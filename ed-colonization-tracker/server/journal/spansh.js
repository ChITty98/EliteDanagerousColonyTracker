/**
 * Spansh API client for the server (Node 20+).
 *
 * Port of src/services/spanshApi.ts with TS types stripped and browser
 * assumptions replaced:
 *   - `fetch` is the Node 20+ global — no polyfill required.
 *   - Browser version hits `/spansh-api/*` (vite proxy). Server version hits
 *     `https://spansh.co.uk/api/*` directly.
 *   - Caches live in-memory on the module (no sessionStorage).
 *
 * Rate limiting: 1 req/sec, queued (matches the browser implementation).
 */

const SPANSH_BASE = 'https://spansh.co.uk/api';

// --- Rate limiter: 1 request per second, queued ---
let lastRequestTime = 0;
const MIN_INTERVAL = 1100; // 1.1s between requests

async function rateLimitedFetch(url, init) {
  const now = Date.now();
  const wait = Math.max(0, MIN_INTERVAL - (now - lastRequestTime));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestTime = Date.now();
  return fetch(url, init);
}

// --- Caches ---
/** @type {Map<string, { data: any[], ts: number }>} */
const searchCache = new Map();
/** @type {Map<number, { data: any, ts: number }>} */
const dumpCache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 min for system data (doesn't change often)

// --- API functions ---

/**
 * Search for systems within a radius of reference coordinates.
 * Returns basic system info with minimal body data.
 *
 * @param {{x:number,y:number,z:number}} origin - reference coordinates
 * @param {number} [radius=15] - ly radius
 * @param {{limit?: number, skipVisited?: Iterable<number> | Set<number>}} [opts]
 *        limit: 0 = unlimited (default 0)
 *        skipVisited: iterable of id64s to filter out of the returned results
 */
export async function searchNearbySystems(origin, radius = 15, opts = {}) {
  const limit = typeof opts.limit === 'number' ? opts.limit : 0;
  const skipSet =
    opts.skipVisited instanceof Set
      ? opts.skipVisited
      : opts.skipVisited
        ? new Set(opts.skipVisited)
        : null;

  const key = `${origin.x}|${origin.y}|${origin.z}|${radius}`;
  const hit = searchCache.get(key);
  let allResults;

  if (hit && Date.now() - hit.ts < CACHE_TTL) {
    allResults = hit.data;
  } else {
    const body = JSON.stringify({
      filters: { distance: { min: 0, max: radius } },
      sort: [{ distance: { direction: 'asc' } }],
      size: 100,
      page: 0,
      reference_coords: { x: origin.x, y: origin.y, z: origin.z },
    });

    const res = await rateLimitedFetch(`${SPANSH_BASE}/systems/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    if (!res.ok) throw new Error(`Spansh systems search: ${res.status}`);
    const data = await res.json();

    // If more than 100 results, fetch additional pages
    allResults = data.results;
    const effectiveMax = limit > 0 ? limit : data.count;
    if (data.count > 100 && allResults.length < effectiveMax) {
      const pages = Math.ceil(Math.min(data.count, effectiveMax) / 100);
      for (let page = 1; page < pages; page++) {
        const pageBody = JSON.stringify({
          filters: { distance: { min: 0, max: radius } },
          sort: [{ distance: { direction: 'asc' } }],
          size: 100,
          page,
          reference_coords: { x: origin.x, y: origin.y, z: origin.z },
        });
        const pageRes = await rateLimitedFetch(`${SPANSH_BASE}/systems/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: pageBody,
        });
        if (pageRes.ok) {
          const pageData = await pageRes.json();
          allResults = allResults.concat(pageData.results);
        }
      }
    }

    searchCache.set(key, { data: allResults, ts: Date.now() });
  }

  // Apply skipVisited filter (post-cache so cache stays canonical).
  let filtered = allResults;
  if (skipSet && skipSet.size > 0) {
    filtered = allResults.filter((s) => !skipSet.has(s.id64));
  }

  return limit > 0 ? filtered.slice(0, limit) : filtered;
}

/**
 * Fetch full system data (bodies with all fields) from the dump endpoint.
 * Required for scoring — has isLandable, earthMasses, atmosphere, rings, parents, etc.
 *
 * @param {number} id64
 */
export async function fetchSystemDump(id64) {
  const hit = dumpCache.get(id64);
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.data;

  const res = await rateLimitedFetch(`${SPANSH_BASE}/dump/${id64}`);
  if (!res.ok) throw new Error(`Spansh dump: ${res.status}`);
  const raw = await res.json();
  // Dump endpoint wraps data in { system: { ... } }
  const data = raw.system ?? raw;
  dumpCache.set(id64, { data, ts: Date.now() });
  return data;
}

/**
 * Look up a system name → id64 and coordinates via the typeahead endpoint.
 *
 * @param {string} name
 * @returns {Promise<{id64:number,x:number,y:number,z:number} | null>}
 */
export async function resolveSystemName(name) {
  const res = await rateLimitedFetch(
    `${SPANSH_BASE}/systems/field_values/system_names?q=${encodeURIComponent(name)}`,
  );
  if (!res.ok) return null;
  const data = await res.json();
  const match = data.min_max.find((s) => s.name.toLowerCase() === name.toLowerCase());
  return match ? { id64: match.id64, x: match.x, y: match.y, z: match.z } : null;
}

export function clearSpanshCache() {
  searchCache.clear();
  dumpCache.clear();
}
