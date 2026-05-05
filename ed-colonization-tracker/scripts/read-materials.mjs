#!/usr/bin/env node
// One-shot ship-engineering materials scan.
// Strategy: walk all journal files newest→oldest, find the most recent
// `Materials` event (full snapshot, written on game start), then forward-apply
// every material-changing event that came AFTER that timestamp.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DIR = path.join(os.homedir(), 'Saved Games', 'Frontier Developments', 'Elite Dangerous');

// Sort journals oldest→newest by mtime so we can walk forward from baseline.
const files = fs.readdirSync(DIR)
  .filter((n) => /^Journal\..*\.log$/.test(n))
  .map((n) => ({ name: n, mtime: fs.statSync(path.join(DIR, n)).mtimeMs }))
  .sort((a, b) => a.mtime - b.mtime)
  .map((f) => f.name);

// Pass 1: find latest Materials snapshot (full inventory baseline).
let baseline = null;
let baselineTimestamp = null;
let baselineFile = null;
for (let i = files.length - 1; i >= 0; i--) {
  const lines = fs.readFileSync(path.join(DIR, files[i]), 'utf8').split('\n');
  for (let j = lines.length - 1; j >= 0; j--) {
    const line = lines[j].trim();
    if (!line) continue;
    if (!line.includes('"event":"Materials"')) continue;
    try {
      const ev = JSON.parse(line);
      if (ev.event === 'Materials') {
        baseline = ev;
        baselineTimestamp = ev.timestamp;
        baselineFile = files[i];
        break;
      }
    } catch { /* skip */ }
  }
  if (baseline) break;
}

if (!baseline) {
  console.error('No Materials event found in any journal.');
  process.exit(1);
}

// Build inventory: { raw: {name: count}, manufactured: {...}, encoded: {...} }
const inv = { Raw: {}, Manufactured: {}, Encoded: {} };
const labels = {}; // name → display label
for (const cat of ['Raw', 'Manufactured', 'Encoded']) {
  for (const item of baseline[cat] || []) {
    inv[cat][item.Name] = item.Count;
    if (item.Name_Localised) labels[item.Name] = item.Name_Localised;
  }
}

// Pass 2: forward-apply all delta events after baselineTimestamp.
const adj = (cat, name, delta, nameLocalised) => {
  if (!inv[cat]) return; // skip suit categories
  inv[cat][name] = (inv[cat][name] || 0) + delta;
  if (nameLocalised && !labels[name]) labels[name] = nameLocalised;
};

let deltaEvents = 0;
for (const f of files) {
  const lines = fs.readFileSync(path.join(DIR, f), 'utf8').split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.indexOf('"timestamp"') === -1) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    if (!ev.event || !ev.timestamp) continue;
    if (ev.timestamp <= baselineTimestamp) continue;

    if (ev.event === 'Materials') {
      // Newer full snapshot — reset baseline.
      for (const cat of ['Raw', 'Manufactured', 'Encoded']) {
        inv[cat] = {};
        for (const item of ev[cat] || []) {
          inv[cat][item.Name] = item.Count;
          if (item.Name_Localised) labels[item.Name] = item.Name_Localised;
        }
      }
      continue;
    }
    if (ev.event === 'MaterialCollected') {
      const cat = ev.Category; // "Raw", "Manufactured", "Encoded"
      adj(cat, ev.Name, ev.Count || 1, ev.Name_Localised);
      deltaEvents++;
    } else if (ev.event === 'MaterialDiscarded') {
      adj(ev.Category, ev.Name, -(ev.Count || 1), ev.Name_Localised);
      deltaEvents++;
    } else if (ev.event === 'EngineerCraft' || ev.event === 'EngineerLegacyConvert') {
      for (const m of ev.Ingredients || []) {
        // Need to figure category from name — fall back: try each.
        for (const cat of ['Raw', 'Manufactured', 'Encoded']) {
          if (m.Name in inv[cat]) { adj(cat, m.Name, -(m.Count || 1)); break; }
        }
      }
      deltaEvents++;
    } else if (ev.event === 'Synthesis') {
      for (const m of ev.Materials || []) {
        for (const cat of ['Raw', 'Manufactured', 'Encoded']) {
          if (m.Name in inv[cat]) { adj(cat, m.Name, -(m.Count || 1)); break; }
        }
      }
      deltaEvents++;
    } else if (ev.event === 'TechnologyBroker') {
      for (const m of ev.Materials || []) {
        for (const cat of ['Raw', 'Manufactured', 'Encoded']) {
          if (m.Name in inv[cat]) { adj(cat, m.Name, -(m.Count || 1)); break; }
        }
      }
      deltaEvents++;
    } else if (ev.event === 'MaterialTrade') {
      const paid = ev.Paid;
      const received = ev.Received;
      if (paid && paid.Material) adj(paid.Category, paid.Material, -(paid.Quantity || 0), paid.Material_Localised);
      if (received && received.Material) adj(received.Category, received.Material, +(received.Quantity || 0), received.Material_Localised);
      deltaEvents++;
    } else if (ev.event === 'MissionCompleted') {
      for (const m of ev.MaterialsReward || []) {
        adj(m.Category, m.Name, +(m.Count || 0), m.Name_Localised);
      }
      if (ev.MaterialsReward && ev.MaterialsReward.length) deltaEvents++;
    } else if (ev.event === 'ScientificResearch') {
      adj(ev.Category, ev.Name, -(ev.Count || 0), ev.Name_Localised);
      deltaEvents++;
    } else if (ev.event === 'EngineerContribution') {
      if (ev.Type === 'Material' && ev.Material) {
        for (const cat of ['Raw', 'Manufactured', 'Encoded']) {
          if (ev.Material in inv[cat]) { adj(cat, ev.Material, -(ev.Quantity || 1)); break; }
        }
        deltaEvents++;
      }
    }
  }
}

// Output
console.log(`Baseline: ${baselineFile} (${baselineTimestamp})`);
console.log(`Delta events applied: ${deltaEvents}`);
console.log('');
for (const cat of ['Raw', 'Manufactured', 'Encoded']) {
  const entries = Object.entries(inv[cat])
    .filter(([_, c]) => c > 0)
    .sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [_, c]) => s + c, 0);
  console.log(`=== ${cat.toUpperCase()} (${entries.length} types, ${total} total) ===`);
  for (const [name, count] of entries) {
    const label = labels[name] || name;
    console.log(`  ${String(count).padStart(4)}  ${label}`);
  }
  console.log('');
}
