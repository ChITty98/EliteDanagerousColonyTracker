#!/usr/bin/env node
// Material Trader recommendation: rank current Manufactured stock by trade
// efficiency to acquire a target material at a Material Trader.
//
// Trader rules (same type only — Manufactured trader handles Manufactured):
//   - Up 1 grade:   6:1   (need 6 lower for 1 higher)
//   - Down 1 grade: 1:3   (1 higher gives 3 lower)
//   - Multi-grade compounds: 1 G5 → 27 G2, 1 G5 → 81 G1, etc.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// === Manufactured grade + line table ===
// Line is the "subcategory" inside Manufactured (alloy / chemical / mechanical / etc).
// Within-line trades use the standard ladder (1:6 up, 3:1 down, multiplicative).
// Cross-line trades use a separate cross-category table (per ED wiki).
// Guardian + Thargoid items excluded.
const MANUF_INFO = {
  // [grade, line]
  // Alloy line: Salvaged → Galvanising → Phase → Proto Light → Proto Radiolic
  'Salvaged Alloys':       [1, 'alloy'], 'Galvanising Alloys':   [2, 'alloy'],
  'Phase Alloys':          [3, 'alloy'], 'Proto Light Alloys':   [4, 'alloy'],
  'Proto Radiolic Alloys': [5, 'alloy'],
  // Chemical line: Storage → Processors → Distillery → Manipulators → Pharma Isolators
  'Chemical Storage Units': [1, 'chemical'], 'Chemical Processors':    [2, 'chemical'],
  'Chemical Distillery':    [3, 'chemical'], 'Chemical Manipulators':  [4, 'chemical'],
  'Pharmaceutical Isolators': [5, 'chemical'],
  // Thermal line: Heat Conduction → Dispersion → Exchangers → Vanes → Proto Heat Radiators
  'Heat Conduction Wiring': [1, 'thermal'], 'Heat Dispersion Plate':  [2, 'thermal'],
  'Heat Exchangers':        [3, 'thermal'], 'Heat Vanes':             [4, 'thermal'],
  'Proto Heat Radiators':   [5, 'thermal'],
  // Mechanical line: Scrap → Equipment → Components → Configurable → Improvised
  'Mechanical Scrap':       [1, 'mechanical'], 'Mechanical Equipment':   [2, 'mechanical'],
  'Mechanical Components':  [3, 'mechanical'], 'Configurable Components': [4, 'mechanical'],
  'Improvised Components':  [5, 'mechanical'],
  // Conductive line: Basic → Components → Ceramics → Polymers → Biotech Conductors
  'Basic Conductors':      [1, 'conductive'], 'Conductive Components': [2, 'conductive'],
  'Conductive Ceramics':   [3, 'conductive'], 'Conductive Polymers':   [4, 'conductive'],
  'Biotech Conductors':    [5, 'conductive'],
  // Composite line: Compact → Filament → High Density → Proprietary → Core Dynamics
  'Compact Composites':       [1, 'composite'], 'Filament Composites':       [2, 'composite'],
  'High Density Composites':  [3, 'composite'], 'Proprietary Composites':    [4, 'composite'],
  'Core Dynamics Composites': [5, 'composite'],
  // Crystal line: Crystal Shards → Flawed → Focus → Refined → Exquisite
  'Crystal Shards':         [1, 'crystal'], 'Flawed Focus Crystals':  [2, 'crystal'],
  'Focus Crystals':         [3, 'crystal'], 'Refined Focus Crystals': [4, 'crystal'],
  'Exquisite Focus Crystals': [5, 'crystal'],
  // Capacitor line: Grid Resistors → Hybrid → Electrochemical → Polymer → Military Super
  'Grid Resistors':         [1, 'capacitor'], 'Hybrid Capacitors':      [2, 'capacitor'],
  'Electrochemical Arrays': [3, 'capacitor'], 'Polymer Capacitors':     [4, 'capacitor'],
  'Military Supercapacitors': [5, 'capacitor'],
  // Shield line: Worn Shield Emitters → Shield Emitters → Shielding Sensors → Compound → Imperial
  'Worn Shield Emitters':   [1, 'shield'], 'Shield Emitters':        [2, 'shield'],
  'Shielding Sensors':      [3, 'shield'], 'Compound Shielding':     [4, 'shield'],
  'Imperial Shielding':     [5, 'shield'],
  // Thermal2 line (Tempered alloy variant): Tempered → Heat Resistant Ceramics → Precipitated → Thermic → Military Grade
  'Tempered Alloys':        [1, 'thermal2'], 'Heat Resistant Ceramics': [2, 'thermal2'],
  'Precipitated Alloys':    [3, 'thermal2'], 'Thermic Alloys':          [4, 'thermal2'],
  'Military Grade Alloys':  [5, 'thermal2'],
};
const MANUF_GRADE = Object.fromEntries(Object.entries(MANUF_INFO).map(([k, v]) => [k, v[0]]));
const MANUF_LINE  = Object.fromEntries(Object.entries(MANUF_INFO).map(([k, v]) => [k, v[1]]));

// Cross-line lookup table (per wiki "Conversion to another category"):
// CROSS[input][output] = "X→Y" meaning give X input → get Y output
const CROSS = {
  1: { 1: [6,1],  2: [36,1],  3: [216,1],  4: [1296,1], 5: [7776,1] },
  2: { 1: [2,1],  2: [6,1],   3: [36,1],   4: [216,1],  5: [1296,1] },
  3: { 1: [2,3],  2: [2,1],   3: [6,1],    4: [36,1],   5: [216,1]  },
  4: { 1: [2,9],  2: [2,3],   3: [2,1],    4: [6,1],    5: [36,1]   },
  5: { 1: [2,27], 2: [2,9],   3: [2,3],    4: [2,1],    5: [6,1]    },
};
// Reading: CROSS[input_grade][output_grade] — note wiki table lists "input on top, output on left"
// so e.g. input=5, output=2 → [2,9] = 2 source → 9 target. Per source = 4.5.

// Grade caps: 300, 250, 200, 150, 100 for G1..G5
const CAP = { 1: 300, 2: 250, 3: 200, 4: 150, 5: 100 };

// Target = Mechanical Equipment (G2)
const TARGET = process.argv[2] || 'Mechanical Equipment';
const TARGET_GRADE = MANUF_GRADE[TARGET];
if (!TARGET_GRADE) {
  console.error(`Unknown target: ${TARGET}`);
  console.error('Known Manufactured materials:');
  for (const [name, g] of Object.entries(MANUF_GRADE)) console.error(`  G${g}  ${name}`);
  process.exit(1);
}

// Yield per 1 unit of source.
// sameLine = true → standard ladder (1:6 up, 3:1 down, multiplicative)
// sameLine = false → cross-line table (CROSS[input][output] = [give, get])
function yieldPer(srcGrade, tgtGrade, sameLine) {
  if (srcGrade === tgtGrade && sameLine) return null;
  if (sameLine) {
    if (srcGrade < tgtGrade) return 1 / Math.pow(6, tgtGrade - srcGrade);
    return Math.pow(3, srcGrade - tgtGrade);
  }
  // Cross-line — read from table
  const [give, get] = CROSS[srcGrade][tgtGrade];
  return get / give;
}

// === Read current Manufactured inventory using read-materials logic ===
const DIR = path.join(os.homedir(), 'Saved Games', 'Frontier Developments', 'Elite Dangerous');
const files = fs.readdirSync(DIR)
  .filter((n) => /^Journal\..*\.log$/.test(n))
  .map((n) => ({ name: n, mtime: fs.statSync(path.join(DIR, n)).mtimeMs }))
  .sort((a, b) => a.mtime - b.mtime)
  .map((f) => f.name);

let baseline = null, baselineTimestamp = null;
for (let i = files.length - 1; i >= 0; i--) {
  const lines = fs.readFileSync(path.join(DIR, files[i]), 'utf8').split('\n');
  for (let j = lines.length - 1; j >= 0; j--) {
    const line = lines[j].trim();
    if (!line || !line.includes('"event":"Materials"')) continue;
    try { const ev = JSON.parse(line); if (ev.event === 'Materials') { baseline = ev; baselineTimestamp = ev.timestamp; break; } } catch {}
  }
  if (baseline) break;
}
if (!baseline) { console.error('No Materials event found.'); process.exit(1); }

const inv = {};
const labels = {};
for (const item of baseline.Manufactured || []) {
  const name = item.Name_Localised || item.Name;
  inv[name] = item.Count;
  labels[item.Name] = name;
}
// Apply forward deltas
for (const f of files) {
  const lines = fs.readFileSync(path.join(DIR, f), 'utf8').split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.indexOf('"timestamp"') === -1) continue;
    let ev; try { ev = JSON.parse(line); } catch { continue; }
    if (!ev.event || !ev.timestamp || ev.timestamp <= baselineTimestamp) continue;
    if (ev.event === 'Materials') {
      Object.keys(inv).forEach((k) => delete inv[k]);
      for (const item of ev.Manufactured || []) {
        const name = item.Name_Localised || item.Name;
        inv[name] = item.Count;
      }
    } else if (ev.event === 'MaterialCollected' && ev.Category === 'Manufactured') {
      const name = ev.Name_Localised || ev.Name;
      inv[name] = (inv[name] || 0) + (ev.Count || 1);
    } else if (ev.event === 'MaterialDiscarded' && ev.Category === 'Manufactured') {
      const name = ev.Name_Localised || ev.Name;
      inv[name] = (inv[name] || 0) - (ev.Count || 1);
    } else if (ev.event === 'EngineerCraft' || ev.event === 'Synthesis' || ev.event === 'TechnologyBroker') {
      for (const m of (ev.Ingredients || ev.Materials || [])) {
        const name = m.Name_Localised || m.Name || m.Material_Localised || m.Material;
        if (name in inv) inv[name] = inv[name] - (m.Count || m.Quantity || 1);
      }
    } else if (ev.event === 'MaterialTrade' && ev.Paid && ev.Paid.Category === 'Manufactured') {
      const pname = ev.Paid.Material_Localised || ev.Paid.Material;
      inv[pname] = (inv[pname] || 0) - (ev.Paid.Quantity || 0);
      if (ev.Received && ev.Received.Category === 'Manufactured') {
        const rname = ev.Received.Material_Localised || ev.Received.Material;
        inv[rname] = (inv[rname] || 0) + (ev.Received.Quantity || 0);
      }
    }
  }
}

const TARGET_LINE = MANUF_LINE[TARGET];

// === Rank trades ===
const candidates = [];
for (const [name, count] of Object.entries(inv)) {
  if (count <= 0) continue;
  const grade = MANUF_GRADE[name];
  const line = MANUF_LINE[name];
  if (!grade || !line) continue; // unknown / Guardian / Thargoid — skip
  if (name === TARGET) continue;
  const sameLine = line === TARGET_LINE;
  const yp = yieldPer(grade, TARGET_GRADE, sameLine);
  if (yp == null) continue;

  // Compute max trades & total yield based on whether trading up or down.
  let totalYield, ratioStr;
  if (sameLine) {
    if (grade < TARGET_GRADE) {
      const need = Math.pow(6, TARGET_GRADE - grade);
      const trades = Math.floor(count / need);
      totalYield = trades;
      ratioStr = `${need}:1`;
    } else {
      totalYield = Math.floor(count * yp);
      ratioStr = `1:${Math.pow(3, grade - TARGET_GRADE)}`;
    }
  } else {
    const [give, get] = CROSS[grade][TARGET_GRADE];
    const trades = Math.floor(count / give);
    totalYield = trades * get;
    ratioStr = `${give}:${get}`;
  }
  candidates.push({
    name, count, grade, line, sameLine,
    yieldPerSource: yp,
    totalYield,
    ratioStr,
    cap: CAP[grade],
    capped: count >= CAP[grade],
  });
}

// Sort: same-line first, then by yieldPerSource desc, then by totalYield desc.
candidates.sort((a, b) => {
  if (a.sameLine !== b.sameLine) return a.sameLine ? -1 : 1;
  if (a.yieldPerSource !== b.yieldPerSource) return b.yieldPerSource - a.yieldPerSource;
  return b.totalYield - a.totalYield;
});

console.log(`Target: ${TARGET} (G${TARGET_GRADE}, ${TARGET_LINE} line)`);
console.log(`Always trade WITHIN-LINE first — cross-line is 6× worse.`);
console.log('');
console.log('Source                          Stk Cap  G Line       Same Ratio   Yield');
console.log('─'.repeat(82));
let lastSameLine = null;
for (const c of candidates) {
  if (c.totalYield <= 0) continue;
  if (lastSameLine !== null && lastSameLine !== c.sameLine) {
    console.log('  ─── cross-line below (6× penalty) ───');
  }
  lastSameLine = c.sameLine;
  const cappedTag = c.capped ? '★' : ' ';
  console.log(
    c.name.padEnd(32) +
    String(c.count).padStart(3) + ' ' +
    String(c.cap).padStart(3) + cappedTag + ' G' +
    c.grade + ' ' +
    c.line.padEnd(10) + ' ' +
    (c.sameLine ? 'YES ' : 'no  ') +
    c.ratioStr.padStart(6) + '  ' +
    String(c.totalYield).padStart(5)
  );
}
console.log('');
console.log('★ = at cap (drops are wasted — trade these soon)');
