#!/usr/bin/env node
/**
 * What does an OXYGEN non-icy landable orbit? Specifically: how often is the
 * oxygen world a MOON OF A BROWN DWARF (warmed locally by the BD, not the system
 * primary) — the Col 173 AX-J d9-52 configuration — and how often a RINGED one?
 *
 * Parent is inferred from ED body-name hierarchy: "<sys> 2 a" -> parent "<sys> 2".
 * (A brown dwarf can carry a planet-style numeric designation, e.g. d9-52 "2".)
 * Limitation: only the IMMEDIATE parent is checked (a moon of a planet that
 * itself orbits a BD counts as "moon of a planet").
 *
 * Usage: node tools/analyze-oxygen-host.mjs [E:/Spansh/region-ao-master.jsonl]
 */
import { streamLines } from './lib/stream.mjs';
import { ICY_SUBTYPES, isColonisableAtmosphere } from '../server/journal/scorer.js';

const isOxy = (b) => b.type === 'Planet' && b.landable && isColonisableAtmosphere(b.atmo)
  && !ICY_SUBTYPES.has(b.subType || '') && /oxygen/i.test(b.atmo || '');
const isBD = (st) => /brown dwarf/i.test(st || '');
const file = process.argv[2] || 'E:/Spansh/region-ao-master.jsonl';

let oxy = 0;
const host = { bdRinged: 0, bdPlain: 0, otherStar: 0, planetMoon: 0, rootStar: 0, unknownParent: 0 };
const ex = [];

await streamLines(file, (line) => {
  if (!line) return;
  let sys; try { sys = JSON.parse(line); } catch { return; }
  const bodies = sys.bodies || [];
  if (!bodies.length) return;
  const byName = new Map(bodies.map((b) => [b.name, b]));
  const sysName = sys.name || '';
  for (const b of bodies) {
    if (!isOxy(b)) continue;
    oxy++;
    let pName = null;
    if (b.name && b.name.startsWith(sysName)) {
      const toks = b.name.slice(sysName.length).trim().split(/\s+/).filter(Boolean);
      if (toks.length > 1) { toks.pop(); pName = (sysName + ' ' + toks.join(' ')).trim(); }
    }
    if (!pName) { host.rootStar++; continue; }
    const p = byName.get(pName);
    if (!p) { host.unknownParent++; continue; }
    if (p.type === 'Star') {
      if (isBD(p.subType)) { if (p.rings) { host.bdRinged++; if (ex.length < 12) ex.push(b.name + '  (parent: ' + p.subType + ', ringed)'); } else host.bdPlain++; }
      else host.otherStar++;
    } else if (p.type === 'Planet') host.planetMoon++;
    else host.unknownParent++;
  }
});

const pct = (n) => ((100 * n) / oxy).toFixed(1) + '%';
console.log(`oxygen non-icy landables found: ${oxy}\n`);
console.log('immediate host of the oxygen body:');
console.log(`  moon of a RINGED brown dwarf : ${host.bdRinged}\t${pct(host.bdRinged)}   <-- Col 173 AX-J d9-52 config`);
console.log(`  moon of a plain brown dwarf  : ${host.bdPlain}\t${pct(host.bdPlain)}`);
console.log(`  moon of another star         : ${host.otherStar}\t${pct(host.otherStar)}`);
console.log(`  moon of a planet             : ${host.planetMoon}\t${pct(host.planetMoon)}`);
console.log(`  orbits the main star directly: ${host.rootStar}\t${pct(host.rootStar)}`);
console.log(`  parent not in records        : ${host.unknownParent}\t${pct(host.unknownParent)}`);
console.log(`\n  (brown-dwarf-hosted total: ${host.bdRinged + host.bdPlain} = ${pct(host.bdRinged + host.bdPlain)})`);
console.log('\nexamples of ringed-BD oxygen moons:');
for (const e of ex) console.log('  ' + e);
