#!/usr/bin/env node
/**
 * Sky-drama query: find NON-populated systems where a landable non-icy atmo
 * body has something HUGE dominating the sky.
 *
 *   node tools/sky-drama.mjs [INDEX] [OUT]
 *
 * Scenarios:
 *   A. Moon ≤2 Ls from ringed parent (rings fill sky)
 *   B. Moon ≤2 Ls from non-ringed gas giant (planet disk dominates)
 *   C. Twin atmos: 2+ landable atmo siblings sharing parent with Δ ≤2 Ls
 *   D. Landable has a moon ≤2 Ls above it (moon looms)
 *   E. Landable ≤10 Ls from O/B/WR/Neutron/BH/Giant/Supergiant/Carbon main star
 *   F. Landable ≤5 Ls from any main star (close sun)
 *   TRIPLE: A + C on same body
 *
 * Output: JSON list + top-30 composite + top-10 per category.
 */

import fs from 'node:fs';
import readline from 'node:readline';

const INDEX = process.argv[2] || 'E:/Spansh/region-col173-axj-d9-52-700.jsonl';
const OUT = process.argv[3] || 'E:/Spansh/sky-drama.json';

const AX_J_D9_52 = { x: 1021.75, y: -82.65625, z: 69.375 };

const W = {
  A: 10, A_RARE_BONUS: 5,     // moon just outside outer ring edge ("amongst rings")
  B1: 12,                       // moon actually inside ring material (ringInner ≤ sma ≤ ringOuter)
  B2: 7,                        // moon in clear gap between parent and rings (sma < ringInner)
  B_NONRING: 8,                 // close to non-ringed gas giant
  C: 18, C_BOTH_RARE_BONUS: 5,
  D: 10,
  E: 12,
  F: 8,
  TRIPLE: 15,
};

const RARE_ATMOS_RE = /(oxygen|ammonia|nitrogen|water|methane-rich|argon-rich)/i;
const NO_ATMO_RE = /^no atmosphere$/i;
const ICY_RE = /icy|rocky ice/i;
const GAS_GIANT_RE = /gas giant|class (i|ii|iii|iv|v)/i;
const HUGE_PARENT_RE = /gas giant|brown dwarf/i;  // only these dominate sky when ringed
const SPECIAL_STAR_RE = /^(O |B |WR|Wolf-Rayet|Neutron|Black Hole|Carbon)/i;
const GIANT_STAR_RE = /(giant|supergiant)/i;
const RARE_OXY_WATER_RE = /oxygen|water/i;

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
let populated = 0;
const t0 = Date.now();

const rs = fs.createReadStream(INDEX, { highWaterMark: 1<<20 });
const rl = readline.createInterface({ input: rs });

for await (const line of rl) {
  scanned++;
  if (scanned % 200000 === 0) {
    const elapsed = (Date.now() - t0) / 1000;
    process.stderr.write(`  ${scanned} scanned, ${results.length} candidates, ${populated} populated, ${Math.round(scanned/elapsed)} sys/s\n`);
  }
  if (!line) continue;
  let sys;
  try { sys = JSON.parse(line); } catch { continue; }
  if (!sys || !sys.coords) continue;

  if (sys.population && sys.population > 0) {
    populated++;
    populatedCoords.push(sys.coords);
    if (sys.name === 'HIP 47126') hip47126Coords = sys.coords;
    continue;
  }

  const bodies = sys.bodies || [];
  if (bodies.length === 0) continue;

  const candidates = bodies.filter(b =>
    b.landable &&
    b.atmo &&
    !NO_ATMO_RE.test(b.atmo) &&
    !ICY_RE.test(b.subType || '') &&
    (b.distLs || 0) <= 4000
  );
  if (candidates.length === 0) continue;

  // Index by suffix for parent/sibling/child lookup
  const bySuffix = new Map();
  for (const b of bodies) {
    const sfx = bodySuffix(sys.name, b.name);
    if (sfx != null) bySuffix.set(sfx, b);
  }

  const mainStarSub = sys.mainStar;

  for (const body of candidates) {
    let score = 0;
    const tags = [];
    const sfx = bodySuffix(sys.name, body.name);
    const pSfx = parentSuffix(sfx);
    const parent = pSfx != null ? bySuffix.get(pSfx) : null;
    const bodyRare = RARE_ATMOS_RE.test(body.atmo);
    const bodyDist = body.distLs || 0;

    // A/B1/B2: geometry around a ringed GG / brown dwarf parent, using sma vs ringInner+ringOuter.
    // A  — moon just outside outer ring edge (100-150% of ringOuter) — "amongst rings"
    // B1 — moon IN ring material (ringInner ≤ sma ≤ ringOuter) — embedded
    // B2 — moon in clear gap between parent and rings (sma < ringInner, above artifact threshold)
    let hitA = false;
    let hitB = false;  // B1 or B2, used by TRIPLE calc
    if (parent && parent.rings === true && HUGE_PARENT_RE.test(parent.subType || '')
        && typeof body.sma === 'number' && typeof parent.ringOuter === 'number' && parent.ringOuter > 0
        && typeof parent.ringInner === 'number' && parent.ringInner > 0) {
      const sma = body.sma;
      const inner = parent.ringInner;
      const outer = parent.ringOuter;
      if (sma > outer && sma <= outer * 1.5) {
        // A: past outer edge but within 50% beyond
        score += W.A;
        if (RARE_OXY_WATER_RE.test(body.atmo)) score += W.A_RARE_BONUS;
        const pct = (sma / outer * 100).toFixed(0);
        tags.push(`A:edge(${parent.subType?.replace(/\s*gas giant.*/i,'GG')||'?'},sma=${sma.toFixed(2)}/outer=${outer.toFixed(2)},${pct}%)`);
        hitA = true;
      } else if (sma >= inner && sma <= outer) {
        // B1: embedded in ring material
        score += W.B1;
        if (RARE_OXY_WATER_RE.test(body.atmo)) score += W.A_RARE_BONUS;
        tags.push(`B1:in-rings(${parent.subType?.replace(/\s*gas giant.*/i,'GG')||'?'},sma=${sma.toFixed(2)},rings=${inner.toFixed(2)}-${outer.toFixed(2)})`);
        hitB = true;
      } else if (sma < inner && sma >= inner * 0.5 && sma >= 0.15) {
        // B2: clear gap between parent and ring inner edge (filtered for artifacts)
        score += W.B2;
        tags.push(`B2:gap(${parent.subType?.replace(/\s*gas giant.*/i,'GG')||'?'},sma=${sma.toFixed(2)},inner=${inner.toFixed(2)})`);
        hitB = true;
      }
    }

    // B_NONRING: close to big parent that has NO rings
    if (!hitA && !hitB && parent && GAS_GIANT_RE.test(parent.subType || '') && parent.rings !== true
        && typeof body.sma === 'number' && body.sma <= 3) {
      score += W.B_NONRING;
      tags.push(`B_nonring:giant(sma=${body.sma.toFixed(2)}Ls)`);
    }

    // C: landable-atmo sibling with similar SMA (orbits at similar radius around same parent).
    // Uses sma-delta, not distLs-delta. If either sma missing, fall back to distLs delta.
    let hitC = false;
    if (pSfx != null) {
      let nearestSib = null;
      for (const [s, b2] of bySuffix) {
        if (b2 === body) continue;
        if (parentSuffix(s) !== pSfx) continue;
        if (!b2.landable || !b2.atmo || NO_ATMO_RE.test(b2.atmo) || ICY_RE.test(b2.subType || '')) continue;
        let delta, via;
        if (typeof body.sma === 'number' && typeof b2.sma === 'number') {
          delta = Math.abs(body.sma - b2.sma);
          via = 'sma';
        } else {
          delta = Math.abs(bodyDist - (b2.distLs || 0));
          via = 'distLs';
        }
        if (delta <= 2 && (!nearestSib || delta < nearestSib.delta)) {
          nearestSib = { body: b2, delta, via };
        }
      }
      if (nearestSib) {
        score += W.C;
        if (bodyRare && RARE_ATMOS_RE.test(nearestSib.body.atmo)) score += W.C_BOTH_RARE_BONUS;
        tags.push(`C:twin(${nearestSib.body.atmo.replace(/-rich atmosphere/i,'')},Δ${nearestSib.via}=${nearestSib.delta.toFixed(1)})`);
        hitC = true;
      }
    }

    // D: candidate has a child (its own moon). Uses child's sma (= distance to candidate).
    // If sma missing, fall back to distLs delta.
    let nearestChild = null;
    for (const [s, b2] of bySuffix) {
      if (parentSuffix(s) !== sfx) continue;
      let delta, via;
      if (typeof b2.sma === 'number') {
        delta = b2.sma;
        via = 'sma';
      } else {
        delta = Math.abs(bodyDist - (b2.distLs || 0));
        via = 'distLs';
      }
      if (delta <= 2 && (!nearestChild || delta < nearestChild.delta)) {
        nearestChild = { body: b2, delta, via };
      }
    }
    if (nearestChild) {
      score += W.D;
      tags.push(`D:moon(${nearestChild.via}=${nearestChild.delta.toFixed(1)}Ls)`);
    }

    // E / F: arrival star
    if (mainStarSub) {
      const isSpecial = SPECIAL_STAR_RE.test(mainStarSub) || GIANT_STAR_RE.test(mainStarSub);
      if (isSpecial && bodyDist <= 50) {
        score += W.E;
        tags.push(`E:exotic(${mainStarSub},${bodyDist.toFixed(0)}Ls)`);
      } else if (bodyDist <= 5) {
        score += W.F;
        tags.push(`F:sun(${mainStarSub},${bodyDist.toFixed(1)}Ls)`);
      }
    }

    // Triple: (A or B1 or B2) + C
    if ((hitA || hitB) && hitC) {
      score += W.TRIPLE;
      tags.push('TRIPLE');
    }

    if (score > 0) {
      results.push({
        sysName: sys.name,
        sysCoords: sys.coords,
        bodyName: body.name,
        bodySuffix: sfx,
        bodyAtmo: body.atmo,
        bodySubType: body.subType,
        bodyGravity: body.gravity,
        bodyDistLs: bodyDist,
        bodyRare,
        bodyTerraform: body.terraform,
        bodyBioSignals: body.bioSignals || 0,
        mainStar: mainStarSub,
        sysScore: sys.score,
        score,
        tags,
      });
    }
  }
}

process.stderr.write(`\n[scan] ${scanned} systems, ${results.length} candidates, ${populated} populated\n`);
process.stderr.write(`[scan] HIP 47126 in populated: ${!!hip47126Coords}\n`);

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

results.sort((a, b) => b.score - a.score || a.anchorDistLy - b.anchorDistLy);

fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
process.stderr.write(`[done] wrote ${OUT} with ${results.length} entries in ${((Date.now()-t0)/1000).toFixed(1)}s\n`);

function fmt(r) {
  return `${String(r.score).padStart(3)} | ${r.sysName} | ${r.bodySuffix} | ${r.bodyAtmo.replace(/ atmosphere/i,'')}${r.bodyTerraform==='Terraformable'?' [T]':''} | anchor ${r.anchorDistLy.toFixed(0)} ly (${r.anchorName}) | pop ${r.popDistLy.toFixed(0)} ly | ${r.tags.join(' ')}`;
}

process.stdout.write('\n=== TOP 40 COMPOSITE ===\n');
for (const r of results.slice(0, 40)) process.stdout.write(fmt(r) + '\n');

for (const cat of ['TRIPLE', 'A', 'B', 'C', 'D', 'E', 'F']) {
  const catResults = results.filter(r => r.tags.some(t => t === cat || t.startsWith(cat + ':'))).slice(0, 10);
  if (catResults.length === 0) continue;
  process.stdout.write(`\n=== TOP 10 — ${cat} ===\n`);
  for (const r of catResults) process.stdout.write(fmt(r) + '\n');
}
