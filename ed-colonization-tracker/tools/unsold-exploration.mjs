// One-off: compute the user's current unsold exploration data by walking journals.
// Logic: maintain a Set<systemAddress> of "carried" systems.
//   - Add on Scan / FSSDiscoveryScan / SAAScanComplete
//   - Remove on SellExplorationData (single system) / MultiSellExplorationData (bulk)
//   - Clear on Died
// Final set = systems with unsold data right now.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const JOURNAL_DIR = path.join(os.homedir(), 'Saved Games', 'Frontier Developments', 'Elite Dangerous');

const files = fs.readdirSync(JOURNAL_DIR)
  .filter((n) => /^Journal\..+\.log$/i.test(n))
  .map((n) => {
    const full = path.join(JOURNAL_DIR, n);
    const st = fs.statSync(full);
    return { name: n, full, mtime: st.mtimeMs };
  })
  .sort((a, b) => a.mtime - b.mtime);

console.log(`Walking ${files.length} journal files chronologically...\n`);

// State
const carried = new Map(); // systemAddress -> { systemName, scanCount, lastScanAt }
const sellEvents = []; // for diagnostic
let lastDiedAt = null;
let lastDiedSystem = null;
let totalScans = 0;
let totalFssDiscovery = 0;
let totalSAA = 0;
let totalSells = 0;
let totalMultiSells = 0;
let multiSellSystemsCleared = 0;
let totalSellEarnings = 0n;
let postDeathSellEarnings = 0n;

// To estimate value of carried, we need per-system body counts. Track scans per system.
const systemBodyDetails = new Map(); // systemAddress -> { systemName, bodies: Set<bodyId>, fss: bool, mapped: Set<bodyId>, mappedFirst: Set<bodyId>, scannedFirst: Set<bodyId> }

function ensureSystem(addr, name) {
  if (!systemBodyDetails.has(addr)) {
    systemBodyDetails.set(addr, {
      systemName: name || '',
      bodies: new Set(),
      fss: false,
      mapped: new Set(),
      mappedFirst: new Set(),
      scannedFirst: new Set(),
    });
  }
  const e = systemBodyDetails.get(addr);
  if (name && !e.systemName) e.systemName = name;
  return e;
}

for (const f of files) {
  const text = fs.readFileSync(f.full, 'utf-8');
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let ev;
    try { ev = JSON.parse(trimmed); } catch { continue; }
    const t = ev.event;
    if (!t) continue;

    if (t === 'Died') {
      lastDiedAt = ev.timestamp;
      lastDiedSystem = ev.StarSystem || null;
      carried.clear();
      // Note: systemBodyDetails persists for value estimation; only carried is reset.
      // We rebuild carried after death from subsequent scans.
      // But for accurate value estimation post-death, we should also reset systemBodyDetails for unsold systems.
      // Simpler: also clear systemBodyDetails so post-death scans rebuild fresh data.
      systemBodyDetails.clear();
    } else if (t === 'FSSDiscoveryScan') {
      totalFssDiscovery++;
      const addr = ev.SystemAddress;
      if (addr != null) {
        carried.set(addr, { systemName: ev.SystemName, lastScanAt: ev.timestamp });
        const e = ensureSystem(addr, ev.SystemName);
        e.fss = true;
      }
    } else if (t === 'Scan') {
      totalScans++;
      const addr = ev.SystemAddress;
      if (addr != null) {
        carried.set(addr, { systemName: ev.StarSystem || (carried.get(addr) || {}).systemName, lastScanAt: ev.timestamp });
        const e = ensureSystem(addr, ev.StarSystem);
        if (ev.BodyID != null) {
          e.bodies.add(ev.BodyID);
          if (ev.WasDiscovered === false) e.scannedFirst.add(ev.BodyID);
        }
      }
    } else if (t === 'SAAScanComplete') {
      totalSAA++;
      const addr = ev.SystemAddress;
      if (addr != null) {
        carried.set(addr, { systemName: (carried.get(addr) || {}).systemName, lastScanAt: ev.timestamp });
        const e = ensureSystem(addr, null);
        if (ev.BodyID != null) {
          e.mapped.add(ev.BodyID);
          if (ev.WasMapped === false) e.mappedFirst.add(ev.BodyID);
        }
      }
    } else if (t === 'SellExplorationData') {
      totalSells++;
      sellEvents.push({ ts: ev.timestamp, type: 'single', earnings: ev.TotalEarnings, systems: (ev.Systems || []).length });
      const earnings = BigInt(ev.TotalEarnings || 0);
      totalSellEarnings += earnings;
      if (lastDiedAt && ev.timestamp > lastDiedAt) postDeathSellEarnings += earnings;
      // Single sell — Systems[] lists by name, no addresses. Best-effort: clear carried by name.
      const names = ev.Systems || [];
      for (const name of names) {
        for (const [addr, info] of carried) {
          if (info.systemName === name) {
            carried.delete(addr);
            systemBodyDetails.delete(addr);
          }
        }
      }
    } else if (t === 'MultiSellExplorationData') {
      totalMultiSells++;
      const earnings = BigInt(ev.TotalEarnings || 0);
      totalSellEarnings += earnings;
      if (lastDiedAt && ev.timestamp > lastDiedAt) postDeathSellEarnings += earnings;
      sellEvents.push({ ts: ev.timestamp, type: 'multi', earnings: ev.TotalEarnings, systems: (ev.Discovered || []).length });
      for (const d of (ev.Discovered || [])) {
        if (d.SystemAddress != null) {
          if (carried.delete(d.SystemAddress)) multiSellSystemsCleared++;
          systemBodyDetails.delete(d.SystemAddress);
        } else if (d.SystemName) {
          for (const [addr, info] of carried) {
            if (info.systemName === d.SystemName) {
              carried.delete(addr);
              systemBodyDetails.delete(addr);
              multiSellSystemsCleared++;
            }
          }
        }
      }
    }
  }
}

console.log(`Last Died:            ${lastDiedAt || 'never (in tracked history)'}${lastDiedSystem ? ` @ ${lastDiedSystem}` : ''}`);
console.log(`Total Scans:          ${totalScans}`);
console.log(`Total FSSDiscovery:   ${totalFssDiscovery}`);
console.log(`Total SAA mapped:     ${totalSAA}`);
console.log(`Total single sells:   ${totalSells}`);
console.log(`Total multi sells:    ${totalMultiSells} (cleared ${multiSellSystemsCleared} systems)`);
console.log(`Total sell earnings:  ${totalSellEarnings.toLocaleString()} cr (lifetime in tracked history)`);
console.log(`Post-death earnings:  ${postDeathSellEarnings.toLocaleString()} cr (sold after last death)`);
console.log('');
console.log(`==> CARRIED RIGHT NOW: ${carried.size} system(s) with unsold data`);

if (carried.size > 0) {
  console.log('');
  // Estimate value — rough heuristic
  // Body honk: 1500 cr/system base, +bonus first discovery
  // FSS scan: ~6000 cr/body for terrestrial, can be much more
  // Mapped (DSS): adds ~1.5–2x
  // First mapped/discovered: another bonus
  // Without per-body type data this is fuzzy. Use:
  //   honk = 1500 cr
  //   per body scanned = avg 25,000 cr
  //   per body mapped = avg 50,000 cr (replaces scan value, with mapping bonus)
  //   first discovered body = +50%
  //   first mapped body = +100% (efficiency bonus)
  // These are wild averages; real values depend heavily on body types.
  let estLow = 0;
  let estHigh = 0;
  const rows = [];
  for (const [addr, info] of carried) {
    const det = systemBodyDetails.get(addr) || { bodies: new Set(), fss: false, mapped: new Set(), mappedFirst: new Set(), scannedFirst: new Set() };
    const honkValue = det.fss ? 1500 : 0;
    const bodyCount = det.bodies.size;
    const mappedCount = det.mapped.size;
    const firstD = det.scannedFirst.size;
    const firstM = det.mappedFirst.size;
    // Low: assume mostly icy/rocky bodies
    const bodyLow = bodyCount * 12000 + mappedCount * 25000 + firstD * 6000 + firstM * 25000;
    // High: assume some terraformable / earth-likes / water worlds in mix
    const bodyHigh = bodyCount * 50000 + mappedCount * 150000 + firstD * 25000 + firstM * 150000;
    estLow += honkValue + bodyLow;
    estHigh += honkValue + bodyHigh;
    rows.push({ system: info.systemName || `(addr ${addr})`, bodies: bodyCount, mapped: mappedCount, firstD, firstM, low: honkValue + bodyLow, high: honkValue + bodyHigh });
  }
  rows.sort((a, b) => b.high - a.high);
  console.log(`Estimated value:      ${estLow.toLocaleString()} – ${estHigh.toLocaleString()} cr (rough)`);
  console.log('');
  console.log('Top 20 systems by est. high:');
  console.log('  System                                         bodies  mapped  firstD  firstM  est-low      est-high');
  for (const r of rows.slice(0, 20)) {
    console.log(`  ${r.system.padEnd(46)}  ${String(r.bodies).padStart(6)}  ${String(r.mapped).padStart(6)}  ${String(r.firstD).padStart(6)}  ${String(r.firstM).padStart(6)}  ${r.low.toLocaleString().padStart(10)}   ${r.high.toLocaleString().padStart(10)}`);
  }
}

console.log('');
console.log(`Recent sells (last 10):`);
for (const s of sellEvents.slice(-10)) {
  console.log(`  ${s.ts}  ${s.type.padEnd(6)}  ${s.systems} sys  ${s.earnings.toLocaleString()} cr`);
}
