/**
 * Mapping of raw journal StationType strings to display info.
 * Used for user-friendly station type display throughout the app.
 */
import { getInstallationTypeById } from './installationTypes';

export interface StationTypeInfo {
  /** User-friendly label */
  label: string;
  /** Short label for tight spaces */
  shortLabel: string;
  /** Unicode icon */
  icon: string;
  /** Broad category for grouping */
  category: 'orbital' | 'surface' | 'outpost' | 'settlement' | 'carrier' | 'megaship' | 'other';
  /** Whether to show this station type in system overviews (hide settlements by default) */
  showInSystemOverview: boolean;
}

const STATION_TYPE_MAP: Record<string, StationTypeInfo> = {
  // Orbital stations (large)
  Coriolis: {
    label: 'Coriolis Station',
    shortLabel: 'Station',
    icon: '\u{1F6F0}', // satellite
    category: 'orbital',
    showInSystemOverview: true,
  },
  Orbis: {
    label: 'Orbis Station',
    shortLabel: 'Station',
    icon: '\u{1F6F0}',
    category: 'orbital',
    showInSystemOverview: true,
  },
  Ocellus: {
    label: 'Ocellus Station',
    shortLabel: 'Station',
    icon: '\u{1F6F0}',
    category: 'orbital',
    showInSystemOverview: true,
  },
  // Dodecahedron — newer large station type
  StationDodec: {
    label: 'Dodec Spaceport',
    shortLabel: 'Dodec',
    icon: '\u{1F6F0}',
    category: 'orbital',
    showInSystemOverview: true,
  },
  // Asteroid base
  AsteroidBase: {
    label: 'Asteroid Base',
    shortLabel: 'Asteroid',
    icon: '\u2604',
    category: 'orbital',
    showInSystemOverview: true,
  },

  // Outposts (medium pads max)
  Outpost: {
    label: 'Outpost',
    shortLabel: 'Outpost',
    icon: '\u{1F4E1}', // antenna
    category: 'outpost',
    showInSystemOverview: true,
  },

  // Surface ports & outposts
  CraterPort: {
    label: 'Surface Port',
    shortLabel: 'Surface',
    icon: '\u{1FA90}', // ringed planet / surface
    category: 'surface',
    showInSystemOverview: true,
  },
  CraterOutpost: {
    label: 'Surface Outpost',
    shortLabel: 'Surface',
    icon: '\u{1FA90}',
    category: 'surface',
    showInSystemOverview: true,
  },

  // Planetary port & outpost (alternate journal names)
  PlanetaryPort: {
    label: 'Planetary Port',
    shortLabel: 'Planet',
    icon: '\u{1FA90}',
    category: 'surface',
    showInSystemOverview: true,
  },
  PlanetaryOutpost: {
    label: 'Planetary Outpost',
    shortLabel: 'Planet',
    icon: '\u{1FA90}',
    category: 'surface',
    showInSystemOverview: true,
  },
  SurfaceOutpost: {
    label: 'Surface Outpost',
    shortLabel: 'Surface',
    icon: '\u{1FA90}',
    category: 'surface',
    showInSystemOverview: true,
  },

  // On-foot settlements
  OnFootSettlement: {
    label: 'Settlement',
    shortLabel: 'Settle',
    icon: '\u{1F3D8}', // houses/settlement
    category: 'settlement',
    showInSystemOverview: false,
  },

  // Fleet Carrier
  FleetCarrier: {
    label: 'Fleet Carrier',
    shortLabel: 'FC',
    icon: '\u2693', // anchor
    category: 'carrier',
    showInSystemOverview: true,
  },

  // Megaships & installations
  MegaShip: {
    label: 'Megaship',
    shortLabel: 'Megaship',
    icon: '\u{1F6A2}', // ship
    category: 'megaship',
    showInSystemOverview: true,
  },
  Installation: {
    label: 'Installation',
    shortLabel: 'Installation',
    icon: '\u2699', // gear
    category: 'other',
    showInSystemOverview: true,
  },

  // Surface stations (large pads)
  SurfaceStation: {
    label: 'Surface Station',
    shortLabel: 'Surface',
    icon: '\u{1FA90}',
    category: 'surface',
    showInSystemOverview: true,
  },

  // Construction depots (colonization)
  SpaceConstructionDepot: {
    label: 'Orbital Construction Depot',
    shortLabel: 'Construct',
    icon: '\u{1F6A7}', // construction sign
    category: 'orbital',
    showInSystemOverview: true,
  },
  OrbitalConstructionDepot: {
    label: 'Orbital Construction Depot',
    shortLabel: 'Construct',
    icon: '\u{1F6A7}',
    category: 'orbital',
    showInSystemOverview: true,
  },
  PlanetaryConstructionDepot: {
    label: 'Planetary Construction Depot',
    shortLabel: 'Construct',
    icon: '\u{1F6A7}',
    category: 'surface',
    showInSystemOverview: true,
  },
  SurfaceConstructionDepot: {
    label: 'Surface Construction Depot',
    shortLabel: 'Construct',
    icon: '\u{1F6A7}',
    category: 'surface',
    showInSystemOverview: true,
  },
};

/**
 * Get station type display info from a raw journal StationType string or installation type ID.
 * Falls back to a generic entry if the type is unknown.
 */
export function getStationTypeInfo(stationType: string): StationTypeInfo {
  // Direct journal type match
  if (STATION_TYPE_MAP[stationType]) return STATION_TYPE_MAP[stationType];

  // Case-insensitive fallback (journal sometimes uses different casing)
  const lower = stationType.toLowerCase();
  for (const [key, info] of Object.entries(STATION_TYPE_MAP)) {
    if (key.toLowerCase() === lower) return info;
  }
  // Partial match for dodec variants
  if (lower.includes('dodec')) return STATION_TYPE_MAP['StationDodec'];

  // Check if it's an installation type ID (e.g. "coriolis_starport")
  const instType = getInstallationTypeById(stationType);
  if (instType) {
    // Try to borrow the canonical icon/category from a matching journal-type entry,
    // but ALWAYS use the specific instType's name so sub-types stay distinguishable.
    let borrowedIcon: string | undefined;
    let borrowedCategory: StationTypeInfo['category'] | undefined;
    if (instType.journalTypes?.length) {
      for (const jt of instType.journalTypes) {
        if (STATION_TYPE_MAP[jt]) {
          borrowedIcon = STATION_TYPE_MAP[jt].icon;
          borrowedCategory = STATION_TYPE_MAP[jt].category;
          break;
        }
      }
    }
    const category: StationTypeInfo['category'] = borrowedCategory ??
      (instType.location === 'Surface'
        ? (instType.padSize ? 'surface' : 'settlement')
        : (instType.padSize === 'L' ? 'orbital' : instType.padSize === 'M' ? 'outpost' : 'other'));
    const icon = borrowedIcon ?? (instType.padSize === null ? '\u2699'  // gear for installations
      : instType.location === 'Orbital' && instType.padSize === 'L' ? '\u{1F6F0}'  // satellite
      : instType.location === 'Orbital' ? '\u{1F4E1}'  // antenna
      : '\u{1FA90}');  // ringed planet for surface
    return {
      label: instType.name,
      shortLabel: instType.name.length > 14
        ? instType.name.split(/[:\s]/).filter(Boolean).slice(0, 2).join(' ')
        : instType.name,
      icon,
      category,
      showInSystemOverview: true,
    };
  }

  return {
    label: stationType ? stationType.replace(/([a-z])([A-Z])/g, '$1 $2') : 'Unknown',
    shortLabel: stationType ? stationType.replace(/([a-z])([A-Z])/g, '$1 $2') : '?',
    icon: '\u2B50',
    category: 'other' as const,
    showInSystemOverview: true,
  };
}

/**
 * Station types available in user-facing dropdowns (for editing/completing projects).
 * Excludes construction depots, fleet carriers, and duplicate journal aliases.
 */
export const EDITABLE_STATION_TYPES: { value: string; label: string }[] = [
  { value: 'Coriolis', label: 'Coriolis Station' },
  { value: 'Orbis', label: 'Orbis Station' },
  { value: 'Ocellus', label: 'Ocellus Station' },
  { value: 'StationDodec', label: 'Dodec Spaceport' },
  { value: 'Outpost', label: 'Outpost' },
  { value: 'AsteroidBase', label: 'Asteroid Base' },
  { value: 'CraterPort', label: 'Surface Port' },
  { value: 'CraterOutpost', label: 'Surface Outpost' },
  { value: 'SurfaceStation', label: 'Surface Station' },
  { value: 'Installation', label: 'Installation' },
  { value: 'MegaShip', label: 'Megaship' },
  { value: 'OnFootSettlement', label: 'Settlement' },
];

/**
 * Resolve a station type for display. Maps construction depot types to their
 * likely result category (orbital → Coriolis, surface → CraterPort).
 * Use when showing completed projects that may still have the depot type.
 */
export function resolveStationType(completedType: string | null, rawType: string | null): string {
  if (completedType) return completedType;
  if (!rawType) return 'Unknown';
  // Construction depots → sensible defaults
  if (rawType === 'SpaceConstructionDepot' || rawType === 'OrbitalConstructionDepot') return 'Coriolis';
  if (rawType === 'PlanetaryConstructionDepot' || rawType === 'SurfaceConstructionDepot') return 'CraterPort';
  return rawType;
}

/**
 * Get just the icon for a station type.
 */
export function getStationTypeIcon(stationType: string): string {
  return getStationTypeInfo(stationType).icon;
}

/**
 * Get station types that should be shown in system overview.
 */
export function shouldShowInOverview(stationType: string): boolean {
  return getStationTypeInfo(stationType).showInSystemOverview;
}
