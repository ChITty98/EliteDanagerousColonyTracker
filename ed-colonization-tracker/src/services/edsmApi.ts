import type { SystemInfo } from '@/store/types';

// Use Vite proxy in dev to avoid CORS, direct URL in production
const EDSM_BASE = import.meta.env.DEV ? '/edsm-api' : 'https://www.edsm.net';

interface EdsmSystemInfo {
  name: string;
  information?: {
    allegiance?: string;
    government?: string;
    faction?: string;
    factionState?: string;
    population?: number;
    economy?: string;
    secondEconomy?: string;
    security?: string;
  };
  coords?: {
    x: number;
    y: number;
    z: number;
  };
}

/**
 * Fetch system info from EDSM including economy, population, and coordinates.
 * Rate limited to ~360 requests/hour by EDSM.
 */
export async function fetchSystemInfo(systemName: string): Promise<SystemInfo | null> {
  try {
    const url = new URL(`${EDSM_BASE}/api-v1/system`, window.location.origin);
    url.searchParams.set('systemName', systemName);
    url.searchParams.set('showInformation', '1');
    url.searchParams.set('showCoordinates', '1');

    const response = await fetch(url.toString());
    if (!response.ok) return null;

    const data: EdsmSystemInfo = await response.json();

    // EDSM returns empty object {} if system not found
    if (!data.name) return null;

    return {
      economy: data.information?.economy || 'Unknown',
      secondEconomy: data.information?.secondEconomy,
      population: data.information?.population || 0,
      coordinates: data.coords ? { x: data.coords.x, y: data.coords.y, z: data.coords.z } : undefined,
      lastFetched: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Calculate the distance between two 3D coordinate points in light years.
 */
export function calculateDistance(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number }
): number {
  return Math.sqrt(
    Math.pow(a.x - b.x, 2) +
    Math.pow(a.y - b.y, 2) +
    Math.pow(a.z - b.z, 2)
  );
}

/**
 * Fetch system info and calculate distance from a reference system.
 * Returns the SystemInfo with distanceFromHome populated if both systems have coords.
 */
export async function fetchSystemInfoWithDistance(
  systemName: string,
  homeSystemName?: string
): Promise<SystemInfo | null> {
  const info = await fetchSystemInfo(systemName);
  if (!info) return null;

  // If we have a home system, calculate distance
  if (homeSystemName && info.coordinates) {
    try {
      const homeInfo = await fetchSystemInfo(homeSystemName);
      if (homeInfo?.coordinates) {
        info.distanceFromHome = Math.round(calculateDistance(info.coordinates, homeInfo.coordinates) * 100) / 100;
      }
    } catch {
      // Distance calculation is optional, don't fail
    }
  }

  return info;
}
