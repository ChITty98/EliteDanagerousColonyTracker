/**
 * Wiki — data-driven reference pages about the 700 ly scouting bubble.
 *
 * Source: Spansh galaxy dump (102.74 GB), region-indexed by tools/spansh-index.mjs
 * into E:\Spansh\region-col173-axj-d9-52-700.jsonl.
 *
 * All figures below are static snapshots of the 2026-04-20 scan. Re-run
 * tools/spansh-index.mjs + tools/sky-drama.mjs if the dump refreshes.
 */

type AtmoRow = {
  atmo: string;
  allLandable: number;
  nonIcy: number;
  icyOnly: number;
  pctNonIcy: number;
};

type RingEdgeRow = {
  anchor: number;
  anchorName: 'AX-J' | 'HIP';
  pop: number;
  system: string;
  body: string;
  atmo: string;
  pct: number;
  parent: string;
};

type InsideRingsRow = {
  anchor: number;
  anchorName: 'AX-J' | 'HIP';
  pop: number;
  system: string;
  body: string;
  atmo: string;
  pct: number;
  sma: number;
  ring: number;
  parent: string;
};

type BinaryRow = {
  anchor: number;
  anchorName: 'AX-J' | 'HIP';
  pop: number;
  system: string;
  bodies: string;
  atmos: string;
  sepKm: number;
};

type BigSiblingRow = {
  anchor: number;
  anchorName: 'AX-J' | 'HIP';
  pop: number;
  apparentDeg: number;
  system: string;
  landable: string;
  sibling: string;
  sibType: string;
  sepLs: number;
};

type UniqueRow = {
  label: string;
  system: string;
  anchor: number;
  anchorName: 'AX-J' | 'HIP';
  pop: number;
  body: string;
  note: string;
};

const TOTAL_NON_ICY_LANDABLE_ATMO = 122914;
const TOTAL_ALL_LANDABLE_ATMO = 390103;

const ATMO_RARITY: AtmoRow[] = [
  { atmo: 'Thin Neon',                 allLandable: 123760, nonIcy: 2,     icyOnly: 123758, pctNonIcy: 0.002 },
  { atmo: 'Hot thin Silicate vapour',  allLandable: 7,      nonIcy: 7,     icyOnly: 0,      pctNonIcy: 0.006 },
  { atmo: 'Hot thin Carbon dioxide',   allLandable: 68,     nonIcy: 68,    icyOnly: 0,      pctNonIcy: 0.055 },
  { atmo: 'Hot thin Sulphur dioxide',  allLandable: 222,    nonIcy: 222,   icyOnly: 0,      pctNonIcy: 0.181 },
  { atmo: 'Thin Argon-rich',           allLandable: 5665,   nonIcy: 289,   icyOnly: 5376,   pctNonIcy: 0.235 },
  { atmo: 'Thin Oxygen',               allLandable: 1163,   nonIcy: 339,   icyOnly: 824,    pctNonIcy: 0.276 },
  { atmo: 'Thin Methane-rich',         allLandable: 459,    nonIcy: 459,   icyOnly: 0,      pctNonIcy: 0.373 },
  { atmo: 'Thin Methane',              allLandable: 20531,  nonIcy: 627,   icyOnly: 19904,  pctNonIcy: 0.510 },
  { atmo: 'Thin Water',                allLandable: 779,    nonIcy: 779,   icyOnly: 0,      pctNonIcy: 0.634 },
  { atmo: 'Thin Argon',                allLandable: 69531,  nonIcy: 1128,  icyOnly: 68403,  pctNonIcy: 0.918 },
  { atmo: 'Thin Neon-rich',            allLandable: 39418,  nonIcy: 1361,  icyOnly: 38057,  pctNonIcy: 1.107 },
  { atmo: 'Thin Carbon dioxide-rich',  allLandable: 2158,   nonIcy: 2069,  icyOnly: 89,     pctNonIcy: 1.684 },
  { atmo: 'Thin Nitrogen',             allLandable: 10877,  nonIcy: 2867,  icyOnly: 8010,   pctNonIcy: 2.333 },
  { atmo: 'Thin Helium',               allLandable: 4701,   nonIcy: 2995,  icyOnly: 1706,   pctNonIcy: 2.437 },
  { atmo: 'Thin Water-rich',           allLandable: 89,     nonIcy: 0,     icyOnly: 89,     pctNonIcy: 0 },
  { atmo: 'Thin Ammonia',              allLandable: 19367,  nonIcy: 19318, icyOnly: 49,     pctNonIcy: 15.72 },
  { atmo: 'Thin Sulphur dioxide',      allLandable: 36640,  nonIcy: 35739, icyOnly: 901,    pctNonIcy: 29.08 },
  { atmo: 'Thin Carbon dioxide',       allLandable: 54668,  nonIcy: 54645, icyOnly: 23,     pctNonIcy: 44.46 },
];

const RING_EDGE_TOP20: RingEdgeRow[] = [
  { anchor: 0,   anchorName: 'AX-J', pop: 57,  system: 'Col 173 Sector AX-J d9-52',      body: '2 a',     atmo: 'Oxygen',     pct: 101, parent: 'Y brown dwarf' },
  { anchor: 0,   anchorName: 'AX-J', pop: 57,  system: 'Col 173 Sector AX-J d9-52',      body: '2 b',     atmo: 'Oxygen',     pct: 149, parent: 'Y brown dwarf' },
  { anchor: 102, anchorName: 'HIP',  pop: 38,  system: 'Col 173 Sector LG-Z c15-7',      body: 'AB 2 a',  atmo: 'Methane',    pct: 103, parent: 'Y brown dwarf' },
  { anchor: 120, anchorName: 'HIP',  pop: 65,  system: 'Wregoe ER-C c26-5',              body: '3 a',     atmo: 'Methane',    pct: 126, parent: 'Class I GG' },
  { anchor: 160, anchorName: 'AX-J', pop: 42,  system: 'Vela Dark Region DG-X c1-14',    body: 'ABC 5 a', atmo: 'Argon-rich', pct: 115, parent: 'Y brown dwarf' },
  { anchor: 167, anchorName: 'HIP',  pop: 72,  system: 'Wregoe YZ-E c25-6',              body: '1 a',     atmo: 'SO2',        pct: 144, parent: 'Class III GG' },
  { anchor: 192, anchorName: 'AX-J', pop: 122, system: 'Synuefe UA-C d14-26',            body: '1 a',     atmo: 'SO2',        pct: 112, parent: 'Class III GG' },
  { anchor: 216, anchorName: 'HIP',  pop: 61,  system: 'Synuefe TX-J c25-9',             body: '3 a',     atmo: 'SO2',        pct: 118, parent: 'Class III GG' },
  { anchor: 221, anchorName: 'AX-J', pop: 170, system: 'HD 77672',                       body: 'AB 1 a',  atmo: 'CO2',        pct: 146, parent: 'Y brown dwarf' },
  { anchor: 224, anchorName: 'HIP',  pop: 67,  system: 'Swoilz VD-F c7',                 body: 'AB 3 a',  atmo: 'SO2',        pct: 131, parent: 'Class III GG' },
  { anchor: 254, anchorName: 'HIP',  pop: 29,  system: 'HIP 44495',                      body: 'ABC 4 a', atmo: 'SO2',        pct: 126, parent: 'Class III GG' },
  { anchor: 259, anchorName: 'AX-J', pop: 63,  system: 'Col 173 Sector OQ-B c14-18',     body: '6 a',     atmo: 'SO2',        pct: 130, parent: 'Class III GG' },
  { anchor: 272, anchorName: 'HIP',  pop: 176, system: 'Swoilz EG-A c3-16',              body: '3 a',     atmo: 'Methane',    pct: 105, parent: 'Y brown dwarf' },
  { anchor: 275, anchorName: 'AX-J', pop: 68,  system: 'Col 173 Sector ZR-Y c15-21',     body: '2 a',     atmo: 'SO2',        pct: 125, parent: 'Class III GG' },
  { anchor: 278, anchorName: 'AX-J', pop: 26,  system: 'Col 173 Sector FU-D c13-10',     body: '12 a',    atmo: 'Methane',    pct: 147, parent: 'Y brown dwarf' },
  { anchor: 314, anchorName: 'HIP',  pop: 20,  system: 'Synuefe OC-K c25-24',            body: '5 a',     atmo: 'SO2',        pct: 105, parent: 'Class III GG' },
  { anchor: 328, anchorName: 'HIP',  pop: 91,  system: 'Wregoe AV-G d10-17',             body: '1 a',     atmo: 'SO2',        pct: 145, parent: 'Class III GG' },
  { anchor: 345, anchorName: 'AX-J', pop: 138, system: 'Col 173 Sector KT-P d6-36',      body: '2 a',     atmo: 'Ammonia',    pct: 101, parent: 'GG' },
  { anchor: 361, anchorName: 'AX-J', pop: 39,  system: 'Col 173 Sector HS-S d4-89',      body: '8 a',     atmo: 'Methane',    pct: 102, parent: 'Y brown dwarf' },
  { anchor: 378, anchorName: 'AX-J', pop: 29,  system: 'Col 173 Sector ZF-N d7-17',      body: '1 a',     atmo: 'SO2',        pct: 123, parent: 'Class III GG' },
];

const INSIDE_RINGS_ALL: InsideRingsRow[] = [
  { anchor: 203, anchorName: 'HIP',  pop: 105, system: 'Praea Euq JK-A d15',             body: 'AB 6 c', atmo: 'CO2',     pct: 36, sma: 1.64,  ring: 4.52,  parent: 'Class I GG' },
  { anchor: 242, anchorName: 'AX-J', pop: 59,  system: 'Col 173 Sector MJ-P d6-44',      body: 'A 4 a',  atmo: 'CO2',     pct: 38, sma: 2.09,  ring: 5.53,  parent: 'Class I GG' },
  { anchor: 298, anchorName: 'AX-J', pop: 12,  system: 'Col 173 Sector KY-Q d5-65',      body: 'AB 2 d', atmo: 'CO2',     pct: 35, sma: 20.99, ring: 60.22, parent: 'Y brown dwarf (massive rings)' },
  { anchor: 387, anchorName: 'HIP',  pop: 95,  system: 'Praea Euq OW-W d1-8',            body: '9 f',    atmo: 'CO2',     pct: 35, sma: 3.99,  ring: 11.48, parent: 'Class I GG (+ twin)' },
  { anchor: 388, anchorName: 'HIP',  pop: 194, system: 'Praea Euq VC-V d2-13',           body: '3 c',    atmo: 'CO2',     pct: 35, sma: 2.54,  ring: 7.26,  parent: 'Class I GG (+ twin)' },
  { anchor: 427, anchorName: 'AX-J', pop: 169, system: '2MASS J08465517-4240422',        body: '9 b',    atmo: 'CO2',     pct: 35, sma: 13.93, ring: 40.32, parent: 'Y brown dwarf (massive)' },
  { anchor: 497, anchorName: 'AX-J', pop: 116, system: 'Col 173 Sector EM-L d8-57',      body: 'A 5 d',  atmo: 'Ammonia', pct: 36, sma: 3.93,  ring: 10.79, parent: 'Class III GG' },
  { anchor: 525, anchorName: 'HIP',  pop: 234, system: 'Swoilz CQ-V d3-37',              body: 'AB 3 c', atmo: 'Ammonia', pct: 34, sma: 7.58,  ring: 22.07, parent: 'Class III GG' },
  { anchor: 606, anchorName: 'HIP',  pop: 120, system: 'Praea Euq JL-P d5-102',          body: '2 c',    atmo: 'CO2',     pct: 36, sma: 2.62,  ring: 7.30,  parent: 'Class I GG' },
  { anchor: 653, anchorName: 'HIP',  pop: 4,   system: 'Synuefe VG-J d10-104',           body: '5 c',    atmo: 'CO2',     pct: 36, sma: 2.00,  ring: 5.53,  parent: 'Class I GG' },
  { anchor: 678, anchorName: 'AX-J', pop: 465, system: 'Swoilz FA-Y d1-7',               body: '6 a',    atmo: 'CO2',     pct: 37, sma: 6.36,  ring: 17.24, parent: 'Class II GG' },
  { anchor: 689, anchorName: 'AX-J', pop: 161, system: 'Col 132 Sector PJ-Q d5-20',      body: 'A 4 d',  atmo: 'Ammonia', pct: 38, sma: 2.85,  ring: 7.57,  parent: 'Class II GG' },
];

const WATER_BINARIES: BinaryRow[] = [
  { anchor: 353, anchorName: 'HIP',  pop: 205, system: 'Wregoe FH-W b44-1',              bodies: 'A 4 + A 5',       atmos: 'Water + Water', sepKm: 6206 },
  { anchor: 667, anchorName: 'HIP',  pop: 264, system: 'HD 73199',                       bodies: '5 b + 5 c',       atmos: 'Water + Water', sepKm: 7585 },
  { anchor: 500, anchorName: 'HIP',  pop: 93,  system: 'HIP 52992',                      bodies: '6 c + 6 d',       atmos: 'Water + Water', sepKm: 7765 },
  { anchor: 679, anchorName: 'AX-J', pop: 223, system: 'Plio Eurl NO-Z d13-92',          bodies: 'ABC 3 d + 3 e',   atmos: 'Water + Water', sepKm: 8364 },
  { anchor: 510, anchorName: 'AX-J', pop: 5,   system: 'Synuefe BM-V b35-2',             bodies: 'B 5 + B 6',       atmos: 'Water + Water', sepKm: 10343 },
  { anchor: 370, anchorName: 'HIP',  pop: 91,  system: 'Wregoe DB-F d11-106',            bodies: '9 e + 9 f',       atmos: 'Water + Water', sepKm: 10643 },
  { anchor: 622, anchorName: 'HIP',  pop: 290, system: 'Praea Euq HD-Q b20-0',           bodies: 'A 2 + A 3',       atmos: 'Water + Water', sepKm: 10912 },
  { anchor: 338, anchorName: 'HIP',  pop: 163, system: 'Praea Euq MG-H b10-0',           bodies: 'B 6 + B 7',       atmos: 'Water + Water', sepKm: 11212 },
  { anchor: 407, anchorName: 'HIP',  pop: 124, system: 'HIP 46382',                      bodies: '6 d + 6 e',       atmos: 'Water + Water', sepKm: 14570 },
  { anchor: 420, anchorName: 'AX-J', pop: 53,  system: 'Col 173 Sector PB-V b19-7',      bodies: 'A 1 + A 2',       atmos: 'Water + Water', sepKm: 17778 },
];

const BIG_SIBLING_TOP: BigSiblingRow[] = [
  { anchor: 14, anchorName: 'HIP',  pop: 3,  apparentDeg: 155, system: 'Wregoe BB-A b55-1',       landable: 'A 1 / A 2', sibling: 'A 2 / A 1', sibType: 'HMC + HMC (ultra-tight)', sepLs: 0 },
  { anchor: 12, anchorName: 'HIP',  pop: 12, apparentDeg: 109, system: 'Wregoe QI-B d13-31',      landable: 'BC 3 / BC 4', sibling: 'BC 4 / BC 3', sibType: 'HMC + HMC', sepLs: 0 },
  { anchor: 20, anchorName: 'AX-J', pop: 66, apparentDeg: 107, system: 'Col 173 Sector ZI-V c17-0', landable: 'C 6 / C 7', sibling: 'C 7 / C 6', sibType: 'HMC + HMC', sepLs: 0 },
  { anchor: 27, anchorName: 'HIP',  pop: 26, apparentDeg: 97,  system: 'Wregoe RI-B d13-4',       landable: 'A 1 / A 2', sibling: 'A 2 / A 1', sibType: 'HMC + HMC', sepLs: 0 },
  { anchor: 32, anchorName: 'AX-J', pop: 60, apparentDeg: 129, system: 'Col 173 Sector AX-J d9-37', landable: 'C 3 / C 4', sibling: 'C 4 / C 3', sibType: 'HMC + HMC (home sector)', sepLs: 0 },
  { anchor: 29, anchorName: 'HIP',  pop: 25, apparentDeg: 38,  system: 'Wregoe AG-A b55-6',       landable: 'A 2 / A 3', sibling: 'A 3 / A 2', sibType: 'HMC + HMC', sepLs: 0.01 },
  { anchor: 23, anchorName: 'HIP',  pop: 18, apparentDeg: 26,  system: 'Wregoe QI-B d13-55',      landable: 'A 2 / A 3', sibling: 'A 3 / A 2', sibType: 'HMC + HMC (Earth-diameter sep)', sepLs: 0.04 },
  { anchor: 22, anchorName: 'HIP',  pop: 11, apparentDeg: 15,  system: 'Wregoe LX-A c27-4',       landable: 'A 1',       sibling: 'A 4',       sibType: 'Class I gas giant sibling', sepLs: 1.23 },
];

const UNIQUES: UniqueRow[] = [
  { label: 'Carbon Star',          system: 'HIP 52656',                   anchor: 252, anchorName: 'HIP', pop: 127, body: 'B 1 (Metal-rich, 0.23g, 251 Ls)', note: 'ONLY carbon star in the 700 ly bubble. Deep red star, rare chemistry. Also has AB 1-4 HMCs at 459-708 Ls if you want more landings.' },
  { label: 'Hot Silicate Vapour — confirmed',  system: 'Col 173 Sector OT-Q d5-48', anchor: 330, anchorName: 'AX-J', pop: 78, body: '1 (Metal-rich, 1.48g, 12 Ls)', note: 'First Footfall achieved. Very hot star dominates sky, surface temp near silicate vaporization. F-class main star at close range.' },
  { label: 'Hot Silicate Vapour',  system: 'Col 173 Sector IS-S d4-56',   anchor: 395, anchorName: 'AX-J', pop: 54,  body: '1 (Metal-rich, 1.46g, 11 Ls)', note: 'Same pattern — close orbit to hot F star. Closer to populated.' },
  { label: 'Hot Silicate Vapour',  system: 'Synuefe LU-D d13-71',         anchor: 477, anchorName: 'HIP', pop: 38,  body: 'A 1 (Metal-rich, 1.46g, 20 Ls)', note: '38 ly from populated.' },
  { label: 'Hot Silicate Vapour',  system: 'Synuefe GO-F d12-13',         anchor: 559, anchorName: 'HIP', pop: 31,  body: '2 (Metal-rich, 1.42g, 16 Ls)', note: '31 ly from populated — easiest to stage from.' },
];

const BINARY_PAIRS_TOP15: BinaryRow[] = [
  { anchor: 50, anchorName: 'AX-J', pop: 85, system: 'Col 173 Sector CS-J d9-94',   bodies: '2 h + 2 i', atmos: 'CO2 + CO2',         sepKm: 43740 },
  { anchor: 54, anchorName: 'AX-J', pop: 20, system: 'Col 173 Sector ZN-N b37-2',   bodies: 'A 2 + A 3', atmos: 'Ammonia + Ammonia', sepKm: 35765 },
  { anchor: 57, anchorName: 'AX-J', pop: 40, system: 'Col 173 Sector HP-L b38-7',   bodies: 'B 4 + B 5', atmos: 'CO2 + SO2',         sepKm: 91946 },
  { anchor: 63, anchorName: 'HIP',  pop: 61, system: 'Wregoe WP-A b55-3',           bodies: 'A 6 + A 7', atmos: 'SO2 + SO2',         sepKm: 106666 },
  { anchor: 65, anchorName: 'AX-J', pop: 52, system: 'Vela Dark Region FW-W d1-92', bodies: 'B 2 + B 3', atmos: 'SO2 + SO2',         sepKm: 97433 },
  { anchor: 66, anchorName: 'AX-J', pop: 49, system: 'Col 173 Sector BX-J d9-59',   bodies: '9 h + 9 i', atmos: 'CO2 + CO2',         sepKm: 31088 },
  { anchor: 70, anchorName: 'HIP',  pop: 39, system: 'Synuefe PG-I b57-12',         bodies: 'A 2 + A 3', atmos: 'SO2 + SO2',         sepKm: 49676 },
  { anchor: 71, anchorName: 'HIP',  pop: 58, system: 'Col 173 Sector OB-Q b36-3',   bodies: 'A 2 + A 4', atmos: 'SO2 + SO2',         sepKm: 48686 },
  { anchor: 72, anchorName: 'AX-J', pop: 69, system: 'Col 173 Sector XG-S b34-4',   bodies: 'B 1 + B 2', atmos: 'SO2 + SO2',         sepKm: 65445 },
  { anchor: 77, anchorName: 'HIP',  pop: 33, system: 'Wregoe MI-Z c27-12',          bodies: 'B 1 + B 2', atmos: 'SO2 + SO2',         sepKm: 61457 },
  { anchor: 78, anchorName: 'AX-J', pop: 34, system: 'Col 173 Sector IU-L b38-11',  bodies: 'C 2 + C 3', atmos: 'Ammonia + Ammonia', sepKm: 24823 },
  { anchor: 83, anchorName: 'AX-J', pop: 66, system: 'Col 173 Sector DE-V c17-7',   bodies: 'B 1 + B 2', atmos: 'Ammonia + Ammonia', sepKm: 24553 },
  { anchor: 89, anchorName: 'HIP',  pop: 25, system: 'Col 173 Sector OR-X c16-2',   bodies: '1 f + 1 g', atmos: 'CO2 + CO2',         sepKm: 27491 },
  { anchor: 98, anchorName: 'AX-J', pop: 25, system: 'Vela Dark Region IR-W d1-59', bodies: '8 c + 8 d', atmos: 'CO2 + CO2',         sepKm: 29949 },
  { anchor: 108,anchorName: 'AX-J', pop: 17, system: 'Vela Dark Region CQ-Y d64',   bodies: '2 d + 2 e', atmos: 'Ammonia + Ammonia', sepKm: 25812 },
];

const STAR_RARITY: { count: number; type: string }[] = [
  { count: 1,       type: 'Carbon Star (unique in entire bubble)' },
  { count: 6,       type: 'Wolf-Rayet' },
  { count: 7,       type: 'O-class (Blue-White)' },
  { count: 9,       type: 'M Red super giant' },
  { count: 17,      type: 'A Blue-White super giant' },
  { count: 26,      type: 'F White super giant' },
  { count: 33,      type: 'Herbig Ae/Be' },
  { count: 38,      type: 'G White-Yellow super giant' },
  { count: 52,      type: 'B Blue-White super giant' },
  { count: 100,     type: 'Black Holes' },
  { count: 228,     type: 'Neutron Stars' },
  { count: 2214,    type: 'K Yellow-Orange giant' },
  { count: 2387,    type: 'B Blue-White (main sequence)' },
  { count: 2705,    type: 'M Red giant' },
  { count: 14192,   type: 'A Blue-White' },
  { count: 36127,   type: 'Y Brown dwarf (your home parent type)' },
  { count: 64934,   type: 'F White' },
  { count: 71045,   type: 'G White-Yellow' },
  { count: 81771,   type: 'T Tauri' },
  { count: 124453,  type: 'T Brown dwarf' },
  { count: 238375,  type: 'K Yellow-Orange' },
  { count: 244982,  type: 'L Brown dwarf' },
  { count: 717877,  type: 'M Red dwarf (most common)' },
];

function formatAnchor(r: { anchor: number; anchorName: string }) {
  return `${r.anchor} ly (${r.anchorName})`;
}

export function WikiPage() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold text-primary">Galaxy Wiki</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Reference data for the 700 ly scouting bubble around Col 173 Sector AX-J d9-52
        </p>
      </header>

      {/* ============ Dataset background ============ */}
      <section className="bg-card border border-border rounded-lg p-5 space-y-3">
        <h2 className="text-lg font-semibold text-foreground">About the dataset</h2>
        <p className="text-sm text-foreground/90">
          All figures below come from the Spansh galaxy dump pulled 2026-04-20 and
          region-indexed into a 700 ly sphere around your home colony.
        </p>
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <div className="flex justify-between border-b border-border/50 py-1">
            <dt className="text-muted-foreground">Scan center</dt>
            <dd className="font-mono">Col 173 Sector AX-J d9-52</dd>
          </div>
          <div className="flex justify-between border-b border-border/50 py-1">
            <dt className="text-muted-foreground">Coords (ly)</dt>
            <dd className="font-mono">(1021.75, -82.66, 69.38)</dd>
          </div>
          <div className="flex justify-between border-b border-border/50 py-1">
            <dt className="text-muted-foreground">Radius</dt>
            <dd className="font-mono">700 ly</dd>
          </div>
          <div className="flex justify-between border-b border-border/50 py-1">
            <dt className="text-muted-foreground">Source dump size</dt>
            <dd className="font-mono">102.74 GB (gzipped)</dd>
          </div>
          <div className="flex justify-between border-b border-border/50 py-1">
            <dt className="text-muted-foreground">Systems scanned</dt>
            <dd className="font-mono">186,969,910 (full galaxy)</dd>
          </div>
          <div className="flex justify-between border-b border-border/50 py-1">
            <dt className="text-muted-foreground">Systems in bubble</dt>
            <dd className="font-mono">1,267,864</dd>
          </div>
          <div className="flex justify-between border-b border-border/50 py-1">
            <dt className="text-muted-foreground">Populated systems</dt>
            <dd className="font-mono">6,429 (0.51%)</dd>
          </div>
          <div className="flex justify-between border-b border-border/50 py-1">
            <dt className="text-muted-foreground">Bodies in bubble</dt>
            <dd className="font-mono">8,271,649</dd>
          </div>
          <div className="flex justify-between border-b border-border/50 py-1">
            <dt className="text-muted-foreground">Stars</dt>
            <dd className="font-mono">1,603,239</dd>
          </div>
          <div className="flex justify-between border-b border-border/50 py-1">
            <dt className="text-muted-foreground">Planets</dt>
            <dd className="font-mono">6,668,410</dd>
          </div>
        </dl>
        <p className="text-xs text-muted-foreground mt-2">
          Indexer: <code className="bg-muted/50 px-1 rounded">tools/spansh-index.mjs</code>.
          Slim schema captures id64, coords, mainStar, population, economy, body list (name,
          type, subType, landable, atmo, gravity, rings, ringOuter in Ls, semi-major axis in Ls,
          distLs, terraform, discovered/mapped, bio/geo signals).
        </p>
      </section>

      {/* ============ Atmosphere rarity ============ */}
      <section className="bg-card border border-border rounded-lg p-5 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Atmosphere rarity</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Landable bodies in the 700 ly bubble, broken down by atmosphere. The
            &ldquo;Including icy&rdquo; column counts every landable body with that atmosphere.
            The &ldquo;Non-icy&rdquo; column excludes Icy body and Rocky ice world types — which
            matters because 71% of Thin Oxygen landables, 99% of Thin Neon landables, and 98% of
            Thin Argon landables sit on icy surfaces. If you&rsquo;re looking for a rocky/HMC
            body you can actually work with, the non-icy count is the real rarity.
          </p>
        </div>
        <div className="text-xs text-muted-foreground grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-muted/30 rounded p-2">
            <div className="text-muted-foreground">All landable w/ atmo</div>
            <div className="text-foreground font-mono text-base">{TOTAL_ALL_LANDABLE_ATMO.toLocaleString()}</div>
          </div>
          <div className="bg-muted/30 rounded p-2">
            <div className="text-muted-foreground">Non-icy landable w/ atmo</div>
            <div className="text-foreground font-mono text-base">{TOTAL_NON_ICY_LANDABLE_ATMO.toLocaleString()}</div>
          </div>
          <div className="bg-muted/30 rounded p-2">
            <div className="text-muted-foreground">Icy share of landable atmo</div>
            <div className="text-foreground font-mono text-base">
              {((1 - TOTAL_NON_ICY_LANDABLE_ATMO / TOTAL_ALL_LANDABLE_ATMO) * 100).toFixed(1)}%
            </div>
          </div>
          <div className="bg-muted/30 rounded p-2">
            <div className="text-muted-foreground">Total atmosphere types</div>
            <div className="text-foreground font-mono text-base">{ATMO_RARITY.length}</div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left border-b border-border">
                <th className="py-2 px-2 text-muted-foreground font-medium">Atmosphere</th>
                <th className="py-2 px-2 text-muted-foreground font-medium text-right">Including icy</th>
                <th className="py-2 px-2 text-muted-foreground font-medium text-right">Non-icy</th>
                <th className="py-2 px-2 text-muted-foreground font-medium text-right">Icy only</th>
                <th className="py-2 px-2 text-muted-foreground font-medium text-right">% of non-icy total</th>
                <th className="py-2 px-2 text-muted-foreground font-medium text-right">1 in N non-icy</th>
              </tr>
            </thead>
            <tbody>
              {ATMO_RARITY.map((row) => {
                const rare = row.pctNonIcy < 1;
                const oneInN = row.nonIcy > 0 ? Math.round(TOTAL_NON_ICY_LANDABLE_ATMO / row.nonIcy) : null;
                return (
                  <tr key={row.atmo} className="border-b border-border/40 hover:bg-muted/20">
                    <td className={`py-1.5 px-2 ${rare ? 'text-primary font-medium' : 'text-foreground'}`}>{row.atmo}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-foreground/80">{row.allLandable.toLocaleString()}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-foreground">{row.nonIcy.toLocaleString()}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-muted-foreground">{row.icyOnly.toLocaleString()}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-foreground/80">{row.pctNonIcy.toFixed(3)}%</td>
                    <td className="py-1.5 px-2 text-right font-mono text-muted-foreground">{oneInN ? oneInN.toLocaleString() : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="text-xs text-muted-foreground space-y-1 border-t border-border/50 pt-3">
          <p>
            <strong className="text-foreground">What &ldquo;icy only&rdquo; tells you:</strong>{' '}
            Thin Neon has 123,760 landable instances in the bubble, but only 2 are on non-icy
            bodies. It&rsquo;s the most &ldquo;common&rdquo; atmosphere by raw count and the
            rarest in practical terms.
          </p>
          <p>
            <strong className="text-foreground">The flip case:</strong>{' '}
            Thin Water shows 779 in both columns — every Thin Water landable in the bubble is on
            a rocky or HMC body, none on icy. Same for Thin Methane-rich, Hot thin CO2/SO2/Silicate.
          </p>
          <p>
            <strong className="text-foreground">The hidden rarity:</strong>{' '}
            Thin Oxygen looks moderate at 1,163 total landables, but 824 of those are on icy
            surfaces. Only <strong className="text-primary">339</strong> sit on a rocky or HMC
            body — roughly 1 in 363 of non-icy landable atmospheres. Excluding icy flips Oxygen
            from being ~50% more common than Water to being <strong className="text-primary">2.3×
            rarer</strong> than Water.
          </p>
        </div>
      </section>

      {/* ============ Dramatic skies ============ */}
      <section className="bg-card border border-border rounded-lg p-5 space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Dramatic skies</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Four geometries make &ldquo;something huge dominates the sky&rdquo; when you stand on a
            landable non-icy atmospheric body. Classification uses actual orbital geometry
            (body&rsquo;s semi-major axis around its parent vs the parent&rsquo;s ring outer radius
            in light-seconds) — not a distance-from-arrival-star proxy, which produces
            false positives.
          </p>
        </div>

        {/* Geometry A */}
        <div className="border-l-2 border-primary/60 pl-4 space-y-3">
          <div className="flex items-baseline gap-3 flex-wrap">
            <h3 className="font-semibold text-foreground">A — At the ring edge (&ldquo;amongst the rings&rdquo;)</h3>
            <span className="text-xs text-muted-foreground">81 bodies in bubble</span>
          </div>
          <p className="text-sm text-foreground/90">
            Moon orbits at 80-150% of parent&rsquo;s ring outer radius. Because the moon is at or
            just past the outermost ring, <strong className="text-foreground">ring material sits
            between the moon and the parent</strong> — you see the rings wrapping visually from
            your orbit inward toward the gas giant. This is the geometry that produces the
            &ldquo;amongst the rings&rdquo; view (your home&rsquo;s type). Parent must be a gas
            giant or brown dwarf; rocky ringed parents don&rsquo;t dominate. Distribution by
            atmosphere: SO2 (44), Methane (17), CO2 (10), Ammonia (4),{' '}
            <strong className="text-primary">Oxygen (3)</strong>, Argon-rich (1), Hot SO2 (2).
            <strong className="text-primary"> Zero Water.</strong>
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-left border-b border-border">
                  <th className="py-1.5 px-2 text-muted-foreground font-medium">Anchor</th>
                  <th className="py-1.5 px-2 text-muted-foreground font-medium">Pop</th>
                  <th className="py-1.5 px-2 text-muted-foreground font-medium">System</th>
                  <th className="py-1.5 px-2 text-muted-foreground font-medium">Body</th>
                  <th className="py-1.5 px-2 text-muted-foreground font-medium">Atmo</th>
                  <th className="py-1.5 px-2 text-muted-foreground font-medium text-right">% of ring</th>
                  <th className="py-1.5 px-2 text-muted-foreground font-medium">Parent</th>
                </tr>
              </thead>
              <tbody>
                {RING_EDGE_TOP20.map((r, i) => {
                  const isHome = r.system === 'Col 173 Sector AX-J d9-52';
                  const isOxy = r.atmo === 'Oxygen';
                  return (
                    <tr key={`${r.system}-${r.body}`} className={`border-b border-border/40 ${isHome ? 'bg-primary/10' : i % 2 ? 'bg-muted/10' : ''}`}>
                      <td className="py-1 px-2 font-mono">{formatAnchor(r)}</td>
                      <td className="py-1 px-2 font-mono text-muted-foreground">{r.pop}</td>
                      <td className={`py-1 px-2 ${isHome ? 'text-primary font-semibold' : ''}`}>{r.system}</td>
                      <td className="py-1 px-2 font-mono">{r.body}</td>
                      <td className={`py-1 px-2 ${isOxy ? 'text-primary font-medium' : ''}`}>{r.atmo}</td>
                      <td className="py-1 px-2 font-mono text-right">{r.pct}%</td>
                      <td className="py-1 px-2 text-muted-foreground">{r.parent}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="text-xs text-muted-foreground mt-2">Top 20 of 81 shown, sorted by closest to home. Highlighted rows = your colony system.</p>
          </div>
        </div>

        {/* Geometry B */}
        <div className="border-l-2 border-primary/60 pl-4 space-y-3">
          <div className="flex items-baseline gap-3 flex-wrap">
            <h3 className="font-semibold text-foreground">B — Inside the ring outer radius (gap or material)</h3>
            <span className="text-xs text-muted-foreground">12 bodies in bubble</span>
          </div>
          <p className="text-sm text-foreground/90">
            Moon orbits at 30-79% of ring outer radius — inside the orbital zone bounded by the
            outermost ring, but closer to the parent than the ring material sits. Scouting
            Praea Euq JK-A d15 AB 6 c (36%, SMA 1.64 Ls, ring outer 4.52 Ls) confirmed what this
            actually looks like: <strong className="text-foreground">parent dominates the sky;
            rings are a distant outward band beyond your orbit</strong>, not wrapping around you.
            This geometry puts you <em>between</em> parent and rings — rings are &ldquo;behind&rdquo;
            you relative to the parent.
          </p>
          <p className="text-xs text-muted-foreground">
            <strong className="text-foreground">Data caveat:</strong> the slim index captures
            <code className="bg-muted/50 px-1 rounded mx-1">ringOuter</code> but not
            <code className="bg-muted/50 px-1 rounded mx-1">ringInner</code>. That means Category
            B currently lumps together &ldquo;moon in the empty gap between parent and rings&rdquo;
            (common) with &ldquo;moon genuinely embedded in ring material&rdquo; (rare). The
            500-800% ratio range is nearly empty bubble-wide (5 moons total) — moons physically
            don&rsquo;t sit in the middle of ring material, they shepherd edges or clear gaps.
            For &ldquo;amongst the rings&rdquo; visuals, use Category A (100-150%), not B.
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-left border-b border-border">
                  <th className="py-1.5 px-2 text-muted-foreground font-medium">Anchor</th>
                  <th className="py-1.5 px-2 text-muted-foreground font-medium">Pop</th>
                  <th className="py-1.5 px-2 text-muted-foreground font-medium">System</th>
                  <th className="py-1.5 px-2 text-muted-foreground font-medium">Body</th>
                  <th className="py-1.5 px-2 text-muted-foreground font-medium">Atmo</th>
                  <th className="py-1.5 px-2 text-muted-foreground font-medium text-right">%</th>
                  <th className="py-1.5 px-2 text-muted-foreground font-medium text-right">SMA (Ls)</th>
                  <th className="py-1.5 px-2 text-muted-foreground font-medium text-right">Ring (Ls)</th>
                  <th className="py-1.5 px-2 text-muted-foreground font-medium">Parent</th>
                </tr>
              </thead>
              <tbody>
                {INSIDE_RINGS_ALL.map((r, i) => {
                  const closeParent = r.sma < 3;
                  return (
                    <tr key={`${r.system}-${r.body}`} className={`border-b border-border/40 ${i % 2 ? 'bg-muted/10' : ''}`}>
                      <td className="py-1 px-2 font-mono">{formatAnchor(r)}</td>
                      <td className="py-1 px-2 font-mono text-muted-foreground">{r.pop}</td>
                      <td className="py-1 px-2">{r.system}</td>
                      <td className="py-1 px-2 font-mono">{r.body}</td>
                      <td className="py-1 px-2">{r.atmo}</td>
                      <td className="py-1 px-2 font-mono text-right">{r.pct}%</td>
                      <td className={`py-1 px-2 font-mono text-right ${closeParent ? 'text-primary font-medium' : ''}`}>{r.sma}</td>
                      <td className="py-1 px-2 font-mono text-right">{r.ring}</td>
                      <td className="py-1 px-2 text-muted-foreground">{r.parent}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="text-xs text-muted-foreground mt-2">All 12 shown. Highlighted SMA values = parent close enough (&lt; 3 Ls) to genuinely dominate.</p>
          </div>
        </div>

        {/* Geometry C — Water binaries */}
        <div className="border-l-2 border-primary/60 pl-4 space-y-3">
          <div className="flex items-baseline gap-3 flex-wrap">
            <h3 className="font-semibold text-foreground">C — Binary landable pair (water subset)</h3>
            <span className="text-xs text-muted-foreground">10 water-atmo binaries in bubble</span>
          </div>
          <p className="text-sm text-foreground/90">
            Two landable Thin Water rocky/HMC bodies orbiting each other at under 0.2 Ls SMA
            around their shared barycentre. Each body has another Thin Water moon in its sky.
          </p>
          <p className="text-sm text-destructive/90 bg-destructive/10 border border-destructive/20 rounded p-2">
            <strong>Calibration correction:</strong> my initial hype said these would fill 30-50°
            of sky. In-game scouting of Wregoe FH-W b44-1 A 4 confirmed the actual apparent size
            is ~4° — much smaller. Reason: the Thin Water landables here are very low gravity
            (0.05g → radius ~220 km). A small body 6,000 km away subtends only ~4°. For actual
            sky dominance, skip water binaries and jump to Category H (big non-landable sibling).
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-left border-b border-border">
                  <th className="py-1.5 px-2 text-muted-foreground font-medium">Anchor</th>
                  <th className="py-1.5 px-2 text-muted-foreground font-medium">Pop</th>
                  <th className="py-1.5 px-2 text-muted-foreground font-medium">System</th>
                  <th className="py-1.5 px-2 text-muted-foreground font-medium">Bodies</th>
                  <th className="py-1.5 px-2 text-muted-foreground font-medium text-right">Separation</th>
                </tr>
              </thead>
              <tbody>
                {WATER_BINARIES.map((r, i) => (
                  <tr key={`${r.system}-${r.bodies}`} className={`border-b border-border/40 ${i === 0 ? 'bg-primary/10' : i % 2 ? 'bg-muted/10' : ''}`}>
                    <td className="py-1 px-2 font-mono">{formatAnchor(r)}</td>
                    <td className="py-1 px-2 font-mono text-muted-foreground">{r.pop}</td>
                    <td className={`py-1 px-2 ${i === 0 ? 'text-primary font-semibold' : ''}`}>{r.system}</td>
                    <td className="py-1 px-2 font-mono">{r.bodies}</td>
                    <td className={`py-1 px-2 font-mono text-right ${i === 0 ? 'text-primary font-semibold' : ''}`}>{r.sepKm.toLocaleString()} km</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-muted-foreground mt-2">All 10 water-atmo binaries. Synuefe BM-V b35-2 is closest to populated (5 ly). Wregoe FH-W b44-1 is tightest.</p>
          </div>
        </div>

        {/* Geometry C — closest binaries (any atmo) */}
        <div className="border-l-2 border-primary/60 pl-4 space-y-3">
          <div className="flex items-baseline gap-3 flex-wrap">
            <h3 className="font-semibold text-foreground">C — Binary landable pair (closest, any atmo)</h3>
            <span className="text-xs text-muted-foreground">1,565 total in bubble</span>
          </div>
          <p className="text-sm text-foreground/90">
            All landable-atmo binary pairs where both bodies orbit their shared barycentre at
            under 0.2 Ls. Ammonia pairs highlighted — rarer than SO2/CO2 binaries and
            visually more interesting given the atmospheric tint.
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-left border-b border-border">
                  <th className="py-1.5 px-2 text-muted-foreground font-medium">Anchor</th>
                  <th className="py-1.5 px-2 text-muted-foreground font-medium">Pop</th>
                  <th className="py-1.5 px-2 text-muted-foreground font-medium">System</th>
                  <th className="py-1.5 px-2 text-muted-foreground font-medium">Bodies</th>
                  <th className="py-1.5 px-2 text-muted-foreground font-medium">Atmospheres</th>
                  <th className="py-1.5 px-2 text-muted-foreground font-medium text-right">Separation</th>
                </tr>
              </thead>
              <tbody>
                {BINARY_PAIRS_TOP15.map((r, i) => {
                  const isAmmonia = r.atmos.includes('Ammonia');
                  return (
                    <tr key={`${r.system}-${r.bodies}`} className={`border-b border-border/40 ${i % 2 ? 'bg-muted/10' : ''}`}>
                      <td className="py-1 px-2 font-mono">{formatAnchor(r)}</td>
                      <td className="py-1 px-2 font-mono text-muted-foreground">{r.pop}</td>
                      <td className="py-1 px-2">{r.system}</td>
                      <td className="py-1 px-2 font-mono">{r.bodies}</td>
                      <td className={`py-1 px-2 ${isAmmonia ? 'text-primary font-medium' : ''}`}>{r.atmos}</td>
                      <td className="py-1 px-2 font-mono text-right">{r.sepKm.toLocaleString()} km</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="text-xs text-muted-foreground mt-2">Top 15 of 1,565 by closest to home. Earth&rsquo;s diameter is 12,756 km — pairs under 30,000 km are within ~2.5 Earth diameters.</p>
          </div>
        </div>

        {/* Geometry D */}
        <div className="border-l-2 border-primary/60 pl-4 space-y-2">
          <div className="flex items-baseline gap-3 flex-wrap">
            <h3 className="font-semibold text-foreground">D — Close own moon</h3>
            <span className="text-xs text-muted-foreground">Common</span>
          </div>
          <p className="text-sm text-foreground/90">
            Landable has its own moon orbiting at under 2 Ls SMA. Most &ldquo;full stack&rdquo;
            sky-drama hits combine A (ring edge) + C (twin sibling) + D (own moon) on one body.
            AX-J d9-52 body 2 a hits A + C but not D (no sub-moon) — the lack of D is why the
            top composite score in the bubble is 45, not the theoretical 63.
          </p>
        </div>

        {/* Geometry H — Big non-landable sibling */}
        <div className="border-l-2 border-primary/60 pl-4 space-y-3">
          <div className="flex items-baseline gap-3 flex-wrap">
            <h3 className="font-semibold text-foreground">H — Big non-landable sibling</h3>
            <span className="text-xs text-muted-foreground">47,353 bubble-wide (only strongest shown)</span>
          </div>
          <p className="text-sm text-foreground/90">
            Landable rocky/HMC body with a <strong>bigger sibling in close orbit</strong>
            (another HMC, or a Water World / Earth-like / Ammonia World / gas giant). You stand
            on the small one, the big one fills the sky. This is the geometry of your 2-year-old
            HIP 64049 5 B screenshot and the 120K cold-moon screenshot.
          </p>
          <p className="text-sm text-foreground/90">
            Reference calibration: <strong>HD 76412 7 a (Class IV GG parent)</strong> gives
            ~12.7° apparent = &ldquo;pretty darn good&rdquo; per scouting. Category H picks at
            25-100°+ apparent are a whole different tier — &ldquo;fuckin&rsquo; big&rdquo;.
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-left border-b border-border">
                  <th className="py-1.5 px-2 text-muted-foreground font-medium">Anchor</th>
                  <th className="py-1.5 px-2 text-muted-foreground font-medium">Pop</th>
                  <th className="py-1.5 px-2 text-muted-foreground font-medium text-right">Apparent</th>
                  <th className="py-1.5 px-2 text-muted-foreground font-medium">System</th>
                  <th className="py-1.5 px-2 text-muted-foreground font-medium">Landable / Sibling</th>
                  <th className="py-1.5 px-2 text-muted-foreground font-medium">Type</th>
                  <th className="py-1.5 px-2 text-muted-foreground font-medium text-right">Sep (Ls)</th>
                </tr>
              </thead>
              <tbody>
                {BIG_SIBLING_TOP.map((r, i) => {
                  const precisionCaveat = r.sepLs === 0;
                  return (
                    <tr key={`${r.system}-${r.landable}`} className={`border-b border-border/40 ${i % 2 ? 'bg-muted/10' : ''}`}>
                      <td className="py-1 px-2 font-mono">{r.anchor} ly ({r.anchorName})</td>
                      <td className="py-1 px-2 font-mono text-muted-foreground">{r.pop}</td>
                      <td className={`py-1 px-2 font-mono text-right ${r.apparentDeg >= 30 ? 'text-primary font-semibold' : ''}`}>{r.apparentDeg}°{precisionCaveat ? '*' : ''}</td>
                      <td className="py-1 px-2">{r.system}</td>
                      <td className="py-1 px-2 font-mono">{r.landable} + {r.sibling}</td>
                      <td className="py-1 px-2 text-muted-foreground">{r.sibType}</td>
                      <td className="py-1 px-2 font-mono text-right">{r.sepLs === 0 ? '<0.01' : r.sepLs}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="text-xs text-muted-foreground mt-2">
              * Ultra-tight pairs where separation rounds to 0 in Spansh data (sub-km precision).
              May be real, may be precision artifacts — worth scouting to verify.
              <br/>
              <strong className="text-foreground">Safest &ldquo;fuckin&rsquo; big&rdquo; pick: Wregoe AG-A b55-6</strong> — 29 ly HIP, 25 ly pop, verified 3,000 km
              separation (same scale as your HIP 64049 screenshot). Expected ~38° apparent sibling.
            </p>
          </div>
        </div>

        {/* Reference system */}
        <div className="bg-muted/20 rounded p-3 border border-border/50">
          <h3 className="font-semibold text-foreground text-sm mb-2">Reference — Col 173 Sector AX-J d9-52</h3>
          <p className="text-xs text-foreground/90 mb-2">
            Parent body 2 is a Y brown dwarf with rings of outer radius 2.10 Ls. Your colony
            candidates orbit it as follows:
          </p>
          <div className="text-xs font-mono text-foreground/80 space-y-0.5">
            <div>2 a: SMA 2.13 Ls → <span className="text-primary">101% of ringOuter</span> — Thin Oxygen, landable, terraformable</div>
            <div>2 b: SMA 3.12 Ls → <span className="text-primary">149% of ringOuter</span> — Thin Oxygen, landable</div>
            <div>2 c: SMA 5.25 Ls → 250% — landable, no atmo</div>
            <div>2 d: SMA 7.62 Ls → 363% — Thin SO2</div>
            <div>2 e: SMA 11.68 Ls → 557% — Thin SO2</div>
            <div>2 f: SMA 16.21 Ls → 773% — Thin CO2</div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            The 101%/149% pairing on 2 a and 2 b is unique in the bubble. No other system has
            two Oxygen moons at the ring edge of a common parent.
          </p>
        </div>

        {/* Recommendations */}
        <div className="bg-muted/10 rounded p-3 border border-border/50 space-y-2">
          <h3 className="font-semibold text-foreground text-sm">Recommendations by goal</h3>
          <dl className="text-xs space-y-2">
            <div>
              <dt className="text-foreground font-medium">Thin Water atmo landable</dt>
              <dd className="text-foreground/80 mt-0.5">
                Wregoe QI-B d13-149 body B 2 — 45 ly from HIP 47126 (closest water-atmo in bubble). No ring drama, just the atmosphere.
                Synuefe HY-F d12-90 bodies 3 d/e/g/h — 174 ly HIP, four water-atmo sibling moons (not in rings but visible to each other).
              </dd>
            </div>
            <div>
              <dt className="text-foreground font-medium">&ldquo;At the rings&rdquo; like your home</dt>
              <dd className="text-foreground/80 mt-0.5">
                Col 173 Sector LG-Z c15-7 AB 2 a — 102 ly HIP, Methane atmo, Y brown dwarf parent at 103%. Same geometry as home, different atmosphere.
              </dd>
            </div>
            <div>
              <dt className="text-foreground font-medium">Between parent and rings (geometry B)</dt>
              <dd className="text-foreground/80 mt-0.5">
                Praea Euq JK-A d15 body AB 6 c — 203 ly HIP, CO2, close parent (SMA 1.64 Ls, ring 4.52 Ls).
                Col 173 Sector MJ-P d6-44 A 4 a — 242 ly AX-J, similar geometry. Parent
                dominates sky; rings are a distant outward band. NOT &ldquo;amongst rings&rdquo; —
                use geometry A picks for that.
              </dd>
            </div>
            <div>
              <dt className="text-foreground font-medium">Landable companion filling the sky (Category H — preferred)</dt>
              <dd className="text-foreground/80 mt-0.5">
                Wregoe AG-A b55-6 A 2 + A 3 — 29 ly HIP, HMC pair at 3,000 km sep (~38° apparent).
                Wregoe QI-B d13-55 A 2 + A 3 — 23 ly HIP, HMC pair at Earth-diameter sep (~26°).
                Wregoe BB-A b55-1 A 1 + A 2 — 14 ly HIP, 3 ly pop, ultra-tight pair (may be &gt;100° if real).
              </dd>
            </div>
            <div>
              <dt className="text-foreground font-medium">&ldquo;Huge sun in sky&rdquo; (hot silicate vapour pattern)</dt>
              <dd className="text-foreground/80 mt-0.5">
                Col 173 Sector OT-Q d5-48 body 1 — 330 ly AX-J, First Footfall confirmed. F-class main star dominates sky at 12 Ls range. 6 other silicate-vapour landables in bubble with same geometry (see Uniques section).
              </dd>
            </div>
            <div>
              <dt className="text-foreground font-medium">Unique-star novelty</dt>
              <dd className="text-foreground/80 mt-0.5">
                HIP 52656 — 252 ly HIP 47126, 127 ly from pop. The ONLY carbon star in the bubble. Body B 1 is a landable Metal-rich at 251 Ls — closest viewpoint to the ruby-red carbon star.
              </dd>
            </div>
          </dl>
        </div>

        <div className="text-xs text-muted-foreground space-y-1 border-t border-border/50 pt-3">
          <p>
            <strong className="text-foreground">Scoring composite</strong> lives in{' '}
            <code className="bg-muted/50 px-1 rounded">tools/sky-drama.mjs</code>. It adds up
            points for each geometry a body hits (A = 10 base + 5 if Oxygen/Water atmo,
            C = 18 + 5 both-rare, D = 10, TRIPLE = +15 for A+C together). Top score in the
            bubble is 45 (AX-J d9-52 2 a); top non-Oxygen is 43 (any Water binary).
          </p>
          <p>
            <strong className="text-foreground">Raw data:</strong>{' '}
            <code className="bg-muted/50 px-1 rounded">E:\Spansh\sky-drama.json</code> and{' '}
            <code className="bg-muted/50 px-1 rounded">E:\Spansh\water-atmo.json</code> hold all
            candidates with full body details. Regenerate with{' '}
            <code className="bg-muted/50 px-1 rounded">node tools/sky-drama.mjs</code> after a
            dump refresh.
          </p>
        </div>
      </section>

      {/* ============ Notable individual systems ============ */}
      <section className="bg-card border border-border rounded-lg p-5 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Notable individual systems</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Systems with specific rare features worth visiting just for novelty or visual
            uniqueness — carbon stars, silicate-vapour worlds, etc.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left border-b border-border">
                <th className="py-2 px-2 text-muted-foreground font-medium">Feature</th>
                <th className="py-2 px-2 text-muted-foreground font-medium">System</th>
                <th className="py-2 px-2 text-muted-foreground font-medium">Anchor</th>
                <th className="py-2 px-2 text-muted-foreground font-medium">Pop</th>
                <th className="py-2 px-2 text-muted-foreground font-medium">Landable pick</th>
                <th className="py-2 px-2 text-muted-foreground font-medium">Note</th>
              </tr>
            </thead>
            <tbody>
              {UNIQUES.map((r) => (
                <tr key={r.system + r.label} className="border-b border-border/40 hover:bg-muted/20 align-top">
                  <td className="py-2 px-2 font-medium text-primary whitespace-nowrap">{r.label}</td>
                  <td className="py-2 px-2">{r.system}</td>
                  <td className="py-2 px-2 font-mono">{r.anchor} ly ({r.anchorName})</td>
                  <td className="py-2 px-2 font-mono">{r.pop}</td>
                  <td className="py-2 px-2 font-mono text-xs">{r.body}</td>
                  <td className="py-2 px-2 text-muted-foreground text-xs">{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="text-xs text-muted-foreground border-t border-border/50 pt-3 space-y-1">
          <p>
            <strong className="text-foreground">Pattern for hot silicate vapour:</strong>{' '}
            These bodies only exist close to hot stars (F-class main sequence or similar) —
            the atmosphere is literally vaporized silicate rock. Scouting confirmed the star
            fills a huge fraction of the sky when you land. Seven landable instances in the
            whole bubble; four are listed above.
          </p>
          <p>
            <strong className="text-foreground">The carbon star:</strong>{' '}
            HIP 52656 is the only one in the 700 ly bubble. C stars are cool carbon-rich
            stars with distinctive deep-red color from carbon-molecule absorption. Rare
            enough that it&rsquo;s worth the 252 ly trip just for the view. System also has
            multiple HMC landables (AB 1-4) at various distances if you want to spend time.
          </p>
        </div>
      </section>

      {/* ============ Star & ring rarity ============ */}
      <section className="bg-card border border-border rounded-lg p-5 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Star &amp; ring rarity</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Counts of notable stars and ring geometries across the 1.27M systems in the bubble.
            Rarer ones at top, common ones at bottom.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left border-b border-border">
                <th className="py-2 px-2 text-muted-foreground font-medium text-right">Count</th>
                <th className="py-2 px-2 text-muted-foreground font-medium">Star type</th>
              </tr>
            </thead>
            <tbody>
              {STAR_RARITY.map((r) => {
                const rare = r.count < 1000;
                return (
                  <tr key={r.type} className="border-b border-border/40 hover:bg-muted/20">
                    <td className={`py-1 px-2 text-right font-mono ${rare ? 'text-primary font-medium' : 'text-foreground/80'}`}>{r.count.toLocaleString()}</td>
                    <td className={`py-1 px-2 ${rare ? 'text-foreground' : 'text-foreground/80'}`}>{r.type}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <div className="bg-muted/30 rounded p-3">
            <div className="text-muted-foreground text-xs">Systems with ≥1 ringed body</div>
            <div className="text-foreground font-mono text-base">160,309</div>
            <div className="text-xs text-muted-foreground mt-1">12.6% of bubble</div>
          </div>
          <div className="bg-muted/30 rounded p-3">
            <div className="text-muted-foreground text-xs">Systems with ≥1 ringed gas giant</div>
            <div className="text-foreground font-mono text-base">138,760</div>
            <div className="text-xs text-muted-foreground mt-1">10.9% of bubble</div>
          </div>
          <div className="bg-muted/30 rounded p-3">
            <div className="text-muted-foreground text-xs">Systems with ringed Earth-like</div>
            <div className="text-foreground font-mono text-base text-primary">30</div>
            <div className="text-xs text-muted-foreground mt-1">1 in 42,262 — vanishingly rare</div>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div className="bg-muted/30 rounded p-3">
            <div className="text-muted-foreground text-xs">Earth-like worlds</div>
            <div className="text-foreground font-mono text-base">3,479</div>
            <div className="text-xs text-muted-foreground">in 3,398 systems</div>
          </div>
          <div className="bg-muted/30 rounded p-3">
            <div className="text-muted-foreground text-xs">Ammonia worlds</div>
            <div className="text-foreground font-mono text-base">6,984</div>
            <div className="text-xs text-muted-foreground">in 6,803 systems</div>
          </div>
          <div className="bg-muted/30 rounded p-3">
            <div className="text-muted-foreground text-xs">Water worlds</div>
            <div className="text-foreground font-mono text-base">53,248</div>
            <div className="text-xs text-muted-foreground">in 44,285 systems</div>
          </div>
          <div className="bg-muted/30 rounded p-3">
            <div className="text-muted-foreground text-xs">Helium gas giants</div>
            <div className="text-foreground font-mono text-base">1,192</div>
            <div className="text-xs text-muted-foreground">in 479 systems</div>
          </div>
          <div className="bg-muted/30 rounded p-3">
            <div className="text-muted-foreground text-xs">Water giants</div>
            <div className="text-foreground font-mono text-base">2,137</div>
            <div className="text-xs text-muted-foreground">in 1,977 systems</div>
          </div>
          <div className="bg-muted/30 rounded p-3">
            <div className="text-muted-foreground text-xs">GG with water-based life</div>
            <div className="text-foreground font-mono text-base">47,645</div>
            <div className="text-xs text-muted-foreground">in 40,779 systems</div>
          </div>
          <div className="bg-muted/30 rounded p-3">
            <div className="text-muted-foreground text-xs">GG with ammonia-based life</div>
            <div className="text-foreground font-mono text-base">29,511</div>
            <div className="text-xs text-muted-foreground">in 27,087 systems</div>
          </div>
          <div className="bg-muted/30 rounded p-3">
            <div className="text-muted-foreground text-xs">Bubble population density</div>
            <div className="text-foreground font-mono text-base">0.51%</div>
            <div className="text-xs text-muted-foreground">6,429 of 1.27M</div>
          </div>
        </div>
      </section>
    </div>
  );
}
