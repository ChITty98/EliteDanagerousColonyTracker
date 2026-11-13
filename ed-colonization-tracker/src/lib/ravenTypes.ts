/**
 * Raven Colonial build types by any station-type string the app meets (1.60.28).
 *
 * Raven's table (src/data/ravenBuildTypes.json) keys each build by display name, tier and
 * orbital/surface; the app meets the same builds as installation ids ("refinery_hub"), journal
 * StationTypes ("CraterOutpost", and the generic "Outpost" / "SurfaceStation" every colony primary
 * is written as), FSS signal types and Spansh strings. This maps them, using the dossier's economy
 * to tell apart the outposts the journal does not name (a High Tech outpost is a scientific one,
 * a Military one military). Pure; the mapping the 2026-10-05 ranking scripts did by hand.
 */
import ravenBuildTypesJson from '@/data/ravenBuildTypes.json';

export interface RavenEffects { pop: number; mpop: number; sec: number; wealth: number; tech: number; sol: number; dev: number }
export interface RavenBuildType {
  displayName: string;
  displayName2?: string;
  subTypes?: string[];
  haul: number;
  buildClass?: string;
  tier: number;
  padSize?: string;
  orbital: boolean;
  inf?: string;
  effects: RavenEffects;
}

const RAW = ravenBuildTypesJson as unknown as RavenBuildType[] | Record<string, RavenBuildType>;
export const RAVEN_BUILD_TYPES: RavenBuildType[] = (Array.isArray(RAW) ? RAW : Object.values(RAW)).filter((e) => e && e.tier > 0);

function pick(displayName: string, orbital?: boolean, tier?: number): RavenBuildType | null {
  return RAVEN_BUILD_TYPES.find((e) => e.displayName === displayName && (orbital === undefined || e.orbital === orbital) && (tier === undefined || e.tier === tier)) ?? null;
}

const norm = (t: string | null | undefined) => String(t ?? '').toLowerCase().replace(/[\s_\-'’]/g, '');

export type EconomyKind = 'hightech' | 'military' | 'industrial' | 'agriculture' | 'extraction' | 'refinery' | 'tourism' | 'colony';

/** The economy a dossier string names: "$economy_HighTech;", "High Tech", "Military"… */
export function economyKind(hint: string | null | undefined): EconomyKind | null {
  const h = String(hint ?? '').toLowerCase();
  if (!h) return null;
  if (/hightech|high tech/.test(h)) return 'hightech';
  if (/military/.test(h)) return 'military';
  if (/industrial/.test(h)) return 'industrial';
  if (/agri/.test(h)) return 'agriculture';
  if (/extraction/.test(h)) return 'extraction';
  if (/refinery/.test(h)) return 'refinery';
  if (/touris/.test(h)) return 'tourism';
  if (/colony|service/.test(h)) return 'colony';
  return null;
}

/**
 * The Raven build for a station-type string, or null when the type carries no Raven entry
 * (carriers, megaships, construction depots, blank or unresolvable types).
 * @param economyHint the dossier's primary economy, used for the journal's generic outposts
 */
export function ravenFor(stationType: string | null | undefined, economyHint?: string | null): RavenBuildType | null {
  const t = norm(stationType);
  const eco = economyKind(economyHint);
  if (!t || t === 'unknown') return null;
  if (/carrier|squadron|megaship|drakeclass|construction|colonisationship|colonizationship/.test(t)) return null;
  if (/largeplanetaryport|craterport|planetaryport/.test(t)) return pick('Planetary port');
  if (/dodec/.test(t)) return pick('Dodec');
  if (/coriolis/.test(t)) return pick('Coriolis');
  if (/asteroid/.test(t)) return pick('Asteroid base');
  if (/orbis|oneil/.test(t)) return pick('Orbis');
  if (/ocellus|bernal/.test(t)) return pick('Ocellus');
  // surface outposts
  if (/civiliansurfaceoutpost/.test(t)) return pick('Civilian', false, 1);
  if (/industrialsurfaceoutpost/.test(t)) return pick('Industrial', false, 1);
  if (/scientificsurfaceoutpost/.test(t)) return pick('Scientific', false, 1);
  if (/crateroutpost|planetaryoutpost|surfaceoutpost/.test(t)) {
    if (eco === 'hightech') return pick('Scientific', false, 1);
    if (eco === 'industrial') return pick('Industrial', false, 1);
    return pick('Civilian', false, 1);
  }
  // orbital outposts
  if (/civilianoutpost/.test(t)) return pick('Civilian', true, 1);
  if (/commercialoutpost/.test(t)) return pick('Commercial');
  if (/industrialoutpost/.test(t)) return pick('Industrial', true, 1);
  if (/militaryoutpost/.test(t)) return pick('Military', true, 1);
  if (/scientificoutpost/.test(t)) return pick('Scientific', true);
  if (/pirateoutpost|criminaloutpost/.test(t)) return pick('Pirate');
  if (t === 'outpost' || t === 'surfacestation' || t === 'stationoutpost') {
    // the journal's generic orbital outpost — every colony primary; the dossier's economy names it
    if (eco === 'hightech') return pick('Scientific', true);
    if (eco === 'military') return pick('Military', true, 1);
    if (eco === 'industrial') return pick('Industrial', true, 1);
    if (eco === 'colony') return pick('Civilian', true, 1);
    return pick('Commercial');
  }
  // settlements
  if (/settlement/.test(t)) {
    const size = /small/.test(t) ? 'Small' : /medium/.test(t) ? 'Medium' : /large/.test(t) ? 'Large' : null;
    const kind = /agricultur/.test(t) ? 'Agriculture' : /mining|extraction/.test(t) ? 'Mining' : /industrial/.test(t) ? 'Industrial' : /military/.test(t) ? 'Military' : /bio/.test(t) ? 'Bio' : /touris/.test(t) ? 'Tourist' : null;
    return size && kind ? pick(`${size} ${kind}`) : null; // "OnFootSettlement" / "Settlement" carry neither
  }
  // hubs
  if (/refineryhub/.test(t)) return pick('Refinery');
  if (/industrialhub/.test(t)) return pick('Industrial', false, 2);
  if (/extractionhub/.test(t)) return pick('Extraction');
  if (/civilianhub/.test(t)) return pick('Civilian', false, 2);
  if (/explorationhub/.test(t)) return pick('Exploration');
  if (/outposthub/.test(t)) return pick('Outpost');
  if (/scientifichub/.test(t)) return pick('Scientific', false, 2);
  if (/militaryhub/.test(t)) return pick('Military', false, 2);
  if (/hightechhub/.test(t)) return pick('High Tech');
  // installations
  if (/satellite/.test(t)) return pick('Satellite');
  if (/communication/.test(t)) return pick('Communication');
  if (/spacefarm/.test(t)) return pick('Space Farm');
  if (/piratebase/.test(t)) return pick('Pirate Base');
  if (/mining/.test(t)) return pick('Mining', true);
  if (/relay/.test(t)) return pick('Relay');
  if (/militaryinstallation/.test(t)) return pick('Military', true, 2);
  if (/security/.test(t)) return pick('Security');
  if (/government/.test(t)) return pick('Government');
  if (/medical/.test(t)) return pick('Medical');
  if (/research/.test(t)) return pick('Research');
  if (/tourist/.test(t)) return pick('Tourist');
  if (/bar/.test(t)) return pick('Bar');
  return null;
}

/**
 * The app's installation id for the journal's generic outpost types, from the economy: the
 * dossier's "Outpost" or "SurfaceStation" with a Military economy is a military outpost, High
 * Tech a scientific one, Industrial an industrial one, anything else commercial. Other types
 * come back unchanged.
 */
export function resolveGenericOutpost(stationType: string | null | undefined, economyHint?: string | null): string {
  const t = norm(stationType);
  if (t !== 'outpost' && t !== 'surfacestation') return String(stationType ?? '');
  const eco = economyKind(economyHint);
  if (eco === 'hightech') return 'scientific_outpost';
  if (eco === 'military') return 'military_outpost';
  if (eco === 'industrial') return 'industrial_outpost';
  if (eco === 'colony') return 'civilian_outpost';
  return 'commercial_outpost';
}
