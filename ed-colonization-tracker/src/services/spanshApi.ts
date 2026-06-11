// Spansh API client with rate limiting (max 1 request/sec)

// --- Rate limiter: 1 request per second, queued ---
let lastRequestTime = 0;
const MIN_INTERVAL = 1100; // 1.1s between requests

async function rateLimitedFetch(url: string, init?: RequestInit): Promise<Response> {
  const now = Date.now();
  const wait = Math.max(0, MIN_INTERVAL - (now - lastRequestTime));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestTime = Date.now();
  return fetch(url, init);
}

// --- Types: Systems search response (basic body info) ---

export interface SpanshSearchBody {
  id64: number;
  name: string;
  type: 'Star' | 'Planet';
  subtype: string;
  distance_to_arrival: number;
  is_main_star: boolean | null;
  terraforming_state?: string;
}

export interface SpanshSearchStation {
  name: string;
  type: string;
  market_id: number;
  distance_to_arrival?: number;
  has_large_pad: boolean;
  controlling_minor_faction: string;
  services: string[];
}

export interface SpanshSearchSystem {
  id64: number;
  name: string;
  distance: number;
  x: number;
  y: number;
  z: number;
  bodies: SpanshSearchBody[];
  body_count: number;
  stations: SpanshSearchStation[];
  population: number;
  primary_economy: string;
  secondary_economy: string;
  is_colonised?: boolean;
}

interface SpanshSearchResponse {
  count: number;
  results: SpanshSearchSystem[];
  search_reference: string;
  size: number;
}

// --- Types: Dump response (full body data for scoring) ---

export interface SpanshRing {
  name: string;
  type: string;
  innerRadius: number;
  outerRadius: number;
  mass: number;
}

export interface SpanshDumpBody {
  bodyId: number;
  id64: number;
  name: string;
  type: 'Star' | 'Planet';
  subType: string;
  distanceToArrival: number;
  // Star fields
  mainStar?: boolean;
  spectralClass?: string;
  solarMasses?: number;
  solarRadius?: number; // solar radii (stars use this; planets/journal bodies use `radius` in km)
  luminosity?: string;
  // Planet fields
  isLandable?: boolean;
  earthMasses?: number;
  gravity?: number;
  atmosphereType?: string | null;
  atmosphereComposition?: Record<string, number>;
  volcanismType?: string;
  terraformingState?: string;
  rings?: SpanshRing[];
  parents?: Array<Record<string, number>>;
  reserveLevel?: string;
  surfaceTemperature?: number;
  surfacePressure?: number; // Pa
  radius?: number; // km
  semiMajorAxis?: number; // AU
  solidComposition?: Record<string, number>;
  signals?: { genuses: unknown[]; signals: Record<string, number> };
  materials?: Record<string, number>;
  stations?: Array<{
    name: string;
    type: string;
    market_id?: number;
    controllingFaction?: string;
  }>;
}

export interface SpanshDumpSystem {
  id64: number;
  name: string;
  x: number;
  y: number;
  z: number;
  updateTime?: string; // e.g. "2026-03-11 17:23:28+00"
  bodyCount?: number; // TRUE total body count from the FSS discovery scan (may exceed bodies.length = partial scan)
  bodies: SpanshDumpBody[];
  stations: Array<{
    name: string;
    type: string;
    market_id?: number;
    has_large_pad?: boolean;
    controllingFaction?: string;
  }>;
  population: number;
  primaryEconomy?: string;
  secondaryEconomy?: string;
}

// --- Caches ---
const searchCache = new Map<string, { data: SpanshSearchSystem[]; ts: number }>();
const dumpCache = new Map<number, { data: SpanshDumpSystem; ts: number }>();
const CACHE_TTL = 30 * 60 * 1000; // 30 min for system data (doesn't change often)

// --- API functions ---

/**
 * Search for systems within a radius of reference coordinates.
 * Returns basic system info with minimal body data.
 * Single API call — returns all results.
 */
export async function searchNearbySystems(
  coords: { x: number; y: number; z: number },
  radius: number = 15,
  maxResults: number = 0, // 0 = unlimited
): Promise<SpanshSearchSystem[]> {
  const key = `${coords.x}|${coords.y}|${coords.z}|${radius}`;
  const hit = searchCache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL) {
    return maxResults > 0 ? hit.data.slice(0, maxResults) : hit.data;
  }

  const body = JSON.stringify({
    filters: { distance: { min: 0, max: radius } },
    sort: [{ distance: { direction: 'asc' } }],
    size: 100,
    page: 0,
    reference_coords: { x: coords.x, y: coords.y, z: coords.z },
  });

  const res = await rateLimitedFetch('/spansh-api/api/systems/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  if (!res.ok) throw new Error(`Spansh systems search: ${res.status}`);
  const data: SpanshSearchResponse = await res.json();

  // If more than 100 results, fetch additional pages
  let allResults = data.results;
  const effectiveMax = maxResults > 0 ? maxResults : data.count;
  if (data.count > 100 && allResults.length < effectiveMax) {
    const pages = Math.ceil(Math.min(data.count, effectiveMax) / 100);
    for (let page = 1; page < pages; page++) {
      const pageBody = JSON.stringify({
        filters: { distance: { min: 0, max: radius } },
        sort: [{ distance: { direction: 'asc' } }],
        size: 100,
        page,
        reference_coords: { x: coords.x, y: coords.y, z: coords.z },
      });
      const pageRes = await rateLimitedFetch('/spansh-api/api/systems/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: pageBody,
      });
      if (pageRes.ok) {
        const pageData: SpanshSearchResponse = await pageRes.json();
        allResults = allResults.concat(pageData.results);
      }
    }
  }

  searchCache.set(key, { data: allResults, ts: Date.now() });
  return maxResults > 0 ? allResults.slice(0, maxResults) : allResults;
}

export interface BoxelSystem { index: number; name: string; id64: number; bodyCount: number; }
export interface BoxelEnumeration {
  prefix: string;            // e.g. "Col 173 Sector AX-J d9-"
  known: BoxelSystem[];      // systems Spansh knows, sorted by index
  gaps: number[];            // indices ≤ maxIndex that Spansh doesn't have (likely unscanned)
  maxIndex: number;
  pages: number;             // Spansh pages fetched (for transparency)
}

/**
 * Enumerate a procedural boxel from live Spansh by name, to find SEQUENCE GAPS —
 * indices that exist by the contiguous numbering but Spansh has no system for
 * (i.e. unscanned). Spansh's name filter is loose (returns the whole boxel-id
 * group across mass codes), so we client-filter to the exact boxel prefix.
 * `prefix` should be the boxel + '-' (e.g. from parseBoxel in starNaming).
 */
export async function enumerateBoxel(prefix: string): Promise<BoxelEnumeration> {
  const re = new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\d+)$');
  const seen = new Map<number, BoxelSystem>();
  let pages = 0;
  for (let page = 0; page < 40; page++) { // cap pages so a huge boxel-id group can't run away
    const res = await rateLimitedFetch('/spansh-api/api/systems/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filters: { name: { value: prefix } }, size: 100, page }),
    });
    pages++;
    if (!res.ok) break;
    const data: SpanshSearchResponse = await res.json();
    const results = data.results || [];
    for (const s of results) {
      const mm = (s.name || '').match(re);
      if (mm) {
        const idx = parseInt(mm[1], 10);
        if (!seen.has(idx)) seen.set(idx, { index: idx, name: s.name, id64: s.id64, bodyCount: s.body_count ?? 0 });
      }
    }
    if (results.length < 100) break; // last page
  }
  const known = [...seen.values()].sort((a, b) => a.index - b.index);
  const maxIndex = known.length ? known[known.length - 1].index : -1;
  const gaps: number[] = [];
  for (let k = 0; k <= maxIndex; k++) if (!seen.has(k)) gaps.push(k);
  return { prefix, known, gaps, maxIndex, pages };
}

/**
 * Fetch full system data (bodies with all fields) from the dump endpoint.
 * Required for scoring — has isLandable, earthMasses, atmosphere, rings, parents, etc.
 */
export async function fetchSystemDump(id64: number): Promise<SpanshDumpSystem> {
  const hit = dumpCache.get(id64);
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.data;

  const res = await rateLimitedFetch(`/spansh-api/api/dump/${id64}`);
  if (!res.ok) throw new Error(`Spansh dump: ${res.status}`);
  const raw = await res.json();
  // Dump endpoint wraps data in { system: { ... } }
  const data: SpanshDumpSystem = raw.system ?? raw;
  dumpCache.set(id64, { data, ts: Date.now() });
  return data;
}

/**
 * Look up a system name → id64 and coordinates via the typeahead endpoint.
 */
export async function resolveSystemName(
  name: string,
): Promise<{ id64: number; x: number; y: number; z: number } | null> {
  const res = await rateLimitedFetch(
    `/spansh-api/api/systems/field_values/system_names?q=${encodeURIComponent(name)}`,
  );
  if (!res.ok) return null;
  const data: { min_max: Array<{ id64: number; name: string; x: number; y: number; z: number }> } =
    await res.json();
  const match = data.min_max.find((s) => s.name.toLowerCase() === name.toLowerCase());
  return match ? { id64: match.id64, x: match.x, y: match.y, z: match.z } : null;
}

export function clearSpanshCache() {
  searchCache.clear();
  dumpCache.clear();
}
