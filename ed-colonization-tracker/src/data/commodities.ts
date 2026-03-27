export type CommodityCategory = 'heavy' | 'medium' | 'light';

export interface CommodityDefinition {
  id: string;
  journalName: string; // e.g. "$aluminium_name;"
  name: string; // Display name e.g. "Aluminium"
  category: CommodityCategory;
  planetaryOnly: boolean;
}

// All known colonization commodities
export const COMMODITIES: CommodityDefinition[] = [
  // Heavy (typically 1000+ tons needed)
  { id: "steel", journalName: "$steel_name;", name: "Steel", category: "heavy", planetaryOnly: false },
  { id: "titanium", journalName: "$titanium_name;", name: "Titanium", category: "heavy", planetaryOnly: false },
  { id: "cmmcomposite", journalName: "$cmmcomposite_name;", name: "CMM Composite", category: "heavy", planetaryOnly: true },
  { id: "liquidoxygen", journalName: "$liquidoxygen_name;", name: "Liquid Oxygen", category: "heavy", planetaryOnly: false },

  // Medium (100-999 tons)
  { id: "water", journalName: "$water_name;", name: "Water", category: "medium", planetaryOnly: false },
  { id: "ceramiccomposites", journalName: "$ceramiccomposites_name;", name: "Ceramic Composites", category: "medium", planetaryOnly: true },
  { id: "polymers", journalName: "$polymers_name;", name: "Polymers", category: "medium", planetaryOnly: false },
  { id: "aluminium", journalName: "$aluminium_name;", name: "Aluminium", category: "medium", planetaryOnly: false },
  { id: "insulatingmembrane", journalName: "$insulatingmembrane_name;", name: "Insulating Membrane", category: "medium", planetaryOnly: false },
  { id: "copper", journalName: "$copper_name;", name: "Copper", category: "medium", planetaryOnly: false },

  // Light (under 100 tons)
  { id: "superconductors", journalName: "$superconductors_name;", name: "Superconductors", category: "light", planetaryOnly: false },
  { id: "computercomponents", journalName: "$computercomponents_name;", name: "Computer Components", category: "light", planetaryOnly: false },
  { id: "foodcartridges", journalName: "$foodcartridges_name;", name: "Food Cartridges", category: "light", planetaryOnly: false },
  { id: "fruitandvegetables", journalName: "$fruitandvegetables_name;", name: "Fruit and Vegetables", category: "light", planetaryOnly: false },
  { id: "semiconductors", journalName: "$semiconductors_name;", name: "Semiconductors", category: "light", planetaryOnly: false },
  { id: "waterpurifiers", journalName: "$waterpurifiers_name;", name: "Water Purifiers", category: "light", planetaryOnly: false },
  { id: "medicaldiagnosticequipment", journalName: "$medicaldiagnosticequipment_name;", name: "Medical Diagnostic Equipment", category: "light", planetaryOnly: false },
  { id: "nonlethalweapons", journalName: "$nonlethalweapons_name;", name: "Non-Lethal Weapons", category: "light", planetaryOnly: false },
  { id: "powergenerators", journalName: "$powergenerators_name;", name: "Power Generators", category: "light", planetaryOnly: false },
];

// Lookup helpers
export const COMMODITY_BY_ID = new Map(COMMODITIES.map(c => [c.id, c]));
export const COMMODITY_BY_JOURNAL_NAME = new Map(COMMODITIES.map(c => [c.journalName.toLowerCase(), c]));
export const COMMODITY_BY_DISPLAY_NAME = new Map(COMMODITIES.map(c => [c.name.toLowerCase(), c]));

export function findCommodityByJournalName(journalName: string | undefined | null): CommodityDefinition | undefined {
  if (!journalName) return undefined;
  return COMMODITY_BY_JOURNAL_NAME.get(journalName.toLowerCase());
}

export function findCommodityByDisplayName(displayName: string | undefined | null): CommodityDefinition | undefined {
  if (!displayName) return undefined;
  return COMMODITY_BY_DISPLAY_NAME.get(displayName.toLowerCase());
}

export function getCommoditiesByCategory(category: CommodityCategory): CommodityDefinition[] {
  return COMMODITIES.filter(c => c.category === category);
}

export const CATEGORY_ORDER: CommodityCategory[] = ['heavy', 'medium', 'light'];
export const CATEGORY_LABELS: Record<CommodityCategory, string> = {
  heavy: 'Heavy (1000+ tons)',
  medium: 'Medium (100-999 tons)',
  light: 'Light (<100 tons)',
};
