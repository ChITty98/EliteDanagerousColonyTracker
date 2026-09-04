// server/journal/rawMaterials.js
//
// Raw engineering materials — grade and cap, for the surface-mining overlay.
//
// GENERATED FROM src/data/engineeringMaterials.ts, which stays the single source of truth. The
// server cannot import that .ts module, so this is a mirror — and tests/raw-materials-sync.test.mjs
// fails the suite if the two ever disagree, which is what keeps a copy honest.
//
// Caps are ED's grade-based raw limits: G1=300, G2=250, G3=200, G4=150.

export const RAW_MATERIALS = {
  carbon: { name: 'Carbon', grade: 1, cap: 300 },
  vanadium: { name: 'Vanadium', grade: 2, cap: 250 },
  niobium: { name: 'Niobium', grade: 3, cap: 200 },
  yttrium: { name: 'Yttrium', grade: 4, cap: 150 },
  phosphorus: { name: 'Phosphorus', grade: 1, cap: 300 },
  chromium: { name: 'Chromium', grade: 2, cap: 250 },
  molybdenum: { name: 'Molybdenum', grade: 3, cap: 200 },
  technetium: { name: 'Technetium', grade: 4, cap: 150 },
  sulphur: { name: 'Sulphur', grade: 1, cap: 300 },
  manganese: { name: 'Manganese', grade: 2, cap: 250 },
  cadmium: { name: 'Cadmium', grade: 3, cap: 200 },
  ruthenium: { name: 'Ruthenium', grade: 4, cap: 150 },
  iron: { name: 'Iron', grade: 1, cap: 300 },
  zinc: { name: 'Zinc', grade: 2, cap: 250 },
  tin: { name: 'Tin', grade: 3, cap: 200 },
  selenium: { name: 'Selenium', grade: 4, cap: 150 },
  nickel: { name: 'Nickel', grade: 1, cap: 300 },
  germanium: { name: 'Germanium', grade: 2, cap: 250 },
  tungsten: { name: 'Tungsten', grade: 3, cap: 200 },
  tellurium: { name: 'Tellurium', grade: 4, cap: 150 },
  rhenium: { name: 'Rhenium', grade: 1, cap: 300 },
  arsenic: { name: 'Arsenic', grade: 2, cap: 250 },
  mercury: { name: 'Mercury', grade: 3, cap: 200 },
  polonium: { name: 'Polonium', grade: 4, cap: 150 },
  lead: { name: 'Lead', grade: 1, cap: 300 },
  zirconium: { name: 'Zirconium', grade: 2, cap: 250 },
  boron: { name: 'Boron', grade: 3, cap: 200 },
  antimony: { name: 'Antimony', grade: 4, cap: 150 },
};

export const GRADE_LABEL = { 1: 'Very Common', 2: 'Common', 3: 'Standard', 4: 'Rare' };

/** Journal Name (any case) -> { name, grade, cap } or null when it is not a raw material. */
export function rawMaterial(name) {
  if (!name) return null;
  return RAW_MATERIALS[String(name).toLowerCase()] || null;
}
