/**
 * Arrival traffic report — EDSM passage counts + cache.
 *
 * EDSM's traffic endpoint counts LOGGED PASSAGES (visits by EDSM-feeding players), not unique
 * people; the unique-people number comes from radarState's per-system visitor tracking (distinct
 * anonymized uploaders heard in-system over 24 h). Both are floors — only tool-running
 * commanders are audible anywhere.
 *
 * Fetch discipline: one call per jump, warmed at StartJump (FSD charge time covers the round
 * trip so the arrival overlay can read the cache synchronously). 10-minute per-system cache,
 * failures cached too (never hammer EDSM), no background polling of any kind.
 */

const cache = new Map(); // sysLower -> { at, data: {day,week,total}|null }
const TTL_MS = 10 * 60_000;
const MAX_CACHE = 200;

export async function getEdsmTraffic(sysName) {
  if (!sysName) return null;
  const key = String(sysName).toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  let data = null;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch('https://www.edsm.net/api-system-v1/traffic?systemName=' + encodeURIComponent(sysName), { signal: ctl.signal });
    clearTimeout(t);
    const j = await r.json();
    if (j && j.traffic) data = { day: j.traffic.day || 0, week: j.traffic.week || 0, total: j.traffic.total || 0 };
  } catch { /* offline / timeout — cache the miss so we don't retry in a loop */ }
  cache.set(key, { at: Date.now(), data });
  if (cache.size > MAX_CACHE) { const k0 = cache.keys().next().value; cache.delete(k0); }
  return data;
}

// Synchronous cache read for the arrival overlay: undefined = never fetched, null = EDSM had
// nothing / fetch failed, object = counts.
export function peekEdsmTraffic(sysName) {
  const hit = cache.get(String(sysName || '').toLowerCase());
  return hit && Date.now() - hit.at < TTL_MS ? hit.data : undefined;
}
