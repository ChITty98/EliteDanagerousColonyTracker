import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '@/store';
import {
  MATERIALS,
  MATERIAL_BY_ID,
  tradeYieldPerSource,
  CROSS_LINE_TRADE,
  type MaterialDefinition,
  type MaterialCategory,
} from '@/data/engineeringMaterials';
import { BLUEPRINTS, computeGradeCapacity } from '@/data/blueprints';
import { materialOverview, bodiesCarrying, shortBody, shortSite, type ColonyBodiesPayload } from '@/lib/colonyBodies';

// ===== Where to trade (1.61.2) =====
// The trader follows the material's category — always known, offline. The station comes from the server:
// Spansh's nearest stations with that trader, or the nearest you have docked at when Spansh is unreachable.
const TRADER: Record<MaterialCategory, { label: string; economies: string }> = {
  raw: { label: 'Raw material trader', economies: 'Extraction or Refinery stations' },
  manufactured: { label: 'Manufactured material trader', economies: 'Industrial stations' },
  encoded: { label: 'Encoded material trader', economies: 'High Tech or Military stations' },
};
const TRADER_SHORT: Record<MaterialCategory, string> = { raw: 'raw trader', manufactured: 'manufactured trader', encoded: 'encoded trader' };

interface TraderStation { station: string | null; system: string | null; ly: number | null; ls: number; largePads?: number; economy?: string | null }
interface TradersPayload {
  reference: string | null;
  traders: Record<MaterialCategory, TraderStation[]> | null;
  known: Record<MaterialCategory, TraderStation | null>;
  error: string | null;
}

const withToken = (p: string) => {
  try { const t = sessionStorage.getItem('colony-token'); return t ? `${p}${p.includes('?') ? '&' : '?'}token=${t}` : p; }
  catch { return p; }
};

function useTraders(): TradersPayload | null {
  const [d, setD] = useState<TradersPayload | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(withToken('/api/material-traders'))
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive && j) setD(j as TradersPayload); })
      .catch(() => { /* offline: the trader type still shows */ });
    return () => { alive = false; };
  }, []);
  return d;
}

const stationText = (t: TraderStation) =>
  `${t.station} · ${t.system}${t.ly != null ? ` · ${t.ly.toLocaleString()} ly` : ''} · ${t.ls.toLocaleString()} ls from the star`;

const nearestOf = (traders: TradersPayload | null, c: MaterialCategory): TraderStation | null =>
  (traders?.traders?.[c]?.[0]) || traders?.known?.[c] || null;

/** One line: which trader deals this category, and the nearest station that has one. */
function TraderNote({ category, line, traders }: { category: MaterialCategory; line?: string; traders: TradersPayload | null }) {
  if (line === 'special') return <div className="text-xs text-muted-foreground">Not sold at material traders.</div>;
  const near = nearestOf(traders, category);
  return (
    <div className="text-xs text-muted-foreground">
      Trade at a <span className="text-foreground">{TRADER[category].label}</span> — found at {TRADER[category].economies}.
      {near && <> Nearest: <span className="text-foreground">{stationText(near)}</span>.</>}
    </div>
  );
}

/** The three kinds of trader and the nearest of each, from where you are. */
function TradersCard({ traders }: { traders: TradersPayload | null }) {
  if (!traders) return null;
  const fromSpansh = !!traders.traders;
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 mb-2">
        <h2 className="text-sm font-bold text-foreground">Material traders near {traders.reference || 'you'}</h2>
        <span className="text-[11px] text-muted-foreground">
          {fromSpansh ? 'Spansh station search' : 'stations you have docked at'}
          {!fromSpansh && traders.error ? ` · Spansh unavailable (${traders.error})` : ''}
        </span>
      </div>
      <div className="space-y-1.5 text-sm">
        {(['raw', 'manufactured', 'encoded'] as MaterialCategory[]).map((c) => {
          const list = fromSpansh ? (traders.traders![c] || []) : [];
          const near = nearestOf(traders, c);
          return (
            <div key={c} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="w-32 shrink-0 font-medium text-foreground">{TRADER[c].label.replace(' material trader', '')}</span>
              <span className="w-52 shrink-0 text-xs text-muted-foreground">{TRADER[c].economies}</span>
              {near ? <span>{stationText(near)}</span> : <span className="text-muted-foreground">none found</span>}
              {list.length > 1 && <span className="text-xs text-muted-foreground">· also {list.slice(1).map((t) => `${t.station} (${t.ly} ly)`).join(', ')}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

type Tab = 'inventory' | 'trade' | 'engineering' | 'colony';

export function MaterialsPage() {
  const inv = useAppStore((s) => s.materialInventory);
  const [tab, setTab] = useState<Tab>('inventory');
  const traders = useTraders();

  if (!inv) {
    return (
      <div className="text-center py-20">
        <p className="text-4xl mb-4">{'\u{1F6E0}\u{FE0F}'}</p>
        <h2 className="text-xl font-bold text-foreground mb-2">No material inventory yet</h2>
        <p className="text-muted-foreground mb-4">
          Run <strong>Sync All from Journal</strong> on the Dashboard to scan your engineering material inventory.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Engineering Materials</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Last updated {new Date(inv.updatedAt).toLocaleString()}
          {inv.baselineFrom && <span> &middot; baseline from {inv.baselineFrom}</span>}
        </p>
      </div>

      <TradersCard traders={traders} />

      {/* Tabs */}
      <div className="flex gap-2 border-b border-border">
        {(['inventory', 'trade', 'engineering', 'colony'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t === 'inventory' && 'Inventory'}
            {t === 'trade' && 'Trade Planner'}
            {t === 'engineering' && 'Engineering Capacity'}
            {t === 'colony' && 'Colony Bodies'}
          </button>
        ))}
      </div>

      {tab === 'inventory' && <InventoryTab traders={traders} />}
      {tab === 'trade' && <TradeTab traders={traders} />}
      {tab === 'engineering' && <EngineeringTab />}
      {tab === 'colony' && <ColonyBodiesTab />}
    </div>
  );
}

// ===== Inventory tab =====

function InventoryTab({ traders }: { traders: TradersPayload | null }) {
  const inv = useAppStore((s) => s.materialInventory)!;
  const sections: { category: MaterialCategory; label: string; data: Record<string, number> }[] = [
    { category: 'raw', label: 'Raw', data: inv.raw },
    { category: 'manufactured', label: 'Manufactured', data: inv.manufactured },
    { category: 'encoded', label: 'Encoded', data: inv.encoded },
  ];
  return (
    <div className="space-y-6">
      {sections.map((s) => (
        <CategorySection key={s.category} category={s.category} label={s.label} data={s.data} traders={traders} />
      ))}
    </div>
  );
}

function CategorySection({ category, label, data, traders }: { category: MaterialCategory; label: string; data: Record<string, number>; traders: TradersPayload | null }) {
  // Group by line, then by grade.
  const byLine = useMemo(() => {
    const groups: Record<string, MaterialDefinition[]> = {};
    for (const m of MATERIALS) {
      if (m.category !== category) continue;
      if (!groups[m.line]) groups[m.line] = [];
      groups[m.line].push(m);
    }
    for (const k of Object.keys(groups)) {
      groups[k].sort((a, b) => a.grade - b.grade);
    }
    return groups;
  }, [category]);

  const total = Object.entries(data).reduce((s, [, c]) => s + (c || 0), 0);
  const typeCount = Object.values(data).filter((c) => c > 0).length;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-baseline justify-between mb-1">
        <h2 className="text-lg font-bold text-foreground">{label}</h2>
        <div className="text-xs text-muted-foreground">
          {typeCount} types &middot; {total.toLocaleString()} total
        </div>
      </div>
      <div className="mb-3"><TraderNote category={category} traders={traders} /></div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {Object.entries(byLine).map(([line, mats]) => (
          <LineGroup key={line} line={line} mats={mats} data={data} />
        ))}
      </div>
    </div>
  );
}

function LineGroup({ line, mats, data }: { line: string; mats: MaterialDefinition[]; data: Record<string, number> }) {
  return (
    <div className="rounded-lg border border-border/50 bg-muted/10 p-3">
      <div className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
        {line}
        {line === 'special' && <span className="normal-case tracking-normal"> · not sold at material traders</span>}
      </div>
      <div className="space-y-1">
        {mats.map((m) => {
          const count = data[m.id] || 0;
          const pct = (count / m.cap) * 100;
          const capped = count >= m.cap;
          const empty = count === 0;
          return (
            <div key={m.id} className={`flex items-center gap-2 text-sm ${empty ? 'opacity-40' : ''}`}>
              <span className="text-xs text-muted-foreground w-5">G{m.grade}</span>
              <span className="flex-1 truncate">{m.displayName}</span>
              <span className={`tabular-nums ${capped ? 'text-amber-400 font-bold' : 'text-foreground'}`}>
                {count}
                <span className="text-muted-foreground/50 text-xs"> / {m.cap}</span>
                {capped && <span className="ml-1">{'★'}</span>}
              </span>
              <div className="w-16 h-1.5 bg-muted/30 rounded overflow-hidden">
                <div
                  className={`h-full ${capped ? 'bg-amber-400' : 'bg-primary'}`}
                  style={{ width: `${Math.min(100, pct)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ===== Trade Planner tab =====

function TradeTab({ traders }: { traders: TradersPayload | null }) {
  const inv = useAppStore((s) => s.materialInventory)!;
  const [targetId, setTargetId] = useState('mechanicalcomponents');
  const target = MATERIAL_BY_ID.get(targetId);

  const candidates = useMemo(() => {
    if (!target) return [];
    const stockOf = (m: MaterialDefinition) => inv[m.category][m.id] || 0;
    const out: {
      mat: MaterialDefinition;
      count: number;
      sameLine: boolean;
      ratio: string;
      totalYield: number;
      yieldPerSource: number;
    }[] = [];
    for (const m of MATERIALS) {
      if (m.id === target.id) continue;
      if (m.category !== target.category) continue;
      if (m.line === 'special') continue; // Guardian/Thargoid not in standard ladder
      const count = stockOf(m);
      if (count <= 0) continue;
      const sameLine = m.line === target.line;
      const yieldPer = tradeYieldPerSource(m.grade, target.grade, sameLine);
      if (yieldPer <= 0) continue;
      let ratioStr: string;
      let totalYield: number;
      if (sameLine) {
        if (m.grade < target.grade) {
          const need = Math.pow(6, target.grade - m.grade);
          ratioStr = `${need}:1`;
          totalYield = Math.floor(count / need);
        } else {
          const factor = Math.pow(3, m.grade - target.grade);
          ratioStr = `1:${factor}`;
          totalYield = count * factor;
        }
      } else {
        const entry = CROSS_LINE_TRADE[m.grade]?.[target.grade];
        if (!entry) continue;
        ratioStr = `${entry[0]}:${entry[1]}`;
        totalYield = Math.floor(count / entry[0]) * entry[1];
      }
      out.push({ mat: m, count, sameLine, ratio: ratioStr, totalYield, yieldPerSource: yieldPer });
    }
    out.sort((a, b) => {
      if (a.sameLine !== b.sameLine) return a.sameLine ? -1 : 1;
      if (a.yieldPerSource !== b.yieldPerSource) return b.yieldPerSource - a.yieldPerSource;
      return b.totalYield - a.totalYield;
    });
    return out;
  }, [inv, target]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-muted/20 p-4">
        <label className="block text-sm font-medium mb-2">Target material</label>
        <select
          value={targetId}
          onChange={(e) => setTargetId(e.target.value)}
          className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm"
        >
          {(['raw', 'manufactured', 'encoded'] as MaterialCategory[]).map((cat) => (
            <optgroup key={cat} label={cat.charAt(0).toUpperCase() + cat.slice(1)}>
              {MATERIALS.filter((m) => m.category === cat && m.line !== 'special').map((m) => (
                <option key={m.id} value={m.id}>
                  G{m.grade} &mdash; {m.displayName} ({m.line})
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {target && (
          <div className="mt-2 text-xs text-muted-foreground">
            Currently {inv[target.category][target.id] || 0} / {target.cap} in stock.
          </div>
        )}
        {target && <div className="mt-1"><TraderNote category={target.category} line={target.line} traders={traders} /></div>}
      </div>

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/30">
            <tr>
              <th className="text-left px-3 py-2">Source</th>
              <th className="text-left px-3 py-2">Line</th>
              <th className="text-center px-3 py-2">Stock</th>
              <th className="text-center px-3 py-2">Same line</th>
              <th className="text-center px-3 py-2">Ratio</th>
              <th className="text-right px-3 py-2">Total yield</th>
            </tr>
          </thead>
          <tbody>
            {candidates.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center text-muted-foreground py-8">
                  No tradeable materials in stock for this target.
                </td>
              </tr>
            )}
            {candidates.map((c, i) => {
              const prev = candidates[i - 1];
              const showDivider = prev && prev.sameLine && !c.sameLine;
              return (
                <Fragment2 key={c.mat.id}>
                  {showDivider && (
                    <tr>
                      <td colSpan={6} className="px-3 py-1.5 text-xs text-muted-foreground bg-muted/20 italic">
                        {'─'.repeat(3)} cross-line below (6× penalty per grade) {'─'.repeat(3)}
                      </td>
                    </tr>
                  )}
                  <tr className={`border-t border-border/30 ${c.sameLine ? '' : 'opacity-60'}`}>
                    <td className="px-3 py-2">
                      <div className="text-foreground">{c.mat.displayName}</div>
                      <div className="text-xs text-muted-foreground">G{c.mat.grade}</div>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{c.mat.line}</td>
                    <td className="px-3 py-2 text-center tabular-nums">{c.count}</td>
                    <td className="px-3 py-2 text-center">
                      {c.sameLine ? (
                        <span className="text-emerald-400">{'✓'}</span>
                      ) : (
                        <span className="text-muted-foreground">{'✕'}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center font-mono text-xs">{c.ratio}</td>
                    <td className="px-3 py-2 text-right font-bold text-foreground tabular-nums">
                      {c.totalYield.toLocaleString()}
                    </td>
                  </tr>
                </Fragment2>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Stable Fragment with key for the trade table
function Fragment2(props: { children: React.ReactNode }) {
  return <>{props.children}</>;
}

// ===== Colony Bodies tab (1.63.0) =====
// Which bodies in your colony systems carry a raw material, and how much of the surface mix it is. The figures are your
// own scans (the surface ledger keeps every landable body's Materials); Spansh's figure stands in only where you have no
// scan, and says so. Nothing picked: one row per raw material. A material picked: every colony body that carries it.

const RAW_MATERIALS = MATERIALS.filter((m) => m.category === 'raw');
const recall = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const remember = (k: string, v: string | null) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private window */ } };

function useColonyBodies(): { data: ColonyBodiesPayload | null; error: string | null } {
  const [data, setData] = useState<ColonyBodiesPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(withToken('/api/materials/colony-bodies'))
      .then((r) => { if (!r.ok) throw new Error(`the server answered ${r.status}`); return r.json(); })
      .then((j) => { if (alive) setData(j as ColonyBodiesPayload); })
      .catch((e) => { if (alive) setError((e && e.message) || 'no answer from the server'); });
    return () => { alive = false; };
  }, []);
  return { data, error };
}

function ColonyBodiesTab() {
  const inv = useAppStore((s) => s.materialInventory)!;
  const { data, error } = useColonyBodies();
  const [pick, setPickState] = useState<string | null>(() => { const v = recall('materials.colonyPick'); return v && RAW_MATERIALS.some((m) => m.id === v) ? v : null; });
  const [hideIcy, setHideIcyState] = useState(() => recall('materials.colonyHideIcy') === '1');
  const setPick = (id: string | null) => { setPickState(id); remember('materials.colonyPick', id); };
  const setHideIcy = (v: boolean) => { setHideIcyState(v); remember('materials.colonyHideIcy', v ? '1' : null); };

  const shown = useMemo(() => (data ? data.bodies.filter((b) => !(hideIcy && b.icy)) : []), [data, hideIcy]);
  const overview = useMemo(() => materialOverview(shown, RAW_MATERIALS, inv.raw), [shown, inv]);
  const rows = useMemo(() => (pick ? bodiesCarrying(shown, pick) : []), [shown, pick]);

  if (error) return <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">Your colony bodies could not be read: {error}.</div>;
  if (!data) return <div className="text-sm text-muted-foreground">Reading your colony bodies…</div>;

  const def = pick ? MATERIAL_BY_ID.get(pick) : undefined;
  const held = def ? inv.raw[def.id] || 0 : 0;
  const icyCount = data.bodies.filter((b) => b.icy).length;
  const spanshCount = data.bodies.filter((b) => b.source === 'spansh').length;
  const withData = data.systems.filter((s) => s.bodies > 0).length;
  const unscanned = data.unscanned.reduce((n, u) => n + u.bodies.length, 0);
  const noLandable = data.systems.filter((s) => s.bodies === 0 && s.unscanned === 0).map((s) => s.name);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-2">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
          <div className="min-w-[16rem] flex-1">
            <label className="block text-sm font-medium mb-2" htmlFor="colony-material">Raw material</label>
            <select
              id="colony-material"
              value={pick ?? ''}
              onChange={(e) => setPick(e.target.value || null)}
              className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm"
            >
              <option value="">All raw materials</option>
              {RAW_MATERIALS.map((m) => (
                <option key={m.id} value={m.id}>G{m.grade} &mdash; {m.displayName}</option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm text-muted-foreground" htmlFor="colony-hide-icy">
            <input id="colony-hide-icy" type="checkbox" checked={hideIcy} onChange={(e) => setHideIcy(e.target.checked)} />
            Hide icy bodies ({icyCount})
          </label>
        </div>
        <div className="text-xs text-muted-foreground">
          {data.bodies.length.toLocaleString()} bodies with a surface mix on file, in {withData} of your {data.systems.length} colony systems.
          {spanshCount > 0 && <> {spanshCount} of them are Spansh figures, where you have no scan of your own.</>}
        </div>
        {def && (
          <div className="text-xs text-muted-foreground">
            <span className="text-foreground">{def.displayName}</span> is grade {def.grade}: {held} / {def.cap} held, room for {Math.max(0, def.cap - held)}.
          </div>
        )}
      </div>

      {!def && (
        <div className="rounded-lg border border-border bg-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className="text-left px-3 py-2">Material</th>
                <th className="text-right px-3 py-2">Held</th>
                <th className="text-right px-3 py-2">Room</th>
                <th className="text-right px-3 py-2">Colony bodies</th>
                <th className="text-right px-3 py-2">Best share</th>
                <th className="text-left px-3 py-2">Richest body</th>
              </tr>
            </thead>
            <tbody>
              {overview.map((o) => (
                <tr key={o.material.id} onClick={() => setPick(o.material.id)} className={`border-t border-border/30 cursor-pointer hover:bg-muted/20 ${o.bodies === 0 ? 'opacity-40' : ''}`}>
                  <td className="px-3 py-2">
                    <button type="button" onClick={(e) => { e.stopPropagation(); setPick(o.material.id); }} className="text-left text-foreground hover:underline">
                      <span className="mr-1 text-xs text-muted-foreground">G{o.material.grade}</span>{o.material.displayName}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{o.held}<span className="text-xs text-muted-foreground/50"> / {o.material.cap}</span></td>
                  <td className="px-3 py-2 text-right tabular-nums">{o.room <= 0 ? <span className="text-muted-foreground">full</span> : o.room}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{o.bodies || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-bold text-foreground">{o.bestPct == null ? '—' : `${o.bestPct}%`}</td>
                  <td className="px-3 py-2">
                    {o.best
                      ? <>{shortBody(o.best.body, o.best.system)} <span className="text-xs text-muted-foreground">{o.best.system}{o.best.icy ? ' · icy' : ''}</span></>
                      : <span className="text-muted-foreground">on none of your colony bodies</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {def && (
        <div className="rounded-lg border border-border bg-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className="text-left px-3 py-2">Body</th>
                <th className="text-left px-3 py-2">System</th>
                <th className="text-right px-3 py-2">{def.displayName}</th>
                <th className="text-right px-3 py-2">Gravity</th>
                <th className="text-left px-3 py-2">World</th>
                <th className="text-right px-3 py-2">From the star</th>
                <th className="text-left px-3 py-2">Your sites there</th>
                <th className="text-left px-3 py-2">Figure from</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-muted-foreground">No colony body on file carries {def.displayName}.</td>
                </tr>
              )}
              {rows.map((b) => (
                <tr key={b.body} className={`border-t border-border/30 ${b.icy ? 'opacity-50' : ''}`}>
                  <td className="px-3 py-2 whitespace-nowrap text-foreground">{shortBody(b.body, b.system)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{b.system}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-bold text-foreground">{b.materials[def.id]}%</td>
                  <td className="px-3 py-2 text-right tabular-nums">{b.gravity == null ? '—' : `${b.gravity.toFixed(2)} g`}</td>
                  <td className="px-3 py-2 text-xs">
                    {b.planetClass || '—'}
                    <span className="text-muted-foreground"> · {b.atmosphere === 'none' ? 'no atmosphere' : b.atmosphere || 'atmosphere not on file'}</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground whitespace-nowrap">{b.distanceLs == null ? '—' : `${b.distanceLs.toLocaleString()} ls`}</td>
                  <td className="px-3 py-2 text-xs">{b.sites.length ? b.sites.map(shortSite).join(', ') : <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{b.source === 'spansh' ? 'Spansh' : `your scan${b.at ? ` · ${new Date(b.at).toLocaleDateString()}` : ''}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="space-y-1 text-xs text-muted-foreground max-w-4xl">
        {unscanned > 0 && (
          <p>
            {unscanned} landable {unscanned === 1 ? 'body' : 'bodies'} in your colonies {unscanned === 1 ? 'has' : 'have'} no surface mix on file and {unscanned === 1 ? 'is' : 'are'} not listed:{' '}
            {data.unscanned.map((u) => `${u.system} (${u.bodies.length})`).join(', ')}. A scan of the body fills it in.
          </p>
        )}
        {noLandable.length > 0 && <p>No landable body on file in: {noLandable.join(', ')}.</p>}
        <p>The share is the material&rsquo;s part of the body&rsquo;s surface mix, from the scan. It is not a drop rate. Your colony systems are the ones with a project or marked as colonised.</p>
      </div>
    </div>
  );
}

// ===== Engineering Capacity tab =====

function EngineeringTab() {
  const inv = useAppStore((s) => s.materialInventory)!;
  const [blueprintId, setBlueprintId] = useState(BLUEPRINTS[0].id);
  const [shipCount, setShipCount] = useState(2);
  const [rollsPerShip, setRollsPerShip] = useState(25);
  const [unlockRollsPerStage, setUnlockRollsPerStage] = useState(5);
  const blueprint = BLUEPRINTS.find((b) => b.id === blueprintId);

  if (!blueprint) return null;

  const grades = ([1, 2, 3, 4, 5] as const).map((g) =>
    computeGradeCapacity(blueprint, g, inv),
  );

  // Total mat budget for "N ships, R rolls each at G5, U unlock rolls per G1-G4 stage"
  const requiredMats = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const grade of [1, 2, 3, 4] as const) {
      const recipe = blueprint.grades.find((g) => g.grade === grade);
      if (!recipe) continue;
      for (const ing of recipe.ingredients) {
        totals[ing.materialId] = (totals[ing.materialId] || 0) + ing.count * unlockRollsPerStage * shipCount;
      }
    }
    const g5 = blueprint.grades.find((g) => g.grade === 5);
    if (g5) {
      for (const ing of g5.ingredients) {
        totals[ing.materialId] = (totals[ing.materialId] || 0) + ing.count * rollsPerShip * shipCount;
      }
    }
    return totals;
  }, [blueprint, shipCount, rollsPerShip, unlockRollsPerStage]);

  const stockOf = (id: string): number => {
    const m = MATERIALS.find((x) => x.id === id);
    if (!m) return 0;
    return inv[m.category][id] || 0;
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
        <div>
          <label className="block text-sm font-medium mb-2">Blueprint</label>
          <select
            value={blueprintId}
            onChange={(e) => setBlueprintId(e.target.value)}
            className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm"
          >
            {BLUEPRINTS.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} &mdash; {b.module}
              </option>
            ))}
          </select>
          {!blueprint.verified && (
            <div className="mt-1 text-xs text-amber-400">
              {'⚠️'} Recipe not yet verified in-game; spot-check before large rolls.
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium mb-1">Ships</label>
            <input
              type="number"
              min={1}
              value={shipCount}
              onChange={(e) => setShipCount(Math.max(1, parseInt(e.target.value, 10) || 1))}
              className="w-full bg-muted border border-border rounded px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">G5 rolls / ship</label>
            <input
              type="number"
              min={1}
              value={rollsPerShip}
              onChange={(e) => setRollsPerShip(Math.max(1, parseInt(e.target.value, 10) || 1))}
              className="w-full bg-muted border border-border rounded px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Unlock rolls / stage</label>
            <input
              type="number"
              min={1}
              value={unlockRollsPerStage}
              onChange={(e) => setUnlockRollsPerStage(Math.max(1, parseInt(e.target.value, 10) || 1))}
              className="w-full bg-muted border border-border rounded px-2 py-1 text-sm"
            />
          </div>
        </div>
      </div>

      {/* Per-grade capacity */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-bold mb-3">Capacity per grade</h3>
        <div className="space-y-3">
          {grades.map((g) => g && (
            <div key={g.grade} className="border-l-2 border-primary/50 pl-3">
              <div className="flex items-baseline justify-between">
                <div className="font-medium">Grade {g.grade}</div>
                <div className={`text-sm ${g.maxRolls === 0 ? 'text-red-400' : 'text-foreground'}`}>
                  {g.maxRolls.toLocaleString()} rolls available
                </div>
              </div>
              <div className="mt-1 text-xs space-y-0.5">
                {g.ingredients.map((i) => (
                  <div key={i.materialId} className={`flex gap-2 ${i.bottleneck ? 'text-amber-400' : 'text-muted-foreground'}`}>
                    <span className="w-4">{i.bottleneck ? '★' : ' '}</span>
                    <span className="flex-1">
                      {i.material?.displayName || i.materialId}
                      {i.material && (
                        <span className="ml-1.5 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                          {i.material.line === 'special' ? 'not traded' : TRADER_SHORT[i.material.category]}
                        </span>
                      )}
                    </span>
                    <span className="tabular-nums">
                      need {i.required}, have {i.available} &rarr; {i.maxRolls} rolls
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Total material budget for the configured plan */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-bold mb-2">
          Total material budget &mdash; {shipCount} ship{shipCount > 1 ? 's' : ''} max engineered
        </h3>
        <p className="text-xs text-muted-foreground mb-3">
          Assumes {unlockRollsPerStage} rolls per G1-G4 unlock stage and {rollsPerShip} G5 rolls per ship for a near-max outcome.
        </p>
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground border-b border-border">
            <tr>
              <th className="text-left pb-1">Material</th>
              <th className="text-right pb-1">Need</th>
              <th className="text-right pb-1">Have</th>
              <th className="text-right pb-1">Gap</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(requiredMats).map(([id, needed]) => {
              const have = stockOf(id);
              const gap = needed - have;
              const m = MATERIALS.find((x) => x.id === id);
              return (
                <tr key={id} className="border-t border-border/30">
                  <td className="py-1.5">
                    <span className="text-xs text-muted-foreground mr-1">G{m?.grade ?? '?'}</span>
                    {m?.displayName || id}
                  </td>
                  <td className="text-right tabular-nums">{needed}</td>
                  <td className="text-right tabular-nums">{have}</td>
                  <td className={`text-right tabular-nums font-bold ${gap > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                    {gap > 0 ? `-${gap}` : `+${-gap}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
