/**
 * Engineering blueprint catalog.
 *
 * Each entry lists materials consumed per single roll at each grade.
 * Recipes are best-effort from community sources — verify against in-game
 * Engineer Workshop before committing large mats. A `verified: false` flag
 * marks recipes I haven't physically confirmed yet.
 *
 * Adding a new blueprint: append to BLUEPRINTS, ensure every materialId is
 * present in src/data/engineeringMaterials.ts (otherwise the capacity calc
 * will silently skip it).
 */

import { MATERIALS, type MaterialDefinition } from './engineeringMaterials';

export interface BlueprintIngredient {
  materialId: string; // canonical id from engineeringMaterials.ts
  count: number;      // per single roll
}

export interface BlueprintGradeRecipe {
  grade: 1 | 2 | 3 | 4 | 5;
  ingredients: BlueprintIngredient[];
}

export interface Blueprint {
  id: string;
  name: string;
  module: string;     // 'Thrusters', 'Frame Shift Drive', etc.
  description: string;
  primaryEngineer: string;
  grades: BlueprintGradeRecipe[];
  verified: boolean;  // true if recipe confirmed in-game
}

export const BLUEPRINTS: Blueprint[] = [
  {
    id: 'dirty_drive_tuning',
    name: 'Dirty Drive Tuning',
    module: 'Thrusters',
    description: 'Increases top speed at the cost of integrity, thermal load, and power draw.',
    primaryEngineer: 'Professor Palin (G5)',
    verified: false,
    grades: [
      { grade: 1, ingredients: [
        { materialId: 'legacyfirmware', count: 1 },
      ]},
      { grade: 2, ingredients: [
        { materialId: 'mechanicalequipment', count: 1 },
        { materialId: 'consumerfirmware', count: 1 },
      ]},
      { grade: 3, ingredients: [
        { materialId: 'mechanicalcomponents', count: 1 },
        { materialId: 'industrialfirmware', count: 1 },
        { materialId: 'selenium', count: 1 },
      ]},
      { grade: 4, ingredients: [
        { materialId: 'configurablecomponents', count: 1 },
        { materialId: 'industrialfirmware', count: 1 },
        { materialId: 'chromium', count: 1 },
      ]},
      { grade: 5, ingredients: [
        { materialId: 'pharmaceuticalisolators', count: 1 },
        { materialId: 'industrialfirmware', count: 1 },
        { materialId: 'cadmium', count: 1 },
      ]},
    ],
  },
  {
    id: 'increased_range_fsd',
    name: 'Increased Range FSD',
    module: 'Frame Shift Drive',
    description: 'Increases optimal mass and FSD jump range. Standard explorer mod.',
    primaryEngineer: 'Felicity Farseer (G5)',
    verified: false,
    grades: [
      { grade: 1, ingredients: [
        { materialId: 'disruptedwakeechoes', count: 1 },
      ]},
      { grade: 2, ingredients: [
        { materialId: 'chemicalprocessors', count: 1 },
        { materialId: 'disruptedwakeechoes', count: 1 },
      ]},
      { grade: 3, ingredients: [
        { materialId: 'chemicaldistillery', count: 1 },
        { materialId: 'wakesolutions', count: 1 },
        { materialId: 'fsdtelemetry', count: 1 },
      ]},
      { grade: 4, ingredients: [
        { materialId: 'chemicalmanipulators', count: 1 },
        { materialId: 'dataminedwake', count: 1 },
        { materialId: 'fsdtelemetry', count: 1 },
      ]},
      { grade: 5, ingredients: [
        { materialId: 'pharmaceuticalisolators', count: 1 },
        { materialId: 'dataminedwake', count: 1 },
        { materialId: 'hyperspacetrajectories', count: 1 },
      ]},
    ],
  },
];

export const BLUEPRINT_BY_ID = new Map(BLUEPRINTS.map((b) => [b.id, b]));

/**
 * For a blueprint at a given grade, given current inventory, return:
 *  - per-ingredient stock + max-rolls-this-mat-supports
 *  - the bottleneck (lowest max-rolls)
 *  - max rolls for the grade as a whole
 */
export interface IngredientCapacity {
  materialId: string;
  material: MaterialDefinition | undefined;
  required: number;
  available: number;
  maxRolls: number; // floor(available / required)
  bottleneck: boolean;
}

export interface GradeCapacity {
  grade: number;
  ingredients: IngredientCapacity[];
  maxRolls: number;
  bottleneckMaterial: string | null;
}

export function computeGradeCapacity(
  blueprint: Blueprint,
  grade: 1 | 2 | 3 | 4 | 5,
  inventory: { raw: Record<string, number>; manufactured: Record<string, number>; encoded: Record<string, number> },
): GradeCapacity | null {
  const recipe = blueprint.grades.find((g) => g.grade === grade);
  if (!recipe) return null;

  const stockOf = (id: string): number => {
    const m = MATERIALS.find((x) => x.id === id);
    if (!m) return 0;
    return inventory[m.category][id] || 0;
  };

  const ingredients: IngredientCapacity[] = recipe.ingredients.map((ing) => {
    const material = MATERIALS.find((x) => x.id === ing.materialId);
    const available = stockOf(ing.materialId);
    return {
      materialId: ing.materialId,
      material,
      required: ing.count,
      available,
      maxRolls: Math.floor(available / ing.count),
      bottleneck: false,
    };
  });

  const minRolls = ingredients.reduce(
    (acc, i) => Math.min(acc, i.maxRolls),
    Number.POSITIVE_INFINITY,
  );
  const maxRolls = minRolls === Number.POSITIVE_INFINITY ? 0 : minRolls;
  for (const i of ingredients) {
    if (i.maxRolls === maxRolls) i.bottleneck = true;
  }
  const bottleneckMaterial = ingredients.find((i) => i.bottleneck)?.materialId || null;

  return { grade, ingredients, maxRolls, bottleneckMaterial };
}
