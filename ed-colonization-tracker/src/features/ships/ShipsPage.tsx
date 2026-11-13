import { Fragment, useEffect, useMemo, useState } from 'react';
import { useAppStore } from '@/store';
import { formatNumber } from '@/lib/utils';
import { hullFor, PAD_LABEL } from '@/data/ships';
import { speedAndBoost, jumpRanges, shieldStrength, craftFigures, moduleLabel, friendlyType, engineeringSummary, type ShipRecord, type StoredShipEntry, type ShipLifetime, type EngineeringSummary } from '@/lib/shipStats';

/**
 * Ship stable (1.60.33) — every ship the journal has described (a Loadout per ship), where each one is
 * (the last StoredShips read), and the figures that matter when choosing one: pad size, jump unladen and
 * laden, cargo, speed and boost, shields, the craft it carries and the last craft that left it, rebuy.
 * Speed, boost and jump come from the mass-curve and FSD models validated against this commander's own
 * ships; shields are a model until an in-game figure confirms them, and say so.
 */
type SortKey = 'name' | 'pad' | 'jumpU' | 'jumpL' | 'cargo' | 'speed' | 'boost' | 'shields' | 'rebuy' | 'where';

interface Row {
  rec: ShipRecord; hullName: string; pad: string; padClass: number; known: boolean;
  where: StoredShipEntry | null; isCurrent: boolean;
  speed: number | null; boost: number | null; boostLaden: number | null;
  jumpU: number | null; jumpL: number | null; jumpJournal: number | null; boosterLy: number;
  shields: number | null; shieldBoosters: number;
  craft: ReturnType<typeof craftFigures>;
  eng: EngineeringSummary;
}

export function ShipsPage() {
  const inventory = useAppStore((s) => s.shipInventory);
  const stored = useAppStore((s) => s.storedShips);
  const craftMap = useAppStore((s) => s.shipCraft);
  const currentShip = useAppStore((s) => s.currentShip);
  const commanderPosition = useAppStore((s) => s.commanderPosition);
  const [sort, setSort] = useState<SortKey>('name');
  const [desc, setDesc] = useState(false);
  const [mediumOnly, setMediumOnly] = useState(false);
  const [rhinoOnly, setRhinoOnly] = useState(false);
  const [fightersOnly, setFightersOnly] = useState(false);
  const [engineeredOnly, setEngineeredOnly] = useState(false);
  const [showSold, setShowSold] = useState(false);
  const [openIds, setOpenIds] = useState<Set<number>>(() => new Set());
  const toggleOpen = (id: number) => setOpenIds((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  // Lifetime per ship (1.60.38): read from the journals by the server on demand, cached per file — not in the state.
  const [lifetime, setLifetime] = useState<Record<string, ShipLifetime> | null>(null);
  useEffect(() => {
    let cancelled = false;
    const t = (() => { try { return sessionStorage.getItem('colony-token'); } catch { return null; } })();
    fetch(t ? `/api/ship-lifetime?token=${t}` : '/api/ship-lifetime')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled) setLifetime((j && j.ships) || {}); })
      .catch(() => { if (!cancelled) setLifetime({}); });
    return () => { cancelled = true; };
  }, []);

  const rows = useMemo<Row[]>(() => {
    const whereById = new Map<number, StoredShipEntry>((stored?.ships ?? []).map((s) => [s.shipId, s]));
    const out: Row[] = [];
    for (const rec of Object.values(inventory)) {
      const hull = hullFor(rec.type);
      const where = whereById.get(rec.shipId) ?? null;
      const isCurrent = currentShip?.shipId === rec.shipId;
      // A ship the last StoredShips read does not list, and that is not the one being flown, was sold or
      // never belonged to this commander's current fleet — shown only on request.
      if (stored && !where && !isCurrent && !showSold) continue;
      const sb = speedAndBoost(rec, 0); const sbL = speedAndBoost(rec, rec.cargoCapacity ?? 0);
      const j = jumpRanges(rec); const sh = shieldStrength(rec);
      out.push({
        rec, hullName: friendlyType(rec.type), pad: hull ? PAD_LABEL[hull.padClass] : '?', padClass: hull?.padClass ?? 0, known: !!hull && hull.source !== 'missing',
        where, isCurrent,
        speed: sb?.speed ?? null, boost: sb?.boost ?? null, boostLaden: sbL?.boost ?? null,
        jumpU: j.unladen, jumpL: j.laden, jumpJournal: j.journal, boosterLy: j.boosterLy,
        shields: sh?.mj ?? null, shieldBoosters: sh?.boosters ?? 0,
        craft: craftFigures(rec, craftMap[String(rec.shipId)]),
        eng: engineeringSummary(rec),
      });
    }
    return out;
  }, [inventory, stored, craftMap, currentShip, showSold]);

  const filtered = rows.filter((r) => (!mediumOnly || (r.padClass > 0 && r.padClass <= 2)) && (!rhinoOnly || r.craft.rhinoCapable) && (!fightersOnly || r.craft.vesselCapacity > 0) && (!engineeredOnly || r.eng.any));
  const num = (v: number | null) => (v == null ? Number.NEGATIVE_INFINITY : v);
  const sorted = filtered.slice().sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    let d = 0;
    switch (sort) {
      case 'name': d = a.hullName.localeCompare(b.hullName) || (a.rec.name ?? '').localeCompare(b.rec.name ?? ''); break;
      case 'pad': d = a.padClass - b.padClass; break;
      case 'jumpU': d = num(a.jumpU) - num(b.jumpU); break;
      case 'jumpL': d = num(a.jumpL) - num(b.jumpL); break;
      case 'cargo': d = (a.rec.cargoCapacity ?? 0) - (b.rec.cargoCapacity ?? 0); break;
      case 'speed': d = num(a.speed) - num(b.speed); break;
      case 'boost': d = num(a.boost) - num(b.boost); break;
      case 'shields': d = num(a.shields) - num(b.shields); break;
      case 'rebuy': d = (a.rec.rebuy ?? 0) - (b.rec.rebuy ?? 0); break;
      case 'where': d = (a.where?.system ?? '').localeCompare(b.where?.system ?? ''); break;
    }
    return desc ? -d : d;
  });

  const th = (key: SortKey, label: string, title?: string, align: 'left' | 'right' = 'right') => (
    <th
      className={`px-2 py-2 text-xs font-medium text-muted-foreground cursor-pointer select-none whitespace-nowrap ${align === 'right' ? 'text-right' : 'text-left'}`}
      title={title}
      onClick={() => { if (sort === key) setDesc(!desc); else { setSort(key); setDesc(key !== 'name' && key !== 'where' && key !== 'pad'); } }}
    >
      {label}{sort === key ? (desc ? ' ▼' : ' ▲') : ''}
    </th>
  );
  const fmt = (v: number | null, digits = 0) => (v == null ? <span className="text-muted-foreground/50">n/a</span> : v.toFixed(digits));
  const here = commanderPosition?.systemName?.toLowerCase() ?? null;
  const whereText = (r: Row) => {
    if (r.isCurrent) return <span className="text-primary">flying it</span>;
    if (!r.where) return <span className="text-muted-foreground/60">not in the last fleet list</span>;
    const w = r.where;
    const local = here && w.system && w.system.toLowerCase() === here;
    return (
      <span>
        {w.station ? `${w.station}, ` : ''}{w.system ?? '?'}
        {w.inTransit && <span className="ml-1 text-amber-400">in transit</span>}
        {!local && w.transferPrice ? <span className="ml-1 text-muted-foreground/70" title="Transfer cost and time to where the fleet list was read">· {formatNumber(w.transferPrice)} cr{w.transferTime ? ` · ${Math.round(w.transferTime / 60)} min` : ''}</span> : null}
        {w.hot && <span className="ml-1 text-red-400">hot</span>}
      </span>
    );
  };
  const craftText = (r: Row) => {
    const c = r.craft; const parts: string[] = [];
    if (c.srvCount) parts.push(`${c.srvCount} SRV${c.srvCount === 1 ? '' : 's'}${c.rhinoCapable ? ' (Rhino bay)' : ''}`);
    if (c.vesselHangars) parts.push(`vessel hangar${c.vesselHangars === 1 ? '' : 's'}: ${c.vesselCapacity} craft${c.builtInVesselBay ? ' (built in)' : ''}`);
    const last = c.last ? [c.last.srv?.type, c.last.vessel?.type, c.last.fighter ? 'fighter' : null].filter(Boolean).join(', ') : '';
    return (
      <span>
        {parts.length ? parts.join(' · ') : <span className="text-muted-foreground/50">none</span>}
        {last && <span className="block text-[11px] text-muted-foreground/70" title="The last craft that launched from this ship — the Loadout names the bay, not what is parked in it">last launched: {last}</span>}
      </span>
    );
  };

  const unknownHulls = [...new Set(rows.filter((r) => !r.known).map((r) => r.hullName))];

  return (
    <div className="p-4 md:p-6 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Ship Stable</h1>
          <p className="text-xs text-muted-foreground">
            {rows.length} ship{rows.length === 1 ? '' : 's'} from the journal's Loadouts{stored?.at ? ` · fleet list read ${stored.at.slice(0, 10)} at ${stored.station ?? stored.system ?? '?'}` : ' · no fleet list read yet — dock at a shipyard'}.
            Jump unladen = the figure the game shows; laden = full tank and full hold. Speed and boost at full tank, empty hold. Lit chips are engineered modules ({'✦'} = experimental). Click a ship for its lifetime.
          </p>
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          <label className="flex items-center gap-1"><input type="checkbox" checked={mediumOnly} onChange={(e) => setMediumOnly(e.target.checked)} /> fits a medium pad</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={rhinoOnly} onChange={(e) => setRhinoOnly(e.target.checked)} /> Rhino bay</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={fightersOnly} onChange={(e) => setFightersOnly(e.target.checked)} /> vessel hangar</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={engineeredOnly} onChange={(e) => setEngineeredOnly(e.target.checked)} /> engineered</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={showSold} onChange={(e) => setShowSold(e.target.checked)} /> show ships not in the fleet list</label>
        </div>
      </div>

      {unknownHulls.length > 0 && (
        <div className="text-xs text-amber-400/90">No base figures yet for {unknownHulls.join(' and ')}: speed, boost and shields show n/a until the shipyard's base speed, boost, hull mass and shields are entered in src/data/ships.ts.</div>
      )}

      <div className="bg-card border border-border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-black/20">
            <tr>
              {th('name', 'Ship', undefined, 'left')}
              {th('where', 'Where', 'From the last StoredShips read at a shipyard', 'left')}
              {th('pad', 'Pad')}
              {th('jumpU', 'Jump', 'Unladen (as the game shows it) / laden with a full hold, ly')}
              {th('cargo', 'Cargo')}
              {th('speed', 'Speed', 'Top speed and boost, full tank, empty hold; boost with a full hold in brackets')}
              {th('boost', 'Boost')}
              {th('shields', 'Shields', 'Base shields × generator curve at hull mass × boosters — matches the shipyard screen for the Corsair (296) and the Kestrel (556)')}
              <th className="px-2 py-2 text-xs font-medium text-muted-foreground text-left">Craft</th>
              {th('rebuy', 'Rebuy')}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <Fragment key={r.rec.shipId}>
              <tr className={`border-t border-border/40 ${r.isCurrent ? 'bg-primary/5' : ''}`}>
                <td className="px-2 py-1.5">
                  <button type="button" onClick={() => toggleOpen(r.rec.shipId)} className="text-left w-full" title="Lifetime: jumps, work done, engineering history">
                    <div className="text-foreground">
                      <span className="text-muted-foreground/60 mr-1">{openIds.has(r.rec.shipId) ? '▾' : '▸'}</span>
                      {r.hullName}{r.rec.name ? <span className="text-muted-foreground"> · {r.rec.name}</span> : null}{r.rec.ident ? <span className="text-muted-foreground/60 text-xs"> {r.rec.ident}</span> : null}
                    </div>
                  </button>
                  <EngineeringChips eng={r.eng} />
                  <div className="text-[11px] text-muted-foreground/60">{r.boosterLy ? `Guardian FSD booster +${r.boosterLy} ly · ` : ''}{r.rec.updatedAt ? <span title="The Loadout this row is computed from — a refit since then shows only once the ship is boarded again">fit as of {r.rec.updatedAt.slice(0, 10)}</span> : null}</div>
                </td>
                <td className="px-2 py-1.5 text-xs">{whereText(r)}</td>
                <td className="px-2 py-1.5 text-right">{r.pad}</td>
                <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap" title={r.jumpJournal != null ? `Journal: ${r.jumpJournal.toFixed(2)} ly` : undefined}>{fmt(r.jumpU, 1)} <span className="text-muted-foreground/60">/ {fmt(r.jumpL, 1)}</span></td>
                <td className="px-2 py-1.5 text-right tabular-nums">{r.rec.cargoCapacity != null ? `${formatNumber(r.rec.cargoCapacity)} t` : '—'}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.speed)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">{fmt(r.boost)}{r.boostLaden != null && r.boost != null && Math.round(r.boostLaden) !== Math.round(r.boost) ? <span className="text-muted-foreground/60"> ({Math.round(r.boostLaden)})</span> : null}</td>
                <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">{r.shields == null ? fmt(null) : <span title={`${moduleLabel(r.rec.shieldGenerator)}${r.shieldBoosters ? ` + ${r.shieldBoosters} booster${r.shieldBoosters === 1 ? '' : 's'}` : ''}`}>{formatNumber(Math.round(r.shields))} MJ</span>}</td>
                <td className="px-2 py-1.5 text-xs">{craftText(r)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{r.rec.rebuy ? `${(r.rec.rebuy / 1e6).toFixed(1)}M` : '—'}</td>
              </tr>
              {openIds.has(r.rec.shipId) && (
                <tr className="border-t border-border/20 bg-black/10">
                  <td colSpan={10} className="px-4 py-2">
                    <LifetimePanel life={lifetime ? lifetime[String(r.rec.shipId)] : undefined} loading={lifetime == null} />
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
            {sorted.length === 0 && (
              <tr><td colSpan={10} className="px-3 py-6 text-center text-sm text-muted-foreground">No ships on file yet. Run Sync All to read every Loadout in the journals, or board a ship.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** The ship's core modules as chips — lit with the grade when engineered, ✦ for an experimental — then the engineered optional modules grouped. */
function EngineeringChips({ eng }: { eng: EngineeringSummary }) {
  const chip = 'text-[10px] leading-none px-1 py-0.5 rounded border';
  return (
    <div className="flex flex-wrap items-center gap-1 my-0.5">
      {eng.core.map((c) => (
        <span
          key={c.key}
          title={c.title}
          className={`${chip} ${c.state === 'engineered' ? 'border-amber-500/50 bg-amber-500/15 text-amber-300' : c.state === 'none' ? 'border-border/30 text-muted-foreground/30 line-through' : c.state === 'unknown' ? 'border-dashed border-border/40 text-muted-foreground/40' : 'border-border/40 text-muted-foreground/50'}`}
        >
          {c.label}{c.state === 'engineered' ? ` G${c.grade ?? '?'}` : ''}{c.experimental ? ' ✦' : ''}
        </span>
      ))}
      {eng.others.map((g) => (
        <span key={g.title} title={g.title} className={`${chip} border-amber-500/30 text-amber-300/80`}>
          {g.count > 1 ? `${g.count}× ` : ''}{g.label} G{g.grade ?? '?'}{g.experimental ? ' ✦' : ''}
        </span>
      ))}
    </div>
  );
}

/** Lifetime for one ship: flying, work done, engineering history — every journal, events credited to the ship flown. */
function LifetimePanel({ life, loading }: { life: ShipLifetime | undefined; loading: boolean }) {
  if (loading) return <div className="text-xs text-muted-foreground">Reading the journals…</div>;
  if (!life) return <div className="text-xs text-muted-foreground">Nothing in the journals for this ship yet.</div>;
  const n = (v: number) => formatNumber(Math.round(v));
  const head = 'text-[11px] uppercase tracking-wide text-muted-foreground/70 mb-1';
  const stat = (label: string, value: string) => (
    <div className="flex justify-between gap-3"><span className="text-muted-foreground">{label}</span><span className="tabular-nums text-foreground">{value}</span></div>
  );
  const span = (a: string | null, b: string | null) => {
    const x = a ? a.slice(0, 10) : '?'; const y = b ? b.slice(0, 10) : '?';
    return x === y ? x : `${x} – ${y}`;
  };
  const cr = (v: number) => (Math.abs(v) >= 1e9 ? `${(v / 1e9).toFixed(1)}B` : Math.abs(v) >= 10e6 ? `${Math.round(v / 1e6)}M` : Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `${Math.round(v / 1e3)}k` : String(Math.round(v)));
  const hull = (t: string) => { const name = friendlyType(t); return name.charAt(0).toUpperCase() + name.slice(1); };
  const e = life.earned;
  const earnedTitle = e ? [`Trade ${cr(e.trade)}`, `Community-goal sales ${cr(e.cgSales)}`, `Community-goal rewards ${cr(e.cgRewards)}`, `Missions ${cr(e.missions)}`, `Exploration ${cr(e.exploration)}`, `Combat claims ${cr(e.combat)}`].join('\n') : '';
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-xs">
      <div>
        <div className={head}>Flying</div>
        {stat('Jumps', n(life.jumps))}
        {stat('Light-years', n(life.ly))}
        {stat('Longest jump', `${life.longest.toFixed(1)} ly`)}
        {stat('Neutron boosts', n(life.neutron))}
        {life.carriedLy != null && stat('Carried on your carrier', `${n(life.carriedLy)} ly`)}
        {life.systems != null && stat('Systems visited', n(life.systems))}
        {life.farthest && life.farthest.ly > 0 && (
          <div className="flex justify-between gap-3"><span className="text-muted-foreground">Farthest from Sol</span><span className="tabular-nums text-foreground text-right" title={life.farthest.system ?? ''}>{n(life.farthest.ly)} ly{life.farthest.system ? <span className="text-muted-foreground"> · {life.farthest.system}</span> : null}</span></div>
        )}
      </div>
      <div>
        <div className={head}>Work</div>
        {stat('Bought', `${n(life.boughtT)} t`)}
        {stat('Delivered to colony depots', `${n(life.delivered)} t`)}
        {stat('Refined', `${n(life.refined)} t`)}
        {stat('Bodies scanned', n(life.scans))}
        {stat('First discoveries', n(life.firstDiscoveries))}
        {e && (
          <div className="flex justify-between gap-3" title={earnedTitle}><span className="text-muted-foreground underline decoration-dotted">Earned</span><span className="tabular-nums text-foreground">{cr(e.total)} cr</span></div>
        )}
      </div>
      <div>
        <div className={head}>Combat</div>
        {life.kills == null
          ? <div className="text-muted-foreground/60">Not read yet.</div>
          : (life.kills === 0 && !life.bonds && !life.playerKills)
            ? <div className="text-muted-foreground/60">No kills with this ship.</div>
            : (
              <>
                {stat('Ship kills', n(life.kills))}
                {!!life.bountyCr && stat('Bounties claimed', `${cr(life.bountyCr)} cr`)}
                {!!life.bonds && stat('Combat bonds', `${n(life.bonds)} · ${cr(life.bondCr ?? 0)} cr`)}
                {!!life.playerKills && stat('Player kills', n(life.playerKills))}
                {life.victims && life.victims.length > 0 && (
                  <div className="text-muted-foreground mt-0.5">Most often: {life.victims.map((v) => `${hull(v.name)} ${n(v.count)}`).join(' · ')}</div>
                )}
              </>
            )}
      </div>
      <div>
        <div className={head}>Engineering history</div>
        {life.engineers.length === 0
          ? <div className="text-muted-foreground/60">No crafts on this ship.</div>
          : life.engineers.map((e) => (
            <div key={e.name} className="flex justify-between gap-3">
              <span className="text-foreground">{e.name}</span>
              <span className="tabular-nums text-muted-foreground">{e.crafts} craft{e.crafts === 1 ? '' : 's'} · {span(e.first, e.last)}</span>
            </div>
          ))}
      </div>
    </div>
  );
}
