#!/usr/bin/env node
/**
 * Thin Water atmosphere landable bodies in the 700 ly bubble.
 * No sky-drama requirements — just pure water-atmo inventory.
 *
 *   node tools/water-atmo.mjs [INDEX] [OUT]
 *
 * Filters:
 *   - Body landable
 *   - Body has Thin Water atmosphere (also Thin Water-rich if --include-rich)
 *   - Body not icy
 *   - Body ≤4000 Ls from arrival star
 *   - System population = 0
 *
 * Output columns: system, body, atmo, grav, distLs-from-arrival, parent type,
 * anchor distance (min HIP 47126 / AX-J d9-52), populated distance.
 */

import fs from 'node:fs';
import readline from 'node:readline';

const INDEX = process.argv[2] || 'E:/Spansh/region-col173-axj-d9-52-700.jsonl';
const OUT = process.argv[3] || 'E:/Spansh/water-atmo.json';
const INCLUDE_RICH = process.argv.includes('--include-rich');

const AX_J_D9_52 = { x: 1021.75, y: -82.65625, z: 69.375 };
const WATER_RE = INCLUDE_RICH ? /water/i : /^thin water$/i;
const ICY_RE = /icy|rocky ice/i;

function sqDist(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return dx*dx + dy*dy + dz*dz;
}
function bodySuffix(sysName, bodyName) {
  if (!bodyName) return null;
  if (bodyName === sysName) return '';
  if (bodyName.startsWith(sysName + ' ')) return bodyName.slice(sysName.length + 1);
  if (bodyName.startsWith(sysName)) return bodyName.slice(sysName.length).trim();
  return bodyName;
}
function parentSuffix(suffix) {
  if (!suffix) return null;
  const tokens = suffix.split(/\s+/);
  if (tokens.length <= 1) return null;
  return tokens.slice(0, -1).join(' ');
}

const results = [];
const populatedCoords = [];
let hip47126Coords = null;
let scanned = 0;
const t0 = Date.now();

const rs = fs.createReadStream(INDEX, { highWaterMark: 1<<20 });
const rl = readline.createInterface({ input: rs });

for await (const line of rl) {
  scanned++;
  if (scanned % 200000 === 0) {
    process.stderr.write(`  ${scanned} scanned, ${results.length} water landables\n`);
  }
  if (!line) continue;
  let sys;
  try { sys = JSON.parse(line); } catch { continue; }
  if (!sys || !sys.coords) continue;

  if (sys.population && sys.population > 0) {
    populatedCoords.push(sys.coords);
    if (sys.name === 'HIP 47126') hip47126Coords = sys.coords;
    continue;
  }

  const bodies = sys.bodies || [];
  if (bodies.length === 0) continue;

  const bySuffix = new Map();
  for (const b of bodies) {
    const sfx = bodySuffix(sys.name, b.name);
    if (sfx != null) bySuffix.set(sfx, b);
  }

  for (const body of bodies) {
    if (!body.landable) continue;
    if (!body.atmo || !WATER_RE.test(body.atmo)) continue;
    if (ICY_RE.test(body.subType || '')) continue;
    const bodyDist = body.distLs || 0;
    if (bodyDist > 4000) continue;

    const sfx = bodySuffix(sys.name, body.name);
    const pSfx = parentSuffix(sfx);
    const parent = pSfx != null ? bySuffix.get(pSfx) : null;

    // Sibling count (any landable atmo, any atmo type)
    let atmoSiblings = 0;
    if (pSfx != null) {
      for (const [s, b2] of bySuffix) {
        if (b2 === body) continue;
        if (parentSuffix(s) !== pSfx) continue;
        if (b2.landable && b2.atmo && b2.atmo !== 'No atmosphere') atmoSiblings++;
      }
    }

    // Water siblings specifically
    let waterSiblings = 0;
    if (pSfx != null) {
      for (const [s, b2] of bySuffix) {
        if (b2 === body) continue;
        if (parentSuffix(s) !== pSfx) continue;
        if (b2.landable && b2.atmo && WATER_RE.test(b2.atmo)) waterSiblings++;
      }
    }

    // Ring proximity using actual sma + ringOuter when available
    let inRingsPct = null;  // body.sma as % of parent.ringOuter — <100 means inside rings
    if (parent && parent.rings === true && typeof body.sma === 'number' && typeof parent.ringOuter === 'number') {
      inRingsPct = body.sma / parent.ringOuter * 100;
    }

    results.push({
      sysName: sys.name,
      sysCoords: sys.coords,
      bodyName: body.name,
      bodySuffix: sfx,
      bodyAtmo: body.atmo,
      bodySubType: body.subType,
      bodyGravity: body.gravity,
      bodyDistLs: bodyDist,
      bodySma: body.sma,
      parentSubType: parent ? parent.subType : null,
      parentRinged: parent ? parent.rings === true : false,
      parentRingOuter: parent ? parent.ringOuter : null,
      parentDeltaLs: parent ? Math.abs(bodyDist - (parent.distLs || 0)) : null,
      inRingsPct,
      atmoSiblings,
      waterSiblings,
      mainStar: sys.mainStar,
    });
  }
}

process.stderr.write(`\n[scan] ${scanned} systems, ${results.length} water landables\n`);
process.stderr.write(`[scan] HIP 47126 found: ${!!hip47126Coords}\n`);

process.stderr.write('[post] computing distances...\n');
for (const r of results) {
  let minPop = Infinity;
  for (const p of populatedCoords) {
    const d2 = sqDist(r.sysCoords, p);
    if (d2 < minPop) minPop = d2;
  }
  r.popDistLy = Math.sqrt(minPop);
  const dHip = hip47126Coords ? Math.sqrt(sqDist(r.sysCoords, hip47126Coords)) : Infinity;
  const dAxj = Math.sqrt(sqDist(r.sysCoords, AX_J_D9_52));
  r.hipDistLy = dHip;
  r.axjDistLy = dAxj;
  if (dAxj <= dHip) { r.anchorDistLy = dAxj; r.anchorName = 'AX-J d9-52'; }
  else              { r.anchorDistLy = dHip; r.anchorName = 'HIP 47126'; }
}

results.sort((a, b) => a.anchorDistLy - b.anchorDistLy);

fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
process.stderr.write(`[done] ${results.length} entries in ${((Date.now()-t0)/1000).toFixed(1)}s → ${OUT}\n`);

function fmt(r) {
  const parent = r.parentSubType ? `${r.parentSubType}${r.parentRinged?'(rings)':''}` : '(arrival)';
  const sibStr = r.waterSiblings > 0 ? ` | ${r.waterSiblings} water-atmo siblings` : r.atmoSiblings > 0 ? ` | ${r.atmoSiblings} atmo siblings` : '';
  const smaStr = r.bodySma != null ? ` sma=${r.bodySma.toFixed(2)}Ls` : '';
  const ringStr = r.inRingsPct != null
    ? ` [ring=${r.parentRingOuter.toFixed(2)}Ls, moon at ${r.inRingsPct.toFixed(0)}% — ${r.inRingsPct <= 100 ? 'IN RINGS' : r.inRingsPct <= 120 ? 'grazing' : 'outside'}]`
    : '';
  return `${r.sysName} | ${r.bodySuffix} | ${r.bodyAtmo} | ${r.bodyGravity?.toFixed(2)||'?'}g | ${r.bodyDistLs}Ls from star |${smaStr} parent: ${parent}${ringStr} | anchor ${r.anchorDistLy.toFixed(0)} ly (${r.anchorName}) | pop ${r.popDistLy.toFixed(0)} ly${sibStr}`;
}

process.stdout.write('\n=== TOP 50 by closest-to-you ===\n');
for (const r of results.slice(0, 50)) process.stdout.write(fmt(r) + '\n');

process.stdout.write('\n=== TOP 20 by closest-to-populated ===\n');
const byPop = [...results].sort((a,b) => a.popDistLy - b.popDistLy);
for (const r of byPop.slice(0, 20)) process.stdout.write(fmt(r) + '\n');

process.stdout.write('\n=== Parent body-type breakdown ===\n');
const parentTypes = {};
for (const r of results) {
  const key = r.parentSubType || '(arrival star direct)';
  parentTypes[key] = (parentTypes[key] || 0) + 1;
}
for (const [k, v] of Object.entries(parentTypes).sort((a,b) => b[1]-a[1])) {
  process.stdout.write(`  ${String(v).padStart(4)} | ${k}\n`);
}
