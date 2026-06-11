/**
 * Type declarations for the canonical scorer implementation (scorer.js).
 *
 * scorer.js is the single source of truth for system scoring — consumed by
 * the server (overlay.js), the browser UI (via the src/lib/scoutingScorer.ts
 * re-export shim), and the offline region tools (tools/*.mjs). This file
 * gives TypeScript consumers full types without duplicating the logic.
 */
import type { SpanshDumpBody } from '../../src/services/spanshApi';

export interface QualifyingBody {
  body: SpanshDumpBody;
  parentStarId: number | null; // bodyId of the parent star (from parents array)
  isPrimaryStar: boolean; // orbits the main star (or its barycenter)
  economy: string; // classified economy
  hasAtmosphere: boolean;
  hasRings: boolean;
  distanceLs: number;
}

export interface StarInfo {
  bodyId: number;
  name: string;
  subType: string;
  isMainStar: boolean;
  emoji: string;
  scorePoints: number;
  isHazardous: boolean;
}

export interface BodySegment {
  text: string;
  tooltip: string;
}

export interface EpicView {
  isEpic: boolean;
  reasons: string[]; // e.g. ["tight binary 0.03 AU", "parent fills 25° of sky", "ring-edge moon"]
}

export interface ScoreBreakdown {
  starPoints: number;
  starDetails: string[];
  atmospherePoints: number;
  atmosphereCount: number;
  oxygenPoints: number;
  oxygenCount: number;
  exoticPoints: number;
  exoticCount: number;
  ringPoints: number;
  ringCount: number;
  proximityPoints: number;
  proximityCount: number;
  economyPoints: number;
  uniqueEconomies: string[];
  bodyCountPoints: number;
  bodyCount: number;
  starCount: number;
  epicView: EpicView;
  total: number;
  hasRingedLandable: boolean;
  hasOxygenAtmosphere: boolean;
  hazardousStars: string[];
}

export declare const ICY_SUBTYPES: Set<string>;
export declare function isColonisableAtmosphere(atmosphereType?: string | null): boolean;
export declare function distanceDecay(distanceLs: number): number;
export declare function exoticAtmoPoints(atmosphereType?: string | null): number;
export declare function filterQualifyingBodies(bodies: SpanshDumpBody[]): QualifyingBody[];
export declare function classifyStars(bodies: SpanshDumpBody[]): StarInfo[];
export declare function buildBodyString(qualBodies: QualifyingBody[], stars: StarInfo[]): string;
export declare function buildBodySegments(qualBodies: QualifyingBody[], stars: StarInfo[]): BodySegment[];
export declare function scoreSystem(bodies: SpanshDumpBody[]): ScoreBreakdown;
export declare function emptyScore(): ScoreBreakdown;
export declare function detectEpicView(bodies: SpanshDumpBody[]): EpicView;
