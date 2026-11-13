// server/journal/ships.js
//
// The ship stable (1.60.33): what the journal says about every ship the commander owns.
//   - shipRecordFromLoadout(ev)  — one Loadout → a compact record: masses, cargo, fuel, the game's own
//     max jump range, values, and the modules the stable computes with (thrusters, FSD, shield generator,
//     boosters, Guardian FSD booster, hangars, approach suite) with their engineering modifiers.
//   - storedShipsFromEvent(ev)   — StoredShips → where every stored ship is, transfer cost and time.
//   - craftFromLaunch(ev, shipId) — LaunchSRV / LaunchFighter / LaunchVessel → the craft that left a ship.
//     The Loadout names a bay, never what is parked in it; a launch is the only time the journal says.
//   - extractShipInventory(journalDir, io) — the Sync All backfill: the latest Loadout per ShipID, the
//     latest StoredShips, and the last craft of each kind launched from each ship, across every file.
// Pure functions over journal events; the extractor takes an injectable io for tests.
import fs from 'node:fs';
import { listJournalFiles } from './paths.js';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function modClassRating(item) {
  // size and class are separate tokens: a Guardian FSD booster has a size and no class.
  const sz = /size(\d+)/i.exec(item || ''); const cl = /class(\d+)/i.exec(item || '');
  return { size: sz ? Number(sz[1]) : null, rating: cl ? ('EDCBA'[Number(cl[1]) - 1] || null) : null };
}

function engineering(mod) {
  const e = mod && mod.Engineering;
  if (!e) return null;
  const mods = {};
  for (const x of e.Modifiers || []) if (x && x.Label) mods[x.Label] = { value: num(x.Value), original: num(x.OriginalValue) };
  return { blueprint: e.BlueprintName || null, grade: num(e.Level), experimental: e.ExperimentalEffect_Localised || e.ExperimentalEffect || null, modifiers: mods };
}

function modRecord(mod) {
  const { size, rating } = modClassRating(mod.Item);
  return { item: String(mod.Item || '').toLowerCase(), slot: mod.Slot, size, rating, engineering: engineering(mod) };
}

/** One Loadout event → the stable's record for that ship. */
export function shipRecordFromLoadout(ev) {
  if (!ev || ev.event !== 'Loadout' || ev.ShipID == null) return null;
  const mods = Array.isArray(ev.Modules) ? ev.Modules : [];
  const find = (re, slotRe) => mods.find((m) => re.test(String(m.Item || '')) && (!slotRe || slotRe.test(String(m.Slot || ''))));
  const thr = find(/engine_size\d/i, /^MainEngines$/i) || find(/engine_size\d/i); // int_engine_…, int_mkiiagileboost_engine_…, …_gravityoptimised_mkii
  const fsd = find(/int_hyperdrive/i, /^FrameShiftDrive$/i) || find(/int_hyperdrive/i);
  const gen = find(/int_shieldgenerator/i);
  const boosters = mods.filter((m) => /hpt_shieldbooster/i.test(String(m.Item || '')));
  const gfsd = find(/int_guardianfsdbooster/i);
  const srvBays = mods.filter((m) => /buggybay/i.test(String(m.Item || '')));
  const fighterBays = mods.filter((m) => /fighterbay/i.test(String(m.Item || '')));
  return {
    shipId: ev.ShipID,
    type: String(ev.Ship || '').toLowerCase(),
    name: ev.ShipName || null,
    ident: ev.ShipIdent || null,
    unladenMass: num(ev.UnladenMass),
    cargoCapacity: num(ev.CargoCapacity),
    maxJumpRange: num(ev.MaxJumpRange),
    fuelMain: ev.FuelCapacity ? num(ev.FuelCapacity.Main) : null,
    fuelReserve: ev.FuelCapacity ? num(ev.FuelCapacity.Reserve) : null,
    hullValue: num(ev.HullValue),
    modulesValue: num(ev.ModulesValue),
    rebuy: num(ev.Rebuy),
    thrusters: thr ? modRecord(thr) : null,
    fsd: fsd ? { ...modRecord(fsd), overcharge: /overcharge/i.test(String(fsd.Item || '')) } : null,
    shieldGenerator: gen ? { ...modRecord(gen), biweave: /_fast$/i.test(String(gen.Item || '')), prismatic: /strong/i.test(String(gen.Item || '')) } : null,
    shieldBoosters: boosters.map(modRecord),
    guardianFsdBooster: gfsd ? modRecord(gfsd) : null,
    srvBays: srvBays.map((m) => ({ ...modRecord(m), large: /mkiilargebuggybay/i.test(String(m.Item || '')) })),
    fighterBays: fighterBays.map((m) => ({ ...modRecord(m), vessel: /fighterbaymk2/i.test(String(m.Item || '')) })),
    planetaryApproach: mods.some((m) => /planetapproachsuite/i.test(String(m.Item || ''))),
    // Every engineered module, for the stable's engineering chips (1.60.38), and what sits in each core slot so a
    // stock module reads as stock and an empty one as not fitted.
    engineered: engineeredModules(mods),
    coreItems: coreItemsOf(mods),
    updatedAt: ev.timestamp || null,
  };
}

const CORE_SLOTS = ['MainEngines', 'FrameShiftDrive', 'PowerPlant', 'PowerDistributor', 'LifeSupport', 'Radar'];

function engineeredModules(mods) {
  const out = [];
  for (const m of mods) {
    const e = engineering(m);
    if (!e) continue;
    const { size, rating } = modClassRating(m.Item);
    out.push({ slot: m.Slot || '', item: String(m.Item || '').toLowerCase(), size, rating, blueprint: e.blueprint, grade: e.grade, experimental: e.experimental });
  }
  return out;
}

function coreItemsOf(mods) {
  const out = {};
  for (const m of mods) if (CORE_SLOTS.includes(m.Slot)) out[m.Slot] = String(m.Item || '').toLowerCase();
  const gen = mods.find((m) => /int_shieldgenerator/i.test(String(m.Item || '')));
  out.ShieldGenerator = gen ? String(gen.Item).toLowerCase() : null;
  return out;
}

// ===== Lifetime per ship (1.60.38) =====
// Every journal, each event credited to the ship being flown at the time: jumps, light-years, longest jump, neutron
// boosts; tonnes bought, delivered to colony depots, refined; bodies scanned and first discovered; engineering crafts
// by engineer. Each file's totals are cached by size and modification time, so after the first read only the active
// journal is read again. Events before a file's first ship event belong to the ship the previous file ended in.

// 1.60.40 adds combat (ship kills, bounty and bond claims, player kills, the commonest victims — kills in an SRV or on
// foot are not the ship's), distance carried on a carrier while docked aboard, systems visited, the farthest point from
// Sol, and credits earned (trade, community-goal sales, community-goal rewards, missions, exploration, combat claims).
// A fighter you fly yourself writes its own Loadout; its kills belong to the ship that carries it, so a fighter or a
// suit never becomes "the ship".

const LIFETIME_EVENTS = new Set(['LoadGame', 'Loadout', 'ShipyardSwap', 'ShipyardNew', 'FSDJump', 'CarrierJump', 'Location', 'Docked', 'Undocked',
  'LaunchSRV', 'DockSRV', 'SRVDestroyed', 'Disembark', 'Embark', 'JetConeBoost', 'MarketBuy', 'MarketSell', 'ColonisationContribution', 'MiningRefined',
  'Scan', 'EngineerCraft', 'Bounty', 'FactionKillBond', 'PVPKill', 'MissionCompleted', 'CommunityGoal', 'CommunityGoalReward', 'SellExplorationData', 'MultiSellExplorationData']);
const lifetimeCache = new Map(); // fullPath -> { size, mtimeMs, summary }
let lifetimeRun = null;
const isFighterHull = (ship) => /fighter/i.test(String(ship || ''));
const isSuit = (ship) => /suit/i.test(String(ship || ''));
const fromSol = (p) => Math.hypot(Number(p[0]) || 0, Number(p[1]) || 0, Number(p[2]) || 0);
const between = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function emptyLifetime() {
  return {
    jumps: 0, ly: 0, longest: 0, neutron: 0, carriedLy: 0, systems: new Set(), farthest: { ly: 0, system: null },
    boughtT: 0, delivered: 0, refined: 0, scanKeys: new Set(), firstKeys: new Set(),
    kills: 0, bountyCr: 0, bonds: 0, bondCr: 0, playerKills: 0, victims: {},
    earned: { trade: 0, cgSales: 0, cgRewards: 0, missions: 0, exploration: 0, combat: 0 },
    engineers: {},
  };
}

/** One journal file's text → { parts: Map<'prefix'|shipId, totals>, endShip }. Pure. */
export function summarizeLifetimeText(text) {
  const parts = new Map(); let cur = null; let endShip = null;
  let mode = 'ship';            // ship | srv | foot
  let dock = null;              // { station, system, carrier }
  let pos = null;               // the last StarPos this file has seen
  const cgMarkets = new Map();  // "station|system" -> expiry, from the game's CommunityGoal list
  const bucket = () => { const k = cur == null ? 'prefix' : String(cur); let a = parts.get(k); if (!a) { a = emptyLifetime(); parts.set(k, a); } return a; };
  const reach = (a, p, system) => { const d = fromSol(p); if (d > a.farthest.ly) a.farthest = { ly: d, system: system || null }; };
  for (const line of String(text || '').split('\n')) {
    const m = /"event":"(\w+)"/.exec(line);
    if (!m || !LIFETIME_EVENTS.has(m[1])) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    switch (e.event) {
      case 'LoadGame':
        if (isSuit(e.Ship)) { mode = 'foot'; continue; }
        if (e.ShipID != null && !isFighterHull(e.Ship)) { cur = e.ShipID; endShip = cur; }
        mode = 'ship'; continue;
      case 'Loadout': if (e.ShipID != null && !isFighterHull(e.Ship) && !isSuit(e.Ship)) { cur = e.ShipID; endShip = cur; } continue;
      case 'ShipyardSwap': if (e.ShipID != null) { cur = e.ShipID; endShip = cur; } continue;
      case 'ShipyardNew': if (e.NewShipID != null) { cur = e.NewShipID; endShip = cur; } continue;
      case 'LaunchSRV': mode = 'srv'; continue;
      case 'DockSRV': case 'SRVDestroyed': mode = 'ship'; continue;
      case 'Disembark': mode = 'foot'; continue;
      case 'Embark': mode = e.SRV ? 'srv' : 'ship'; continue;
      case 'Location':
        if (Array.isArray(e.StarPos)) pos = e.StarPos;
        dock = e.Docked ? { station: e.StationName || null, system: e.StarSystem || null, carrier: e.StationType === 'FleetCarrier' } : null;
        continue;
      case 'Docked': dock = { station: e.StationName || null, system: e.StarSystem || null, carrier: e.StationType === 'FleetCarrier' }; continue;
      case 'Undocked': dock = null; continue;
      case 'CommunityGoal':
        cgMarkets.clear();
        for (const g of e.CurrentGoals || []) if (g && g.MarketName) cgMarkets.set(`${g.MarketName}|${g.SystemName || ''}`, g.Expiry || null);
        continue;
    }
    const a = bucket();
    switch (e.event) {
      case 'FSDJump': {
        const d = Number(e.JumpDist) || 0; a.jumps++; a.ly += d; if (d > a.longest) a.longest = d;
        if (e.StarSystem) a.systems.add(e.StarSystem);
        if (Array.isArray(e.StarPos)) { reach(a, e.StarPos, e.StarSystem); pos = e.StarPos; }
        break;
      }
      case 'CarrierJump':
        // the ship rode the carrier only if you were docked aboard it; a jump with no earlier position in the file adds no distance
        if (dock && dock.carrier && Array.isArray(e.StarPos)) {
          if (pos) a.carriedLy += between(pos, e.StarPos);
          if (e.StarSystem) a.systems.add(e.StarSystem);
          reach(a, e.StarPos, e.StarSystem);
        }
        if (Array.isArray(e.StarPos)) pos = e.StarPos;
        break;
      case 'JetConeBoost': a.neutron++; break;
      case 'MarketBuy': a.boughtT += Number(e.Count) || 0; break;
      case 'ColonisationContribution': for (const c of e.Contributions || []) a.delivered += Number(c.Amount) || 0; break;
      case 'MiningRefined': a.refined++; break;
      case 'Scan':
        // A body once per ship, however many times it was scanned; nav-beacon data and belt clusters are not your scans.
        if (e.ScanType && e.ScanType !== 'NavBeaconDetail' && e.SystemAddress != null && e.BodyID != null && !/Belt Cluster/i.test(e.BodyName || '')) {
          const k = `${e.SystemAddress}:${e.BodyID}`;
          a.scanKeys.add(k);
          if (e.WasDiscovered === false) a.firstKeys.add(k);
        }
        break;
      case 'EngineerCraft': {
        const n = e.Engineer || 'unknown';
        const x = a.engineers[n] || (a.engineers[n] = { crafts: 0, first: null, last: null });
        x.crafts++;
        if (e.timestamp && (!x.first || e.timestamp < x.first)) x.first = e.timestamp;
        if (e.timestamp && (!x.last || e.timestamp > x.last)) x.last = e.timestamp;
        break;
      }
      case 'MarketSell': {
        const profit = ((Number(e.SellPrice) || 0) - (Number(e.AvgPricePaid) || 0)) * (Number(e.Count) || 0);
        const key = dock ? `${dock.station}|${dock.system}` : null;
        const expiry = key && cgMarkets.has(key) ? cgMarkets.get(key) : undefined;
        const intoGoal = expiry !== undefined && (!expiry || !e.timestamp || e.timestamp <= expiry);
        if (intoGoal) a.earned.cgSales += profit; else a.earned.trade += profit;
        break;
      }
      case 'Bounty': {
        if (mode !== 'ship') break;
        const r = Number(e.TotalReward ?? e.Reward) || 0;
        a.kills++; a.bountyCr += r; a.earned.combat += r;
        const t = String(e.Target || e.Target_Localised || 'unknown').toLowerCase();
        a.victims[t] = (a.victims[t] || 0) + 1;
        break;
      }
      case 'FactionKillBond': if (mode === 'ship') { const r = Number(e.Reward) || 0; a.bonds++; a.bondCr += r; a.earned.combat += r; } break;
      case 'PVPKill': if (mode === 'ship') a.playerKills++; break;
      case 'MissionCompleted': a.earned.missions += Number(e.Reward) || 0; break;
      case 'CommunityGoalReward': a.earned.cgRewards += Number(e.Reward) || 0; break;
      case 'SellExplorationData': case 'MultiSellExplorationData': a.earned.exploration += Number(e.TotalEarnings) || 0; break;
    }
  }
  return { parts, endShip };
}

function addLifetime(totals, id, a) {
  const key = String(id);
  let t = totals.get(key);
  if (!t) { t = emptyLifetime(); totals.set(key, t); }
  t.jumps += a.jumps; t.ly += a.ly; if (a.longest > t.longest) t.longest = a.longest; t.neutron += a.neutron;
  t.carriedLy += a.carriedLy;
  for (const s of a.systems) t.systems.add(s);
  if (a.farthest.ly > t.farthest.ly) t.farthest = { ...a.farthest };
  t.boughtT += a.boughtT; t.delivered += a.delivered; t.refined += a.refined;
  t.kills += a.kills; t.bountyCr += a.bountyCr; t.bonds += a.bonds; t.bondCr += a.bondCr; t.playerKills += a.playerKills;
  for (const [v, n] of Object.entries(a.victims)) t.victims[v] = (t.victims[v] || 0) + n;
  for (const k of Object.keys(t.earned)) t.earned[k] += a.earned[k] || 0;
  for (const k of a.scanKeys) t.scanKeys.add(k);
  for (const k of a.firstKeys) t.firstKeys.add(k);
  for (const [n, x] of Object.entries(a.engineers)) {
    const y = t.engineers[n] || (t.engineers[n] = { crafts: 0, first: null, last: null });
    y.crafts += x.crafts;
    if (x.first && (!y.first || x.first < y.first)) y.first = x.first;
    if (x.last && (!y.last || x.last > y.last)) y.last = x.last;
  }
}

/**
 * Lifetime totals for every ship the journals mention: { ships: Record<shipId, …>, files, reread }.
 * Yields between files so the server stays responsive on the first, full read. Concurrent calls share one run.
 * io = { listFiles(dir) -> [{ fullPath, size, mtimeMs }], readFile(path) } for tests.
 */
export function extractShipLifetime(journalDir, io = {}) {
  if (lifetimeRun && !io.listFiles) return lifetimeRun;
  const run = (async () => {
    const list = io.listFiles ? io.listFiles(journalDir) : listJournalFiles(journalDir);
    const read = io.readFile || ((p) => fs.readFileSync(p, 'utf8'));
    const cache = io.cache || lifetimeCache;
    const totals = new Map(); let carry = null; let reread = 0;
    for (const f of list) {
      let hit = cache.get(f.fullPath);
      if (!hit || hit.size !== f.size || hit.mtimeMs !== f.mtimeMs) {
        let text; try { text = read(f.fullPath); } catch { continue; }
        hit = { size: f.size, mtimeMs: f.mtimeMs, summary: summarizeLifetimeText(text) };
        cache.set(f.fullPath, hit); reread++;
        if (!io.listFiles) await new Promise((r) => setImmediate(r));
      }
      for (const [k, a] of hit.summary.parts) {
        const id = k === 'prefix' ? carry : k;
        if (id == null) continue;
        addLifetime(totals, id, a);
      }
      if (hit.summary.endShip != null) carry = hit.summary.endShip;
    }
    const ships = {};
    for (const [id, t] of totals) {
      const earned = Object.fromEntries(Object.entries(t.earned).map(([k, v]) => [k, Math.round(v)]));
      ships[id] = {
        jumps: t.jumps, ly: Math.round(t.ly * 10) / 10, longest: Math.round(t.longest * 100) / 100, neutron: t.neutron,
        carriedLy: Math.round(t.carriedLy), systems: t.systems.size,
        farthest: { ly: Math.round(t.farthest.ly), system: t.farthest.system },
        boughtT: t.boughtT, delivered: t.delivered, refined: t.refined, scans: t.scanKeys.size, firstDiscoveries: t.firstKeys.size,
        kills: t.kills, bountyCr: Math.round(t.bountyCr), bonds: t.bonds, bondCr: Math.round(t.bondCr), playerKills: t.playerKills,
        victims: Object.entries(t.victims).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([name, count]) => ({ name, count })),
        earned: { ...earned, total: Object.values(earned).reduce((s, v) => s + v, 0) },
        engineers: Object.entries(t.engineers).map(([name, x]) => ({ name, ...x })).sort((a, b) => b.crafts - a.crafts || a.name.localeCompare(b.name)),
      };
    }
    return { ships, files: list.length, reread };
  })();
  if (!io.listFiles) { lifetimeRun = run; run.finally(() => { if (lifetimeRun === run) lifetimeRun = null; }); }
  return run;
}

/** StoredShips → the fleet's whereabouts. */
export function storedShipsFromEvent(ev) {
  if (!ev || ev.event !== 'StoredShips') return null;
  const ship = (s, here) => ({
    shipId: s.ShipID, type: String(s.ShipType || '').toLowerCase(), typeName: s.ShipType_Localised || s.ShipType || '',
    name: s.Name || null, system: here ? ev.StarSystem || null : s.StarSystem || null, station: here ? ev.StationName || null : null,
    marketId: here ? ev.MarketID ?? null : s.ShipMarketID ?? null, value: num(s.Value), hot: !!s.Hot, inTransit: !!s.InTransit,
    transferPrice: here ? 0 : num(s.TransferPrice), transferTime: here ? 0 : num(s.TransferTime),
  });
  return {
    at: ev.timestamp || null,
    station: ev.StationName || null,
    system: ev.StarSystem || null,
    marketId: ev.MarketID ?? null,
    ships: [...(ev.ShipsHere || []).map((s) => ship(s, true)), ...(ev.ShipsRemote || []).map((s) => ship(s, false))],
  };
}

/** A launch event → { kind, type, at } for the ship it left; null for anything else. */
export function craftFromLaunch(ev) {
  if (!ev) return null;
  if (ev.event === 'LaunchSRV') return { kind: 'srv', type: ev.SRVType_Localised || ev.SRVType || 'SRV', at: ev.timestamp || null };
  if (ev.event === 'LaunchFighter') return { kind: 'fighter', type: ev.Loadout ? `fighter (${ev.Loadout})` : 'fighter', at: ev.timestamp || null };
  if (ev.event === 'LaunchVessel') return { kind: 'vessel', type: ev.VesselType_Localised || ev.VesselType || 'vessel', at: ev.timestamp || null };
  return null;
}

/** Fold a craft launch into the per-ship craft map: the latest of each kind per ship. */
export function recordCraft(craftMap, shipId, craft) {
  if (shipId == null || !craft) return craftMap;
  const key = String(shipId);
  const cur = craftMap[key] ? { ...craftMap[key] } : {};
  const prev = cur[craft.kind];
  if (!prev || !prev.at || (craft.at && craft.at > prev.at)) cur[craft.kind] = { type: craft.type, at: craft.at };
  return { ...craftMap, [key]: cur };
}

/**
 * Sync All backfill: walk every journal file (oldest first) and return
 * { inventory: Record<shipId, record>, storedShips, craft: Record<shipId, {srv?, fighter?, vessel?}> }.
 */
export function extractShipInventory(journalDir, io = {}) {
  const listFiles = io.listFiles || ((dir) => listJournalFiles(dir).map((f) => (typeof f === 'string' ? f : f.fullPath)));
  const readFile = io.readFile || ((p) => fs.readFileSync(p, 'utf8'));
  const inventory = {}; let storedShips = null; let craft = {}; let currentShipId = null;
  for (const f of listFiles(journalDir)) {
    let txt; try { txt = readFile(f); } catch { continue; }
    for (const line of txt.split('\n')) {
      if (!/"event":"(Loadout|StoredShips|ShipyardSwap|Launch(SRV|Fighter|Vessel))"/.test(line)) continue;
      let ev; try { ev = JSON.parse(line); } catch { continue; }
      if (ev.event === 'Loadout') {
        const rec = shipRecordFromLoadout(ev);
        if (rec) { const prev = inventory[String(rec.shipId)]; if (!prev || !prev.updatedAt || (rec.updatedAt && rec.updatedAt > prev.updatedAt)) inventory[String(rec.shipId)] = rec; currentShipId = rec.shipId; }
      } else if (ev.event === 'ShipyardSwap') {
        if (ev.ShipID != null) currentShipId = ev.ShipID;
      } else if (ev.event === 'StoredShips') {
        const s = storedShipsFromEvent(ev);
        if (s && (!storedShips || !storedShips.at || (s.at && s.at > storedShips.at))) storedShips = s;
      } else {
        craft = recordCraft(craft, currentShipId, craftFromLaunch(ev));
      }
    }
  }
  return { inventory, storedShips, craft };
}
