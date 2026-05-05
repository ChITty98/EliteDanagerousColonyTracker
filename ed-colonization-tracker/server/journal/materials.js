/**
 * Server-side ship-engineering materials extractor.
 *
 * Strategy: ship engineering materials (Raw / Manufactured / Encoded) have NO
 * live snapshot file from ED. State must be derived from journal events:
 *   - `Materials` event: full snapshot, written every game start. Newest one
 *     wins as the baseline.
 *   - Forward-applied delta events: MaterialCollected (+), MaterialDiscarded (-),
 *     EngineerCraft / Synthesis / TechnologyBroker / EngineerContribution /
 *     ScientificResearch (consume), MaterialTrade (swap), MissionCompleted
 *     (rewards).
 *
 * Returns `{ raw, manufactured, encoded }` keyed by canonical journal Name
 * (lowercase). Display-name labels can be looked up client-side from
 * src/data/engineeringMaterials.ts.
 */

import fs from 'node:fs';
import path from 'node:path';

const JOURNAL_RX = /^Journal\..*\.log$/;

/** Sort journal files oldest→newest by mtime. */
function listJournalFiles(dir) {
  const files = fs.readdirSync(dir).filter((n) => JOURNAL_RX.test(n));
  return files
    .map((n) => ({ name: n, mtime: fs.statSync(path.join(dir, n)).mtimeMs }))
    .sort((a, b) => a.mtime - b.mtime)
    .map((f) => f.name);
}

/** Fast scan: find latest `Materials` event walking newest→oldest. */
function findLatestMaterialsBaseline(dir, files) {
  for (let i = files.length - 1; i >= 0; i--) {
    const lines = fs.readFileSync(path.join(dir, files[i]), 'utf8').split('\n');
    for (let j = lines.length - 1; j >= 0; j--) {
      const line = lines[j].trim();
      if (!line || !line.includes('"event":"Materials"')) continue;
      try {
        const ev = JSON.parse(line);
        if (ev.event === 'Materials') {
          return { ev, file: files[i] };
        }
      } catch { /* skip malformed line */ }
    }
  }
  return null;
}

function emptyInv() {
  return { raw: {}, manufactured: {}, encoded: {} };
}

function loadBaseline(ev, inv) {
  for (const cat of ['Raw', 'Manufactured', 'Encoded']) {
    const target = cat.toLowerCase();
    for (const item of ev[cat] || []) {
      const id = (item.Name || '').toLowerCase();
      if (!id) continue;
      inv[target][id] = item.Count;
    }
  }
}

/** Apply a single delta event to the inventory. Returns true if inv changed. */
function applyDeltaEvent(ev, inv) {
  if (!ev || !ev.event) return false;

  const adj = (cat, name, delta) => {
    if (!cat || !name || !inv[cat]) return;
    const id = name.toLowerCase();
    inv[cat][id] = (inv[cat][id] || 0) + delta;
    if (inv[cat][id] < 0) inv[cat][id] = 0;
  };

  switch (ev.event) {
    case 'Materials':
      // Full snapshot — overwrite.
      for (const cat of ['raw', 'manufactured', 'encoded']) {
        Object.keys(inv[cat]).forEach((k) => delete inv[cat][k]);
      }
      loadBaseline(ev, inv);
      return true;
    case 'MaterialCollected':
      adj((ev.Category || '').toLowerCase(), ev.Name, ev.Count || 1);
      return true;
    case 'MaterialDiscarded':
      adj((ev.Category || '').toLowerCase(), ev.Name, -(ev.Count || 1));
      return true;
    case 'EngineerCraft':
    case 'EngineerLegacyConvert': {
      // Ingredients consumed — category not in event, infer from inv membership.
      let changed = false;
      for (const m of ev.Ingredients || []) {
        const name = (m.Name || '').toLowerCase();
        const count = m.Count || 1;
        for (const cat of ['raw', 'manufactured', 'encoded']) {
          if (name in inv[cat]) {
            adj(cat, name, -count);
            changed = true;
            break;
          }
        }
      }
      return changed;
    }
    case 'Synthesis':
    case 'TechnologyBroker': {
      let changed = false;
      for (const m of ev.Materials || []) {
        const name = (m.Name || '').toLowerCase();
        const count = m.Count || 1;
        for (const cat of ['raw', 'manufactured', 'encoded']) {
          if (name in inv[cat]) {
            adj(cat, name, -count);
            changed = true;
            break;
          }
        }
      }
      return changed;
    }
    case 'MaterialTrade': {
      let changed = false;
      if (ev.Paid && ev.Paid.Material) {
        adj((ev.Paid.Category || '').toLowerCase(), ev.Paid.Material, -(ev.Paid.Quantity || 0));
        changed = true;
      }
      if (ev.Received && ev.Received.Material) {
        adj((ev.Received.Category || '').toLowerCase(), ev.Received.Material, +(ev.Received.Quantity || 0));
        changed = true;
      }
      return changed;
    }
    case 'MissionCompleted': {
      let changed = false;
      for (const m of ev.MaterialsReward || []) {
        adj((m.Category || '').toLowerCase(), m.Name, +(m.Count || 0));
        changed = true;
      }
      return changed;
    }
    case 'ScientificResearch': {
      adj((ev.Category || '').toLowerCase(), ev.Name, -(ev.Count || 0));
      return true;
    }
    case 'EngineerContribution': {
      if (ev.Type === 'Material' && ev.Material) {
        const name = ev.Material.toLowerCase();
        for (const cat of ['raw', 'manufactured', 'encoded']) {
          if (name in inv[cat]) {
            adj(cat, name, -(ev.Quantity || 1));
            return true;
          }
        }
      }
      return false;
    }
    default:
      return false;
  }
}

/**
 * One-shot scan: walk journals, build current inventory.
 * Returns { raw, manufactured, encoded, baselineFrom, baselineTimestamp,
 *           updatedAt, deltaEvents } or null if no Materials event found.
 */
export function extractMaterialInventory(journalDir) {
  const files = listJournalFiles(journalDir);
  if (files.length === 0) return null;

  const baseline = findLatestMaterialsBaseline(journalDir, files);
  if (!baseline) return null;

  const inv = emptyInv();
  loadBaseline(baseline.ev, inv);
  const baselineTimestamp = baseline.ev.timestamp;

  // Forward-apply every delta with timestamp > baseline.
  let deltaEvents = 0;
  for (const f of files) {
    const lines = fs.readFileSync(path.join(journalDir, f), 'utf8').split('\n');
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.indexOf('"timestamp"') === -1) continue;
      let ev;
      try { ev = JSON.parse(line); } catch { continue; }
      if (!ev.event || !ev.timestamp) continue;
      if (ev.timestamp <= baselineTimestamp && ev.event !== 'Materials') continue;
      if (ev.event === 'Materials' && ev.timestamp <= baselineTimestamp) continue;
      if (applyDeltaEvent(ev, inv)) deltaEvents++;
    }
  }

  return {
    raw: inv.raw,
    manufactured: inv.manufactured,
    encoded: inv.encoded,
    baselineFrom: baseline.file,
    baselineTimestamp,
    updatedAt: new Date().toISOString(),
    deltaEvents,
  };
}

/**
 * Apply a single live delta event to an existing inventory snapshot in place.
 * Used by the journal watcher's poll loop to keep state fresh without re-scanning.
 * Returns true if the inventory was modified.
 */
export function applyMaterialDeltaEvent(ev, inventory) {
  // inventory shape: { raw, manufactured, encoded }
  return applyDeltaEvent(ev, inventory);
}
