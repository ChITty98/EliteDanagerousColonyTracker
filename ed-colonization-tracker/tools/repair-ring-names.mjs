// tools/repair-ring-names.mjs
//
// One-shot repair: fill the ring back in on rocks that logged without one.
//
// WHY THEY ARE MISSING: currentRing lived only in memory, so restarting the exe while parked in a
// ring lost it with no event left to recover from until the commander flew out and back. Every rock
// prospected in between logged ring-less. v1.49.0 stopped it happening (seedRingContext re-derives
// the ring at boot); this repairs what was already lost — 45 rocks, including the single best rock
// in the log, which was also detached from its hotspot mark because those key on ring NAME.
//
// The ring IS recoverable: the journals recorded the SupercruiseExit into the ring all along, the
// app just wasn't running to see it. This replays that history and matches by timestamp.
//
// SAFETY: the log is append-only by design, so this is the one thing that rewrites it. It backs up
// first, only ever FILLS BLANK fields (never overwrites a ring that is already set), and refuses to
// run while the exe holds the file.
//
//   node tools/repair-ring-names.mjs --dry-run
//   node tools/repair-ring-names.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LOG = path.join(ROOT, 'mining-log.jsonl');
const RINGS = path.join(ROOT, 'mining-rings.json');
const JOURNAL_DIR = process.env.ED_JOURNAL_DIR
  || path.join(process.env.USERPROFILE || '', 'Saved Games', 'Frontier Developments', 'Elite Dangerous');

const DRY = process.argv.includes('--dry-run');

function fail(msg) { console.error(`\n  ${msg}\n`); process.exit(1); }

if (!fs.existsSync(LOG)) fail(`No mining log at ${LOG}`);
if (!fs.existsSync(JOURNAL_DIR)) fail(`No journal directory at ${JOURNAL_DIR}`);

// ── Replay ring context from the journals ───────────────────────────────────────────────────
// Files sorted by MTIME, never by name: pre-2022 journals (Journal.YYMMDD…) sort AFTER 2026 ISO
// names alphabetically, which would scramble the timeline.
const files = fs.readdirSync(JOURNAL_DIR)
  .filter((f) => /^Journal\..+\.log$/i.test(f))
  .map((f) => { const p = path.join(JOURNAL_DIR, f); return { p, m: fs.statSync(p).mtimeMs }; })
  .sort((a, b) => a.m - b.m);

/** [{ t: epoch ms, ring: string|null }] — every moment the ring context changed. */
const timeline = [];
for (const { p } of files) {
  let text;
  try { text = fs.readFileSync(p, 'utf8'); } catch { continue; }
  if (!/SupercruiseExit|SupercruiseEntry|"Location"|FSDJump|Shutdown/.test(text)) continue;
  for (const line of text.split('\n')) {
    if (!/"(SupercruiseExit|SupercruiseEntry|Location|FSDJump|Shutdown)"/.test(line)) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    const t = Date.parse(ev.timestamp);
    if (!Number.isFinite(t)) continue;
    if (ev.event === 'SupercruiseExit' || ev.event === 'Location') {
      timeline.push({ t, ring: ev.BodyType === 'PlanetaryRing' && ev.Body ? ev.Body : null });
    } else {
      timeline.push({ t, ring: null }); // entry / jump / shutdown all end it
    }
  }
}
timeline.sort((a, b) => a.t - b.t);
console.log(`replayed ${timeline.length} ring-context transitions from ${files.length} journals`);

/** The ring in effect at time t — the last transition at or before it. */
function ringAt(t) {
  let lo = 0, hi = timeline.length - 1, best = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (timeline[mid].t <= t) { best = timeline[mid]; lo = mid + 1; } else hi = mid - 1;
  }
  return best ? best.ring : null;
}

// Ring class / reserve, so repaired rows carry the same columns a live row would.
let ringIndex = {};
try { ringIndex = JSON.parse(fs.readFileSync(RINGS, 'utf8')); } catch { /* optional */ }
const meta = (name) => ringIndex.rings?.[name] || ringIndex.allRings?.[name] || null;

// ── Repair ──────────────────────────────────────────────────────────────────────────────────
const lines = fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean);
let blank = 0, fixed = 0, unresolved = 0;
const out = [];
const bySystem = {};

for (const line of lines) {
  let r;
  try { r = JSON.parse(line); } catch { out.push(line); continue; }
  if (r.ring) { out.push(line); continue; }      // never overwrite an existing ring
  blank++;
  const t = Date.parse(r.t);
  const ring = Number.isFinite(t) ? ringAt(t) : null;
  if (!ring) { unresolved++; out.push(line); continue; }

  // A ring from a different system means the timeline and the rock disagree — leave it alone
  // rather than stamp a confident wrong answer.
  if (r.sys && !ring.toLowerCase().startsWith(String(r.sys).toLowerCase())) {
    unresolved++;
    out.push(line);
    continue;
  }

  const m = meta(ring);
  r.ring = ring;
  if (!r.ringClass && m?.ringClass) r.ringClass = String(m.ringClass).replace(/^eRingClass_/, '');
  if (!r.reserve && m?.reserve) r.reserve = m.reserve;
  r.ringRepaired = true; // honest marker: this row was reconstructed, not observed
  fixed++;
  bySystem[ring] = (bySystem[ring] || 0) + 1;
  out.push(JSON.stringify(r));
}

console.log(`\n${lines.length} rocks · ${blank} with no ring · ${fixed} repairable · ${unresolved} left alone`);
for (const [ring, n] of Object.entries(bySystem).sort((a, b) => b[1] - a[1])) {
  console.log(`   ${String(n).padStart(3)}  ${ring}`);
}

if (!fixed) { console.log('\nnothing to do.\n'); process.exit(0); }

if (DRY) { console.log('\n--dry-run: nothing written.\n'); process.exit(0); }

const backup = `${LOG}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
fs.copyFileSync(LOG, backup);
fs.writeFileSync(LOG, out.join('\n') + '\n', 'utf8');
console.log(`\nbacked up to ${path.basename(backup)}`);
console.log(`repaired ${fixed} rock(s).\n`);
