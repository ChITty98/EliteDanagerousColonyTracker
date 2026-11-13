/**
 * The Materials page's "Colony bodies" tab (1.63.0) — the half with no React in it: the payload's shape, the
 * per-material overview, and the list of bodies that carry one material. The server builds the payload
 * (server/journal/colonyMaterials.js); this only arranges it.
 */
import type { MaterialDefinition } from '../data/engineeringMaterials';

export interface ColonyBody {
  body: string;
  system: string;
  /** 'scan' = the commander's own Scan; 'spansh' = Spansh's figure, used only where no scan exists. */
  source: 'scan' | 'spansh';
  at: string | null;
  /** material id → percent of the body's surface mix */
  materials: Record<string, number>;
  gravity: number | null;
  planetClass: string | null;
  /** a short description, 'none' for an airless body, null when it is not on file */
  atmosphere: string | null;
  icy: boolean;
  distanceLs: number | null;
  sites: string[];
}
export interface ColonySystemCount { name: string; bodies: number; spansh: number; unscanned: number }
export interface ColonyBodiesPayload {
  systems: ColonySystemCount[];
  bodies: ColonyBody[];
  unscanned: { system: string; bodies: string[] }[];
  empty: string[];
}
export interface MaterialOverviewRow {
  material: MaterialDefinition;
  held: number;
  room: number;
  /** how many of the bodies carry it */
  bodies: number;
  bestPct: number | null;
  best: ColonyBody | null;
}

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

/** The bodies that carry a material, richest first. Icy bodies come after the others: listed, never leading. */
export function bodiesCarrying(bodies: ColonyBody[], materialId: string): ColonyBody[] {
  return bodies
    .filter((b) => typeof b.materials[materialId] === 'number')
    .sort((a, b) => Number(a.icy) - Number(b.icy) || b.materials[materialId] - a.materials[materialId] || natural(a.body, b.body));
}

/**
 * One row per raw material: stock and room, how many colony bodies carry it, and the richest of them (the first row
 * bodiesCarrying would list). Highest grade first, then by best share; a material no body carries goes last.
 */
export function materialOverview(bodies: ColonyBody[], raw: MaterialDefinition[], held: Record<string, number>): MaterialOverviewRow[] {
  return raw.map((material) => {
    const list = bodiesCarrying(bodies, material.id);
    const best = list[0] ?? null;
    const have = held[material.id] || 0;
    return { material, held: have, room: material.cap - have, bodies: list.length, bestPct: best ? best.materials[material.id] : null, best };
  }).sort((a, b) => Number(b.bodies > 0) - Number(a.bodies > 0) || b.material.grade - a.material.grade || (b.bestPct ?? -1) - (a.bestPct ?? -1) || natural(a.material.displayName, b.material.displayName));
}

/** "Col 173 Sector AX-J d9-52 2 b" in its own system is "2 b". */
export function shortBody(body: string, system: string): string {
  return system && body.toLowerCase().startsWith(`${system.toLowerCase()} `) ? body.slice(system.length + 1) : body;
}

/** A construction site by the name the port will carry. */
export function shortSite(name: string): string {
  return name.replace(/^(Planetary|Orbital) Construction Site:\s*/i, '');
}
