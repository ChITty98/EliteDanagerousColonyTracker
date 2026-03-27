export interface ArdentStation {
  commodityName: string;
  marketId: number;
  stationName: string;
  stationType: string;
  distanceToArrival: number;
  maxLandingPadSize: number;
  systemName: string;
  systemX: number;
  systemY: number;
  systemZ: number;
  buyPrice: number;
  stock: number;
  updatedAt: string;
  distance?: number; // ly from reference system (present in nearby queries)
}

// In-memory cache with 5-minute TTL
const cache = new Map<string, { data: ArdentStation[]; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000;

export async function findNearbySources(
  systemName: string,
  commodityName: string,
  opts: { maxDistance?: number; excludeFC?: boolean } = {},
): Promise<ArdentStation[]> {
  const { maxDistance = 80, excludeFC = true } = opts;
  const key = `${systemName}|${commodityName}|${maxDistance}|${excludeFC}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.data;

  const params = new URLSearchParams({
    minLandingPadSize: 'L',
    maxDistance: String(maxDistance),
  });
  if (excludeFC) params.set('fleetCarriers', 'false');

  const url = `/ardent-api/v2/system/name/${encodeURIComponent(systemName)}/commodity/name/${encodeURIComponent(commodityName)}/nearby/exports?${params}`;
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 404) return [];
    throw new Error(`Ardent API: ${res.status}`);
  }
  const data: ArdentStation[] = await res.json();
  cache.set(key, { data, ts: Date.now() });
  return data;
}

export function clearSourceCache() {
  cache.clear();
}
