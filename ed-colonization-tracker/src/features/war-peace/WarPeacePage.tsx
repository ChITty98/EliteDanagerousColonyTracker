// War & Peace — find systems in conflict (War / Civil War / Election) near a reference system.
// Backed by /api/war-peace/search which proxies Spansh and caches per BGS tick (Thursday 07:00 UTC).
//
// Filters: distance, conflict states, system allegiance, combatant allegiance (post-filter), min population.
// Each result row expands to show all conflict-state factions and the war-faction installations sorted by
// distance_to_arrival (good proxy for "how far you'll fly to find the action").

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useAppStore } from '@/store';

function apiUrl(path: string): string {
  try {
    const token = sessionStorage.getItem('colony-token');
    return token ? `${path}?token=${token}` : path;
  } catch {
    return path;
  }
}

type ConflictState = 'War' | 'Civil War' | 'Election';
type Allegiance = 'Alliance' | 'Federation' | 'Empire' | 'Independent';

interface SpanshFactionPresence {
  name: string;
  allegiance: string;
  state: string;
  influence: number;
  government?: string;
  recovering_states?: Array<string | { state: string }>;
  pending_states?: Array<string | { state: string }>;
  active_states?: Array<string | { state: string }>;
}

interface SpanshConflictStation {
  name: string;
  type?: string;
  controlling_minor_faction?: string;
  distance_to_arrival?: number;
  has_large_pad?: boolean;
}

interface WarPeaceSystem {
  id64: number;
  name: string;
  distance: number;
  allegiance: string;
  government: string;
  population: number;
  controlling_minor_faction: string;
  controlling_minor_faction_state: string;
  primary_economy: string;
  secondary_economy: string;
  minor_faction_presences: SpanshFactionPresence[];
  stations: SpanshConflictStation[];
  power?: string[];
  power_state?: string;
}

interface WarPeaceResponse {
  count: number;
  cached: boolean;
  cachedAt?: number;
  expiresAt?: number;
  totalUpstream?: number;
  results: WarPeaceSystem[];
  error?: string;
}

const ALL_STATES: ConflictState[] = ['War', 'Civil War', 'Election'];
const ALL_ALLEGIANCES: Allegiance[] = ['Alliance', 'Federation', 'Empire', 'Independent'];
const CONFLICT_STATE_SET = new Set<string>(ALL_STATES);

// Installations to filter OUT of the combat-anchor list — fleet carriers move every few days
// and aren't useful as "where the fighting is" landmarks.
const NON_ANCHOR_TYPES = new Set(['Drake-Class Carrier', 'FleetCarrier']);

function allegianceTag(a: string): string {
  if (a === 'Alliance') return 'ALL';
  if (a === 'Federation') return 'FED';
  if (a === 'Empire') return 'EMP';
  if (a === 'Independent') return 'IND';
  return a.slice(0, 3).toUpperCase();
}

function allegianceColor(a: string): string {
  if (a === 'Alliance') return 'bg-emerald-500/20 text-emerald-300';
  if (a === 'Federation') return 'bg-sky-500/20 text-sky-300';
  if (a === 'Empire') return 'bg-amber-500/20 text-amber-300';
  return 'bg-zinc-500/20 text-zinc-300';
}

function stateColor(s: string): string {
  if (s === 'War') return 'text-red-400';
  if (s === 'Civil War') return 'text-orange-400';
  if (s === 'Election') return 'text-purple-300';
  return 'text-muted-foreground';
}

function formatPop(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'k';
  return String(n);
}

export function WarPeacePage() {
  const commanderPosition = useAppStore((s) => s.commanderPosition);
  const scoutedConflicts = useAppStore((s) => s.scoutedConflicts);
  const upsertScoutedConflict = useAppStore((s) => s.upsertScoutedConflict);

  const [referenceSystem, setReferenceSystem] = useState<string>('');
  const [radiusInput, setRadiusInput] = useState<string>('100');
  // Radius parsed for use; empty / invalid → 100 default at search time, but the input field
  // stays empty during editing so the user can backspace it without it snapping back.
  const radius = useMemo(() => {
    const n = parseInt(radiusInput, 10);
    if (isNaN(n) || n < 1) return 100;
    if (n > 500) return 500;
    return n;
  }, [radiusInput]);
  const [states, setStates] = useState<ConflictState[]>(['War', 'Civil War']);
  const [allegiances, setAllegiances] = useState<Allegiance[]>([]);
  const [combatantAllegiances, setCombatantAllegiances] = useState<Allegiance[]>([]);
  const [minPopulation, setMinPopulation] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<WarPeaceResponse | null>(null);
  const [expandedSystem, setExpandedSystem] = useState<string | null>(null);
  const [scoutingSystem, setScoutingSystem] = useState<string | null>(null);
  const [scoutError, setScoutError] = useState<string | null>(null);

  const scoutSystem = useCallback(async (systemName: string) => {
    setScoutingSystem(systemName);
    setScoutError(null);
    try {
      const res = await fetch(apiUrl('/api/war-peace/scout'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ systemName }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      if (data.report) upsertScoutedConflict(data.report);
    } catch (e) {
      setScoutError(e instanceof Error ? e.message : String(e));
    } finally {
      setScoutingSystem(null);
    }
  }, [upsertScoutedConflict]);

  // Default reference: current commander system. Only fires once on mount —
  // if the user clears the field, we don't overwrite their input.
  const [initialFillDone, setInitialFillDone] = useState(false);
  useEffect(() => {
    if (!initialFillDone && commanderPosition?.systemName) {
      setReferenceSystem(commanderPosition.systemName);
      setInitialFillDone(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commanderPosition?.systemName]);

  const search = useCallback(async () => {
    if (!referenceSystem) {
      setError('Pick a reference system first.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiUrl('/api/war-peace/search'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          referenceSystem,
          radius,
          states,
          allegiances: allegiances.length > 0 ? allegiances : null,
          combatantAllegiances: combatantAllegiances.length > 0 ? combatantAllegiances : null,
          minPopulation,
          size: 200,
        }),
      });
      const data: WarPeaceResponse = await res.json();
      if (!res.ok || data.error) {
        // Clear stale results so the user doesn't see "1 system match" alongside an error
        setResponse(null);
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setResponse(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [referenceSystem, radius, states, allegiances, combatantAllegiances, minPopulation]);

  const toggleArrayItem = <T,>(arr: T[], v: T): T[] =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  const cacheLabel = useMemo(() => {
    if (!response || !response.expiresAt) return null;
    const expires = new Date(response.expiresAt);
    const diff = response.expiresAt - Date.now();
    const hours = Math.max(0, Math.floor(diff / 3_600_000));
    return `cache fresh until ${expires.toLocaleString()} (${hours}h, next BGS tick)`;
  }, [response]);

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold">⚔ War & Peace</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Find systems in conflict near you. Combat zones spawn during <span className="text-red-400">War</span> and <span className="text-orange-400">Civil War</span>.
          Election is mission-only (no CZs).
        </p>
        <p className="text-xs text-amber-400/90 mt-1">
          ⚠ Search results from Spansh may be days stale. <strong>Click the row → Scout button</strong> for live EDSM data before flying — the "in War" status here can be ahead/behind reality.
        </p>
      </div>

      {/* Filter bar */}
      <div className="bg-card border border-border rounded-lg p-4 mb-4 space-y-3">
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Reference:</span>
            <input
              type="text"
              value={referenceSystem}
              onChange={(e) => setReferenceSystem(e.target.value)}
              placeholder="System name (e.g. Aleumoxii)"
              className="px-2 py-1 bg-background border border-border rounded text-sm w-56"
            />
            {commanderPosition?.systemName && referenceSystem !== commanderPosition.systemName && (
              <button
                onClick={() => setReferenceSystem(commanderPosition.systemName)}
                className="text-xs text-primary hover:underline"
              >
                use current ({commanderPosition.systemName})
              </button>
            )}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Radius:</span>
            <input
              type="number"
              min={1}
              max={500}
              value={radiusInput}
              onChange={(e) => setRadiusInput(e.target.value)}
              className="px-2 py-1 bg-background border border-border rounded text-sm w-20"
            />
            <span className="text-xs text-muted-foreground">ly</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Min pop:</span>
            <select
              value={minPopulation}
              onChange={(e) => setMinPopulation(Number(e.target.value))}
              className="px-2 py-1 bg-background border border-border rounded text-sm"
            >
              <option value={0}>any</option>
              <option value={1000}>1k+</option>
              <option value={100000}>100k+</option>
              <option value={1000000}>1M+</option>
              <option value={10000000}>10M+</option>
              <option value={100000000}>100M+</option>
              <option value={1000000000}>1B+</option>
            </select>
          </label>
          <button
            onClick={search}
            disabled={loading || !referenceSystem}
            className="ml-auto px-4 py-1.5 bg-primary/30 text-primary rounded text-sm hover:bg-primary/40 disabled:opacity-50"
          >
            {loading ? 'Searching...' : '🔍 Search'}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-muted-foreground">State:</span>
          {ALL_STATES.map((s) => (
            <label key={s} className="flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                checked={states.includes(s)}
                onChange={() => setStates((v) => toggleArrayItem(v, s))}
              />
              <span className={stateColor(s)}>{s}</span>
              {s === 'Election' && <span className="text-[10px] text-muted-foreground">(no CZs)</span>}
            </label>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-muted-foreground">System aligned with:</span>
          {ALL_ALLEGIANCES.map((a) => (
            <label key={a} className="flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                checked={allegiances.includes(a)}
                onChange={() => setAllegiances((v) => toggleArrayItem(v, a))}
              />
              <span className={`px-1.5 py-0.5 rounded text-xs ${allegianceColor(a)}`}>{a}</span>
            </label>
          ))}
          <span className="text-xs text-muted-foreground">(empty = any)</span>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-muted-foreground">Combatant aligned with:</span>
          {ALL_ALLEGIANCES.map((a) => (
            <label key={a} className="flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                checked={combatantAllegiances.includes(a)}
                onChange={() => setCombatantAllegiances((v) => toggleArrayItem(v, a))}
              />
              <span className={`px-1.5 py-0.5 rounded text-xs ${allegianceColor(a)}`}>{a}</span>
            </label>
          ))}
          <span className="text-xs text-muted-foreground">(catches conflicts where the controlling faction isn't aligned with you)</span>
        </div>
      </div>

      {error && (
        <div className="mb-4 px-4 py-2 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive">
          {error}
        </div>
      )}

      {response && (
        <div className="mb-3 text-xs text-muted-foreground flex flex-wrap gap-3">
          <span>{response.count} system{response.count !== 1 ? 's' : ''} match</span>
          {response.totalUpstream != null && response.totalUpstream !== response.count && (
            <span>(of {response.totalUpstream} from upstream — post-filtered)</span>
          )}
          {response.cached && <span className="text-amber-400">cached</span>}
          {cacheLabel && <span>{cacheLabel}</span>}
        </div>
      )}

      {response && response.results.length > 0 && (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="text-left px-3 py-2">Distance</th>
                <th className="text-left px-3 py-2">System</th>
                <th className="text-left px-3 py-2">Population</th>
                <th className="text-left px-3 py-2">System Allegiance</th>
                <th className="text-left px-3 py-2">Controlling Faction</th>
                <th className="text-left px-3 py-2">State</th>
              </tr>
            </thead>
            <tbody>
              {response.results.map((s) => {
                const expanded = expandedSystem === s.name;
                const conflictFactions = s.minor_faction_presences.filter((f) => CONFLICT_STATE_SET.has(f.state));
                const warFactionNames = new Set(conflictFactions.map((f) => f.name));
                const warAnchors = (s.stations || [])
                  .filter((st) => st.controlling_minor_faction && warFactionNames.has(st.controlling_minor_faction))
                  .filter((st) => !st.type || !NON_ANCHOR_TYPES.has(st.type))
                  .sort((a, b) => (a.distance_to_arrival ?? Infinity) - (b.distance_to_arrival ?? Infinity));
                const nearestAnchor = warAnchors[0];
                return (
                  <>
                    <tr
                      key={s.name}
                      className="border-b border-border hover:bg-muted/30 cursor-pointer"
                      onClick={() => setExpandedSystem(expanded ? null : s.name)}
                    >
                      <td className="px-3 py-2 font-mono text-right tabular-nums">{Math.round(s.distance)} ly</td>
                      <td className="px-3 py-2 font-medium">{s.name}</td>
                      <td className="px-3 py-2 tabular-nums">{formatPop(s.population)}</td>
                      <td className="px-3 py-2">
                        <span className={`px-1.5 py-0.5 rounded text-xs ${allegianceColor(s.allegiance)}`}>
                          {allegianceTag(s.allegiance)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs">{s.controlling_minor_faction}</td>
                      <td className={`px-3 py-2 ${stateColor(s.controlling_minor_faction_state)}`}>
                        {s.controlling_minor_faction_state}
                      </td>
                    </tr>
                    {expanded && (
                      <tr key={s.name + '-detail'} className="border-b border-border bg-muted/20">
                        <td colSpan={6} className="px-3 py-3">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                            <div>
                              <div className="text-muted-foreground mb-1">Combatants (basic)</div>
                              <ul className="space-y-1">
                                {conflictFactions.map((f) => (
                                  <li key={f.name} className="flex items-center gap-2">
                                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${allegianceColor(f.allegiance)}`}>
                                      {allegianceTag(f.allegiance)}
                                    </span>
                                    <span className={`text-[10px] ${stateColor(f.state)}`}>{f.state}</span>
                                    <span className="tabular-nums text-muted-foreground">
                                      {(f.influence * 100).toFixed(1)}%
                                    </span>
                                    <span>{f.name}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                            <div>
                              <div className="text-muted-foreground mb-1">
                                Combat anchors{nearestAnchor && nearestAnchor.distance_to_arrival != null ? ` — nearest at ${nearestAnchor.distance_to_arrival.toLocaleString()} ls` : ''}
                              </div>
                              {warAnchors.length === 0 ? (
                                <div className="text-muted-foreground italic">No war-faction installations indexed</div>
                              ) : (
                                <ul className="space-y-1">
                                  {warAnchors.slice(0, 8).map((st) => (
                                    <li key={st.name} className="flex items-center gap-2">
                                      <span className="tabular-nums text-muted-foreground w-16 text-right">
                                        {(st.distance_to_arrival ?? 0).toLocaleString()} ls
                                      </span>
                                      <span className="text-muted-foreground w-20">{st.type || 'Unknown'}</span>
                                      <span>{st.name}</span>
                                      <span className="text-[10px] text-muted-foreground">· {st.controlling_minor_faction}</span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          </div>
                          <div className="mt-3 text-[11px] text-muted-foreground">
                            Power: {s.power?.join(', ') || '—'}
                            {s.power_state ? ` (${s.power_state})` : ''}
                            {' · '}
                            Economy: {s.primary_economy}{s.secondary_economy ? ` / ${s.secondary_economy}` : ''}
                            {' · '}
                            Government: {s.government}
                          </div>
                          <ScoutSection
                            systemName={s.name}
                            scoutReport={scoutedConflicts[s.id64]}
                            isScouting={scoutingSystem === s.name}
                            onScout={() => scoutSystem(s.name)}
                            scoutError={scoutingSystem === s.name ? scoutError : null}
                          />
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {response && response.results.length === 0 && (
        <div className="bg-card border border-border rounded-lg p-6 text-center text-sm text-muted-foreground">
          No conflict systems match the current filters within {radius} ly of {referenceSystem}.
        </div>
      )}
    </div>
  );
}

// --- Scout report sub-component ---

interface ScoutReportShape {
  systemName: string;
  systemAddress: number;
  scoutedAt: string;
  expiresAt: string;
  controllingFaction?: string;
  conflictPairs: Array<{
    state: string;
    paired: boolean;
    factions: Array<{ name: string; allegiance: string; influence: number; state: string }>;
  }>;
  combatAnchors: Array<{
    name: string; type?: string; distanceLs?: number; controllingFaction?: string;
    hasRefuel?: boolean; hasRepair?: boolean; hasRearm?: boolean;
  }>;
  serviceStations: Array<{
    name: string; type?: string; distanceLs?: number;
    hasRefuel?: boolean; hasRepair?: boolean; hasRearm?: boolean;
  }>;
  notes?: string[];
  sources: { spansh?: boolean; edsm?: boolean; journal?: boolean };
}

function ScoutSection(props: {
  systemName: string;
  scoutReport: ScoutReportShape | undefined;
  isScouting: boolean;
  onScout: () => void;
  scoutError: string | null;
}) {
  const { scoutReport, isScouting, onScout, scoutError } = props;
  const stale = scoutReport ? new Date(scoutReport.expiresAt).getTime() < Date.now() : false;

  return (
    <div className="mt-4 pt-3 border-t border-border">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs text-muted-foreground">
          Detailed scout report (EDSM + Spansh)
          {scoutReport && (
            <>
              {' · scouted '}
              <span className={stale ? 'text-amber-400' : 'text-emerald-400'}>
                {new Date(scoutReport.scoutedAt).toLocaleString()}
              </span>
              {stale && ' (expired — re-scout for fresh data)'}
            </>
          )}
        </div>
        <button
          onClick={onScout}
          disabled={isScouting}
          className="px-3 py-1 bg-primary/30 text-primary rounded text-xs hover:bg-primary/40 disabled:opacity-50"
        >
          {isScouting ? 'Scouting…' : (scoutReport ? '🔄 Re-scout' : '🔍 Scout system')}
        </button>
      </div>

      {scoutError && (
        <div className="mb-2 px-3 py-1 bg-destructive/10 border border-destructive/20 rounded text-xs text-destructive">
          Scout failed: {scoutError}
        </div>
      )}

      {scoutReport && (
        <div className="space-y-3 text-xs">
          {/* Conflict pairs */}
          <div>
            <div className="text-muted-foreground mb-1">Conflict pairs</div>
            {scoutReport.conflictPairs.length === 0 && (
              <div className="text-muted-foreground italic">No conflict states detected</div>
            )}
            {scoutReport.conflictPairs.map((p, i) => (
              <div key={i} className="ml-1 mb-1">
                <span className={`text-[11px] ${p.state === 'War' ? 'text-red-400' : p.state === 'Civil War' ? 'text-orange-400' : 'text-purple-300'}`}>
                  {p.state}
                </span>
                {p.paired ? (
                  <span className="ml-2">
                    <strong>{p.factions[0].name}</strong>
                    <span className={`mx-1 px-1 py-0.5 rounded text-[9px] ${allegianceColor(p.factions[0].allegiance)}`}>
                      {allegianceTag(p.factions[0].allegiance)}
                    </span>
                    <span className="text-muted-foreground"> vs </span>
                    <strong>{p.factions[1].name}</strong>
                    <span className={`mx-1 px-1 py-0.5 rounded text-[9px] ${allegianceColor(p.factions[1].allegiance)}`}>
                      {allegianceTag(p.factions[1].allegiance)}
                    </span>
                  </span>
                ) : (
                  <span className="ml-2 text-muted-foreground">
                    Multiple factions — {p.factions.map((f) => `${f.name} [${allegianceTag(f.allegiance)}]`).join(', ')}
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Combat anchors */}
          <div>
            <div className="text-muted-foreground mb-1">Combat anchors (war-faction installations)</div>
            {scoutReport.combatAnchors.length === 0 ? (
              <div className="text-muted-foreground italic">None — Spansh has no installations indexed for war factions</div>
            ) : (
              <ul className="space-y-1">
                {scoutReport.combatAnchors.slice(0, 12).map((a) => (
                  <li key={a.name} className="flex items-center gap-2">
                    <span className="tabular-nums text-muted-foreground w-16 text-right">
                      {(a.distanceLs ?? 0).toLocaleString()} ls
                    </span>
                    <span className="text-muted-foreground w-32 truncate">{a.type || 'Unknown'}</span>
                    <span className="font-medium">{a.name}</span>
                    {(a.hasRefuel || a.hasRepair || a.hasRearm) && (
                      <span className="text-[10px] text-emerald-400 ml-auto">
                        {a.hasRefuel ? '⛽' : ''}{a.hasRepair ? '🔧' : ''}{a.hasRearm ? '🔫' : ''}
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground">· {a.controllingFaction}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Service stations */}
          <div>
            <div className="text-muted-foreground mb-1">Refuel + Repair + Rearm stations (any owner)</div>
            {scoutReport.serviceStations.length === 0 ? (
              <div className="text-muted-foreground italic">None nearby — bring supplies</div>
            ) : (
              <ul className="space-y-1">
                {scoutReport.serviceStations.slice(0, 6).map((a) => (
                  <li key={a.name} className="flex items-center gap-2">
                    <span className="tabular-nums text-muted-foreground w-16 text-right">
                      {(a.distanceLs ?? 0).toLocaleString()} ls
                    </span>
                    <span className="text-muted-foreground w-32 truncate">{a.type || 'Unknown'}</span>
                    <span className="font-medium">{a.name}</span>
                    <span className="text-[10px] text-emerald-400 ml-auto">⛽🔧🔫</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Notes */}
          {scoutReport.notes && scoutReport.notes.length > 0 && (
            <div className="text-[10px] text-amber-400/80">
              {scoutReport.notes.map((n, i) => <div key={i}>⚠ {n}</div>)}
            </div>
          )}

          {/* Sources */}
          <div className="text-[10px] text-muted-foreground">
            Sources: {scoutReport.sources.spansh && 'Spansh '}
            {scoutReport.sources.edsm && 'EDSM '}
            {scoutReport.sources.journal && 'Journal'}
          </div>
        </div>
      )}
    </div>
  );
}
