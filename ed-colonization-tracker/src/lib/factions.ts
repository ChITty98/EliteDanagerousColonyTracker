/**
 * Re-export shim — the canonical implementation lives in server/journal/factions.js
 * (one reading of the journal's System Factions panel for the dock banner, the Sync All
 * backfill and the system page). Types come from the adjacent factions.d.ts.
 */
export * from '../../server/journal/factions.js';
export type { SystemFactionsEntry, SystemFactionReading, SystemFactionsHistoryPoint, InfluenceTrend } from '../../server/journal/factions.js';
