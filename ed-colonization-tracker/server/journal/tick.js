// server/journal/tick.js
//
// Galaxy BGS tick awareness — polls the same production endpoint BGS-Tally uses
// (tick.infomancer.uk). The tick moves roughly once a day; a 15-minute poll is plenty.
// OPTIONAL ENHANCEMENT per the journal-first tenet: if the service is unreachable the
// last-known value is kept (null if never fetched) and every consumer degrades to its
// pre-tick behaviour — nothing may ever REQUIRE this data.

const TICK_URL = 'http://tick.infomancer.uk/galtick.json';
const POLL_MS = 15 * 60 * 1000;

let lastGalaxyTick = null; // ISO string, e.g. "2026-07-17T15:45:34.000Z"
let fetchedAt = 0;
let timer = null;
let _failLogged = false;

/** Last known galaxy tick (ISO string) or null if the service has never answered. */
export function getGalaxyTick() {
  return lastGalaxyTick;
}

export function getTickInfo() {
  return { lastGalaxyTick, fetchedAt: fetchedAt || null };
}

/** Start the poll loop. Call once at server startup. Fail-silent by design. */
export function startTickPoll(broadcastEvent) {
  const poll = async () => {
    try {
      const res = await fetch(TICK_URL, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`http ${res.status}`);
      const data = await res.json();
      const t = data && data.lastGalaxyTick;
      if (typeof t === 'string' && t) {
        fetchedAt = Date.now();
        _failLogged = false;
        if (t !== lastGalaxyTick) {
          const prev = lastGalaxyTick;
          lastGalaxyTick = t;
          console.log(`[Tick] galaxy tick: ${t}${prev ? ` (was ${prev})` : ''}`);
          if (broadcastEvent) {
            broadcastEvent({ type: 'galaxy_tick', lastGalaxyTick: t, timestamp: new Date().toISOString() });
          }
        }
      }
    } catch (e) {
      if (!_failLogged) {
        console.log(`[Tick] tick service unavailable (${e && e.message}) — tick features dormant`);
        _failLogged = true;
      }
    }
  };
  poll();
  timer = setInterval(poll, POLL_MS);
  if (timer.unref) timer.unref();
}
