/**
 * ED engineering materials — the Raw / Manufactured / Encoded universe.
 *
 * `id` is the canonical journal Name (lowercase, no $..._name; wrapper).
 * `line` is the trader subcategory (within a category, mats in the same line
 * trade at the standard 1:6 up / 3:1 down ladder; cross-line within the same
 * category uses the cross-line table from the wiki — penalty is 6× worse per
 * grade differential).
 * `cap` follows ED's grade-based caps:
 *   Raw: G1=300, G2=250, G3=200, G4=150
 *   Manufactured: G1=300, G2=250, G3=200, G4=150, G5=100
 *   Encoded: G1=150, G2=150, G3=150, G4=150, G5=150  (all G's = 150)
 *
 * Guardian / Thargoid / Sensor Fragment materials are tagged with
 * line:'special' — they're not part of standard trader trade ladders.
 *
 * TODO: spot-check line classifications against in-game trader UI; the four
 * shield-data, encryption-file, and survey-data line assignments are educated
 * guesses based on community references that aren't always consistent.
 */

export type MaterialCategory = 'raw' | 'manufactured' | 'encoded';

export interface MaterialDefinition {
  id: string;
  displayName: string;
  category: MaterialCategory;
  grade: 1 | 2 | 3 | 4 | 5;
  line: string;
  cap: number;
}

// Caps per category × grade.
function capFor(category: MaterialCategory, grade: 1 | 2 | 3 | 4 | 5): number {
  if (category === 'encoded') return 150;
  if (category === 'raw') return [0, 300, 250, 200, 150][grade];
  // manufactured
  return [0, 300, 250, 200, 150, 100][grade];
}

// Helper to make line definitions concise.
function line5(
  category: MaterialCategory,
  line: string,
  g1: [string, string],
  g2: [string, string],
  g3: [string, string],
  g4: [string, string],
  g5: [string, string],
): MaterialDefinition[] {
  return [
    { id: g1[0], displayName: g1[1], category, grade: 1, line, cap: capFor(category, 1) },
    { id: g2[0], displayName: g2[1], category, grade: 2, line, cap: capFor(category, 2) },
    { id: g3[0], displayName: g3[1], category, grade: 3, line, cap: capFor(category, 3) },
    { id: g4[0], displayName: g4[1], category, grade: 4, line, cap: capFor(category, 4) },
    { id: g5[0], displayName: g5[1], category, grade: 5, line, cap: capFor(category, 5) },
  ];
}
function line4(
  category: MaterialCategory,
  line: string,
  g1: [string, string],
  g2: [string, string],
  g3: [string, string],
  g4: [string, string],
): MaterialDefinition[] {
  return [
    { id: g1[0], displayName: g1[1], category, grade: 1, line, cap: capFor(category, 1) },
    { id: g2[0], displayName: g2[1], category, grade: 2, line, cap: capFor(category, 2) },
    { id: g3[0], displayName: g3[1], category, grade: 3, line, cap: capFor(category, 3) },
    { id: g4[0], displayName: g4[1], category, grade: 4, line, cap: capFor(category, 4) },
  ];
}

export const MATERIALS: MaterialDefinition[] = [
  // === RAW (28 materials, 7 lines × 4 grades) ===
  ...line4('raw', 'cat1',
    ['carbon', 'Carbon'],
    ['vanadium', 'Vanadium'],
    ['niobium', 'Niobium'],
    ['yttrium', 'Yttrium']),
  ...line4('raw', 'cat2',
    ['phosphorus', 'Phosphorus'],
    ['chromium', 'Chromium'],
    ['molybdenum', 'Molybdenum'],
    ['technetium', 'Technetium']),
  ...line4('raw', 'cat3',
    ['sulphur', 'Sulphur'],
    ['manganese', 'Manganese'],
    ['cadmium', 'Cadmium'],
    ['ruthenium', 'Ruthenium']),
  ...line4('raw', 'cat4',
    ['iron', 'Iron'],
    ['zinc', 'Zinc'],
    ['tin', 'Tin'],
    ['selenium', 'Selenium']),
  ...line4('raw', 'cat5',
    ['nickel', 'Nickel'],
    ['germanium', 'Germanium'],
    ['tungsten', 'Tungsten'],
    ['tellurium', 'Tellurium']),
  ...line4('raw', 'cat6',
    ['rhenium', 'Rhenium'],
    ['arsenic', 'Arsenic'],
    ['mercury', 'Mercury'],
    ['polonium', 'Polonium']),
  ...line4('raw', 'cat7',
    ['lead', 'Lead'],
    ['zirconium', 'Zirconium'],
    ['boron', 'Boron'],
    ['antimony', 'Antimony']),

  // === MANUFACTURED (50 materials, 10 lines × 5 grades) ===
  ...line5('manufactured', 'alloy',
    ['temperedalloys', 'Tempered Alloys'],
    ['galvanisingalloys', 'Galvanising Alloys'],
    ['phasealloys', 'Phase Alloys'],
    ['protolightalloys', 'Proto Light Alloys'],
    ['protoradiolicalloys', 'Proto Radiolic Alloys']),
  ...line5('manufactured', 'chemical',
    ['chemicalstorageunits', 'Chemical Storage Units'],
    ['chemicalprocessors', 'Chemical Processors'],
    ['chemicaldistillery', 'Chemical Distillery'],
    ['chemicalmanipulators', 'Chemical Manipulators'],
    ['pharmaceuticalisolators', 'Pharmaceutical Isolators']),
  ...line5('manufactured', 'thermal',
    ['heatconductionwiring', 'Heat Conduction Wiring'],
    ['heatdispersionplate', 'Heat Dispersion Plate'],
    ['heatexchangers', 'Heat Exchangers'],
    ['heatvanes', 'Heat Vanes'],
    ['protoheatradiators', 'Proto Heat Radiators']),
  ...line5('manufactured', 'mechanical',
    ['mechanicalscrap', 'Mechanical Scrap'],
    ['mechanicalequipment', 'Mechanical Equipment'],
    ['mechanicalcomponents', 'Mechanical Components'],
    ['configurablecomponents', 'Configurable Components'],
    ['improvisedcomponents', 'Improvised Components']),
  ...line5('manufactured', 'conductive',
    ['basicconductors', 'Basic Conductors'],
    ['conductivecomponents', 'Conductive Components'],
    ['conductiveceramics', 'Conductive Ceramics'],
    ['conductivepolymers', 'Conductive Polymers'],
    ['biotechconductors', 'Biotech Conductors']),
  ...line5('manufactured', 'composite',
    ['compactcomposites', 'Compact Composites'],
    ['filamentcomposites', 'Filament Composites'],
    ['highdensitycomposites', 'High Density Composites'],
    ['fedproprietarycomposites', 'Proprietary Composites'],
    ['fedcorecomposites', 'Core Dynamics Composites']),
  ...line5('manufactured', 'crystal',
    ['crystalshards', 'Crystal Shards'],
    ['uncutfocuscrystals', 'Flawed Focus Crystals'],
    ['focuscrystals', 'Focus Crystals'],
    ['refinedfocuscrystals', 'Refined Focus Crystals'],
    ['exquisitefocuscrystals', 'Exquisite Focus Crystals']),
  ...line5('manufactured', 'capacitor',
    ['gridresistors', 'Grid Resistors'],
    ['hybridcapacitors', 'Hybrid Capacitors'],
    ['electrochemicalarrays', 'Electrochemical Arrays'],
    ['polymercapacitors', 'Polymer Capacitors'],
    ['militarysupercapacitors', 'Military Supercapacitors']),
  ...line5('manufactured', 'shield',
    ['wornshieldemitters', 'Worn Shield Emitters'],
    ['shieldemitters', 'Shield Emitters'],
    ['shieldingsensors', 'Shielding Sensors'],
    ['compoundshielding', 'Compound Shielding'],
    ['imperialshielding', 'Imperial Shielding']),
  ...line5('manufactured', 'thermal2',
    ['salvagedalloys', 'Salvaged Alloys'],
    ['heatresistantceramics', 'Heat Resistant Ceramics'],
    ['precipitatedalloys', 'Precipitated Alloys'],
    ['thermicalloys', 'Thermic Alloys'],
    ['militarygradealloys', 'Military Grade Alloys']),

  // === MANUFACTURED (Guardian — special line, no standard trader) ===
  { id: 'guardian_sentinel_wreckagecomponents', displayName: 'Guardian Wreckage Components', category: 'manufactured', grade: 1, line: 'special', cap: 300 },
  { id: 'guardian_powercell',                  displayName: 'Guardian Power Cell',           category: 'manufactured', grade: 1, line: 'special', cap: 300 },
  { id: 'guardian_powerconduit',               displayName: 'Guardian Power Conduit',        category: 'manufactured', grade: 2, line: 'special', cap: 250 },
  { id: 'guardian_sentinel_weaponparts',       displayName: 'Guardian Sentinel Weapon Parts', category: 'manufactured', grade: 3, line: 'special', cap: 200 },
  { id: 'guardian_techcomponent',              displayName: 'Guardian Technology Component', category: 'manufactured', grade: 3, line: 'special', cap: 200 },
  { id: 'unknownenergysource',                 displayName: 'Sensor Fragment',               category: 'manufactured', grade: 5, line: 'special', cap: 100 },

  // === ENCODED (28 materials, ~6 lines × 5 grades, plus a partial line) ===
  // Wake / FSD scan line
  ...line5('encoded', 'wake',
    ['disruptedwakeechoes', 'Atypical Disrupted Wake Echoes'],
    ['fsdtelemetry', 'Anomalous FSD Telemetry'],
    ['wakesolutions', 'Strange Wake Solutions'],
    ['hyperspacetrajectories', 'Eccentric Hyperspace Trajectories'],
    ['dataminedwake', 'Datamined Wake Exceptions']),
  // Emission Data line
  ...line5('encoded', 'emission',
    ['scrambledemissiondata', 'Exceptional Scrambled Emission Data'],
    ['archivedemissiondata', 'Irregular Emission Data'],
    ['emissiondata', 'Unexpected Emission Data'],
    ['decodedemissiondata', 'Decoded Emission Data'],
    ['compactemissionsdata', 'Abnormal Compact Emissions Data']),
  // Shield Scan line
  ...line5('encoded', 'shieldscan',
    ['shieldcyclerecordings', 'Distorted Shield Cycle Recordings'],
    ['shieldsoakanalysis', 'Inconsistent Shield Soak Analysis'],
    ['shielddensityreports', 'Untypical Shield Scans'],
    ['shieldpatternanalysis', 'Aberrant Shield Pattern Analysis'],
    ['shieldfrequencydata', 'Peculiar Shield Frequency Data']),
  // Encryption Files line (G4 = Atypical Encryption Archives — user may not have any)
  ...line5('encoded', 'encryption',
    ['encryptedfiles', 'Unusual Encrypted Files'],
    ['encryptioncodes', 'Tagged Encryption Codes'],
    ['symmetrickeys', 'Open Symmetric Keys'],
    ['encryptionarchives', 'Atypical Encryption Archives'],
    ['adaptiveencryptors', 'Adaptive Encryptors Capture']),
  // Firmware line
  ...line5('encoded', 'firmware',
    ['legacyfirmware', 'Specialised Legacy Firmware'],
    ['consumerfirmware', 'Modified Consumer Firmware'],
    ['industrialfirmware', 'Cracked Industrial Firmware'],
    ['securityfirmware', 'Security Firmware Patch'],
    ['embeddedfirmware', 'Modified Embedded Firmware']),
  // Scan Data / Survey line
  ...line5('encoded', 'scan',
    ['bulkscandata', 'Anomalous Bulk Scan Data'],
    ['scanarchives', 'Unidentified Scan Archives'],
    ['scandatabanks', 'Classified Scan Databanks'],
    ['encodedscandata', 'Divergent Scan Data'],
    ['classifiedscandata', 'Classified Scan Fragment']),
];

// Lookup helpers
export const MATERIAL_BY_ID = new Map(MATERIALS.map((m) => [m.id, m]));
export const MATERIAL_BY_DISPLAY_NAME = new Map(
  MATERIALS.map((m) => [m.displayName.toLowerCase(), m]),
);

export function findMaterial(idOrName: string | undefined | null): MaterialDefinition | undefined {
  if (!idOrName) return undefined;
  return (
    MATERIAL_BY_ID.get(idOrName.toLowerCase()) ||
    MATERIAL_BY_DISPLAY_NAME.get(idOrName.toLowerCase())
  );
}

// === Material Trader rates ===
// Within-line: standard ladder. Up 1 grade = 6:1 (need 6 lower for 1 higher).
//              Down 1 grade = 1:3 (1 higher gives 3 lower). Multiplicative.
// Cross-line (different line within same category):
//   per wiki "Conversion to another category" table, rows = output grade, cols = input grade.
//   Indexed [inputGrade][outputGrade] → [give, get].
export const CROSS_LINE_TRADE: Record<number, Record<number, [number, number]>> = {
  1: { 1: [6, 1],  2: [36, 1],  3: [216, 1],  4: [1296, 1], 5: [7776, 1] },
  2: { 1: [2, 1],  2: [6, 1],   3: [36, 1],   4: [216, 1],  5: [1296, 1] },
  3: { 1: [2, 3],  2: [2, 1],   3: [6, 1],    4: [36, 1],   5: [216, 1] },
  4: { 1: [2, 9],  2: [2, 3],   3: [2, 1],    4: [6, 1],    5: [36, 1] },
  5: { 1: [2, 27], 2: [2, 9],   3: [2, 3],    4: [2, 1],    5: [6, 1] },
};

/**
 * Compute target units yielded per 1 source unit.
 * sameLine = within-line ladder; cross-line = lookup table.
 * Returns 0 for "not a valid trade" (same grade same line).
 */
export function tradeYieldPerSource(
  sourceGrade: number,
  targetGrade: number,
  sameLine: boolean,
): number {
  if (sameLine) {
    if (sourceGrade === targetGrade) return 0;
    if (sourceGrade < targetGrade) return 1 / Math.pow(6, targetGrade - sourceGrade);
    return Math.pow(3, sourceGrade - targetGrade);
  }
  const entry = CROSS_LINE_TRADE[sourceGrade]?.[targetGrade];
  if (!entry) return 0;
  return entry[1] / entry[0];
}
