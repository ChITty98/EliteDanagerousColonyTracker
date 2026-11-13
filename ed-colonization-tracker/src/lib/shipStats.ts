/**
 * The ship stable's figures (1.60.33): speed and boost, jump range, shields — computed from a ship's
 * journal Loadout record (server/journal/ships.js) and the hull/module constants in src/data/ships.ts
 * with the mass-curve and FSD models the community tools use (EDSY, Coriolis).
 *
 * Validation on the commander's own ships, 2026-10-25:
 *   - boost: Type-8, 5A Dirty G5 + Drag Drives (optimal mass 735 t, optimal performance 145.6%), 463.3 t
 *     unladen + 32.5 t fuel → 538.7 against 538 on the in-game screen.
 *   - jump: the journal's own Loadout.MaxJumpRange is reproduced for every ship in tests/fixtures by
 *     taking the mass as unladen + the fuel one jump burns (the FSD's max fuel per jump); the shipyard's
 *     "laden" figure is full tank + full hold (Corsair 26.84 against 26.86).
 *   - shipyard screen, Corsair (stock 7A, 4A generator, no boosters): 324.8 / 411.8 against 325 / 412,
 *     295.7 MJ against 296. Kestrel Mk II (Dirty G5 agile thrusters, bi-weave 5C reinforced G3, two 0C
 *     and two 0D boosters): 579 boost against 579, 555.7 MJ against 556.
 */
import { GUARDIAN_FSD_BOOST, SHIELD_BOOSTER_BOOST, SRV_BAY_COUNT, FIGHTER_BAY_COUNT, fsdFor, hullFor, shieldGeneratorCurve, thrusterCurve, type HullStats, type MassCurve } from '@/data/ships';

export interface EngineeredModule {
  item: string; slot?: string; size: number | null; rating: string | null;
  engineering: { blueprint: string | null; grade: number | null; experimental: string | null; modifiers: Record<string, { value: number | null; original: number | null }> } | null;
}
export interface ShipRecord {
  shipId: number; type: string; name: string | null; ident: string | null;
  unladenMass: number | null; cargoCapacity: number | null; maxJumpRange: number | null;
  fuelMain: number | null; fuelReserve: number | null;
  hullValue: number | null; modulesValue: number | null; rebuy: number | null;
  thrusters: EngineeredModule | null;
  fsd: (EngineeredModule & { overcharge: boolean }) | null;
  shieldGenerator: (EngineeredModule & { biweave: boolean; prismatic: boolean }) | null;
  shieldBoosters: EngineeredModule[];
  guardianFsdBooster: EngineeredModule | null;
  srvBays: (EngineeredModule & { large: boolean })[];
  fighterBays: (EngineeredModule & { vessel: boolean })[];
  planetaryApproach: boolean;
  /** every engineered module (1.60.38); absent on records written before it */
  engineered?: EngineeredEntry[];
  /** item in each core slot, ShieldGenerator null when none is fitted (1.60.38) */
  coreItems?: Record<string, string | null>;
  updatedAt: string | null;
}
export interface EngineeredEntry { slot: string; item: string; size: number | null; rating: string | null; blueprint: string | null; grade: number | null; experimental: string | null }

/** Lifetime totals per ship from /api/ship-lifetime (1.60.38). */
export interface ShipLifetime {
  jumps: number; ly: number; longest: number; neutron: number;
  /** 1.60.40: distance ridden on a carrier while docked aboard, systems visited, farthest point from Sol */
  carriedLy?: number; systems?: number; farthest?: { ly: number; system: string | null };
  boughtT: number; delivered: number; refined: number; scans: number; firstDiscoveries: number;
  /** 1.60.40: ship kills (bounties) and combat-zone bonds while it was the ship; SRV and on-foot kills are not counted */
  kills?: number; bountyCr?: number; bonds?: number; bondCr?: number; playerKills?: number;
  victims?: { name: string; count: number }[];
  /** 1.60.40: credits earned while it was the ship — trade profit (mined goods in full), community-goal sales and rewards, missions, exploration, combat claims */
  earned?: { trade: number; cgSales: number; cgRewards: number; missions: number; exploration: number; combat: number; total: number };
  engineers: { name: string; crafts: number; first: string | null; last: string | null }[];
}

export interface EngChip { key: string; label: string; state: 'engineered' | 'stock' | 'none' | 'unknown'; grade: number | null; experimental: string | null; title: string }
export interface EngGroup { label: string; count: number; grade: number | null; experimental: boolean; title: string }
export interface EngineeringSummary { core: EngChip[]; others: EngGroup[]; any: boolean }

const CORE_CHIPS: [string, string][] = [['MainEngines', 'Thrusters'], ['FrameShiftDrive', 'FSD'], ['PowerPlant', 'PP'], ['PowerDistributor', 'PD'], ['ShieldGenerator', 'SG'], ['LifeSupport', 'LS'], ['Radar', 'Sensors']];

const blueprintLabel = (bp: string | null) => (bp ?? '').replace(/^(Engine|FSD|ShieldGenerator|ShieldBooster|PowerPlant|PowerDistributor|LifeSupport|Sensor|CargoRack|Weapon|HullReinforcement|Armour)_/i, '').replace(/_/g, ' ');

const OPTIONAL_NAMES: [RegExp, string][] = [
  [/cargorack/, 'cargo rack'], [/shieldbooster/, 'shield booster'], [/hullreinforcement/, 'hull reinforcement'], [/modulereinforcement/, 'module reinforcement'],
  [/shieldcellbank/, 'shield cell bank'], [/fuelscoop/, 'fuel scoop'], [/detailedsurfacescanner/, 'surface scanner'], [/refinery/, 'refinery'],
  [/multicannon/, 'multi-cannon'], [/plasmashock/, 'shock cannon'], [/pulselaser/, 'pulse laser'], [/beamlaser/, 'beam laser'], [/burstlaser/, 'burst laser'],
  [/railgun/, 'rail gun'], [/cannon/, 'cannon'], [/missile|dumbfire/, 'missile rack'], [/mininglaser/, 'mining laser'], [/armour/, 'armour'],
];
function optionalName(item: string): string {
  for (const [re, name] of OPTIONAL_NAMES) if (re.test(item)) return name;
  return item.replace(/^(int|hpt)_/, '').replace(/_size\d+.*$/, '').replace(/_/g, ' ');
}

const sizeRating = (item: string | null | undefined): string => {
  const sz = /size(\d+)/i.exec(item ?? ''); const cl = /class(\d+)/i.exec(item ?? '');
  return sz && cl ? `${sz[1]}${'EDCBA'[Number(cl[1]) - 1] ?? ''}` : '';
};

/** Which modules carry engineering, for the stable's chips: the seven core modules, and the rest grouped. */
export function engineeringSummary(rec: ShipRecord): EngineeringSummary {
  const legacy = !rec.engineered;
  const eng: EngineeredEntry[] = rec.engineered ?? [rec.thrusters, rec.fsd, rec.shieldGenerator, ...rec.shieldBoosters]
    .filter((m): m is EngineeredModule => !!m && !!m.engineering)
    .map((m) => ({ slot: m.slot ?? '', item: m.item, size: m.size, rating: m.rating, blueprint: m.engineering?.blueprint ?? null, grade: m.engineering?.grade ?? null, experimental: m.engineering?.experimental ?? null }));
  const isGen = (e: EngineeredEntry) => /int_shieldgenerator/.test(e.item);
  const core: EngChip[] = CORE_CHIPS.map(([slot, label]) => {
    const e = slot === 'ShieldGenerator' ? eng.find(isGen) : eng.find((x) => x.slot === slot);
    if (e) return { key: slot, label, state: 'engineered', grade: e.grade, experimental: e.experimental, title: `${label} ${sizeRating(e.item)}: ${blueprintLabel(e.blueprint)} G${e.grade ?? '?'}${e.experimental ? ` + ${e.experimental}` : ''}`.replace(/ +:/, ':') };
    const fitted = rec.coreItems ? rec.coreItems[slot] : undefined;
    if (legacy && fitted === undefined) {
      const known = slot === 'MainEngines' ? rec.thrusters : slot === 'FrameShiftDrive' ? rec.fsd : slot === 'ShieldGenerator' ? rec.shieldGenerator : undefined;
      if (known === undefined) return { key: slot, label, state: 'unknown', grade: null, experimental: null, title: `${label}: not read yet — boarding the ship or a Sync All fills it in` };
      return { key: slot, label, state: known ? 'stock' : 'none', grade: null, experimental: null, title: known ? `${label} ${sizeRating(known.item)}: stock`.replace(/ +:/, ':') : `${label}: not fitted` };
    }
    return fitted ? { key: slot, label, state: 'stock', grade: null, experimental: null, title: `${label} ${sizeRating(fitted)}: stock`.replace(/ +:/, ':') } : { key: slot, label, state: 'none', grade: null, experimental: null, title: `${label}: not fitted` };
  });
  const coreSlots = new Set(CORE_CHIPS.map(([s]) => s));
  const groups = new Map<string, EngGroup>();
  for (const e of eng) {
    if (coreSlots.has(e.slot) || isGen(e)) continue;
    const name = optionalName(e.item);
    const k = `${name}|${e.blueprint}|${e.grade}|${e.experimental ?? ''}`;
    const g = groups.get(k);
    if (g) { g.count++; continue; }
    groups.set(k, { label: name, count: 1, grade: e.grade, experimental: !!e.experimental, title: `${name}: ${blueprintLabel(e.blueprint)} G${e.grade ?? '?'}${e.experimental ? ` + ${e.experimental}` : ''}` });
  }
  const others = [...groups.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return { core, others, any: eng.length > 0 };
}
export interface StoredShipEntry { shipId: number; type: string; typeName: string; name: string | null; system: string | null; station: string | null; marketId: number | null; value: number | null; hot: boolean; inTransit: boolean; transferPrice: number | null; transferTime: number | null }
export interface StoredShips { at: string | null; station: string | null; system: string | null; marketId: number | null; ships: StoredShipEntry[] }
export interface ShipCraft { srv?: { type: string; at: string | null }; fighter?: { type: string; at: string | null }; vessel?: { type: string; at: string | null } }

const mod = (m: EngineeredModule | null | undefined, label: string): number | null => {
  const v = m?.engineering?.modifiers?.[label]?.value;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

/** The multiplier a mass curve gives at `mass`: maxmul at or below the minimum mass, minmul at or above the maximum, optmul at the optimum. */
export function massCurveMultiplier(mass: number, c: MassCurve): number {
  if (mass <= c.minmass) return c.maxmul;
  if (mass >= c.maxmass) return c.minmul;
  const norm = (mass - c.minmass) / (c.maxmass - c.minmass);
  const normOpt = (c.optmass - c.minmass) / (c.maxmass - c.minmass);
  const exponent = Math.log((c.optmul - c.minmul) / (c.maxmul - c.minmul)) / Math.log(1 - normOpt);
  return c.minmul + (c.maxmul - c.minmul) * Math.pow(1 - norm, exponent);
}

/** The ship's thruster curve with its engineering applied: optimal mass moves the whole mass range, optimal performance scales every multiplier. */
export function engineeredThrusterCurve(rec: ShipRecord): MassCurve | null {
  const t = rec.thrusters; if (!t) return null;
  const base = thrusterCurve(t.size, t.rating); if (!base) return null;
  const optMass = mod(t, 'EngineOptimalMass'); const perf = mod(t, 'EngineOptPerformance');
  const ms = optMass ? optMass / base.optmass : 1; const mu = perf ? perf / 100 : 1;
  return { minmass: base.minmass * ms, optmass: base.optmass * ms, maxmass: base.maxmass * ms, minmul: base.minmul * mu, optmul: base.optmul * mu, maxmul: base.maxmul * mu };
}

export function fuelAboard(rec: ShipRecord): number { return (rec.fuelMain ?? 0) + (rec.fuelReserve ?? 0); }

export interface SpeedFigures { speed: number; boost: number; mass: number }
/** Speed and boost at a given extra mass (cargo) with a full tank; null when the hull or thrusters are unknown. */
export function speedAndBoost(rec: ShipRecord, cargo = 0, hull: HullStats | null = hullFor(rec.type)): SpeedFigures | null {
  if (!hull || hull.source === 'missing' || rec.unladenMass == null) return null;
  const curve = engineeredThrusterCurve(rec); if (!curve) return null;
  const mass = rec.unladenMass + fuelAboard(rec) + cargo;
  const mul = massCurveMultiplier(mass, curve);
  return { speed: hull.speed * mul, boost: hull.boost * mul, mass };
}

export interface JumpFigures { unladen: number | null; laden: number | null; journal: number | null; boosterLy: number }
/** Jump range: unladen = unladen mass + the fuel one jump burns (what the journal's MaxJumpRange measures); laden = full tank + full hold. */
export function jumpRanges(rec: ShipRecord): JumpFigures {
  const out: JumpFigures = { unladen: null, laden: null, journal: rec.maxJumpRange, boosterLy: 0 };
  const f = rec.fsd; const stats = f ? fsdFor(f.item) : null;
  if (!f || !stats || rec.unladenMass == null) return out;
  const optmass = mod(f, 'FSDOptimalMass') ?? stats.optmass;
  const maxfuel = mod(f, 'MaxFuelPerJump') ?? stats.maxfuel;
  const booster = rec.guardianFsdBooster?.size ? (GUARDIAN_FSD_BOOST[rec.guardianFsdBooster.size] ?? 0) : 0;
  const range = (mass: number) => (optmass / mass) * Math.pow(maxfuel / stats.fuelmul, 1 / stats.fuelpower) + booster;
  out.boosterLy = booster;
  out.unladen = range(rec.unladenMass + maxfuel);
  out.laden = range(rec.unladenMass + fuelAboard(rec) + (rec.cargoCapacity ?? 0));
  return out;
}

export interface ShieldFigures { mj: number; generatorMultiplier: number; boosterBonus: number; boosters: number; model: true }
/** Shield strength: base shields × the generator's curve at the hull mass × (1 + the boosters' bonuses). Unvalidated — a model. */
export function shieldStrength(rec: ShipRecord, hull: HullStats | null = hullFor(rec.type)): ShieldFigures | null {
  const g = rec.shieldGenerator;
  if (!g || !hull || hull.source === 'missing') return null;
  const base = shieldGeneratorCurve(g.size, g.rating, g.biweave); if (!base) return null;
  // ShieldGenStrength is the optimal multiplier in percent (90 for a D, 120 for an A); engineering replaces it and
  // the minimum and maximum multipliers move with it. ShieldGenOptimalMass moves the whole mass range.
  const strength = mod(g, 'ShieldGenStrength'); const optMass = mod(g, 'ShieldGenOptimalMass');
  const mu = strength ? strength / 100 / base.optmul : 1; const ms = optMass ? optMass / base.optmass : 1;
  const curve: MassCurve = { minmass: base.minmass * ms, optmass: base.optmass * ms, maxmass: base.maxmass * ms, minmul: base.minmul * mu, optmul: base.optmul * mu, maxmul: base.maxmul * mu };
  const genMul = massCurveMultiplier(hull.hullMass, curve);
  let bonus = 0;
  for (const b of rec.shieldBoosters) {
    const eng = mod(b, 'DefenceModifierShieldMultiplier');
    bonus += eng != null ? eng / 100 : (SHIELD_BOOSTER_BOOST[(b.rating ?? 'E').toUpperCase() as keyof typeof SHIELD_BOOSTER_BOOST] ?? 0);
  }
  return { mj: hull.baseShields * genMul * (1 + bonus), generatorMultiplier: genMul, boosterBonus: bonus, boosters: rec.shieldBoosters.length, model: true };
}

/** Hangars: the game calls the fighter hangar a "vessel hangar" now — fighters and vessels (the Nomad) share it; the Caspian's is built in. */
export interface CraftFigures { srvBays: number; srvCount: number; rhinoCapable: boolean; vesselHangars: number; vesselCapacity: number; builtInVesselBay: boolean; last: ShipCraft | null }
export function craftFigures(rec: ShipRecord, last: ShipCraft | null | undefined): CraftFigures {
  const srvCount = rec.srvBays.reduce((s, b) => s + (b.size ? SRV_BAY_COUNT[b.size] ?? 0 : 0), 0);
  const vesselCapacity = rec.fighterBays.reduce((s, b) => s + (b.size ? FIGHTER_BAY_COUNT[b.size] ?? 0 : 0), 0);
  return {
    srvBays: rec.srvBays.length, srvCount, rhinoCapable: rec.srvBays.some((b) => b.large),
    vesselHangars: rec.fighterBays.length, vesselCapacity, builtInVesselBay: rec.fighterBays.some((b) => b.vessel),
    last: last ?? null,
  };
}

export function moduleLabel(m: EngineeredModule | null | undefined): string {
  if (!m) return '—';
  const base = m.size != null && m.rating ? `${m.size}${m.rating}` : m.item;
  const e = m.engineering;
  if (!e) return base;
  const bp = (e.blueprint ?? '').replace(/^(Engine|FSD|ShieldGenerator|ShieldBooster)_/, '').replace(/_/g, ' ');
  return `${base} ${bp}${e.grade ? ` G${e.grade}` : ''}${e.experimental ? ` + ${e.experimental}` : ''}`.trim();
}

export function friendlyType(type: string | null | undefined): string {
  const h = hullFor(type);
  return h ? h.name : String(type ?? '').replace(/_/g, ' ');
}
