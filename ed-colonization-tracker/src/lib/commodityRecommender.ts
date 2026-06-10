/**
 * Commodity → installation recommendation engine (v2).
 *
 * Given a target commodity and a system context (bodies + existing stations),
 * returns four ranked sections, best-first:
 *
 *   1. existingProducers  — stations already in the system that produce this commodity
 *                           (either journal-reported economy matches, or the host body's
 *                           base inheritable economy matches for colony-type ports).
 *   2. expansionTargets   — installations to build on the SAME body as an existing
 *                           producer, to add slots / boost the same economy.
 *   3. colonyPortPaths    — bodies in the system whose base inheritable economy
 *                           matches the producing economy: build a colony port there.
 *   4. supportingHubs     — fallback when neither (1) nor (3) works: build a
 *                           specialized hub on any landable body to create the
 *                           economy via strong-link.
 *
 * Source priority for installation→economy matching:
 *   a. INSTALLATION_TYPES.economyBonuses (Mega Guide-explicit, currently unpopulated)
 *   b. SPECIALIZED_TYPE_ECONOMY map (fixed by installation type)
 *   c. Name heuristic (last resort)
 */

import {
  INSTALLATION_TYPES,
  COLONY_PORT_IDS,
  SPECIALIZED_TYPE_ECONOMY,
  type InstallationType,
} from '@/data/installationTypes';
import {
  WIKI_COMMODITIES,
  type WikiEconomy,
} from '@/data/wikiCommoditySupplyDemand';
import {
  resolveBodyEconomies,
  type Economy as BodyEconomy,
} from '@/data/bodyEconomies';

// ---------------------------------------------------------------------------
// Public input types
// ---------------------------------------------------------------------------

export interface RecommenderBodyContext {
  name: string;
  subType?: string;
  isLandable?: boolean;
  /** Used by resolveBodyEconomies() for modifier detection */
  rings?: unknown[];
  signals?: { genuses?: unknown[]; signals?: Record<string, number> };
}

export interface ExistingStationContext {
  stationName: string;
  /** Raw journal stationType, e.g. "Coriolis", "Outpost", "CraterOutpost". */
  stationType: string;
  /** Resolved installation type id, when known (e.g. "civilian_outpost"). */
  installationTypeId?: string;
  /** Host body name, when known. */
  body?: string | null;
  /** Journal-reported economies array. nameLocalised like "Refinery", "High Tech". */
  economies?: { name: string; nameLocalised: string; proportion: number }[];
}

export interface SystemContext {
  systemName: string;
  bodies: RecommenderBodyContext[];
  stations?: ExistingStationContext[];
}

// ---------------------------------------------------------------------------
// Public output types
// ---------------------------------------------------------------------------

export type EconomyResolutionSource =
  | 'journal-direct'        // station.economies populated from journal
  | 'inherited-from-body'   // colony port + body base economies
  | 'specialized-type';     // fixed by installation type

export interface ExistingProducer {
  stationName: string;
  stationType: string;
  body: string | null;
  /** The base body subType, e.g. "High metal content world" — informational */
  bodyType?: string;
  matchedEconomies: WikiEconomy[];
  source: EconomyResolutionSource;
  /** Plain-English why this station produces the commodity */
  detail: string;
}

export interface ExpansionTarget {
  installation: InstallationType;
  /** Host body to build on — same body as the existing producer. */
  body: string;
  nearStation: string;
  matchedEconomy: WikiEconomy;
  rankScore: number;
}

export interface ColonyPortPath {
  installation: InstallationType;
  body: string;
  /** What makes this body match — e.g. "Rocky Body — base Refinery + Industrial" */
  bodyDetail: string;
  matchedEconomies: WikiEconomy[];
  rankScore: number;
}

export interface SupportingHub {
  installation: InstallationType;
  matchedEconomy: WikiEconomy;
  feasibility: { ok: boolean; reason?: string };
  rankScore: number;
}

export interface RecommendationResult {
  commodityName: string;
  category: string;
  producingEconomies: WikiEconomy[];
  existingProducers: ExistingProducer[];
  expansionTargets: ExpansionTarget[];
  colonyPortPaths: ColonyPortPath[];
  supportingHubs: SupportingHub[];
}

// ---------------------------------------------------------------------------
// Commodity option list — for the picker UI
// ---------------------------------------------------------------------------

export interface CommodityOption {
  name: string;
  category: string;
  suppliedBy: WikiEconomy[];
}

export function listRecommenderCommodities(): { category: string; items: CommodityOption[] }[] {
  const byCat = new Map<string, CommodityOption[]>();
  for (const [name, entry] of Object.entries(WIKI_COMMODITIES)) {
    if (entry.suppliedBy.length === 0) continue;
    const list = byCat.get(entry.category) ?? [];
    list.push({ name, category: entry.category, suppliedBy: entry.suppliedBy });
    byCat.set(entry.category, list);
  }
  const result: { category: string; items: CommodityOption[] }[] = [];
  for (const cat of [...byCat.keys()].sort()) {
    const items = (byCat.get(cat) ?? []).sort((a, b) => a.name.localeCompare(b.name));
    result.push({ category: cat, items });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const WIKI_NAME_BY_NORMALIZED = new Map<string, string>();
for (const name of Object.keys(WIKI_COMMODITIES)) {
  WIKI_NAME_BY_NORMALIZED.set(normalizeName(name), name);
}

export function resolveWikiCommodityName(input: string): string | null {
  if (!input) return null;
  if (WIKI_COMMODITIES[input]) return input;
  return WIKI_NAME_BY_NORMALIZED.get(normalizeName(input)) ?? null;
}

/** Map journal-economy display strings to WikiEconomy. */
function normalizeEconomyName(raw: string): WikiEconomy | null {
  if (!raw) return null;
  const trimmed = raw.replace(/^\$economy_/i, '').replace(/;$/, '').trim();
  const map: Record<string, WikiEconomy> = {
    'High Tech': 'HighTech',
    HighTech: 'HighTech',
    'high tech': 'HighTech',
    Refinery: 'Refinery',
    Industrial: 'Industrial',
    Extraction: 'Extraction',
    Agriculture: 'Agriculture',
    Military: 'Military',
    Tourism: 'Tourism',
    Terraforming: 'Terraforming',
    Service: 'Service',
  };
  return map[trimmed] ?? null;
}

/** Convert BodyEconomy → WikiEconomy where mappable. */
function bodyEconomyToWiki(e: BodyEconomy): WikiEconomy | null {
  if (e === 'Contraband') return null; // Service in wiki is closest but not equivalent
  return e as WikiEconomy;
}

/** Find a body in the system context by name (case-insensitive, suffix-tolerant). */
function findBody(ctx: SystemContext, bodyName: string | null | undefined): RecommenderBodyContext | undefined {
  if (!bodyName) return undefined;
  const target = bodyName.toLowerCase();
  return ctx.bodies.find((b) => b.name.toLowerCase() === target);
}

/** Get favored economies for a built/buildable installation (for matching). */
function favoredEconomiesForInstallation(t: InstallationType): WikiEconomy[] {
  // 1. economyBonuses (Mega Guide explicit) — currently unpopulated
  if (t.economyBonuses && t.economyBonuses.length > 0) {
    return t.economyBonuses
      .map((b) => normalizeEconomyName(b.economy))
      .filter((e): e is WikiEconomy => e !== null);
  }
  // 2. Specialized type map
  const specialized = SPECIALIZED_TYPE_ECONOMY[t.id];
  if (specialized) {
    const norm = normalizeEconomyName(specialized);
    if (norm) return [norm];
  }
  return [];
}

/** Resolve a station's current economies into WikiEconomy set. */
function resolveStationEconomies(
  s: ExistingStationContext,
  ctx: SystemContext,
): { economies: WikiEconomy[]; source: EconomyResolutionSource; detail: string } {
  // 1. Journal-direct
  if (s.economies && s.economies.length > 0) {
    const econs = s.economies
      .map((e) => normalizeEconomyName(e.nameLocalised || e.name))
      .filter((e): e is WikiEconomy => e !== null);
    if (econs.length > 0) {
      const list = s.economies.map((e) => e.nameLocalised).join(', ');
      return { economies: econs, source: 'journal-direct', detail: `Journal-reported economies: ${list}` };
    }
  }

  // 2. Colony port inheriting from body
  if (s.installationTypeId && COLONY_PORT_IDS.has(s.installationTypeId)) {
    const body = findBody(ctx, s.body);
    if (body) {
      const { profile, economies } = resolveBodyEconomies(body);
      const wikiEcons = economies
        .map(bodyEconomyToWiki)
        .filter((e): e is WikiEconomy => e !== null);
      if (wikiEcons.length > 0) {
        return {
          economies: wikiEcons,
          source: 'inherited-from-body',
          detail: `Inherits from ${body.name}${profile ? ` (${profile.label})` : ''}: ${economies.join(', ')}`,
        };
      }
    }
    return { economies: [], source: 'inherited-from-body', detail: 'Colony port — body unknown or unrecognized.' };
  }

  // 3. Specialized type
  if (s.installationTypeId && SPECIALIZED_TYPE_ECONOMY[s.installationTypeId]) {
    const econ = normalizeEconomyName(SPECIALIZED_TYPE_ECONOMY[s.installationTypeId]);
    if (econ) {
      return { economies: [econ], source: 'specialized-type', detail: `Specialized type → ${econ}` };
    }
  }

  return { economies: [], source: 'journal-direct', detail: 'Economy unknown — no journal data and type not in dataset.' };
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

function findExistingProducers(
  ctx: SystemContext,
  producingSet: Set<WikiEconomy>,
): ExistingProducer[] {
  const out: ExistingProducer[] = [];
  for (const s of ctx.stations ?? []) {
    const { economies, source, detail } = resolveStationEconomies(s, ctx);
    const matched = economies.filter((e) => producingSet.has(e));
    if (matched.length === 0) continue;
    const body = findBody(ctx, s.body);
    out.push({
      stationName: s.stationName,
      stationType: s.stationType,
      body: s.body ?? null,
      bodyType: body?.subType,
      matchedEconomies: matched,
      source,
      detail,
    });
  }
  return out;
}

function buildExpansionTargets(
  ctx: SystemContext,
  existingProducers: ExistingProducer[],
  producingSet: Set<WikiEconomy>,
): ExpansionTarget[] {
  const out: ExpansionTarget[] = [];
  const seen = new Set<string>(); // dedupe (body|installation)
  for (const prod of existingProducers) {
    if (!prod.body) continue;
    for (const t of INSTALLATION_TYPES) {
      const favored = favoredEconomiesForInstallation(t);
      for (const econ of favored) {
        if (!producingSet.has(econ)) continue;
        const key = `${prod.body.toLowerCase()}|${t.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        // Feasibility: surface installations need their host body to be landable
        const body = findBody(ctx, prod.body);
        if (t.location === 'Surface' && !body?.isLandable) continue;
        out.push({
          installation: t,
          body: prod.body,
          nearStation: prod.stationName,
          matchedEconomy: econ,
          rankScore: (4 - t.tier) * 10 + (t.location === 'Surface' ? 5 : 0),
        });
        break;
      }
    }
  }
  out.sort((a, b) => b.rankScore - a.rankScore);
  return out;
}

function buildColonyPortPaths(
  ctx: SystemContext,
  producingSet: Set<WikiEconomy>,
  existingProducers: ExistingProducer[],
): ColonyPortPath[] {
  const out: ColonyPortPath[] = [];
  const bodiesWithExistingProducer = new Set(
    existingProducers.map((p) => p.body?.toLowerCase()).filter(Boolean) as string[],
  );

  for (const body of ctx.bodies) {
    // Skip bodies that already host a producer — covered by expansionTargets
    if (bodiesWithExistingProducer.has(body.name.toLowerCase())) continue;
    const { profile, economies } = resolveBodyEconomies(body);
    if (!profile) continue;
    const wikiEcons = economies
      .map(bodyEconomyToWiki)
      .filter((e): e is WikiEconomy => e !== null);
    const matched = wikiEcons.filter((e) => producingSet.has(e));
    if (matched.length === 0) continue;

    // For each colony port type, recommend (with surface/orbital feasibility)
    for (const portId of COLONY_PORT_IDS) {
      const t = INSTALLATION_TYPES.find((i) => i.id === portId);
      if (!t) continue;
      if (t.location === 'Surface' && !body.isLandable) continue;
      out.push({
        installation: t,
        body: body.name,
        bodyDetail: `${profile.label} — base economies: ${economies.join(', ')}`,
        matchedEconomies: matched,
        rankScore: (4 - t.tier) * 10 + matched.length * 5,
      });
    }
  }
  out.sort((a, b) => b.rankScore - a.rankScore);
  return out;
}

function buildSupportingHubs(
  ctx: SystemContext,
  producingSet: Set<WikiEconomy>,
): SupportingHub[] {
  const hasLandable = ctx.bodies.some((b) => b.isLandable);
  const out: SupportingHub[] = [];
  for (const t of INSTALLATION_TYPES) {
    // Skip colony ports — covered by colonyPortPaths
    if (COLONY_PORT_IDS.has(t.id)) continue;
    const favored = favoredEconomiesForInstallation(t);
    let matched: WikiEconomy | undefined;
    for (const econ of favored) {
      if (producingSet.has(econ)) { matched = econ; break; }
    }
    if (!matched) continue;
    const feasibility: { ok: boolean; reason?: string } = (t.location === 'Surface' && !hasLandable)
      ? { ok: false, reason: 'No landable body in system' }
      : { ok: true };
    let rankScore = (4 - t.tier) * 2;
    if (!feasibility.ok) rankScore -= 200;
    out.push({ installation: t, matchedEconomy: matched, feasibility, rankScore });
  }
  out.sort((a, b) => b.rankScore - a.rankScore);
  return out;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function recommendInstallationsForCommodity(
  commodityInput: string,
  ctx: SystemContext,
): RecommendationResult | null {
  const wikiName = resolveWikiCommodityName(commodityInput);
  if (!wikiName) return null;
  const wikiEntry = WIKI_COMMODITIES[wikiName];
  if (!wikiEntry) return null;

  const producingSet = new Set<WikiEconomy>(wikiEntry.suppliedBy);

  const existingProducers = findExistingProducers(ctx, producingSet);
  const expansionTargets = buildExpansionTargets(ctx, existingProducers, producingSet);
  const colonyPortPaths = buildColonyPortPaths(ctx, producingSet, existingProducers);
  const supportingHubs = buildSupportingHubs(ctx, producingSet);

  return {
    commodityName: wikiName,
    category: wikiEntry.category,
    producingEconomies: wikiEntry.suppliedBy,
    existingProducers,
    expansionTargets,
    colonyPortPaths,
    supportingHubs,
  };
}
