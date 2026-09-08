#!/usr/bin/env node
// Seed populated-systems.json (the Map's "Populated" layer) from one of the commander's own Spansh
// regional dumps — the slim JSONL files tools/spansh-index.mjs writes (name, coords, population,
// economies, main star). The live upkeep from the journal stream is server/radar/populatedStore.js;
// this only writes the starting set.
//
//   node scripts/gen-populated-systems.mjs [--in <regional.jsonl>] [--out <populated-systems.json>]
//
// Defaults: region-ao-master.jsonl on E: (August, the union of both areas from the July dump),
// written beside colony-data.json. Rows the live feed has added or refreshed since the last seed
// (live: true in the existing file) survive a reseed: the stream is newer than any dump.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { BUBBLES, inBubble } from '../server/radar/populatedStore.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const input = arg('--in', 'E:/Spansh/region-ao-master.jsonl');
const output = arg('--out', path.join(HERE, '..', 'populated-systems.json'));

if (!fs.existsSync(input)) { console.error(`input not found: ${input}`); process.exit(1); }

// What the stream has added since the last seed — kept over the dump, which is always older.
const liveRows = new Map();
let liveCount = 0;
if (fs.existsSync(output)) {
  try {
    const prev = JSON.parse(fs.readFileSync(output, 'utf8'));
    for (const s of prev.systems || []) if (s && s.live && s.name) liveRows.set(String(s.name).toLowerCase(), s);
    liveCount = prev.live || liveRows.size;
  } catch { /* a fresh seed then */ }
}

const rl = readline.createInterface({ input: fs.createReadStream(input, { encoding: 'utf8' }), crlfDelay: Infinity });
const systems = [];
let scanned = 0; let malformed = 0; let outside = 0;
for await (const raw of rl) {
  scanned++;
  if (!raw.includes('"population":') || raw.includes('"population":0,') || raw.includes('"population":0}')) continue;
  let s;
  try { s = JSON.parse(raw.replace(/,\s*$/, '')); } catch { malformed++; continue; }
  const pop = Number(s.population);
  const c = s.coords || {};
  if (!(pop > 0) || !s.name || ![c.x, c.y, c.z].every(Number.isFinite)) continue;
  if (!inBubble([c.x, c.y, c.z])) { outside++; continue; }
  systems.push({
    id64: s.id64 ?? null, name: s.name, x: c.x, y: c.y, z: c.z, pop,
    economy: s.economy || null, economy2: s.secondEconomy || null, star: s.mainStar || null,
    at: null, live: false,
  });
}
// Merge: the dump first, then every live row over it (same name → the stream's reading wins).
const byName = new Map(systems.map((s) => [s.name.toLowerCase(), s]));
for (const [k, s] of liveRows) byName.set(k, s);
const merged = [...byName.values()].sort((a, b) => b.pop - a.pop);
const out = {
  generatedAt: new Date().toISOString(),
  source: path.basename(input),
  centre: BUBBLES[0], radiusLy: BUBBLES[0].radiusLy, bubbles: BUBBLES,
  live: liveCount, count: merged.length, systems: merged,
};
fs.writeFileSync(output, JSON.stringify(out));
console.log(`${merged.length} populated systems across ${BUBBLES.map((b) => `${b.radiusLy} ly of ${b.name}`).join(' + ')} (${liveRows.size} live rows kept) → ${output}`);
console.log(`scanned ${scanned.toLocaleString()} lines · ${outside} populated but outside the bubble · ${malformed} malformed · ${(fs.statSync(output).size / 1024).toFixed(0)} KB`);
