/**
 * Type declarations for the system-factions helpers (factions.js) — consumed by the server
 * (processors.js, overlay.js, server.mjs) and the browser through the src/lib/factions.ts shim.
 */
export const FACTION_HISTORY_CAP: number;

export interface SystemFactionReading {
  name: string;
  influence: number;            // 0..1
  state: string | null;         // FactionState, null when None
  government: string | null;
  allegiance: string | null;
  happiness: string | null;     // localised band
  reputation: number | null;    // MyReputation, −100..100
  squadron: boolean;
  active: string[];
  pending: string[];
  recovering: string[];
}

export interface SystemFactionsHistoryPoint {
  at: string;
  influence: Record<string, number>;
  states: Record<string, string | null>;
}

export interface SystemConflict {
  warType: string | null;       // 'war' | 'civilwar' | 'election'
  status: string | null;        // 'active' | 'pending' | ''
  factions: { name: string | null; stake: string | null; wonDays: number }[];
}

export interface SystemFactionsEntry {
  systemName: string;
  systemAddress: number | null;
  updatedAt: string;
  controlling: { name: string; state: string | null } | null;
  allegiance: string | null;
  government: string | null;
  security: string | null;
  factions: SystemFactionReading[];
  conflicts?: SystemConflict[];
  history: SystemFactionsHistoryPoint[];
}

export interface InfluenceTrend {
  current: number;
  previous: number | null;
  previousAt: string | null;
  delta: number | null;
  arrow: '' | '▲' | '▼';
}

export function reputationBand(rep: number | null | undefined): string | null;
export function factionSnapshotFromEvent(ev: unknown): SystemFactionsEntry | null;
export function conflictsFromEvent(ev: unknown): SystemConflict[];
export function mergeSystemFactions(existing: SystemFactionsEntry | null | undefined, snap: SystemFactionsEntry | null | undefined): SystemFactionsEntry | null;
export function influenceTrend(entry: SystemFactionsEntry | null | undefined, factionName: string): InfluenceTrend | null;
export function formatInfluence(v: number | null | undefined): string;
export function factionStatesLabel(f: SystemFactionReading | null | undefined): string;
export function describeStationFactionLine(entry: SystemFactionsEntry | null | undefined, factionName: string | null | undefined): string | null;
export function extractSystemFactions(journalDir: string, io?: { listFiles?: (dir: string) => string[]; readFile?: (p: string) => string }): Record<string, SystemFactionsEntry>;
