/**
 * Port of src/data/commodities.ts — colonization commodity definitions
 * and lookup helpers. Used by the server-side journal reader to translate
 * journal event commodity names into stable internal IDs.
 *
 * This file is the authoritative server-side copy. Keep in sync with the
 * browser copy — they're both small enough that divergence is obvious.
 */

/**
 * @typedef {'heavy'|'medium'|'light'} CommodityCategory
 *
 * @typedef {object} CommodityDefinition
 * @property {string} id
 * @property {string} journalName
 * @property {string} name
 * @property {CommodityCategory} category
 * @property {boolean} planetaryOnly
 */

/** @type {CommodityDefinition[]} */
export const COMMODITIES = [
  // Heavy (typically 1000+ tons needed)
  { id: 'steel', journalName: '$steel_name;', name: 'Steel', category: 'heavy', planetaryOnly: false },
  { id: 'titanium', journalName: '$titanium_name;', name: 'Titanium', category: 'heavy', planetaryOnly: false },
  { id: 'cmmcomposite', journalName: '$cmmcomposite_name;', name: 'CMM Composite', category: 'heavy', planetaryOnly: true },
  { id: 'liquidoxygen', journalName: '$liquidoxygen_name;', name: 'Liquid Oxygen', category: 'heavy', planetaryOnly: false },
  // Medium (100-999 tons)
  { id: 'water', journalName: '$water_name;', name: 'Water', category: 'medium', planetaryOnly: false },
  { id: 'ceramiccomposites', journalName: '$ceramiccomposites_name;', name: 'Ceramic Composites', category: 'medium', planetaryOnly: true },
  { id: 'polymers', journalName: '$polymers_name;', name: 'Polymers', category: 'medium', planetaryOnly: false },
  { id: 'aluminium', journalName: '$aluminium_name;', name: 'Aluminium', category: 'medium', planetaryOnly: false },
  { id: 'insulatingmembrane', journalName: '$insulatingmembrane_name;', name: 'Insulating Membrane', category: 'medium', planetaryOnly: false },
  { id: 'copper', journalName: '$copper_name;', name: 'Copper', category: 'medium', planetaryOnly: false },
  // Medium construction materials (added 2026-04-22)
  { id: 'buildingfabricators', journalName: '$buildingfabricators_name;', name: 'Building Fabricators', category: 'medium', planetaryOnly: false },
  { id: 'surfacestabilisers', journalName: '$surfacestabilisers_name;', name: 'Surface Stabilisers', category: 'medium', planetaryOnly: false },
  { id: 'structuralregulators', journalName: '$structuralregulators_name;', name: 'Structural Regulators', category: 'medium', planetaryOnly: false },
  { id: 'robotics', journalName: '$robotics_name;', name: 'Robotics', category: 'medium', planetaryOnly: false },
  { id: 'mineralextractors', journalName: '$mineralextractors_name;', name: 'Mineral Extractors', category: 'medium', planetaryOnly: false },
  { id: 'cropharvesters', journalName: '$cropharvesters_name;', name: 'Crop Harvesters', category: 'medium', planetaryOnly: false },
  { id: 'autofabricators', journalName: '$autofabricators_name;', name: 'Auto-Fabricators', category: 'medium', planetaryOnly: false },
  { id: 'geologicalequipment', journalName: '$geologicalequipment_name;', name: 'Geological Equipment', category: 'medium', planetaryOnly: false },
  // Light (under 100 tons)
  { id: 'superconductors', journalName: '$superconductors_name;', name: 'Superconductors', category: 'light', planetaryOnly: false },
  { id: 'computercomponents', journalName: '$computercomponents_name;', name: 'Computer Components', category: 'light', planetaryOnly: false },
  { id: 'foodcartridges', journalName: '$foodcartridges_name;', name: 'Food Cartridges', category: 'light', planetaryOnly: false },
  { id: 'fruitandvegetables', journalName: '$fruitandvegetables_name;', name: 'Fruit and Vegetables', category: 'light', planetaryOnly: false },
  { id: 'semiconductors', journalName: '$semiconductors_name;', name: 'Semiconductors', category: 'light', planetaryOnly: false },
  { id: 'waterpurifiers', journalName: '$waterpurifiers_name;', name: 'Water Purifiers', category: 'light', planetaryOnly: false },
  { id: 'medicaldiagnosticequipment', journalName: '$medicaldiagnosticequipment_name;', name: 'Medical Diagnostic Equipment', category: 'light', planetaryOnly: false },
  { id: 'nonlethalweapons', journalName: '$nonlethalweapons_name;', name: 'Non-Lethal Weapons', category: 'light', planetaryOnly: false },
  { id: 'powergenerators', journalName: '$powergenerators_name;', name: 'Power Generators', category: 'light', planetaryOnly: false },
  // Light — added 2026-04-22 from observed depot + market data
  { id: 'emergencypowercells', journalName: '$emergencypowercells_name;', name: 'Emergency Power Cells', category: 'light', planetaryOnly: false },
  { id: 'evacuationshelter', journalName: '$evacuationshelter_name;', name: 'Evacuation Shelter', category: 'light', planetaryOnly: false },
  { id: 'survivalequipment', journalName: '$survivalequipment_name;', name: 'Survival Equipment', category: 'light', planetaryOnly: false },
  { id: 'landenrichmentsystems', journalName: '$landenrichmentsystems_name;', name: 'Land Enrichment Systems', category: 'light', planetaryOnly: false },
  { id: 'hesuits', journalName: '$hesuits_name;', name: 'H.E. Suits', category: 'light', planetaryOnly: false },
  { id: 'combatstabilisers', journalName: '$combatstabilisers_name;', name: 'Combat Stabilisers', category: 'light', planetaryOnly: false },
  { id: 'microcontrollers', journalName: '$microcontrollers_name;', name: 'Micro Controllers', category: 'light', planetaryOnly: false },
  { id: 'battleweapons', journalName: '$battleweapons_name;', name: 'Battle Weapons', category: 'light', planetaryOnly: false },
  { id: 'militarygradefabrics', journalName: '$militarygradefabrics_name;', name: 'Military Grade Fabrics', category: 'light', planetaryOnly: false },
  { id: 'advancedcatalysers', journalName: '$advancedcatalysers_name;', name: 'Advanced Catalysers', category: 'light', planetaryOnly: false },
  { id: 'microbialfurnaces', journalName: '$microbialfurnaces_name;', name: 'Microbial Furnaces', category: 'light', planetaryOnly: false },
  { id: 'resonatingseparators', journalName: '$resonatingseparators_name;', name: 'Resonating Separators', category: 'light', planetaryOnly: false },
  { id: 'thermalcoolingunits', journalName: '$thermalcoolingunits_name;', name: 'Thermal Cooling Units', category: 'light', planetaryOnly: false },
  { id: 'basicmedicines', journalName: '$basicmedicines_name;', name: 'Basic Medicines', category: 'light', planetaryOnly: false },
  { id: 'bioreducinglichen', journalName: '$bioreducinglichen_name;', name: 'Bioreducing Lichen', category: 'light', planetaryOnly: false },
  { id: 'muonimager', journalName: '$muonimager_name;', name: 'Muon Imager', category: 'light', planetaryOnly: false },
  { id: 'biowaste', journalName: '$biowaste_name;', name: 'Biowaste', category: 'light', planetaryOnly: false },
  { id: 'grain', journalName: '$grain_name;', name: 'Grain', category: 'light', planetaryOnly: false },
  { id: 'pesticides', journalName: '$pesticides_name;', name: 'Pesticides', category: 'light', planetaryOnly: false },
];

export const COMMODITY_BY_ID = new Map(COMMODITIES.map((c) => [c.id, c]));
export const COMMODITY_BY_JOURNAL_NAME = new Map(COMMODITIES.map((c) => [c.journalName.toLowerCase(), c]));
export const COMMODITY_BY_DISPLAY_NAME = new Map(COMMODITIES.map((c) => [c.name.toLowerCase(), c]));

export function findCommodityByJournalName(journalName) {
  if (!journalName) return undefined;
  return COMMODITY_BY_JOURNAL_NAME.get(String(journalName).toLowerCase());
}

export function findCommodityByDisplayName(displayName) {
  if (!displayName) return undefined;
  return COMMODITY_BY_DISPLAY_NAME.get(String(displayName).toLowerCase());
}

export function getCommoditiesByCategory(category) {
  return COMMODITIES.filter((c) => c.category === category);
}

export const CATEGORY_ORDER = ['heavy', 'medium', 'light'];
export const CATEGORY_LABELS = {
  heavy: 'Heavy (1000+ tons)',
  medium: 'Medium (100-999 tons)',
  light: 'Light (<100 tons)',
};
