import type { PlaySession, ColonizationProject } from '@/store/types';

/** Compute per-commodity delivery deltas (only positive = tons delivered) */
export function computeSessionDeltas(session: PlaySession): Record<string, number> {
  if (!session.endSnapshot) return {};
  const deltas: Record<string, number> = {};
  for (const [id, endQty] of Object.entries(session.endSnapshot)) {
    const startQty = session.startSnapshot[id] ?? 0;
    const delta = endQty - startQty;
    if (delta > 0) deltas[id] = delta;
  }
  return deltas;
}

/** Total tons delivered in a completed session */
export function computeSessionTons(session: PlaySession): number {
  const deltas = computeSessionDeltas(session);
  return Object.values(deltas).reduce((sum, d) => sum + d, 0);
}

/** Live tons delivered for an active session (compare current project state vs startSnapshot) */
export function computeLiveTons(
  startSnapshot: Record<string, number>,
  project: ColonizationProject,
): number {
  let total = 0;
  for (const c of project.commodities) {
    const startQty = startSnapshot[c.commodityId] ?? 0;
    const delta = c.providedQuantity - startQty;
    if (delta > 0) total += delta;
  }
  return total;
}

/** Duration in milliseconds */
export function computeSessionDurationMs(session: PlaySession): number {
  const start = Date.parse(session.startTime);
  const end = session.endTime ? Date.parse(session.endTime) : Date.now();
  return Math.max(0, end - start);
}

/** Tons per hour. Returns 0 if duration is too short. */
export function computeDeliveryRate(tons: number, durationMs: number): number {
  if (durationMs < 60_000) return 0; // less than 1 minute = no meaningful rate
  return tons / (durationMs / 3_600_000);
}

/** Format milliseconds as "Xh Ym" or "Xm Ys" */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/** Compute project totals from commodities */
export function computeProjectTotals(project: ColonizationProject) {
  let totalRequired = 0;
  let totalProvided = 0;
  for (const c of project.commodities) {
    totalRequired += c.requiredQuantity;
    totalProvided += c.providedQuantity;
  }
  const totalRemaining = Math.max(0, totalRequired - totalProvided);
  const progress = totalRequired > 0 ? totalProvided / totalRequired : 0;
  return { totalRequired, totalProvided, totalRemaining, progress };
}

/** Projected completion date based on remaining tons and average rate (t/hr) */
export function computeProjectedCompletion(remainingTons: number, avgRatePerHour: number): Date | null {
  if (avgRatePerHour <= 0 || remainingTons <= 0) return null;
  const hoursLeft = remainingTons / avgRatePerHour;
  return new Date(Date.now() + hoursLeft * 3_600_000);
}

/** Filter sessions for a specific project */
export function getProjectSessions(sessions: PlaySession[], projectId: string): PlaySession[] {
  return sessions.filter((s) => s.projectId === projectId);
}

/** Filter to completed sessions only */
export function getCompletedSessions(sessions: PlaySession[]): PlaySession[] {
  return sessions.filter((s) => s.endTime !== null);
}

/** Aggregate stats across multiple completed sessions */
export function aggregateSessionStats(sessions: PlaySession[]) {
  const completed = getCompletedSessions(sessions);
  let totalTons = 0;
  let totalMs = 0;
  let bestRate = 0;

  for (const s of completed) {
    const tons = computeSessionTons(s);
    const ms = computeSessionDurationMs(s);
    totalTons += tons;
    totalMs += ms;
    const rate = computeDeliveryRate(tons, ms);
    if (rate > bestRate) bestRate = rate;
  }

  const avgRate = computeDeliveryRate(totalTons, totalMs);

  return {
    count: completed.length,
    totalTons,
    totalMs,
    avgRate,
    bestRate,
  };
}
