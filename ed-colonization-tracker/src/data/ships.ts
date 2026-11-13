/**
 * Hull and module constants for the ship stable (1.60.33).
 *
 * Numbers are Frontier's, as published in the coriolis-data repository (github.com/EDCD/coriolis-data,
 * master on 2026-10-25; its data files are Frontier's IP, so the values are copied here, not the files).
 * Hulls the commander owns that coriolis-data does not carry (Lynx Highliner, Anaconda Mk II) are listed
 * with `source: 'missing'` and show "n/a" until their base figures are read off the in-game shipyard.
 * Engineering comes from each ship's Loadout, never from here.
 */

export interface HullStats {
  journalName: string;     // Loadout.Ship, lower-cased
  name: string;
  padClass: 1 | 2 | 3;     // small / medium / large landing pad
  speed: number;           // base top speed, m/s
  boost: number;           // base boost speed, m/s
  hullMass: number;        // t, hull alone — the shield generator's curve runs on this
  baseShields: number;     // MJ before the generator and boosters
  crew: number;
  source: 'coriolis-data' | 'in-game' | 'missing';
}

const H = (journalName: string, name: string, padClass: 1 | 2 | 3, speed: number, boost: number, hullMass: number, baseShields: number, crew: number): HullStats =>
  ({ journalName, name, padClass, speed, boost, hullMass, baseShields, crew, source: 'coriolis-data' });

export const HULLS: Record<string, HullStats> = {
  sidewinder: H('sidewinder', 'Sidewinder', 1, 220, 320, 25, 40, 1),
  eagle: H('eagle', 'Eagle', 1, 240, 350, 50, 60, 1),
  viper_mkiv: H('viper_mkiv', 'Viper Mk IV', 1, 270, 340, 190, 150, 1),
  empire_courier: H('empire_courier', 'Imperial Courier', 1, 280, 380, 35, 200, 1),
  cobramkv: H('cobramkv', 'Cobra Mk V', 1, 291, 412, 150, 160, 3),
  smallcombat01_nx: H('smallcombat01_nx', 'Kestrel Mk II', 1, 271, 360, 190, 225, 1),
  python: H('python', 'Python', 2, 230, 300, 350, 260, 2),
  ferdelance: H('ferdelance', 'Fer-de-Lance', 2, 260, 350, 250, 300, 2),
  krait_mkii: H('krait_mkii', 'Krait Mk II', 2, 240, 330, 320, 220, 3),
  krait_light: H('krait_light', 'Krait Phantom', 2, 250, 350, 270, 200, 2),
  // Mandalay: coriolis-data says 230 t of hull; the shipyard screen says 190 t, and 190 gives its 283 MJ back.
  mandalay: { ...H('mandalay', 'Mandalay', 2, 280, 350, 190, 220, 2), source: 'in-game' },
  type8: H('type8', 'Type-8 Transporter', 2, 200, 340, 400, 228, 1),
  corsair: H('corsair', 'Corsair', 2, 280, 355, 265, 235, 2),
  lakonminer: H('lakonminer', 'Type-11 Prospector', 2, 272, 367, 320, 275, 3),
  anaconda: H('anaconda', 'Anaconda', 3, 180, 240, 400, 350, 4),
  federation_corvette: H('federation_corvette', 'Federal Corvette', 3, 200, 260, 900, 555, 4),
  cutter: H('cutter', 'Imperial Cutter', 3, 200, 320, 1100, 600, 4),
  panthermkii: H('panthermkii', 'Panther Clipper Mk II', 3, 181, 250, 1200, 350, 4),
  // Caspian: coriolis-data says 950 t of hull; the shipyard screen says 825 t (2026-10-25). The screen wins.
  explorer_nx: { ...H('explorer_nx', 'Caspian Explorer', 3, 210, 290, 825, 500, 4), source: 'in-game' },
  // Lynx Highliner: not in coriolis-data. Base speed, boost and shields back-solved from the shipyard screen
  // (481 / 591 m/s and 306 MJ on 2026-10-25) through the same curves with the ship's own engineering
  // (6A Dirty G5 + Drag Drives, 4A reinforced generator); hull mass 260 t as the screen shows it.
  mediumtransport01: { journalName: 'mediumtransport01', name: 'Lynx Highliner', padClass: 2, speed: 285, boost: 350, hullMass: 260, baseShields: 200, crew: 2, source: 'in-game' },
  // Owned, not in coriolis-data, no shipyard screen read yet: n/a until its base figures are entered.
  anacondamkii: { journalName: 'anacondamkii', name: 'Anaconda Mk II', padClass: 3, speed: 0, boost: 0, hullMass: 0, baseShields: 0, crew: 0, source: 'missing' },
};

export function hullFor(type: string | null | undefined): HullStats | null {
  if (!type) return null;
  return HULLS[String(type).toLowerCase()] ?? null;
}

export const PAD_LABEL: Record<1 | 2 | 3, string> = { 1: 'S', 2: 'M', 3: 'L' };

/** A mass curve: the multiplier a module gives a ship of a given mass (thrusters, shield generators). */
export interface MassCurve { minmass: number; optmass: number; maxmass: number; minmul: number; optmul: number; maxmul: number }

type Rating = 'E' | 'D' | 'C' | 'B' | 'A';

// Thrusters: optimal mass by size and rating; minimum = half, maximum = 1.5×. Multipliers by rating.
const THRUSTER_OPTMASS: Record<number, Record<Rating, number>> = {
  2: { E: 48, D: 54, C: 60, B: 66, A: 72 },
  3: { E: 80, D: 90, C: 100, B: 110, A: 120 },
  4: { E: 280, D: 315, C: 350, B: 385, A: 420 },
  5: { E: 560, D: 630, C: 700, B: 770, A: 840 },
  6: { E: 960, D: 1080, C: 1200, B: 1320, A: 1440 },
  7: { E: 1440, D: 1620, C: 1800, B: 1980, A: 2160 },
  8: { E: 2240, D: 2520, C: 2800, B: 3080, A: 3360 },
};
const THRUSTER_MUL: Record<Rating, [number, number, number]> = { E: [0.83, 1, 1.03], D: [0.86, 1, 1.06], C: [0.9, 1, 1.1], B: [0.93, 1, 1.13], A: [0.96, 1, 1.16] };

export function thrusterCurve(size: number | null, rating: string | null): MassCurve | null {
  if (!size || !rating || !THRUSTER_OPTMASS[size]) return null;
  const r = rating.toUpperCase() as Rating;
  const opt = THRUSTER_OPTMASS[size][r]; const m = THRUSTER_MUL[r];
  if (!opt || !m) return null;
  return { minmass: opt / 2, optmass: opt, maxmass: opt * 1.5, minmul: m[0], optmul: m[1], maxmul: m[2] };
}

// Frame shift drives: optimal mass, max fuel per jump, the rating's linear constant and the size's power constant.
export interface FsdStats { optmass: number; maxfuel: number; fuelmul: number; fuelpower: number }
const F = (optmass: number, maxfuel: number, fuelmul: number, fuelpower: number): FsdStats => ({ optmass, maxfuel, fuelmul, fuelpower });
export const FSDS: Record<string, FsdStats> = {
  int_hyperdrive_size2_class1: F(48, 0.6, 0.011, 2), int_hyperdrive_size2_class2: F(54, 0.6, 0.01, 2), int_hyperdrive_size2_class3: F(60, 0.6, 0.008, 2), int_hyperdrive_size2_class4: F(75, 0.8, 0.01, 2), int_hyperdrive_size2_class5: F(90, 0.9, 0.012, 2),
  int_hyperdrive_size3_class1: F(80, 1.2, 0.011, 2.15), int_hyperdrive_size3_class2: F(90, 1.2, 0.01, 2.15), int_hyperdrive_size3_class3: F(100, 1.2, 0.008, 2.15), int_hyperdrive_size3_class4: F(125, 1.5, 0.01, 2.15), int_hyperdrive_size3_class5: F(150, 1.8, 0.012, 2.15),
  int_hyperdrive_size4_class1: F(280, 2, 0.011, 2.3), int_hyperdrive_size4_class2: F(315, 2, 0.01, 2.3), int_hyperdrive_size4_class3: F(350, 2, 0.008, 2.3), int_hyperdrive_size4_class4: F(437.5, 2.5, 0.01, 2.3), int_hyperdrive_size4_class5: F(525, 3, 0.012, 2.3),
  int_hyperdrive_size5_class1: F(560, 3.3, 0.011, 2.45), int_hyperdrive_size5_class2: F(630, 3.3, 0.01, 2.45), int_hyperdrive_size5_class3: F(700, 3.3, 0.008, 2.45), int_hyperdrive_size5_class4: F(875, 4.1, 0.01, 2.45), int_hyperdrive_size5_class5: F(1050, 5, 0.012, 2.45),
  int_hyperdrive_size6_class1: F(960, 5.3, 0.011, 2.6), int_hyperdrive_size6_class2: F(1080, 5.3, 0.01, 2.6), int_hyperdrive_size6_class3: F(1200, 5.3, 0.008, 2.6), int_hyperdrive_size6_class4: F(1500, 6.6, 0.01, 2.6), int_hyperdrive_size6_class5: F(1800, 8, 0.012, 2.6),
  int_hyperdrive_size7_class1: F(1440, 8.5, 0.011, 2.75), int_hyperdrive_size7_class2: F(1620, 8.5, 0.01, 2.75), int_hyperdrive_size7_class3: F(1800, 8.5, 0.008, 2.75), int_hyperdrive_size7_class4: F(2250, 10.6, 0.01, 2.75), int_hyperdrive_size7_class5: F(2700, 12.8, 0.012, 2.75),
  // Supercruise-overcharge drives (2024+): their own optimal masses and constants.
  int_hyperdrive_overcharge_size2_class1: F(60, 0.6, 0.008, 2), int_hyperdrive_overcharge_size2_class2: F(90, 0.9, 0.012, 2), int_hyperdrive_overcharge_size2_class3: F(90, 0.9, 0.012, 2), int_hyperdrive_overcharge_size2_class4: F(90, 0.9, 0.012, 2), int_hyperdrive_overcharge_size2_class5: F(100, 1, 0.013, 2),
  int_hyperdrive_overcharge_size3_class1: F(100, 1.2, 0.008, 2.15), int_hyperdrive_overcharge_size3_class2: F(150, 1.8, 0.012, 2.15), int_hyperdrive_overcharge_size3_class3: F(150, 1.8, 0.012, 2.15), int_hyperdrive_overcharge_size3_class4: F(150, 1.8, 0.012, 2.15), int_hyperdrive_overcharge_size3_class5: F(167, 1.9, 0.013, 2.15),
  int_hyperdrive_overcharge_size4_class1: F(350, 2, 0.008, 2.3), int_hyperdrive_overcharge_size4_class2: F(525, 3, 0.012, 2.3), int_hyperdrive_overcharge_size4_class3: F(525, 3, 0.012, 2.3), int_hyperdrive_overcharge_size4_class4: F(525, 3, 0.012, 2.3), int_hyperdrive_overcharge_size4_class5: F(585, 3.2, 0.013, 2.3),
  int_hyperdrive_overcharge_size5_class1: F(700, 3.3, 0.008, 2.45), int_hyperdrive_overcharge_size5_class2: F(1050, 5, 0.012, 2.45), int_hyperdrive_overcharge_size5_class3: F(1050, 5, 0.012, 2.45), int_hyperdrive_overcharge_size5_class4: F(1050, 5, 0.012, 2.45), int_hyperdrive_overcharge_size5_class5: F(1175, 5.2, 0.013, 2.45),
  int_hyperdrive_overcharge_size6_class1: F(1200, 5.3, 0.008, 2.6), int_hyperdrive_overcharge_size6_class2: F(1800, 8, 0.012, 2.6), int_hyperdrive_overcharge_size6_class3: F(1800, 8, 0.012, 2.6), int_hyperdrive_overcharge_size6_class4: F(1800, 8, 0.012, 2.6), int_hyperdrive_overcharge_size6_class5: F(2000, 8.3, 0.013, 2.6),
  int_hyperdrive_overcharge_size7_class1: F(1800, 8.5, 0.008, 2.75), int_hyperdrive_overcharge_size7_class2: F(2700, 12.8, 0.012, 2.75), int_hyperdrive_overcharge_size7_class3: F(2700, 12.8, 0.012, 2.75), int_hyperdrive_overcharge_size7_class4: F(2700, 12.8, 0.012, 2.75), int_hyperdrive_overcharge_size7_class5: F(3000, 13.1, 0.013, 2.75),
  int_hyperdrive_overcharge_size8_class1: F(2800, 13.6, 0.008, 2.9), int_hyperdrive_overcharge_size8_class2: F(4200, 20.4, 0.012, 2.9), int_hyperdrive_overcharge_size8_class3: F(4200, 20.4, 0.012, 2.9), int_hyperdrive_overcharge_size8_class4: F(4200, 20.4, 0.012, 2.9), int_hyperdrive_overcharge_size8_class5: F(4670, 20.7, 0.013, 2.9),
};

export function fsdFor(item: string | null | undefined): FsdStats | null {
  if (!item) return null;
  return FSDS[String(item).toLowerCase()] ?? null;
}

/** Guardian FSD booster: flat light-years added to the jump range, by module size. */
export const GUARDIAN_FSD_BOOST: Record<number, number> = { 1: 4, 2: 6, 3: 7.75, 4: 9.25, 5: 10.5 };

// Shield generators: mass curve by size (hull mass, not total), multipliers by rating; bi-weave is C-rated at D multipliers.
const SHIELD_MASS: Record<number, [number, number, number]> = {
  1: [13, 25, 63], 2: [28, 55, 138], 3: [83, 165, 413], 4: [143, 285, 713], 5: [203, 405, 1013], 6: [270, 540, 1350], 7: [530, 1060, 2650], 8: [900, 1800, 4500],
};
const SHIELD_MUL: Record<Rating, [number, number, number]> = { E: [0.3, 0.8, 1.3], D: [0.4, 0.9, 1.4], C: [0.5, 1, 1.5], B: [0.6, 1.1, 1.6], A: [0.7, 1.2, 1.7] };

export function shieldGeneratorCurve(size: number | null, rating: string | null, biweave: boolean): MassCurve | null {
  if (!size || !rating || !SHIELD_MASS[size]) return null;
  const m = SHIELD_MASS[size];
  const mul = biweave ? SHIELD_MUL.D : SHIELD_MUL[rating.toUpperCase() as Rating];
  if (!mul) return null;
  return { minmass: m[0], optmass: m[1], maxmass: m[2], minmul: mul[0], optmul: mul[1], maxmul: mul[2] };
}

/** Shield booster: fraction of strength added per booster, by rating (an engineered booster carries its own figure). */
export const SHIELD_BOOSTER_BOOST: Record<Rating, number> = { E: 0.04, D: 0.08, C: 0.12, B: 0.16, A: 0.2 };

/** Planetary vehicle hangar: SRVs carried, by module size. Fighter hangar: fighters carried, by size. */
export const SRV_BAY_COUNT: Record<number, number> = { 2: 1, 4: 2, 6: 4 };
export const FIGHTER_BAY_COUNT: Record<number, number> = { 5: 1, 6: 2, 7: 2 };
