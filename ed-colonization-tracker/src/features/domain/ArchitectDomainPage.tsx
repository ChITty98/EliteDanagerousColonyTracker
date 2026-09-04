import { useEffect, useMemo, useState } from 'react';
import { findCommodityPrice } from '@/data/commodityPrices';
import { Link } from 'react-router-dom';
import { useAppStore } from '@/store';
import { useGalleryStore, galleryKey } from '@/store/galleryStore';
import {
  aggregateDomainData,
  atmoStyle,
  formatDistance,
  formatGravity,
  properCase,
  STAR_SORT_ORDER,
  STATION_SORT_ORDER,
  LANDABLE_SORT_ORDER,
  NONLANDABLE_SORT_ORDER,
  ATMO_SORT_ORDER,
  DEFAULT_HIGHLIGHT_STARS,
  DEFAULT_HIGHLIGHT_STATIONS,
  type DomainBody,
  type DomainStation,
  type DomainData,
  type Showpiece,
  computeDomainRecords,
  type DomainRecord,
} from './domainHelpers';

// ─── Sub-components ──────────────────────────────────────────────────

function Section({ title, icon, count, children, defaultOpen = false, accent }: {
  title: string; icon: string; count?: number; children: React.ReactNode; defaultOpen?: boolean; accent?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`bg-card border rounded-lg overflow-hidden mb-4 ${accent || 'border-border'}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors"
      >
        <span className="text-sm font-semibold text-foreground flex items-center gap-2">
          <span>{icon}</span> {title}
        </span>
        <span className="flex items-center gap-2">
          {count != null && <span className="text-sm font-bold text-primary tabular-nums">{count}</span>}
          <span className="text-muted-foreground text-xs">{open ? '\u25B2' : '\u25BC'}</span>
        </span>
      </button>
      {open && <div className="border-t border-border px-4 py-3">{children}</div>}
    </div>
  );
}

function ExpandableRow({ icon, label, count, badge, colorClass, children }: {
  icon?: string; label: string; count: number; badge?: string; colorClass?: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-border/20 last:border-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between py-1.5 hover:bg-muted/20 transition-colors text-sm"
      >
        <span className={`flex items-center gap-1.5 ${colorClass || 'text-muted-foreground'}`}>
          {icon && <span>{icon}</span>}
          {label}
        </span>
        <span className="flex items-center gap-2">
          <span className="font-bold text-foreground tabular-nums">{count}</span>
          {badge && <span className="text-[10px] text-muted-foreground/50">{badge}</span>}
          <span className="text-muted-foreground text-xs">{open ? '\u25B2' : '\u25BC'}</span>
        </span>
      </button>
      {open && <div className="max-h-[400px] overflow-y-auto pl-4 pb-2">{children}</div>}
    </div>
  );
}

function GalleryThumb({ gKey }: { gKey: string }) {
  const galleryImages = useGalleryStore((s) => s.images) || {};
  // Skip utility shots — an F10 taken to document a mining deposit is not a portrait of the place.
  const images = (galleryImages[gKey] || []).filter((i) => !i.utility);
  if (images.length === 0) return null;
  return <img src={images[0].url} className="w-10 h-10 rounded object-cover shrink-0" loading="lazy" />;
}

function SystemLink({ name, tab }: { name: string; tab?: string }) {
  const search = tab ? `?tab=${tab}` : '';
  return (
    <Link
      to={`/systems/${encodeURIComponent(name)}${search}`}
      className="text-primary/70 hover:text-primary transition-colors"
    >
      {name}
    </Link>
  );
}

/** Strip system name prefix from body name for shorter display */
function shortBodyName(bodyName: string, systemName: string): string {
  if (bodyName.toLowerCase().startsWith(systemName.toLowerCase())) {
    const stripped = bodyName.slice(systemName.length).trim();
    return stripped || bodyName;
  }
  return bodyName;
}

function BodyRow({ db }: { db: DomainBody }) {
  const { body, systemName, classification } = db;
  const gKey = galleryKey(systemName, 'body', body.bodyName);
  return (
    <div className="flex items-center gap-2 py-1.5 text-sm border-b border-border/20">
      <GalleryThumb gKey={gKey} />
      <span className="text-foreground font-medium">{shortBodyName(body.bodyName, systemName)}</span>
      <SystemLink name={systemName} tab="bodies" />
      <span className="text-muted-foreground/60 text-xs">{properCase(body.subType || '')}</span>
      {body.gravity != null && <span className="text-muted-foreground/60 text-xs">{formatGravity(body.gravity)}</span>}
      {body.distanceToArrival != null && <span className="text-muted-foreground/60 text-xs">{formatDistance(body.distanceToArrival)}</span>}
      {classification.hasRings && <span title="Ringed">{'\u{1F48D}'}</span>}
    </div>
  );
}

function StationRow({ ds }: { ds: DomainStation }) {
  const { station, typeIcon } = ds;
  const gKey = galleryKey(station.systemName, 'station', station.stationName);
  const pads = station.landingPads;
  const primaryEcon = station.economies?.[0]?.nameLocalised || '';
  return (
    <div className="flex items-center gap-2 py-1.5 text-sm border-b border-border/20">
      <GalleryThumb gKey={gKey} />
      <span className="shrink-0">{typeIcon}</span>
      <span className="text-foreground font-medium">{station.stationName}</span>
      <SystemLink name={station.systemName} />
      {station.body && <span className="text-muted-foreground/50 text-xs">{station.body}</span>}
      {pads && (
        <span className="flex gap-0.5 text-[10px]">
          {pads.large > 0 && <span className="bg-blue-500/20 text-blue-400 px-1 rounded">L</span>}
          {pads.medium > 0 && <span className="bg-green-500/20 text-green-400 px-1 rounded">M</span>}
          {pads.small > 0 && <span className="bg-gray-500/20 text-gray-400 px-1 rounded">S</span>}
        </span>
      )}
      {primaryEcon && <span className="text-muted-foreground/50 text-xs">{primaryEcon}</span>}
    </div>
  );
}

// Group items by system, return sorted system groups
function groupBySystem<T extends { systemName: string }>(items: T[]): [string, T[]][] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    if (!map.has(item.systemName)) map.set(item.systemName, []);
    map.get(item.systemName)!.push(item);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

// ===== Main Page =====

/**
 * REMOVED FROM THIS PAGE 2026-08-28 — the commander found a squadron leaderboard
 * jarring on a page about their own territory. Kept out of the render tree rather
 * than deleted outright: if it earns a home elsewhere, it is whole and ready.
 */
export function SquadronSeasonPanel() {
  const journalStats = useAppStore((s) => s.journalStats);
  const journalScan = useAppStore((s) => s.journalScan);
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);

  const sq = (journalStats?.statistics?.Squadron) || {};
  const yours = Number(sq.Squadron_Leaderboard_colonisation_contribution_highestcontribution || 0);
  const squadName = journalScan?.squadron?.name || null;
  const mateName = settings.squadronMateName || '';
  const mate = settings.squadronMateContribution;

  if (!squadName && !yours) return null;

  const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
  const gap = typeof mate === 'number' ? yours - mate : null;

  return (
    <div className="bg-gradient-to-r from-card to-muted/30 border border-purple-500/25 rounded-lg p-4 mb-6">
      <h3 className="text-xs font-semibold text-purple-300/80 uppercase tracking-wider mb-3">
        {'\u{1F3F4}'} Squadron Season{squadName ? ` — ${squadName}` : ''}
      </h3>
      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <div>
          <div className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">Your colonisation contribution</div>
          <div className="text-2xl font-bold text-foreground tabular-nums">{fmt(yours)}</div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">Squadron-mate (manual)</div>
          <div className="flex items-center gap-2">
            <input
              type="text" placeholder="name"
              value={mateName}
              onChange={(e) => updateSettings({ squadronMateName: e.target.value })}
              className="w-28 bg-muted/50 border border-border/50 rounded px-2 py-1 text-sm text-foreground focus:outline-none focus:border-primary"
            />
            <input
              type="number" placeholder="contribution"
              value={mate ?? ''}
              onChange={(e) => updateSettings({ squadronMateContribution: e.target.value === '' ? undefined : Number(e.target.value) })}
              className="w-32 bg-muted/50 border border-border/50 rounded px-2 py-1 text-sm text-foreground tabular-nums focus:outline-none focus:border-primary"
            />
          </div>
        </div>
        {gap != null && (
          <div>
            <div className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">This season</div>
            <div className={`text-lg font-bold ${gap >= 0 ? 'text-green-400' : 'text-amber-400'}`}>
              {gap >= 0 ? `You lead by ${fmt(gap)}` : `Behind by ${fmt(-gap)}`}
            </div>
          </div>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground/60 mt-2">
        Your figure tracks your journal automatically. ED doesn't journal other members' numbers, so enter {mateName || "your mate"}'s from the in-game squadron leaderboard.
      </p>
    </div>
  );
}

/** Rings inside the domain, from the server's journal-built ring index. */
interface DomainRing {
  name: string;
  systemName: string;
  ringClass: string;
  reserve: string;
  depthLs: number | null;
  signals: { label: string; count: number }[];
  hotspots: number;
  kinds: number;
}
interface DomainRingsResponse {
  rings: DomainRing[];
  mappedInDomain: number;
  mappedTotal: number;
  unmappedInDomain: number;
}

export function ArchitectDomainPage() {
  const projects = useAppStore((s) => s.projects);
  const manualColonizedSystems = useAppStore((s) => s.manualColonizedSystems);
  const knownSystems = useAppStore((s) => s.knownSystems);
  const knownStations = useAppStore((s) => s.knownStations);
  const journalExplorationCache = useAppStore((s) => s.journalExplorationCache);
  const settings = useAppStore((s) => s.settings);

  const colonyNames = useMemo(() => {
    const names = new Set<string>();
    for (const p of projects) {
      if (p.systemName) names.add(p.systemName.toLowerCase());
    }
    for (const name of manualColonizedSystems) {
      names.add(name.toLowerCase());
    }
    return names;
  }, [projects, manualColonizedSystems]);

  const domain: DomainData = useMemo(
    () => aggregateDomainData(colonyNames, knownSystems, knownStations, journalExplorationCache, settings),
    [colonyNames, knownSystems, knownStations, journalExplorationCache, settings],
  );

  // Domain records (superlatives)
  const domainRecords = useMemo(
    () => computeDomainRecords(journalExplorationCache, colonyNames, knownSystems),
    [journalExplorationCache, colonyNames, knownSystems],
  );

  // Highlight sets from settings
  const highlightStars = useMemo(
    () => new Set(settings.domainHighlightStars ?? DEFAULT_HIGHLIGHT_STARS),
    [settings.domainHighlightStars],
  );
  const highlightStations = useMemo(
    () => new Set(settings.domainHighlightStations ?? DEFAULT_HIGHLIGHT_STATIONS),
    [settings.domainHighlightStations],
  );

  // Notable Surface — things standing ON a body in the domain, as opposed to orbiting it.
  //
  // Brain trees are the only kind today, read from bodyFlags. Kept as a general category on
  // purpose: Planetary Mining Deposits are the obvious second tenant once the Rhino lands, and
  // both answer the same question — what is worth going down to the surface for.
  //
  // Sites outside the domain are counted, not listed. This page is about the commander's own
  // ground, but silently dropping a confirmed find would be worse than mentioning it.
  //
  // Two sources, because a find reaches the app two ways: the flag set by hand on the System
  // Bodies tab, and the groves on the Surface Mining page — a "grove here" pin or a Codex brain-tree
  // entry, in the surface ledger. Tonight's trees on 2 b came in as a pin and never set a flag.
  const bodyFlags = useAppStore((s) => s.bodyFlags);
  const [surfaceGroves, setSurfaceGroves] = useState<SurfaceGrove[]>([]);
  const notableSurface = useMemo(() => {
    type Site = { system: string; body: string; shortBody: string; label: string; detail: string | null };
    const byBody = new Map<string, Site>();
    let outside = 0;
    const shortOf = (system: string, body: string) => (
      // The system name is already on the chip — no need to repeat it inside the body name.
      body.toLowerCase().startsWith(system.toLowerCase()) ? body.slice(system.length).trim() || body : body
    );
    for (const [key, flag] of Object.entries(bodyFlags)) {
      if (!flag?.brainTrees) continue;
      const i = key.indexOf('|');
      const system = i >= 0 ? key.slice(0, i) : key;
      const body = i >= 0 ? key.slice(i + 1) : '';
      if (!colonyNames.has(system.toLowerCase())) { outside++; continue; }
      byBody.set(`${system.toLowerCase()}|${body.toLowerCase()}`, { system, body, shortBody: shortOf(system, body), label: 'Brain Trees', detail: null });
    }
    const groveCount = new Map<string, { groves: number; units: number }>();
    for (const g of surfaceGroves) {
      if (!g || !g.body || !g.system) continue;
      if (!colonyNames.has(g.system.toLowerCase())) { outside++; continue; }
      const k = `${g.system.toLowerCase()}|${g.body.toLowerCase()}`;
      const c = groveCount.get(k) ?? { groves: 0, units: 0 };
      c.groves += 1; c.units += g.harvest?.units ?? 0;
      groveCount.set(k, c);
      if (!byBody.has(k)) byBody.set(k, { system: g.system, body: g.body, shortBody: shortOf(g.system, g.body), label: 'Brain Trees', detail: null });
    }
    for (const [k, c] of groveCount) {
      const s = byBody.get(k);
      if (s) s.detail = `${c.groves} grove${c.groves === 1 ? '' : 's'}${c.units ? ` · ${c.units} units` : ''}`;
    }
    const sites = [...byBody.values()].sort((a, b) => a.system.localeCompare(b.system) || a.shortBody.localeCompare(b.shortBody));
    return { sites, outside };
  }, [bodyFlags, colonyNames, surfaceGroves]);

  // What the ground yields — DSS-mapped rings inside the domain, richest first. Server-side because
  // the ring index is built from the journals and never reaches the client store.
  const [domainRings, setDomainRings] = useState<DomainRingsResponse | null>(null);
  useEffect(() => {
    let t: string | null = null;
    try { t = sessionStorage.getItem('colony-token') || localStorage.getItem('colony-token'); } catch { /* no storage */ }
    fetch(t ? `/api/domain/rings?token=${t}` : '/api/domain/rings')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && Array.isArray(d.rings)) setDomainRings(d); })
      .catch(() => { /* the section simply doesn't render */ });
  }, []);

  // Planetary mining signals — two records about what the ground HOLDS, not what the commander
  // chose to pull: the body with the most signals, and the body whose signals promise the most
  // (one deposit of each commodity per signal, at galactic average). Same source as the
  // Surface Mining page.
  interface SurfaceGrove { body: string; system: string | null; label?: string | null; source?: string; harvest?: { units: number } | null }
  interface SurfaceBodyRow {
    body: string; system: string | null; sitesKnown: number | null; sitesManual?: boolean;
    siteRows: { index: number; expected: string[]; commodities: Record<string, number> }[];
    drive?: { highest: { alt: number; how: string } | null } | null;
  }
  const [surfaceBodies, setSurfaceBodies] = useState<SurfaceBodyRow[]>([]);
  useEffect(() => {
    let t: string | null = null;
    try { t = sessionStorage.getItem('colony-token') || localStorage.getItem('colony-token'); } catch { /* no storage */ }
    fetch(t ? `/api/surface-mining/summary?token=${t}` : '/api/surface-mining/summary')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && Array.isArray(d.bodies)) setSurfaceBodies(d.bodies as SurfaceBodyRow[]);
        if (d && Array.isArray(d.groves)) setSurfaceGroves(d.groves as SurfaceGrove[]);
      })
      .catch(() => { /* no records, nothing else changes */ });
  }, []);
  const surfaceRecords = useMemo((): DomainRecord[] => {
    const inDomain = surfaceBodies.filter((b) => b.system && colonyNames.has(b.system.toLowerCase()));
    const out: DomainRecord[] = [];
    const withCount = inDomain.filter((b) => (b.sitesKnown ?? 0) > 0);
    if (withCount.length) {
      const most = withCount.reduce((a, b) => ((b.sitesKnown ?? 0) > (a.sitesKnown ?? 0) ? b : a));
      out.push({
        label: 'Most Mining Signals', icon: '\u{1F6F0}\u{FE0F}', bodyName: most.body, systemName: most.system!,
        value: `${most.sitesKnown} signals${most.sitesManual ? ' (from the map)' : ''}`, rawValue: most.sitesKnown ?? 0,
      });
    }
    const price = (c: string) => { const p = findCommodityPrice(c); return p && p.avgSell > 0 ? p.avgSell : 0; };
    const nameOf = (c: string) => findCommodityPrice(c)?.name ?? c;
    // Per signal, its three highest-priced commodities — the Rhino's refinery holds three, so
    // a six-commodity signal is worked as its best three.
    const scored = inDomain.map((b) => {
      let total = 0; let signals = 0;
      for (const r of b.siteRows) {
        const names = new Set([...r.expected, ...Object.keys(r.commodities || {})].map(nameOf));
        if (!names.size) continue;
        signals += 1;
        total += [...names].map(price).sort((x, y) => y - x).slice(0, 3).reduce((t, p) => t + p, 0);
      }
      return { b, total, signals };
    }).filter((x) => x.total > 0);
    if (scored.length) {
      const best = scored.reduce((a, x) => (x.total > a.total ? x : a));
      const fmt = best.total >= 1e6 ? `${(best.total / 1e6).toFixed(1)}M` : `${Math.round(best.total / 1000)}k`;
      out.push({
        label: 'Richest Signals', icon: '\u{1F48E}', bodyName: best.b.body, systemName: best.b.system!,
        value: `~${fmt} expected \u{B7} ${best.signals} signal${best.signals === 1 ? '' : 's'} tagged`, rawValue: best.total,
      });
    }
    // Highest ground reached on any body in the domain — on foot, landed, or in the SRV on the
    // ground; jumps are filtered out server-side.
    const withHigh = inDomain.filter((b) => b.drive && b.drive.highest);
    if (withHigh.length) {
      const top = withHigh.reduce((a, b) => (b.drive!.highest!.alt > a.drive!.highest!.alt ? b : a));
      out.push({
        label: 'Highest Ground Reached', icon: '\u{26F0}\u{FE0F}', bodyName: top.body, systemName: top.system!,
        value: `${top.drive!.highest!.alt.toLocaleString()} m \u{B7} ${top.drive!.highest!.how}`, rawValue: top.drive!.highest!.alt,
      });
    }
    return out;
  }, [surfaceBodies, colonyNames]);
  // The ring with the most hotspots — what the ground holds, from your own DSS scans. The panel
  // below ranks all of them; this is the one-card answer.
  const ringRecords = useMemo((): DomainRecord[] => {
    const rings = (domainRings?.rings ?? []).filter((r) => r.hotspots > 0);
    if (!rings.length) return [];
    const top = rings.reduce((a, r) => (r.hotspots > a.hotspots ? r : a));
    const mats = [...top.signals].sort((a, b) => b.count - a.count).slice(0, 3).map((s) => `${s.label}${s.count > 1 ? ` ×${s.count}` : ''}`).join(' · ');
    return [{
      label: 'Most Hotspots', icon: '\u{1FA90}', bodyName: top.name, systemName: top.systemName,
      value: `${top.hotspots} hotspot${top.hotspots === 1 ? '' : 's'}${mats ? ` · ${mats}` : ''}${top.reserve ? ` · ${top.reserve}` : ''}`, rawValue: top.hotspots,
    }];
  }, [domainRings]);
  const allRecords = useMemo(() => [...domainRecords, ...surfaceRecords, ...ringRecords], [domainRecords, surfaceRecords, ringRecords]);

  // Sorted star entries
  const sortedStars = useMemo(() => {
    const entries = [...domain.starsByType.entries()];
    return entries.sort((a, b) => (STAR_SORT_ORDER[a[0]] ?? 99) - (STAR_SORT_ORDER[b[0]] ?? 99));
  }, [domain.starsByType]);

  // Sorted landable by type
  const sortedLandableTypes = useMemo(() => {
    const entries = [...domain.landableByType.entries()];
    return entries.sort((a, b) => (LANDABLE_SORT_ORDER[a[0]] ?? 99) - (LANDABLE_SORT_ORDER[b[0]] ?? 99));
  }, [domain.landableByType]);

  // Sorted landable by atmo
  const sortedAtmo = useMemo(() => {
    const entries = [...domain.landableByAtmo.entries()];
    return entries.sort((a, b) => (ATMO_SORT_ORDER[a[0]] ?? 99) - (ATMO_SORT_ORDER[b[0]] ?? 99));
  }, [domain.landableByAtmo]);

  // Sorted non-landable
  const sortedNonLandable = useMemo(() => {
    const entries = [...domain.nonLandableByType.entries()];
    return entries.sort((a, b) => (NONLANDABLE_SORT_ORDER[a[0]] ?? 99) - (NONLANDABLE_SORT_ORDER[b[0]] ?? 99));
  }, [domain.nonLandableByType]);

  // Sorted stations
  const sortedStations = useMemo(() => {
    const entries = [...domain.stationsByType.entries()];
    return entries.sort((a, b) => (STATION_SORT_ORDER[a[0]] ?? 99) - (STATION_SORT_ORDER[b[0]] ?? 99));
  }, [domain.stationsByType]);

  return (
    <div>
      {/* Header */}
      <h2 className="text-2xl font-bold mb-1">{'\u{1F3DB}\u{FE0F}'} Architect's Domain</h2>
      <p className="text-sm text-muted-foreground mb-6">
        {domain.colonyCount} systems. {domain.totalStars} stars. {domain.totalLandable} landable bodies. {domain.totalStations} stations.
        {domain.totalPopulation > 0 && ` Population: ${Math.round(domain.totalPopulation / 1_000_000)}M.`}
      </p>

      {/* Showpieces — Domain Highlights */}
      {domain.showpieces.length > 0 && (
        <div className="bg-gradient-to-r from-card to-muted/30 border border-yellow-500/20 rounded-lg p-4 mb-6">
          <h3 className="text-xs font-semibold text-yellow-400/80 uppercase tracking-wider mb-3">Domain Highlights</h3>
          <div className="flex flex-wrap gap-3">
            {domain.showpieces.map((sp, i) => (
              <ShowpieceCard key={i} sp={sp} />
            ))}
          </div>
        </div>
      )}

      {/* Records */}
      {allRecords.length > 0 && (
        <div className="bg-gradient-to-r from-card to-muted/30 border border-amber-500/20 rounded-lg p-4 mb-6">
          <h3 className="text-xs font-semibold text-amber-400/80 uppercase tracking-wider mb-3">{'\u{1F3C6}'} Domain Records</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {allRecords.map((rec, i) => (
              <div key={i} className="flex items-center gap-2 bg-background/40 rounded-md px-3 py-2">
                <span className="text-lg">{rec.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">{rec.label}</div>
                  <div className="text-sm font-semibold text-foreground truncate">{rec.value}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {rec.bodyName.replace(rec.systemName + ' ', '')} <span className="text-muted-foreground/50">in</span>{' '}
                    <Link to={`/systems/${encodeURIComponent(rec.systemName)}`} className="text-primary hover:underline">
                      {rec.systemName}
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Notable Surface \u2014 what is on the ground, as opposed to what orbits it.
          Brain Trees today; Planetary Mining Deposits will join them here once the Rhino ships
          (2 Sept), which is why this is a CATEGORY rather than a brain-tree panel. */}
      {notableSurface.sites.length > 0 && (
        <div className="bg-gradient-to-r from-card to-muted/30 border border-purple-500/25 rounded-lg p-4 mb-6">
          <h3 className="text-xs font-semibold text-purple-300/80 uppercase tracking-wider mb-3">
            {'\u{1F9E0}'} Notable Surface
          </h3>
          <div className="flex flex-wrap gap-2">
            {notableSurface.sites.map((s) => (
              <Link
                key={`${s.system}|${s.body}`}
                to={`/systems/${encodeURIComponent(s.system)}`}
                className="text-xs rounded bg-purple-500/10 border border-purple-500/25 px-2.5 py-1.5 text-purple-100 hover:border-purple-400/50"
              >
                <span className="font-medium">{s.label}</span>
                <span className="text-purple-200/60 ml-1.5">{s.shortBody}</span>
                {s.detail && <span className="text-purple-200/50 ml-1.5">{s.detail}</span>}
                <span className="text-muted-foreground/60 ml-1.5">{s.system}</span>
              </Link>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground/60">
            Brain trees are a raw-material farm on ground you already hold
            {notableSurface.outside > 0 && ` \u00b7 ${notableSurface.outside} more outside your systems`}
          </p>
        </div>
      )}

      {/* What the ground yields \u2014 domain rings by hotspot count */}
      {domainRings && domainRings.rings.length > 0 && (
        <div className="bg-gradient-to-r from-card to-muted/30 border border-cyan-500/20 rounded-lg p-4 mb-6">
          <h3 className="text-xs font-semibold text-cyan-400/80 uppercase tracking-wider mb-3">
            {'\u{1F48E}'} What Your Ground Yields
          </h3>
          <div className="space-y-1.5">
            {domainRings.rings.slice(0, 8).map((r, i) => (
              <div key={r.name} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 bg-background/40 rounded-md px-3 py-2">
                <span className={`font-mono text-sm tabular-nums shrink-0 ${i === 0 ? 'text-cyan-300 font-bold' : 'text-muted-foreground'}`}>
                  {r.hotspots}
                </span>
                <Link
                  to={`/systems/${encodeURIComponent(r.systemName)}`}
                  className="text-sm font-medium text-foreground hover:text-primary truncate"
                >
                  {r.name.startsWith(r.systemName) ? r.name.slice(r.systemName.length).trim() : r.name}
                </Link>
                <span className="text-[11px] font-mono text-muted-foreground/70 shrink-0">
                  {r.systemName}
                </span>
                {r.reserve && (
                  <span className={`text-[10px] font-mono uppercase tracking-wider px-1.5 rounded border ${
                    r.reserve === 'Pristine'
                      ? 'text-emerald-400 border-emerald-500/40'
                      : 'text-muted-foreground border-border'
                  }`}>
                    {r.reserve}
                  </span>
                )}
                <span className="w-full text-[11px] text-muted-foreground truncate">
                  {r.signals.map((s) => `${s.label}${s.count > 1 ? ` \u00D7${s.count}` : ''}`).join(' \u00B7 ')}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground/60">
            {domainRings.mappedInDomain} ring{domainRings.mappedInDomain === 1 ? '' : 's'} mapped across your systems
            {domainRings.unmappedInDomain > 0 && ` \u00B7 ${domainRings.unmappedInDomain} seen but never DSS-scanned`}
            {' \u00B7 hotspot counts from your own scans'}
          </p>
        </div>
      )}

      {/* Stars */}
      <Section title="Stars Under Your Domain" icon={'\u2B50'} count={domain.totalStars} defaultOpen>
        {sortedStars.map(([type, data]) => (
          <ExpandableRow
            key={type}
            icon={highlightStars.has(type) ? '\u{1F31F}' : undefined}
            label={type}
            count={data.bodies.length}
            badge={`in ${data.systems.size} system${data.systems.size !== 1 ? 's' : ''}`}
          >
            {groupBySystem(data.bodies.map((b) => ({ ...b, systemName: b.systemName }))).map(([sys, bodies]) => (
              <div key={sys}>
                <div className="text-xs font-semibold text-muted-foreground mt-2 mb-1"><SystemLink name={sys} /></div>
                {bodies.map((b, i) => (
                  <div key={i} className="flex items-center gap-2 py-0.5 text-sm text-foreground/80">
                    <span>{b.bodyName}</span>
                    <span className="text-muted-foreground/50 text-xs">{b.subType}</span>
                  </div>
                ))}
              </div>
            ))}
          </ExpandableRow>
        ))}
        {sortedStars.length === 0 && (
          <p className="text-sm text-muted-foreground">Sync journals and score colonies to see your stars.</p>
        )}
      </Section>

      {/* Landable Bodies */}
      <Section title="Landable Bodies" icon={'\u{1F30D}'} count={domain.totalLandable} defaultOpen>
        {/* By Atmosphere */}
        {sortedAtmo.length > 0 && (
          <div className="mb-4">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">By Atmosphere</h4>
            {sortedAtmo.map(([type, bodies]) => {
              const style = atmoStyle(type);
              return (
                <ExpandableRow
                  key={type}
                  icon={style.icon}
                  label={type}
                  count={bodies.length}
                  colorClass={style.color}
                  badge={`in ${new Set(bodies.map((b) => b.systemName)).size} system${new Set(bodies.map((b) => b.systemName)).size !== 1 ? 's' : ''}`}
                >
                  {groupBySystem(bodies).map(([sys, sysBodies]) => (
                    <div key={sys}>
                      <div className="text-xs font-semibold text-muted-foreground mt-2 mb-1"><SystemLink name={sys} tab="bodies" /></div>
                      {sysBodies.map((db, i) => <BodyRow key={i} db={db} />)}
                    </div>
                  ))}
                </ExpandableRow>
              );
            })}
          </div>
        )}

        {/* By Category */}
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">By Category</h4>
          {sortedLandableTypes.map(([type, bodies]) => (
            <ExpandableRow
              key={type}
              label={type}
              count={bodies.length}
              badge={`in ${new Set(bodies.map((b) => b.systemName)).size} system${new Set(bodies.map((b) => b.systemName)).size !== 1 ? 's' : ''}`}
            >
              {groupBySystem(bodies).map(([sys, sysBodies]) => (
                <div key={sys}>
                  <div className="text-xs font-semibold text-muted-foreground mt-2 mb-1"><SystemLink name={sys} tab="bodies" /></div>
                  {sysBodies.map((db, i) => <BodyRow key={i} db={db} />)}
                </div>
              ))}
            </ExpandableRow>
          ))}
        </div>

        {sortedAtmo.length === 0 && sortedLandableTypes.length === 0 && (
          <p className="text-sm text-muted-foreground">Sync journals and score colonies to see your landable bodies.</p>
        )}
      </Section>

      {/* Other Bodies */}
      <Section title="Other Bodies" icon={'\u{1FA90}'} count={domain.totalPlanets - domain.totalLandable}>
        {sortedNonLandable.map(([type, bodies]) => (
          <ExpandableRow
            key={type}
            label={properCase(type)}
            count={bodies.length}
            badge={`in ${new Set(bodies.map((b) => b.systemName)).size} system${new Set(bodies.map((b) => b.systemName)).size !== 1 ? 's' : ''}`}
          >
            {groupBySystem(bodies).map(([sys, sysBodies]) => (
              <div key={sys}>
                <div className="text-xs font-semibold text-muted-foreground mt-2 mb-1"><SystemLink name={sys} tab="bodies" /></div>
                {sysBodies.map((db, i) => (
                  <div key={i} className="flex items-center gap-2 py-1.5 text-sm border-b border-border/20">
                    <span className="text-foreground font-medium">{shortBodyName(db.body.bodyName, sys)}</span>
                    <span className="text-muted-foreground/60 text-xs">{properCase(db.body.subType || '')}</span>
                  </div>
                ))}
              </div>
            ))}
          </ExpandableRow>
        ))}
        {sortedNonLandable.length === 0 && (
          <p className="text-sm text-muted-foreground">No non-landable body data yet.</p>
        )}
      </Section>

      {/* Stations & Installations */}
      <Section title="Stations & Installations" icon={'\u{1F6F0}\u{FE0F}'} count={domain.totalStations} defaultOpen>
        {sortedStations.map(([typeLabel, stations]) => {
          const icon = stations[0]?.typeIcon || '';
          const isNotable = highlightStations.has(typeLabel);
          return (
            <ExpandableRow
              key={typeLabel}
              icon={icon}
              label={typeLabel}
              count={stations.length}
              colorClass={isNotable ? 'text-orange-400' : undefined}
              badge={`in ${new Set(stations.map((s) => s.station.systemName)).size} system${new Set(stations.map((s) => s.station.systemName)).size !== 1 ? 's' : ''}`}
            >
              {groupBySystem(stations.map((s) => ({ ...s, systemName: s.station.systemName }))).map(([sys, sysStations]) => (
                <div key={sys}>
                  <div className="text-xs font-semibold text-muted-foreground mt-2 mb-1"><SystemLink name={sys} /></div>
                  {sysStations.map((ds, i) => <StationRow key={i} ds={ds} />)}
                </div>
              ))}
            </ExpandableRow>
          );
        })}
        {sortedStations.length === 0 && (
          <p className="text-sm text-muted-foreground">Sync journals to see your stations.</p>
        )}
      </Section>

      {/* Territorial Spread */}
      <Section title="Territorial Spread" icon={'\u{1F5FA}\u{FE0F}'}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-muted-foreground text-xs mb-1">From Sol</div>
            {domain.nearestSol < Infinity ? (
              <>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Nearest:</span>
                  <span>{domain.nearestSol.toFixed(1)} ly <span className="text-muted-foreground/50">({domain.nearestSolName})</span></span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Farthest:</span>
                  <span>{domain.farthestSol.toFixed(1)} ly <span className="text-muted-foreground/50">({domain.farthestSolName})</span></span>
                </div>
                <div className="flex justify-between mt-1 pt-1 border-t border-border/30">
                  <span className="text-muted-foreground">Span:</span>
                  <span className="text-primary font-medium">{(domain.farthestSol - domain.nearestSol).toFixed(1)} ly</span>
                </div>
              </>
            ) : <span className="text-muted-foreground">No coordinates</span>}
          </div>
          {settings.homeSystem && domain.nearestHome < Infinity && (
            <div>
              <div className="text-muted-foreground text-xs mb-1">From {settings.homeSystem}</div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Nearest:</span>
                <span>{domain.nearestHome.toFixed(1)} ly <span className="text-muted-foreground/50">({domain.nearestHomeName})</span></span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Farthest:</span>
                <span>{domain.farthestHome.toFixed(1)} ly <span className="text-muted-foreground/50">({domain.farthestHomeName})</span></span>
              </div>
              <div className="flex justify-between mt-1 pt-1 border-t border-border/30">
                <span className="text-muted-foreground">Span:</span>
                <span className="text-primary font-medium">{(domain.farthestHome - domain.nearestHome).toFixed(1)} ly</span>
              </div>
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}

// ─── Showpiece card ──────────────────────────────────────────────────

function ShowpieceCard({ sp }: { sp: Showpiece }) {
  return (
    <div className={`bg-card/80 border border-border/50 rounded-lg p-3 min-w-[280px] flex-1 flex items-center gap-3 ${sp.color}`}>
      {sp.galleryKey ? (
        <GalleryThumbOrIcon gKey={sp.galleryKey} fallbackIcon={sp.icon} />
      ) : (
        <span className="text-2xl shrink-0">{sp.icon}</span>
      )}
      <div className="min-w-0">
        <div className="text-sm font-semibold">{sp.title}</div>
        <div className="text-xs text-muted-foreground truncate">{sp.subtitle}</div>
        <Link
          to={`/systems/${encodeURIComponent(sp.systemName)}`}
          className="text-[10px] text-primary/60 hover:text-primary transition-colors"
        >
          {sp.systemName}
        </Link>
      </div>
    </div>
  );
}

function GalleryThumbOrIcon({ gKey, fallbackIcon }: { gKey: string; fallbackIcon: string }) {
  const galleryImages = useGalleryStore((s) => s.images) || {};
  // Skip utility shots — an F10 taken to document a mining deposit is not a portrait of the place.
  const images = (galleryImages[gKey] || []).filter((i) => !i.utility);
  if (images.length > 0) {
    return <img src={images[0].url} className="w-10 h-10 rounded object-cover shrink-0" loading="lazy" />;
  }
  return <span className="text-2xl shrink-0">{fallbackIcon}</span>;
}
