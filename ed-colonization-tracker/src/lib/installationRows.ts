/**
 * Every site in the commander's colonies as one row (1.60.28) — the Installations page's data.
 *
 * Sources, in trust order, mirroring the system page's list and the dock banner's inventory
 * (server/journal/overlay.js collectSystemFacilities): the dock dossier (knownStations — resolved
 * type, economies, dates), completed projects (what was built and its bill), manual installations,
 * FSS station signals. Deduped by name and shed names; carriers, construction sites and
 * colonisation ships never count. The journal's generic "Outpost" / "SurfaceStation" primaries are
 * named by their market's economy and flagged as inferred. Population is the measured-additions
 * split with the floors applied; tech / wealth / development and typical haul from Raven's table.
 * Pure: takes store slices, returns rows.
 */
import type { KnownStation, ColonizationProject, KnownSystem, FSSSignal, ManualInstallation } from '@/store/types';
import {
  estimateFacilityPopulations, effectiveSystemPopulation, applyPopulationFloors, populationClass,
  type PopulationClass, type FacilityEstimate, type PopulationFloors,
} from '@/lib/populationEstimate';
import { ravenFor, resolveGenericOutpost } from '@/lib/ravenTypes';
import { getStationTypeInfo } from '@/data/stationTypes';

export type SiteGroup = 'port' | 'outpost' | 'settlement' | 'installation' | 'unknown';
export const GROUP_ORDER: SiteGroup[] = ['port', 'outpost', 'settlement', 'installation', 'unknown'];
export const GROUP_LABELS: Record<SiteGroup, string> = {
  port: 'Ports',
  outpost: 'Outposts',
  settlement: 'Settlements',
  installation: 'Installations & hubs',
  unknown: 'Unknown type',
};

export interface InstallationRow {
  key: string;                 // "<system lower>|<site lower>"
  siteName: string;
  systemName: string;
  body: string | null;
  stationType: string;         // the type string after resolution ("military_outpost", "CraterPort", …)
  typeLabel: string;
  typeInferred: boolean;       // a generic journal outpost named by its market's economy
  typeUnknown: boolean;        // nothing recorded what this is (a depot type or a blank); a bare FSS "Installation" is a known kind
  group: SiteGroup;
  cls: PopulationClass;
  addition: number;
  estimate: number | null;
  share: number | null;
  held: boolean;
  heldAt: string | null;
  ramp: number;                // how far into its opening window the site is, 0..1 (1.60.29)
  basis: string;
  economies: { name: string; proportion: number }[]; // the market as the journal last recorded it, strongest first
  topEconomy: string | null;
  hasMarket: boolean;
  tech: number | null;
  wealth: number | null;
  dev: number | null;
  ravenName: string | null;
  haul: number | null;         // Raven's typical tonnage for the type
  bill: number | null;         // the commander's own project bill, when a project recorded one
  openedAt: string | null;
  openedSource: 'project' | 'dock' | null;
  lastDocked: string | null;
  dockedCount: number;
  marketId: number | null;
  systemPopulation: number;
  source: 'dossier' | 'project' | 'manual' | 'signal';
}

export interface InstallationRowsInput {
  knownStations: Record<number, KnownStation>;
  projects: ColonizationProject[];
  manualColonizedSystems: string[];
  knownSystems: Record<string, KnownSystem>;
  populationOverrides: Record<string, { population: number; updatedAt: string }>;
  fssSignals?: FSSSignal[];
  floors?: PopulationFloors;
  manualInstallations?: ManualInstallation[];
  hiddenInstallations?: string[];
  now?: number;                // the moment ages are measured against (default Date.now())
}

// The same identity rules as the system page (SystemDetailPage.tsx) and the server (util.js).
const FC_CALLSIGN = /^[A-Z0-9]{3}-[A-Z0-9]{3}$/;
const FSS_FC_NAME = /^[A-Z0-9]{3}-[A-Z0-9]{3}$|^.+\s*\|\s*.+$/;
const FSS_CARRIER_TYPES = new Set(['FleetCarrier', 'Squadron', 'SquadronCarrier']);
const FSS_STATION_TYPES = new Set([
  'Outpost', 'Coriolis', 'Orbis', 'Ocellus', 'CraterPort', 'CraterOutpost',
  'AsteroidBase', 'MegaShip', 'StationDodec', 'SurfaceStation', 'Installation',
  'StationCoriolis', 'StationOrbis', 'StationOcellus', 'StationOutpost', 'StationAsteroid',
  'OnFootSettlement', 'PlanetaryOutpost', 'PlanetaryPort', 'SurfaceOutpost',
]);
const isCarrier = (name: string, type: string) => /carrier|squadron/i.test(type) || FC_CALLSIGN.test(name.trim());
const isConstruction = (name: string) => /construction/i.test(name);
const isColonisationShip = (name: string, type: string) => type === 'ColonisationShip' || /\$EXT_PANEL_ColonisationShip/i.test(name) || /colonisation\s*ship/i.test(name);
const stripPrefixes = (name: string) => String(name ?? '')
  .replace(/^(Planetary|Orbital|Surface|Space)\s+Construction\s+Site:\s*/i, '')
  .replace(/^\$EXT_PANEL_ColonisationShip;\s*/i, '')
  .trim();
const siteKey = (name: string) => stripPrefixes(name).toLowerCase();
const isUnknownType = (type: string) => !type || /ConstructionDepot|^Unknown$/i.test(type);

// The server stores the dossier's primary economy beside the economies list; the client type never declared it.
type StationRecord = KnownStation & { primaryEconomy?: string };
const economyHintOf = (st: StationRecord | undefined) => (st
  ? [st.primaryEconomy, ...(st.economies ?? []).map((e) => e && (e.name || e.nameLocalised))].filter(Boolean).join(' ')
  : '');

interface Facility {
  key: string;
  name: string;
  type: string;
  typeInferred: boolean;
  station?: StationRecord;
  project?: ColonizationProject;
  manual?: ManualInstallation;
  source: InstallationRow['source'];
}

function collect(systemName: string, systemAddress: number | undefined, input: InstallationRowsInput): Facility[] {
  const lower = systemName.toLowerCase();
  const seen = new Set<string>();
  const out: Facility[] = [];
  const add = (name: string, type: string, extra: Omit<Facility, 'key' | 'name' | 'type' | 'typeInferred'> & { typeInferred?: boolean }) => {
    if (!name || isCarrier(name, type) || isConstruction(name) || isColonisationShip(name, type)) return null;
    const key = siteKey(name);
    if (!key || seen.has(key)) return null;
    seen.add(key);
    const f: Facility = { key, name: stripPrefixes(name), type: type || '', typeInferred: false, ...extra };
    out.push(f);
    return f;
  };
  for (const st of Object.values(input.knownStations) as StationRecord[]) {
    if (!st || String(st.systemName ?? '').toLowerCase() !== lower) continue;
    const raw = st.stationType || '';
    const type = resolveGenericOutpost(raw, economyHintOf(st));
    add(st.stationName, type, { station: st, source: 'dossier', typeInferred: type !== raw });
    for (const h of st.nameHistory ?? []) if (h?.name) seen.add(siteKey(h.name));
  }
  for (const p of input.projects) {
    if (!p || p.status !== 'completed' || String(p.systemName ?? '').toLowerCase() !== lower) continue;
    let name = p.completedStationName || p.stationName || '';
    if (!name && p.name) name = String(p.name).replace(/^.*? - /, '');
    name = stripPrefixes(name);
    if (!name) continue;
    const key = siteKey(name);
    const existing = out.find((f) => f.key === key || (p.marketId != null && f.station != null && f.station.marketId === p.marketId));
    if (existing) { existing.project = existing.project ?? p; continue; }
    // No dock at the finished station yet: the project's record is all there is. A depot type says
    // only that something was built there — it stays unknown rather than becoming a guessed port.
    add(name, p.completedStationType || p.stationType || '', { project: p, source: 'project' });
  }
  for (const mi of input.manualInstallations ?? []) {
    if (!mi || String(mi.systemName ?? '').toLowerCase() !== lower) continue;
    add(mi.stationName, mi.stationType || '', { manual: mi, source: 'manual' });
  }
  const hidden = new Set(input.hiddenInstallations ?? []);
  for (const sig of input.fssSignals ?? []) {
    if (!sig || systemAddress == null || sig.systemAddress !== systemAddress) continue;
    if (FSS_CARRIER_TYPES.has(sig.signalType) || FSS_FC_NAME.test(sig.signalName)) continue;
    if (!sig.isStation && !FSS_STATION_TYPES.has(sig.signalType)) continue;
    if (hidden.has(`${lower}|${String(sig.signalName).toLowerCase()}`)) continue;
    add(sig.signalName, sig.signalType || '', { source: 'signal' });
  }
  return out;
}

/** Colonies are the project systems and the manually marked ones, each name once. */
export function colonySystemNames(projects: ColonizationProject[], manual: string[]): string[] {
  const names = new Map<string, string>();
  for (const p of projects) if (p?.systemName && !names.has(p.systemName.toLowerCase())) names.set(p.systemName.toLowerCase(), p.systemName);
  for (const m of manual) if (m) names.set(m.toLowerCase(), names.get(m.toLowerCase()) ?? m);
  return [...names.values()];
}

/** The kind a site is filed under on the page: by population class, settlements by their type string. */
export function groupOf(stationType: string, cls: PopulationClass): SiteGroup {
  if (cls === 'planetary_port' || cls === 'dodec' || cls === 'orbis' || cls === 'ocellus' || cls === 'coriolis') return 'port';
  if (/settlement/i.test(stationType)) return 'settlement';
  if (cls === 'surface_outpost' || cls === 'outpost_mil' || cls === 'unit') return 'outpost';
  if (cls === 'none') return 'installation';
  return 'unknown';
}

export function buildInstallationRows(input: InstallationRowsInput): InstallationRow[] {
  const rows: InstallationRow[] = [];
  for (const systemName of colonySystemNames(input.projects, input.manualColonizedSystems)) {
    const lower = systemName.toLowerCase();
    const sys = input.knownSystems[lower];
    const population = effectiveSystemPopulation(sys, input.populationOverrides[lower]);
    const facilities = collect(systemName, sys?.systemAddress, input);
    if (facilities.length === 0) continue;
    const { result } = applyPopulationFloors(
      estimateFacilityPopulations(population, facilities.map((f) => ({ key: f.key, stationType: f.type, openedAt: f.project?.completedAt ?? null })), input.now),
      systemName,
      input.floors ?? {},
    );
    for (const f of facilities) {
      const est: FacilityEstimate | undefined = result.byKey[f.key];
      const st = f.station;
      const raven = ravenFor(f.type, economyHintOf(st));
      const economies = (st?.economies ?? [])
        .filter((e) => e && typeof e.proportion === 'number' && e.proportion > 0)
        .map((e) => ({ name: String(e.nameLocalised || e.name || '').replace(/^\$economy_/, '').replace(/;$/, ''), proportion: e.proportion }))
        .filter((e) => e.name)
        .sort((a, b) => b.proportion - a.proportion);
      const bill = f.project ? (f.project.commodities ?? []).reduce((a, c) => a + (c?.requiredQuantity || 0), 0) : 0;
      const cls = est?.cls ?? populationClass(f.type).cls;
      const typeUnknown = isUnknownType(f.type);
      const openedAt = f.project?.completedAt ?? st?.firstDocked ?? null;
      rows.push({
        key: `${lower}|${f.key}`,
        siteName: st?.stationName ?? f.name,
        systemName,
        body: st?.body ?? null,
        stationType: f.type,
        typeLabel: typeUnknown ? (f.type ? getStationTypeInfo(f.type).label : 'Unknown') : getStationTypeInfo(f.type).label,
        typeInferred: f.typeInferred,
        typeUnknown,
        group: typeUnknown ? 'unknown' : groupOf(f.type, cls),
        cls,
        addition: est?.addition ?? 0,
        estimate: est?.estimate ?? null,
        share: est?.share ?? null,
        held: !!est?.held,
        heldAt: est?.held?.at ?? null,
        ramp: est?.ramp ?? 1,
        basis: est?.basis ?? '',
        economies,
        topEconomy: economies[0]?.name ?? null,
        hasMarket: economies.length > 0,
        tech: raven ? raven.effects.tech : null,
        wealth: raven ? raven.effects.wealth : null,
        dev: raven ? raven.effects.dev : null,
        ravenName: raven ? raven.displayName2 || raven.displayName : null,
        haul: raven ? raven.haul : null,
        bill: bill > 0 ? bill : null,
        openedAt,
        openedSource: f.project?.completedAt ? 'project' : st?.firstDocked ? 'dock' : null,
        lastDocked: st?.lastDocked ?? null,
        dockedCount: st?.dockedCount ?? 0,
        marketId: st?.marketId ?? f.project?.marketId ?? null,
        systemPopulation: population,
        source: f.source,
      });
    }
  }
  rows.sort((a, b) => (b.estimate ?? -1) - (a.estimate ?? -1) || a.siteName.localeCompare(b.siteName));
  return rows;
}

export interface InstallationSummary {
  sites: number;
  systems: number;
  population: number;      // the sum of every site's estimate
  withMarket: number;
  byGroup: Record<SiteGroup, number>;
}

export function summarizeInstallationRows(rows: InstallationRow[]): InstallationSummary {
  const byGroup: Record<SiteGroup, number> = { port: 0, outpost: 0, settlement: 0, installation: 0, unknown: 0 };
  const systems = new Set<string>();
  let population = 0;
  let withMarket = 0;
  for (const r of rows) {
    systems.add(r.systemName.toLowerCase());
    byGroup[r.group] += 1;
    population += r.estimate ?? 0;
    if (r.hasMarket) withMarket += 1;
  }
  return { sites: rows.length, systems: systems.size, population, withMarket, byGroup };
}
