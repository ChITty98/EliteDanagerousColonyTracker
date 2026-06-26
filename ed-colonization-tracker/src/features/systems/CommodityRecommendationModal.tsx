import { useEffect, useMemo, useState } from 'react';
import { fetchSystemDump, type SpanshDumpBody } from '@/services/spanshApi';
import {
  listRecommenderCommodities,
  recommendInstallationsForCommodity,
  type CommodityOption,
  type RecommendationResult,
  type SystemContext,
  type ExistingStationContext,
  type ExistingProducer,
  type ExpansionTarget,
  type ColonyPortPath,
  type SupportingHub,
} from '@/lib/commodityRecommender';
import type { WikiEconomy } from '@/data/wikiCommoditySupplyDemand';
import type { InstallationType } from '@/data/installationTypes';
import { COMMODITIES } from '@/data/commodities';
import ravenBuildTypes from '@/data/ravenBuildTypes.json';

// Raven Colonial's authoritative total haul tonnage per installation, keyed by
// building name (offline data extracted to src/data/ravenBuildTypes.json).
const RAVEN_HAUL_BY_NAME = new Map<string, number>();
for (const bt of ravenBuildTypes as { displayName?: string; displayName2?: string; haul?: number }[]) {
  if (typeof bt.haul === 'number') {
    if (bt.displayName2) RAVEN_HAUL_BY_NAME.set(bt.displayName2.toLowerCase(), bt.haul);
    if (bt.displayName) RAVEN_HAUL_BY_NAME.set(bt.displayName.toLowerCase(), bt.haul);
  }
}
function ravenHaul(name: string | undefined): number | null {
  return name ? RAVEN_HAUL_BY_NAME.get(name.toLowerCase()) ?? null : null;
}

interface Props {
  systemName: string;
  id64: number | null;
  /** Existing stations in this system, with type, body, economies. */
  stations: ExistingStationContext[];
  onClose: () => void;
}

const ECONOMY_COLORS: Record<WikiEconomy, string> = {
  Agriculture: 'text-green-400 bg-green-500/20',
  Extraction: 'text-orange-400 bg-orange-500/20',
  Refinery: 'text-amber-400 bg-amber-500/20',
  Industrial: 'text-cyan-400 bg-cyan-500/20',
  HighTech: 'text-blue-400 bg-blue-500/20',
  Military: 'text-red-400 bg-red-500/20',
  Tourism: 'text-pink-400 bg-pink-500/20',
  Terraforming: 'text-emerald-400 bg-emerald-500/20',
  Service: 'text-slate-300 bg-slate-500/20',
};

const COMMODITY_NAME_BY_ID: Record<string, string> = {};
for (const c of COMMODITIES) COMMODITY_NAME_BY_ID[c.id] = c.name;

/** Tier-typical tonnage ranges, used as fallback when buildRequirements is unmapped. */
const TIER_TYPICAL_TONNAGE: Record<number, string> = {
  1: '~6,000–20,000 t',
  2: '~10,000–25,000 t',
  3: '~40,000+ t',
};

function BuildRequirementsCard({ inst }: { inst: InstallationType }) {
  const reqs = inst.buildRequirements;
  const haul = ravenHaul(inst.name);
  if (!reqs || reqs.length === 0) {
    return (
      <div className="mt-2 rounded border border-border bg-muted/20 p-2 text-xs">
        <div className="text-muted-foreground italic">
          {haul != null ? (
            <>Commodity breakdown not itemised yet, but Raven Colonial's total haul is{' '}
            <span className="text-foreground font-medium not-italic">{haul.toLocaleString()} t</span>.</>
          ) : (
            <>Build requirements not yet mapped for this type.
            Tier {inst.tier} typical: {TIER_TYPICAL_TONNAGE[inst.tier] ?? 'unknown'}.</>
          )}
        </div>
      </div>
    );
  }
  const total = inst.totalTonnage ?? reqs.reduce((s, r) => s + r.quantity, 0);
  return (
    <div className="mt-2 rounded border border-border bg-muted/20 p-2 text-xs">
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-muted-foreground uppercase tracking-wider">Build requirements</span>
        <span className="text-foreground font-medium">{total.toLocaleString()} t total</span>
      </div>
      <table className="w-full text-xs">
        <tbody>
          {reqs.map((r) => (
            <tr key={r.commodityId} className="border-t border-border/30">
              <td className="py-0.5">{COMMODITY_NAME_BY_ID[r.commodityId] ?? r.commodityId}</td>
              <td className="py-0.5 text-right text-muted-foreground font-mono">
                {r.quantity.toLocaleString()} t
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InstallationLine({
  inst,
  showLocation = true,
  rightSlot,
}: {
  inst: InstallationType;
  showLocation?: boolean;
  rightSlot?: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-2 flex-wrap">
      <span className="font-medium text-foreground">{inst.name}</span>
      <span className="text-muted-foreground text-xs">
        T{inst.tier}
        {showLocation ? `, ${inst.location}` : ''}
        {inst.systemScore ? `, score ${inst.systemScore}` : ''}
      </span>
      {rightSlot}
    </div>
  );
}

function ExpandableInstallation({
  inst,
  rightSlot,
}: {
  inst: InstallationType;
  rightSlot?: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left hover:bg-muted/30 rounded px-2 py-1 -mx-2 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs">{expanded ? '▼' : '▶'}</span>
          <InstallationLine inst={inst} rightSlot={rightSlot} />
        </div>
      </button>
      {expanded && <BuildRequirementsCard inst={inst} />}
    </div>
  );
}

export function CommodityRecommendationModal({ systemName, id64, stations, onClose }: Props) {
  const [bodies, setBodies] = useState<SpanshDumpBody[] | null>(null);
  const [bodiesError, setBodiesError] = useState<string | null>(null);
  const [loadingBodies, setLoadingBodies] = useState(false);
  const [selectedCommodity, setSelectedCommodity] = useState<string>('');

  useEffect(() => {
    if (!id64) {
      setBodiesError('No Spansh id64 — body-based suggestions unavailable.');
      return;
    }
    let cancelled = false;
    setLoadingBodies(true);
    setBodiesError(null);
    fetchSystemDump(id64)
      .then((dump) => {
        if (cancelled) return;
        setBodies(dump.bodies ?? []);
      })
      .catch((err) => {
        if (cancelled) return;
        setBodiesError(`Failed to load body data: ${err.message}`);
      })
      .finally(() => {
        if (!cancelled) setLoadingBodies(false);
      });
    return () => { cancelled = true; };
  }, [id64]);

  const commodityGroups = useMemo(() => listRecommenderCommodities(), []);

  const systemContext: SystemContext = useMemo(() => ({
    systemName,
    bodies: (bodies ?? []).map((b) => ({
      name: b.name,
      subType: b.subType,
      isLandable: b.isLandable,
      rings: b.rings,
      signals: b.signals as { genuses?: unknown[]; signals?: Record<string, number> } | undefined,
    })),
    stations,
  }), [systemName, bodies, stations]);

  const selectedOption: CommodityOption | null = useMemo(() => {
    if (!selectedCommodity) return null;
    for (const grp of commodityGroups) {
      for (const item of grp.items) {
        if (item.name === selectedCommodity) return item;
      }
    }
    return null;
  }, [selectedCommodity, commodityGroups]);

  const result: RecommendationResult | null = useMemo(() => {
    if (!selectedCommodity) return null;
    return recommendInstallationsForCommodity(selectedCommodity, systemContext);
  }, [selectedCommodity, systemContext]);

  const landableBodyCount = (bodies ?? []).filter((b) => b.isLandable).length;

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 overflow-y-auto"
      onClick={handleBackdropClick}
    >
      <div className="bg-card border border-border rounded-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto p-6 my-auto">
        {/* Header */}
        <div className="flex items-baseline justify-between mb-2">
          <div>
            <h2 className="text-xl font-bold text-foreground">Find an installation that produces…</h2>
            <p className="text-sm text-muted-foreground">{systemName}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-2xl leading-none">{'×'}</button>
        </div>

        {/* System context summary */}
        <div className="mt-3 rounded-lg border border-border bg-muted/10 p-3 text-xs">
          {loadingBodies ? (
            <span className="text-muted-foreground italic">Loading body data…</span>
          ) : bodiesError ? (
            <span className="text-amber-300">{bodiesError}</span>
          ) : bodies ? (
            <div className="flex flex-wrap gap-3 text-muted-foreground">
              <span><span className="text-foreground font-medium">{bodies.length}</span> bodies</span>
              <span><span className="text-foreground font-medium">{landableBodyCount}</span> landable</span>
              <span><span className="text-foreground font-medium">{stations.length}</span> known stations</span>
            </div>
          ) : null}
        </div>

        {/* Commodity picker */}
        <div className="mt-4">
          <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-2">
            Commodity
          </label>
          <select
            value={selectedCommodity}
            onChange={(e) => setSelectedCommodity(e.target.value)}
            className="w-full bg-muted border border-border rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
          >
            <option value="">— pick a commodity —</option>
            {commodityGroups.map((grp) => (
              <optgroup key={grp.category} label={grp.category}>
                {grp.items.map((item) => (
                  <option key={item.name} value={item.name}>{item.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        {/* Producing economies */}
        {selectedOption && (
          <div className="mt-4 rounded-lg border border-border bg-muted/10 p-3">
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
              {selectedOption.name} is produced by these economies
            </div>
            <div className="flex flex-wrap gap-2">
              {selectedOption.suppliedBy.map((econ) => (
                <span key={econ} className={`px-2 py-1 rounded text-sm font-medium ${ECONOMY_COLORS[econ]}`}>
                  {econ}
                </span>
              ))}
            </div>
          </div>
        )}

        {result && (
          <>
            {/* 1. Existing producers */}
            <Section title="Already producing in this system" count={result.existingProducers.length}>
              {result.existingProducers.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">
                  No known stations in this system currently produce {result.commodityName}.
                </p>
              ) : (
                <ul className="text-sm space-y-2">
                  {result.existingProducers.map((p) => <ExistingProducerRow key={p.stationName} producer={p} />)}
                </ul>
              )}
            </Section>

            {/* 2. Expansion targets */}
            {result.expansionTargets.length > 0 && (
              <Section title="Expand near existing producer" count={result.expansionTargets.length}>
                <p className="text-xs text-muted-foreground italic mb-2">
                  Build on the same body as an existing producer to add more slots / strong-link bonuses for the same economy. Click each row to see build requirements.
                </p>
                <ul className="text-sm space-y-1">
                  {result.expansionTargets.map((t) => <ExpansionRow key={`${t.body}|${t.installation.id}`} target={t} />)}
                </ul>
              </Section>
            )}

            {/* 3. New colony port paths */}
            {result.colonyPortPaths.length > 0 && (
              <Section title="Build a new colony port on a matching body" count={result.colonyPortPaths.length}>
                <p className="text-xs text-muted-foreground italic mb-2">
                  These bodies have a base inheritable economy that matches. A colony-type port built here directly inherits that economy and produces {result.commodityName} in its market.
                </p>
                <ul className="text-sm space-y-1">
                  {result.colonyPortPaths.map((p, i) => <ColonyPortRow key={`${p.body}|${p.installation.id}|${i}`} path={p} />)}
                </ul>
              </Section>
            )}

            {/* 4. Supporting hubs */}
            {result.supportingHubs.length > 0 && (
              <Section title="Or — build a supporting installation to create the economy" count={result.supportingHubs.length}>
                <p className="text-xs text-muted-foreground italic mb-2">
                  Use these when no body in the system has the producing economy as its base. The hub's strong-link grants the target economy to a nearby colony port.
                </p>
                <ul className="text-sm space-y-1">
                  {result.supportingHubs.map((h) => <SupportingHubRow key={h.installation.id} hub={h} />)}
                </ul>
              </Section>
            )}

            {result.existingProducers.length === 0 &&
              result.expansionTargets.length === 0 &&
              result.colonyPortPaths.length === 0 &&
              result.supportingHubs.length === 0 && (
                <Section title="No suggestions">
                  <p className="text-sm text-muted-foreground italic">
                    No installation in our dataset currently maps to a producing economy for {result.commodityName}.
                  </p>
                </Section>
              )}
          </>
        )}

        {/* Footer */}
        <div className="mt-4 text-xs text-muted-foreground italic">
          Section priority: existing producer &gt; expansion on same body &gt; new colony port on matching body &gt; supporting hub.
          Build requirements expand per row. Sources: CMDR Mechan's Colonization Mega Guide v2.3.0, Elite Dangerous wiki Supply &amp; Demand.
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <div className="mt-4 rounded-lg border border-border bg-muted/10 p-3">
      <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
        {title}{count !== undefined ? ` (${count})` : ''}
      </div>
      {children}
    </div>
  );
}

function ExistingProducerRow({ producer }: { producer: ExistingProducer }) {
  return (
    <li className="border-l-2 border-progress-complete pl-3">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="font-medium text-foreground">{producer.stationName}</span>
        <span className="text-muted-foreground text-xs">({producer.stationType})</span>
        {producer.matchedEconomies.map((e) => (
          <span key={e} className={`text-xs px-1.5 py-0.5 rounded ${ECONOMY_COLORS[e]}`}>{e}</span>
        ))}
      </div>
      <div className="text-xs text-muted-foreground mt-0.5">
        {producer.body ? (
          <>on <span className="text-foreground">{producer.body}</span>{producer.bodyType ? ` (${producer.bodyType})` : ''}</>
        ) : (
          <>body unknown</>
        )}
      </div>
      <div className="text-[11px] text-muted-foreground/70 italic mt-0.5">{producer.detail}</div>
    </li>
  );
}

function ExpansionRow({ target }: { target: ExpansionTarget }) {
  return (
    <li>
      <ExpandableInstallation
        inst={target.installation}
        rightSlot={
          <>
            <span className={`text-xs px-1.5 py-0.5 rounded ${ECONOMY_COLORS[target.matchedEconomy]}`}>{target.matchedEconomy}</span>
            <span className="text-xs text-muted-foreground">
              on <span className="text-foreground">{target.body}</span> · near {target.nearStation}
            </span>
          </>
        }
      />
    </li>
  );
}

function ColonyPortRow({ path }: { path: ColonyPortPath }) {
  return (
    <li>
      <ExpandableInstallation
        inst={path.installation}
        rightSlot={
          <>
            {path.matchedEconomies.map((e) => (
              <span key={e} className={`text-xs px-1.5 py-0.5 rounded ${ECONOMY_COLORS[e]}`}>{e}</span>
            ))}
            {path.buff && path.buff.modifier > 0 && (
              <span
                className="text-xs px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300"
                title={`Production buff (Raven model): ${path.buff.reasons.join(', ')}`}
              >
                {'✨'} +{path.buff.modifier.toFixed(1)} buff
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              on <span className="text-foreground">{path.body}</span>
            </span>
          </>
        }
      />
      <div className="text-[11px] text-muted-foreground/70 italic ml-7 mt-0.5">
        {path.bodyDetail}
        {path.buff && path.buff.modifier > 0 && (
          <span className="text-purple-300/80"> {'·'} production buff: {path.buff.reasons.join(', ')}</span>
        )}
      </div>
    </li>
  );
}

function SupportingHubRow({ hub }: { hub: SupportingHub }) {
  return (
    <li className={hub.feasibility.ok ? '' : 'opacity-50'}>
      <ExpandableInstallation
        inst={hub.installation}
        rightSlot={
          <>
            <span className={`text-xs px-1.5 py-0.5 rounded ${ECONOMY_COLORS[hub.matchedEconomy]}`}>{hub.matchedEconomy}</span>
            {hub.bestBuffBody && (
              <span
                className="text-xs px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300"
                title={`Production buff (Raven model): ${hub.bestBuffBody.buff.reasons.join(', ')}`}
              >
                {'✨'} +{hub.bestBuffBody.buff.modifier.toFixed(1)} on {hub.bestBuffBody.body}
              </span>
            )}
            {!hub.feasibility.ok && (
              <span className="text-amber-300 text-xs italic">— {hub.feasibility.reason}</span>
            )}
          </>
        }
      />
      {hub.bestBuffBody && (
        <div className="text-[11px] text-purple-300/70 italic ml-7 mt-0.5">
          best on <span className="text-foreground not-italic">{hub.bestBuffBody.body}</span>
          {' — '}{hub.bestBuffBody.buff.reasons.join(', ')}
        </div>
      )}
    </li>
  );
}
