import { useMemo, useState } from 'react';
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
  const images = galleryImages[gKey];
  if (!images || images.length === 0) return null;
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

function sortByOrder(entries: [string, unknown][], order: Record<string, number>): [string, unknown][] {
  return entries.sort((a, b) => (order[a[0]] ?? 99) - (order[b[0]] ?? 99));
}

// ===== Main Page =====

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

  // Highlight sets from settings
  const highlightStars = useMemo(
    () => new Set(settings.domainHighlightStars ?? DEFAULT_HIGHLIGHT_STARS),
    [settings.domainHighlightStars],
  );
  const highlightStations = useMemo(
    () => new Set(settings.domainHighlightStations ?? DEFAULT_HIGHLIGHT_STATIONS),
    [settings.domainHighlightStations],
  );

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
  const images = galleryImages[gKey];
  if (images && images.length > 0) {
    return <img src={images[0].url} className="w-10 h-10 rounded object-cover shrink-0" loading="lazy" />;
  }
  return <span className="text-2xl shrink-0">{fallbackIcon}</span>;
}
