import type { JournalScannedBody, JournalExplorationSystem } from '@/services/journalReader';
import type { KnownStation, KnownSystem } from '@/store/types';
import { getStationTypeInfo } from '@/data/stationTypes';

// ─── Classification functions ────────────────────────────────────────

export function classifyStar(subType: string): string {
  // Handle raw journal format like "B_BlueWhiteSuperGiant" — normalize underscores + camelCase
  const normalized = subType.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
  const s = normalized.toLowerCase();
  if (s.includes('black hole')) return 'Black Hole';
  if (s.includes('neutron')) return 'Neutron Star';
  if (s.includes('wolf') || s.includes('rayet')) return 'Wolf-Rayet';
  if (s.includes('white dwarf')) return 'White Dwarf';
  if (s.includes('carbon') || s.includes('c star')) return 'Carbon Star';
  if (/^o\b/.test(s) || s.includes('o (') || s.includes('o blue')) return 'O-class';
  if (/^b\b/.test(s) || s.includes('b (') || s.includes('blue-white') || s.includes('blue white')) return 'B-class';
  if (/^a\b/.test(s) || s.includes('a (') || s.startsWith('a blue')) return 'A-class';
  if (/^f\b/.test(s) || s.includes('f (')) return 'F-class';
  if (/^g\b/.test(s) || s.includes('g (')) return 'G-class';
  if (/^k\b/.test(s) || s.includes('k (')) return 'K-class';
  if (/^m\b/.test(s) || s.includes('m (') || s.includes('red dwarf')) return 'M-class';
  if (s.includes('brown dwarf') || s.includes('t tauri') || /^[lty]\b/.test(s)) return 'Brown Dwarf';
  if (s.includes('super giant') || s.includes('supergiant') || s.includes('giant')) return 'B-class'; // fallback for unmatched giant types
  return normalized || 'Unknown';
}

export function classifyAtmo(atmo: string): string {
  const a = formatAtmoRaw(atmo).toLowerCase();
  if (a.includes('oxygen')) return 'Oxygen';
  if (a.includes('nitrogen')) return 'Nitrogen';
  if (a.includes('ammonia')) return 'Ammonia';
  if (a.includes('carbon dioxide')) return 'Carbon Dioxide';
  if (a.includes('sulphur') || a.includes('sulfur')) return 'Sulphur Dioxide';
  if (a.includes('water')) return 'Water';
  if (a.includes('methane')) return 'Methane';
  if (a.includes('argon')) return 'Argon';
  if (a.includes('helium')) return 'Helium';
  if (a.includes('neon')) return 'Neon';
  return atmo || 'Unknown';
}

export function classifyPlanet(body: JournalScannedBody): {
  type: string;
  isLandable: boolean;
  hasAtmo: boolean;
  hasRings: boolean;
  atmoType: string;
} {
  const sub = (body.subType || '').toLowerCase();
  const isLandable = !!body.isLandable;
  // Guard against empty string, "None", "No atmosphere", and null/undefined
  const rawAtmo = body.atmosphereType?.trim() || '';
  const isRealAtmo = rawAtmo !== '' && rawAtmo.toLowerCase() !== 'none' && rawAtmo.toLowerCase() !== 'no atmosphere';
  const hasAtmo = isRealAtmo;
  const hasRings = !!(body.rings && body.rings.length > 0);
  const atmoType = isRealAtmo ? classifyAtmo(rawAtmo) : '';

  let type: string;
  if (sub.includes('earth')) type = 'Earth-like World';
  else if (sub.includes('water world')) type = 'Water World';
  else if (sub.includes('ammonia')) type = 'Ammonia World';
  else if (sub.includes('gas giant')) type = 'Gas Giant';
  else if (isLandable && hasRings && hasAtmo) type = 'Ringed Atmospheric';
  else if (isLandable && hasRings) type = 'Ringed Landable';
  else if (isLandable && hasAtmo) type = 'Atmospheric Landable';
  else if (isLandable) type = 'Landable';
  else if (sub.includes('icy')) type = 'Icy Body';
  else if (sub.includes('rocky')) type = 'Rocky Body';
  else if (sub.includes('metal')) type = 'High Metal Content';
  else type = sub || 'Unknown';

  return { type, isLandable, hasAtmo, hasRings, atmoType };
}

// ─── Formatting utilities ────────────────────────────────────────────

export function formatAtmoRaw(raw: string): string {
  return raw.replace(/([a-z])([A-Z])/g, '$1 $2');
}

export function formatDistance(ls: number): string {
  if (ls < 1000) return `${ls.toFixed(0)} ls`;
  return `${(ls / 1000).toFixed(1)}K ls`;
}

export function formatGravity(mps2: number): string {
  return (mps2 / 9.81).toFixed(2) + 'g';
}

export function properCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function atmoStyle(type: string): { icon: string; color: string } {
  switch (type) {
    case 'Oxygen': return { icon: '\u{1F7E3}', color: 'text-violet-400' };
    case 'Nitrogen': return { icon: '\u{1F535}', color: 'text-blue-400' };
    case 'Ammonia': return { icon: '\u{1F7E2}', color: 'text-green-400' };
    case 'Carbon Dioxide': return { icon: '\u{1F7E1}', color: 'text-yellow-400' };
    case 'Sulphur Dioxide': return { icon: '\u{1F7E0}', color: 'text-orange-400' };
    case 'Water': return { icon: '\u{1F4A7}', color: 'text-cyan-400' };
    case 'Methane': return { icon: '\u{1F30B}', color: 'text-muted-foreground' };
    case 'Argon': return { icon: '\u{1F535}', color: 'text-indigo-300' };
    case 'Helium': return { icon: '\u{1F30B}', color: 'text-muted-foreground' };
    case 'Neon': return { icon: '\u{1F534}', color: 'text-red-400' };
    case 'None': return { icon: '\u2014', color: 'text-muted-foreground/50' };
    default: return { icon: '\u2753', color: 'text-muted-foreground' };
  }
}

// ─── Sort orders ─────────────────────────────────────────────────────

export const STAR_SORT_ORDER: Record<string, number> = {
  'Black Hole': 0,
  'Neutron Star': 1,
  'Wolf-Rayet': 2,
  'Carbon Star': 3,
  'O-class': 4,
  'B-class': 5,
  'White Dwarf': 6,
  'A-class': 7,
  'F-class': 8,
  'G-class': 9,
  'K-class': 10,
  'M-class': 11,
  'Brown Dwarf': 12,
  Unknown: 999,
};

export const STATION_SORT_ORDER: Record<string, number> = {
  'Dodec Spaceport': 0,
  'Coriolis Station': 1,
  'Orbis Station': 2,
  'Ocellus Station': 3,
  'Asteroid Base': 4,
  Megaship: 999, // not buildable — sort to bottom
  Outpost: 6,
  'Surface Port': 7,
  'Surface Station': 8,
  'Surface Outpost': 9,
  'Planetary Port': 10,
  'Planetary Outpost': 11,
  Settlement: 12,
  Installation: 13,
  Unknown: 999,
};

export const LANDABLE_SORT_ORDER: Record<string, number> = {
  'Ringed Atmospheric': 0,
  'Atmospheric Landable': 1,
  'Ringed Landable': 2,
  Landable: 3,
  Unknown: 999,
};

export const NONLANDABLE_SORT_ORDER: Record<string, number> = {
  'Earth-like World': 0,
  'Water World': 1,
  'Ammonia World': 2,
  'Gas Giant': 3,
  'High Metal Content': 4,
  'Rocky Body': 5,
  'Icy Body': 6,
  Unknown: 999,
};

export const ATMO_SORT_ORDER: Record<string, number> = {
  Oxygen: 0,
  Nitrogen: 1,
  Ammonia: 2,
  'Carbon Dioxide': 3,
  'Sulphur Dioxide': 4,
  Water: 5,
  Methane: 6,
  Argon: 7,
  Helium: 8,
  Neon: 9,
  None: 998,
  Unknown: 999,
};

// ─── Constants ───────────────────────────────────────────────────────

export const RARE_STAR_TYPES = new Set([
  'Black Hole',
  'Neutron Star',
  'Wolf-Rayet',
  'White Dwarf',
  'O-class',
  'Carbon Star',
]);

export const NOTABLE_STATION_LABELS = new Set([
  'Coriolis Station',
  'Orbis Station',
  'Ocellus Station',
  'Dodec Spaceport',
  'Asteroid Base',
  'Planetary Port',
  'Surface Station',
]);

// Default highlight lists for Settings — exported so store defaults and Settings UI can reference them
export const DEFAULT_HIGHLIGHT_STARS = [
  'Black Hole', 'Neutron Star', 'Wolf-Rayet', 'White Dwarf', 'O-class', 'Carbon Star',
];
export const DEFAULT_HIGHLIGHT_ATMOS = ['Oxygen'];
export const DEFAULT_HIGHLIGHT_STATIONS = [
  'Coriolis Station', 'Orbis Station', 'Ocellus Station', 'Dodec Spaceport',
  'Asteroid Base', 'Planetary Port',
];

// All known types for the settings UI toggles
export const ALL_STAR_TYPES = Object.keys(STAR_SORT_ORDER).filter((k) => k !== 'Unknown');
export const ALL_ATMO_TYPES = Object.keys(ATMO_SORT_ORDER).filter((k) => k !== 'Unknown' && k !== 'None');
export const ALL_STATION_TYPES = Object.keys(STATION_SORT_ORDER).filter((k) => k !== 'Unknown');

export const SOL = { x: 0, y: 0, z: 0 };

// ─── Data types ──────────────────────────────────────────────────────

export interface DomainBody {
  body: JournalScannedBody;
  systemName: string;
  classification: ReturnType<typeof classifyPlanet>;
}

export interface DomainStation {
  station: KnownStation;
  typeLabel: string;
  typeIcon: string;
  typeCategory: string;
}

export interface Showpiece {
  kind: 'star-system' | 'oxygen-world' | 'earth-like' | 'ringed-landable' | 'notable-station';
  title: string;
  subtitle: string;
  systemName: string;
  icon: string;
  color: string; // tailwind text color class
  galleryKey?: string;
  bodies?: string[]; // body names for star systems
}

export interface DomainData {
  colonyCount: number;
  totalStars: number;
  totalPlanets: number;
  totalLandable: number;
  totalStations: number;
  totalPopulation: number;
  showpieces: Showpiece[];
  starsByType: Map<string, { bodies: { bodyName: string; systemName: string; subType: string }[]; systems: Set<string> }>;
  landableByType: Map<string, DomainBody[]>;
  landableByAtmo: Map<string, DomainBody[]>;
  nonLandableByType: Map<string, DomainBody[]>;
  stationsByType: Map<string, DomainStation[]>;
  // Territorial
  nearestSol: number;
  farthestSol: number;
  nearestSolName: string;
  farthestSolName: string;
  nearestHome: number;
  farthestHome: number;
  nearestHomeName: string;
  farthestHomeName: string;
}

// ─── Internal helpers ────────────────────────────────────────────────

function distance3d(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

// ─── Aggregation function ────────────────────────────────────────────

export function aggregateDomainData(
  colonyNames: Set<string>,
  knownSystems: Record<string, KnownSystem>,
  knownStations: Record<number, KnownStation>,
  journalExplorationCache: Record<number, JournalExplorationSystem>,
  settings: { homeSystem?: string; domainHighlightStars?: string[]; domainHighlightAtmos?: string[]; domainHighlightStations?: string[] },
): DomainData {
  // Configurable highlight sets (fall back to defaults if settings don't have them yet)
  const highlightStars = new Set(settings.domainHighlightStars ?? DEFAULT_HIGHLIGHT_STARS);
  const highlightAtmos = new Set(settings.domainHighlightAtmos ?? DEFAULT_HIGHLIGHT_ATMOS);
  const highlightStations = new Set(settings.domainHighlightStations ?? DEFAULT_HIGHLIGHT_STATIONS);

  const starsByType = new Map<string, { bodies: { bodyName: string; systemName: string; subType: string }[]; systems: Set<string> }>();
  const landableByType = new Map<string, DomainBody[]>();
  const landableByAtmo = new Map<string, DomainBody[]>();
  const nonLandableByType = new Map<string, DomainBody[]>();
  const stationsByType = new Map<string, DomainStation[]>();

  let totalStars = 0;
  let totalPlanets = 0;
  let totalLandable = 0;
  let totalStations = 0;
  let totalPopulation = 0;

  const showpieces: Showpiece[] = [];

  // Distance tracking
  let nearestSol = Infinity;
  let farthestSol = 0;
  let nearestSolName = '';
  let farthestSolName = '';
  let nearestHome = Infinity;
  let farthestHome = 0;
  let nearestHomeName = '';
  let farthestHomeName = '';

  const homeCoords = settings.homeSystem
    ? knownSystems[settings.homeSystem.toLowerCase()]?.coordinates || null
    : null;

  // Per-system star tracking for showpieces
  const systemRareStars: Record<string, string[]> = {};

  for (const systemNameLower of colonyNames) {
    const kb = knownSystems[systemNameLower];
    const displayName = kb?.systemName || systemNameLower;
    if (kb?.population) totalPopulation += kb.population;

    // Distances
    if (kb?.coordinates) {
      const distSol = distance3d(kb.coordinates, SOL);
      if (distSol < nearestSol) { nearestSol = distSol; nearestSolName = displayName; }
      if (distSol > farthestSol) { farthestSol = distSol; farthestSolName = displayName; }
      if (homeCoords) {
        const distHome = distance3d(kb.coordinates, homeCoords);
        if (distHome < nearestHome) { nearestHome = distHome; nearestHomeName = displayName; }
        if (distHome > farthestHome) { farthestHome = distHome; farthestHomeName = displayName; }
      }
    }

    // Body data from journal exploration cache
    const addr = kb?.systemAddress;
    const exploData = addr ? journalExplorationCache[addr] : null;
    systemRareStars[displayName] = [];

    if (exploData) {
      for (const body of exploData.scannedBodies) {
        if (body.type === 'Star') {
          totalStars++;
          const cls = classifyStar(body.subType);

          if (!starsByType.has(cls)) starsByType.set(cls, { bodies: [], systems: new Set() });
          const entry = starsByType.get(cls)!;
          entry.bodies.push({ bodyName: body.bodyName, systemName: displayName, subType: body.subType });
          entry.systems.add(displayName);

          if (highlightStars.has(cls)) {
            systemRareStars[displayName].push(cls);
          }
        } else if (body.type === 'Planet') {
          totalPlanets++;
          const info = classifyPlanet(body);
          const domainBody: DomainBody = { body, systemName: displayName, classification: info };

          if (info.isLandable) {
            totalLandable++;

            // By type
            if (!landableByType.has(info.type)) landableByType.set(info.type, []);
            landableByType.get(info.type)!.push(domainBody);

            // By atmosphere
            const atmoKey = info.hasAtmo ? info.atmoType : 'None';
            if (!landableByAtmo.has(atmoKey)) landableByAtmo.set(atmoKey, []);
            landableByAtmo.get(atmoKey)!.push(domainBody);

            // Showpieces: highlighted atmosphere types
            if (info.atmoType && highlightAtmos.has(info.atmoType)) {
              const aStyle = atmoStyle(info.atmoType);
              showpieces.push({
                kind: 'oxygen-world',
                title: `${info.atmoType} World`,
                subtitle: body.bodyName,
                systemName: displayName,
                icon: aStyle.icon,
                color: aStyle.color,
                galleryKey: `system:${displayName.toLowerCase()}:body:${body.bodyName.toLowerCase()}`,
              });
            }

            // Showpieces: ringed landable
            if (info.hasRings) {
              showpieces.push({
                kind: 'ringed-landable',
                title: 'Ringed Landable',
                subtitle: body.bodyName,
                systemName: displayName,
                icon: '\u{1F48D}',
                color: 'text-pink-400',
                galleryKey: `system:${displayName.toLowerCase()}:body:${body.bodyName.toLowerCase()}`,
              });
            }
          } else {
            // Non-landable
            if (!nonLandableByType.has(info.type)) nonLandableByType.set(info.type, []);
            nonLandableByType.get(info.type)!.push(domainBody);

            // Showpieces: Earth-likes
            if (info.type === 'Earth-like World') {
              showpieces.push({
                kind: 'earth-like',
                title: 'Earth-like World',
                subtitle: body.bodyName,
                systemName: displayName,
                icon: '\u{1F30D}',
                color: 'text-green-400',
                galleryKey: `system:${displayName.toLowerCase()}:body:${body.bodyName.toLowerCase()}`,
              });
            }

            // Water worlds — tracked in Other Bodies but not showpieces (can't land/build)
          }
        }
      }
    }
  }

  // Showpieces: systems with rare stars
  for (const [system, rareStars] of Object.entries(systemRareStars)) {
    if (rareStars.length > 0) {
      const unique = [...new Set(rareStars)];
      showpieces.push({
        kind: 'star-system',
        title: rareStars.length > 1 ? `${rareStars.length} Rare Stars` : unique[0],
        subtitle: unique.join(', '),
        systemName: system,
        icon: rareStars.length > 1 ? '\u{1F31F}' : '\u2B50',
        color: rareStars.length > 1 ? 'text-yellow-400' : 'text-purple-400',
        galleryKey: `system:${system.toLowerCase()}`,
        bodies: rareStars,
      });
    }
  }

  // Stations — knownStations is keyed by marketId
  const colonyStations: KnownStation[] = [];
  for (const station of Object.values(knownStations)) {
    if (!station.systemName) continue;
    if (!colonyNames.has(station.systemName.toLowerCase())) continue;
    const st = station.stationType.toLowerCase();
    if (st.includes('fleetcarrier') || st.includes('construction')) continue;
    // Filter out temporary colonisation ships
    if (st.includes('colonisation') || station.stationName.toLowerCase().includes('colonisation') || station.stationName.includes('$EXT_PANEL')) continue;
    colonyStations.push(station);
  }

  for (const station of colonyStations) {
    totalStations++;
    const info = getStationTypeInfo(station.stationType);
    const domainStation: DomainStation = {
      station,
      typeLabel: info.label,
      typeIcon: info.icon,
      typeCategory: info.category,
    };

    if (!stationsByType.has(info.label)) stationsByType.set(info.label, []);
    stationsByType.get(info.label)!.push(domainStation);

    // Showpieces: highlighted stations
    if (highlightStations.has(info.label)) {
      showpieces.push({
        kind: 'notable-station',
        title: info.label,
        subtitle: station.stationName,
        systemName: station.systemName,
        icon: info.icon,
        color: 'text-orange-400',
        galleryKey: `system:${station.systemName.toLowerCase()}:station:${station.stationName.toLowerCase()}`,
      });
    }
  }

  return {
    colonyCount: colonyNames.size,
    totalStars,
    totalPlanets,
    totalLandable,
    totalStations,
    totalPopulation,
    showpieces,
    starsByType,
    landableByType,
    landableByAtmo,
    nonLandableByType,
    stationsByType,
    nearestSol,
    farthestSol,
    nearestSolName,
    farthestSolName,
    nearestHome,
    farthestHome,
    nearestHomeName,
    farthestHomeName,
  };
}

// ─── Domain Records (superlatives) ─────────────────────────────────

export interface DomainRecord {
  label: string;
  icon: string;
  bodyName: string;
  systemName: string;
  value: string; // formatted display value
  rawValue: number; // for sorting
}

export function computeDomainRecords(
  explorationData: Record<number, JournalExplorationSystem>,
  colonySystems: Set<string>,
  knownSystems: Record<string, KnownSystem>,
): DomainRecord[] {
  const records: DomainRecord[] = [];

  // Collect all bodies from colony systems
  interface BodyWithSystem { body: JournalScannedBody; systemName: string }
  const allBodies: BodyWithSystem[] = [];

  for (const sys of Object.values(explorationData)) {
    const sysName = sys.systemName || '';
    if (!colonySystems.has(sysName.toLowerCase())) continue;
    for (const body of sys.scannedBodies) {
      allBodies.push({ body, systemName: sysName });
    }
  }

  if (allBodies.length === 0) return records;

  // Helper to add a record
  const add = (label: string, icon: string, b: BodyWithSystem, value: string, rawValue: number) => {
    records.push({ label, icon, bodyName: b.body.bodyName, systemName: b.systemName, value, rawValue });
  };

  // --- Stars ---
  const stars = allBodies.filter((b) => b.body.type === 'Star' && b.body.stellarMass != null);
  if (stars.length > 0) {
    const largest = stars.reduce((a, b) => (b.body.stellarMass! > a.body.stellarMass!) ? b : a);
    add('Largest Star', '\u{2B50}', largest, `${largest.body.stellarMass!.toFixed(2)} M\u{2609}`, largest.body.stellarMass!);

    const smallest = stars.reduce((a, b) => (b.body.stellarMass! < a.body.stellarMass!) ? b : a);
    if (smallest.body.bodyName !== largest.body.bodyName) {
      add('Smallest Star', '\u{1F31F}', smallest, `${smallest.body.stellarMass!.toFixed(4)} M\u{2609}`, smallest.body.stellarMass!);
    }

    const hottestStars = stars.filter((b) => b.body.surfaceTemperature != null);
    if (hottestStars.length > 0) {
      const hottest = hottestStars.reduce((a, b) => (b.body.surfaceTemperature! > a.body.surfaceTemperature!) ? b : a);
      add('Hottest Star', '\u{1F525}', hottest, `${Math.round(hottest.body.surfaceTemperature!).toLocaleString()} K`, hottest.body.surfaceTemperature!);
    }

    // Brightest star — prefer absolute magnitude (lower = brighter); fall back
    // to R²×T⁴ (Stefan-Boltzmann luminosity proxy) for bodies without magnitude.
    const starsWithMag = stars.filter((b) => b.body.absoluteMagnitude != null);
    if (starsWithMag.length > 0) {
      const brightest = starsWithMag.reduce((a, b) => (b.body.absoluteMagnitude! < a.body.absoluteMagnitude!) ? b : a);
      // Display lower-is-brighter as-is so astronomers feel at home
      add('Brightest Star', '\u{1F31F}', brightest,
        `mag ${brightest.body.absoluteMagnitude!.toFixed(2)}`,
        // Sort by "brightness" so bigger rawValue = more notable:
        // invert magnitude so higher = brighter for consistent ranking
        -brightest.body.absoluteMagnitude!);
    } else {
      // Fallback: relative luminosity from radius + temperature (proportional, not absolute)
      const starsWithRT = stars.filter((b) => b.body.radius != null && b.body.surfaceTemperature != null);
      if (starsWithRT.length > 0) {
        const lum = (b: BodyWithSystem) => {
          const r = b.body.radius!;
          const t = b.body.surfaceTemperature!;
          return r * r * t * t * t * t;
        };
        const brightest = starsWithRT.reduce((a, b) => (lum(b) > lum(a)) ? b : a);
        // Normalize against the Sun (R=6.957e8 m, T=5778 K) for a "solar luminosities" label
        const solarLum = 6.957e8 * 6.957e8 * 5778 * 5778 * 5778 * 5778;
        const ratio = lum(brightest) / solarLum;
        const label = ratio >= 100 ? `${Math.round(ratio).toLocaleString()} L\u{2609}` : `${ratio.toFixed(2)} L\u{2609}`;
        add('Brightest Star', '\u{1F31F}', brightest, label, ratio);
      }
    }
  }

  // --- Landable with atmosphere ---
  const landableAtmo = allBodies.filter((b) => b.body.type === 'Planet' && b.body.isLandable && b.body.atmosphereType && !/none|unknown/i.test(b.body.atmosphereType));

  if (landableAtmo.length > 0) {
    // Thickest atmosphere
    const withPressure = landableAtmo.filter((b) => b.body.surfacePressure != null && b.body.surfacePressure > 0);
    if (withPressure.length > 0) {
      const thickest = withPressure.reduce((a, b) => (b.body.surfacePressure! > a.body.surfacePressure!) ? b : a);
      add('Thickest Atmosphere', '\u{1F32B}\u{FE0F}', thickest, `${thickest.body.surfacePressure!.toFixed(0)} Pa`, thickest.body.surfacePressure!);
    }

    // Largest atmospheric landable (by radius)
    const withRadius = landableAtmo.filter((b) => b.body.radius != null && b.body.radius > 0);
    if (withRadius.length > 0) {
      const largest = withRadius.reduce((a, b) => (b.body.radius! > a.body.radius!) ? b : a);
      add('Largest Atmo Landable', '\u{1F30D}', largest, `${(largest.body.radius! / 1000).toFixed(0)} km`, largest.body.radius!);

      const smallest = withRadius.reduce((a, b) => (b.body.radius! < a.body.radius!) ? b : a);
      if (smallest.body.bodyName !== largest.body.bodyName) {
        add('Smallest Atmo Landable', '\u{1FA90}', smallest, `${(smallest.body.radius! / 1000).toFixed(0)} km`, smallest.body.radius!);
      }
    }
  }

  // --- All landables ---
  const landables = allBodies.filter((b) => b.body.type === 'Planet' && b.body.isLandable);

  if (landables.length > 0) {
    // Highest gravity
    const withGravity = landables.filter((b) => b.body.gravity != null && b.body.gravity > 0);
    if (withGravity.length > 0) {
      const highest = withGravity.reduce((a, b) => (b.body.gravity! > a.body.gravity!) ? b : a);
      add('Highest Gravity', '\u{2B07}\u{FE0F}', highest, `${(highest.body.gravity! / 9.81).toFixed(3)}g`, highest.body.gravity!);

      const lowest = withGravity.reduce((a, b) => (b.body.gravity! < a.body.gravity!) ? b : a);
      if (lowest.body.bodyName !== highest.body.bodyName) {
        add('Lowest Gravity', '\u{1F3CB}\u{FE0F}', lowest, `${(lowest.body.gravity! / 9.81).toFixed(3)}g`, lowest.body.gravity!);
      }
    }

    // Closest to arrival star
    const withDist = landables.filter((b) => b.body.distanceToArrival != null && b.body.distanceToArrival > 0);
    if (withDist.length > 0) {
      const closest = withDist.reduce((a, b) => (b.body.distanceToArrival < a.body.distanceToArrival) ? b : a);
      add('Closest to Star', '\u{2600}\u{FE0F}', closest, `${closest.body.distanceToArrival.toFixed(0)} ls`, closest.body.distanceToArrival);
    }

    // Closest orbital distance to parent body (tightest orbit)
    const withSMA = landables.filter((b) => b.body.semiMajorAxis != null && b.body.semiMajorAxis > 0);
    if (withSMA.length > 0) {
      const tightest = withSMA.reduce((a, b) => (b.body.semiMajorAxis! < a.body.semiMajorAxis!) ? b : a);
      const smaLS = tightest.body.semiMajorAxis! / 299792458; // metres to light-seconds
      const smaDisplay = smaLS < 1 ? `${(tightest.body.semiMajorAxis! / 1000).toFixed(0)} km` : `${smaLS.toFixed(1)} ls`;
      add('Tightest Orbit', '\u{1F300}', tightest, smaDisplay, tightest.body.semiMajorAxis!);
    }

    // Hottest / Coolest landable
    const withTemp = landables.filter((b) => b.body.surfaceTemperature != null);
    if (withTemp.length > 0) {
      const hottest = withTemp.reduce((a, b) => (b.body.surfaceTemperature! > a.body.surfaceTemperature!) ? b : a);
      add('Hottest Surface', '\u{1F321}\u{FE0F}', hottest, `${Math.round(hottest.body.surfaceTemperature!)} K`, hottest.body.surfaceTemperature!);

      const coldest = withTemp.reduce((a, b) => (b.body.surfaceTemperature! < a.body.surfaceTemperature!) ? b : a);
      if (coldest.body.bodyName !== hottest.body.bodyName) {
        add('Coldest Surface', '\u{2744}\u{FE0F}', coldest, `${Math.round(coldest.body.surfaceTemperature!)} K`, coldest.body.surfaceTemperature!);
      }
    }
  }

  // --- Largest ring ---
  // Stars can have belt clusters but those are not "rings" in the user-facing
  // sense. Only consider planet rings.
  const withRings = allBodies.filter((b) => b.body.type === 'Planet' && b.body.rings && b.body.rings.length > 0);
  if (withRings.length > 0) {
    let bestRing: { bws: BodyWithSystem; ring: NonNullable<JournalScannedBody['rings']>[0]; outerRad: number } | null = null;
    for (const bws of withRings) {
      for (const ring of bws.body.rings!) {
        if (ring.outerRad && (!bestRing || ring.outerRad > bestRing.outerRad)) {
          bestRing = { bws, ring, outerRad: ring.outerRad };
        }
      }
    }
    if (bestRing) {
      const radiusLS = bestRing.outerRad / 299792458;
      const display = radiusLS < 0.01 ? `${(bestRing.outerRad / 1000).toFixed(0)} km` : `${radiusLS.toFixed(2)} ls`;
      const ringClass = bestRing.ring.ringClass?.match(/Ring_(\w+)_\w+$/)?.[1]
        ?? (/ Belt/i.test(bestRing.ring.name) ? 'Belt' : 'Ring');
      // Parent body name = ring name with system prefix + trailing ring-type suffix stripped
      const sys = bestRing.bws.systemName;
      let parentBody = bestRing.ring.name;
      if (parentBody.startsWith(sys + ' ')) parentBody = parentBody.slice(sys.length + 1);
      parentBody = parentBody.replace(/ [A-G] Ring$/i, '').replace(/ Belt Cluster \d+$/i, '').replace(/ Belt$/i, '').trim();
      // Swap in a fabricated BodyWithSystem using the parent's proper name
      const labeledBws: BodyWithSystem = {
        body: { ...bestRing.bws.body, bodyName: parentBody ? `${sys} ${parentBody}` : bestRing.bws.body.bodyName },
        systemName: sys,
      };
      add('Largest Ring', '\u{1F48D}', labeledBws, `${display} (${ringClass})`, bestRing.outerRad);
    }
  }

  return records;
}
