#!/usr/bin/env node
/**
 * Colonization target ranker.
 *
 * Ranks systems in a region/master file by the project's ESTABLISHED rating
 * model (server/journal/scorer.js scoreSystem, already pre-computed into each
 * system's `score` at extraction time) — stars, rings, proximity clustering,
 * economy diversity, body count. No invented metrics.
 *
 * Layered on top (as practical filters / context, NOT folded into the rating):
 *   - Supply distance to your colony anchors (nearest of N systems)
 *   - Void Cross flag (StellarForge suppression slabs along the X/Z axes)
 *   - Optional economy focus (only systems whose economy set includes it)
 *
 * Usage:
 *   node tools/colonize-rank.mjs --region E:/Spansh/region-ao-master.jsonl
 *   node tools/colonize-rank.mjs --region <file> --anchors "HIP 47126" --radius 150 --top 30
 *   node tools/colonize-rank.mjs --region <file> --economy Extraction --min-score 40
 */

import fs from 'node:fs';

const args = process.argv.slice(2);
const getArg = (n, fb = null) => { const i = args.indexOf(`--${n}`); return i >= 0 && i + 1 < args.length ? args[i + 1] : fb; };

const region = getArg('region');
if (!region || !fs.existsSync(region)) { console.error('need --region <file.jsonl>'); process.exit(1); }
const anchorNames = (getArg('anchors', 'HIP 47126,Col 173 Sector AX-J d9-52,Praea Euq AT-U d2-47'))
  .split(',').map((s) => s.trim()).filter(Boolean);
const radius = parseFloat(getArg('radius', '150'));         // max supply distance (ly) to nearest anchor
const economy = getArg('economy', null);                    // optional economy focus
const minScore = parseFloat(getArg('min-score', '0'));
const topN = parseInt(getArg('top', '25'), 10);
// --warm = F/G/K primary; or explicit --star-class "F,G,K". Null = any class.
const warm = args.includes('--warm');
const starClassArg = getArg('star-class', warm ? 'F,G,K' : null);
const starClasses = starClassArg ? starClassArg.split(',').map((s) => s.trim().toUpperCase()) : null;
// require at least one landable body with a real atmosphere
const needsAtmo = args.includes('--needs-atmo') || args.includes('--atmo-landable');
const minProx = parseInt(getArg('min-prox', '0'), 10);      // min in-system proximity clusters
// Default: drop systems whose ONLY stars are brown dwarfs (iceball factories).
const allowBdOnly = args.includes('--allow-bd-only');
// Exclude already-colonized/populated systems (can't claim an inhabited system).
const uncolonizedOnly = args.includes('--uncolonized');
const minGoodAtmo = parseInt(getArg('min-good-atmo', '0'), 10); // min non-CO2 non-icy atmo bodies
const sortBy = getArg('sort', 'score');                     // score | good-atmo | premium
const maxBodyLs = parseFloat(getArg('max-body-ls', '0'));   // 0 = no cap; else ignore atmo bodies past this distance

const dist = (a, b) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);

// Void Cross: StellarForge suppresses certain star types in slabs |X|<T or |Z|<T
// (the famous X-OR-Z bug). Mostly hits exotic stars, not colony value — informational.
function voidCrossFlag(c) {
  const ax = Math.abs(c.x), az = Math.abs(c.z);
  const inNSBH = ax < 500 || az < 500;     // neutron / black hole suppression
  const inCarbon = ax < 1000 || az < 1000; // carbon-star suppression
  if (inNSBH) return 'CROSS(NS/BH)';
  if (inCarbon) return 'CROSS(carbon)';
  return '';
}

// Stream a jsonl file by raw chunks (bounded memory), invoking onLine per line.
async function streamLines(path, onLine) {
  let tail = '';
  const stream = fs.createReadStream(path, { encoding: 'utf8' });
  for await (const chunk of stream) {
    const text = tail + chunk;
    let start = 0, nl;
    while ((nl = text.indexOf('\n', start)) !== -1) { onLine(text.slice(start, nl)); start = nl + 1; }
    tail = text.slice(start);
  }
  if (tail) onLine(tail);
}

(async () => {
  // Pass 1: resolve anchor coordinates by name
  const anchors = new Map(anchorNames.map((n) => [n.toLowerCase(), null]));
  let remaining = anchors.size;
  await streamLines(region, (line) => {
    if (remaining === 0 || !line) return;
    // cheap name pre-check before JSON.parse
    if (!anchorNames.some((n) => line.includes(`"name":"${n}"`))) return;
    let sys; try { sys = JSON.parse(line); } catch { return; }
    const key = (sys.name || '').toLowerCase();
    if (anchors.has(key) && anchors.get(key) === null && sys.coords) {
      anchors.set(key, sys.coords); remaining--;
    }
  });
  const anchorCoords = [...anchors.entries()].filter(([, c]) => c).map(([n, c]) => ({ name: n, c }));
  if (anchorCoords.length === 0) { console.error(`no anchors resolved from: ${anchorNames.join(', ')}`); process.exit(1); }
  console.error(`anchors: ${anchorCoords.map((a) => a.name).join(' | ')}`);
  const missing = anchorNames.filter((n) => !anchors.get(n.toLowerCase()));
  if (missing.length) console.error(`(not found in region, skipped: ${missing.join(', ')})`);

  // Pass 2: rank
  const candidates = [];
  let scanned = 0, inRadius = 0;
  await streamLines(region, (line) => {
    if (!line) return;
    let sys; try { sys = JSON.parse(line); } catch { return; }
    scanned++;
    const c = sys.coords; const sc = sys.score;
    if (!c || !sc) return;
    let supply = Infinity, near = '';
    for (const a of anchorCoords) { const d = dist(c, a.c); if (d < supply) { supply = d; near = a.name; } }
    if (supply > radius) return;
    inRadius++;
    if (uncolonizedOnly && (sys.population || 0) > 0) return;
    // Warm-star filter: class letter is the first char followed by a space, e.g.
    // "G (White-Yellow) Star". This avoids matching "Black Hole"/"Neutron Star".
    const ms = sys.mainStar || '';
    const cls = (ms.match(/^([OBAFGKMLTY])\s/) || [])[1] || '?';
    if (starClasses && !starClasses.includes(cls)) return;
    // Brown-dwarf-only exclusion: a BD primary is fine if a non-BD companion
    // exists (warmer star → atmo planets); reject only if EVERY star is a BD.
    const starSubs = (sys.bodies || []).filter((b) => b.type === 'Star').map((b) => b.subType || '');
    const knownStars = starSubs.length ? starSubs : (ms ? [ms] : []);
    const bdOnly = knownStars.length > 0 && knownStars.every((s) => /brown dwarf/i.test(s));
    if (bdOnly && !allowBdOnly) return;
    // Landable atmospheric bodies, quality-filtered:
    //  - icy bodies excluded entirely (not wanted)
    //  - CO2 atmospheres counted but treated as boring (goodAtmo excludes them)
    //  - premium = oxygen / ammonia / water (the worthwhile atmospheres)
    //  - optional distance cap drops absurdly-far bodies (e.g. 274k ls outliers)
    let atmoLand = 0, goodAtmo = 0, premium = 0;
    for (const b of (sys.bodies || [])) {
      if (!b.landable || !b.atmo || /no atmosphere/i.test(b.atmo)) continue;
      if (/icy|rocky ice/i.test(b.subType || '')) continue;
      if (maxBodyLs > 0 && (b.distLs || 0) > maxBodyLs) continue;
      atmoLand++;
      if (!/carbon dioxide/i.test(b.atmo)) goodAtmo++;
      if (/oxygen|ammonia|water/i.test(b.atmo)) premium++;
    }
    if (needsAtmo && goodAtmo === 0) return;
    if (goodAtmo < minGoodAtmo) return;
    const prox = sc.proximityCount || 0;
    if (prox < minProx) return;
    if ((sc.total || 0) < minScore) return;
    const econs = sc.uniqueEconomies || [];
    if (economy && !econs.some((e) => e.toLowerCase() === economy.toLowerCase())) return;
    candidates.push({
      name: sys.name, total: sc.total || 0, supply, near, star: cls,
      // app score-object counts (the same numbers the in-game model uses)
      atmoCount: sc.atmosphereCount || 0, oxyCount: sc.oxygenCount || 0,
      ringCount: sc.ringCount || 0, prox, econs, bodyCount: sc.bodyCount || 0,
      // custom body-scan tallies, only used by --sort good-atmo/premium
      atmoLand, goodAtmo, premium,
    });
  });

  const cmp = {
    'good-atmo': (a, b) => b.goodAtmo - a.goodAtmo || b.premium - a.premium || b.prox - a.prox || a.supply - b.supply,
    'premium': (a, b) => b.premium - a.premium || b.goodAtmo - a.goodAtmo || b.prox - a.prox || a.supply - b.supply,
    'score': (a, b) => b.total - a.total || a.supply - b.supply,
  }[sortBy] || ((a, b) => b.total - a.total || a.supply - b.supply);
  candidates.sort(cmp);
  console.error(`scanned ${scanned.toLocaleString()}, ${inRadius.toLocaleString()} within ${radius}ly of an anchor, ${candidates.length.toLocaleString()} passed filters`);
  const withOxy = candidates.filter((c) => c.oxyCount > 0).length;
  console.error(`oxygen-landable systems: ${withOxy.toLocaleString()} of ${candidates.length.toLocaleString()} (${(100 * withOxy / Math.max(1, candidates.length)).toFixed(2)}%)`);
  console.log('');
  console.log(`# Top ${Math.min(topN, candidates.length)} colonization targets (established scoreSystem rating)`);
  console.log(`# rank by score.total; within ${radius}ly supply of [${anchorCoords.map((a) => a.name).join(', ')}]${economy ? `; economy=${economy}` : ''}`);
  console.log(`# sorted by: ${sortBy} (app score.total). atmo/oxy/rings/prox = the app score-object counts.`);
  console.log('score\tstar\tatmo\toxy\trings\tprox\tsupply\tnear\tbodies\tsystem');
  for (const x of candidates.slice(0, topN)) {
    console.log([
      x.total, x.star, x.atmoCount, x.oxyCount, x.ringCount, x.prox, x.supply.toFixed(0) + 'ly',
      x.near.replace(/ sector.*/i, ''), x.bodyCount, x.name,
    ].join('\t'));
  }
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
