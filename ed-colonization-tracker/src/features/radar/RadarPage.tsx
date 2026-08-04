/**
 * Proximity Activity Radar — commander activity within 200 ly of the player, live + 7-day lookback.
 *
 * Visuals ported from activity-radar-mockup.html: deep-void charcoal, amber phosphor scope,
 * quarter-step range rings, slow sweep, signal colors reserved for meaning (build = ember — THE
 * HEADLINE, prospect = viridian, conflict = red, power = cyan, traffic = pale).
 * Y-axis (above/below galactic plane) is REQUIRED and rendered as leader-lines: blip floats
 * above/below its plane-shadow dot, stem length = magnitude, exact offset in the readout.
 *
 * Touch-first identification: hover does not exist on the iPad, so nothing may depend on it.
 * Signal blips carry always-on name labels; tapping any blip (including anonymous traffic)
 * pins an info card. Tooltips remain as a desktop nicety only.
 *
 * Honesty rules (load-bearing): EDDN is anonymized — activity and counts only, never identities;
 * counts phrased "…that I've heard of" (only tool-running commanders are audible); empty scope =
 * "quiet, nothing heard", never invented blips; boxel gaps are a TEXT NOTICE, never blips (they
 * have no coordinates by definition). Zoom never hides silently — off-scope contacts are counted.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '@/store';
import { sseSubscribe } from '@/services/sseBus';
import { parseBoxel } from '@/lib/starNaming';
import { enumerateBoxel, type BoxelEnumeration } from '@/services/spanshApi';

// ---- server payload shapes -------------------------------------------------------------------
interface BuildEv { sys: string; pos: number[] | null; ev: string; stationName?: string | null; at: number; distLy?: number }
interface LeadEv { sys: string; body: string; atmo: string; pos: number[] | null; at: number; newToYou: boolean; distLy?: number }
interface LiveProspect { name: string; pos: number[] | null; at: number; partial: boolean; newToYou: boolean; bodies: number; complete: boolean; score: number }
interface ConflictEv { sys: string; pos: number[] | null; factions: Array<{ name: string; state: string }>; at: number }
interface PowerEv { sys: string; pos: number[] | null; power?: string | null; faction?: string | null; allegiance?: string | null; population?: number; at: number }
interface ScoutedRow { name: string; pos: number[]; distLy: number; score: number; isColonised: boolean; atmospheres: number; oxygen: number }
interface LookbackRow { name: string; pos: number[]; distLy: number; updatedAt: string | null; power?: string | null; faction?: string | null; allegiance?: string | null; population?: number }
interface RadarSnap {
  center: { system: string; pos: number[] | null };
  range: number; at: number;
  eddn: { connected: boolean; msgs: number; inRadius: number };
  density: { liveCmdrs: number; positions?: number[][]; windowMin: number; weekSystems: number };
  builds: BuildEv[]; atmoLeads: LeadEv[]; liveProspects: LiveProspect[];
  conflicts: ConflictEv[]; power: PowerEv[];
  scouted: ScoutedRow[];
  lookback: { fetchedAt: number; systems: LookbackRow[] };
  centerTraffic?: { sys: string; edsm: { day: number; week: number; total: number } | null; liveVisitors: number; windowH: number };
}
interface Ping { kind: string; sys?: string; pos?: number[]; at: number; id: number }
interface Sel { cls: string; title: string; lines: string[] }

const token = () => { try { return sessionStorage.getItem('colony-token'); } catch { return null; } };
const q = (p: string) => { const t = token(); return t ? `${p}${p.includes('?') ? '&' : '?'}token=${t}` : p; };

const fmtPop = (n?: number) => !n ? '—' : n >= 1e9 ? `${(n / 1e9).toFixed(1)} B` : n >= 1e6 ? `${(n / 1e6).toFixed(0)} M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)} k` : String(n);
const ago = (at: number) => {
  const s = Math.max(0, (Date.now() - at) / 1000);
  if (s < 90) return `${Math.round(s)}s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 129600) return `${Math.round(s / 3600)} hr ago`;
  return `${Math.round(s / 86400)} d ago`;
};
const elev = (dy: number) => `${dy >= 0 ? '+' : '−'}${Math.abs(Math.round(dy))} ly ${dy >= 0 ? '▲' : '▼'}`;

type LayerKey = 'prospects' | 'atmo' | 'builds' | 'conflicts' | 'power' | 'traffic';
const LAYERS: Array<{ key: LayerKey; label: string; cls: string }> = [
  { key: 'builds', label: 'Colonization', cls: 'build' },
  { key: 'prospects', label: 'High-score sites', cls: 'prospect' },
  { key: 'atmo', label: 'Atmospheres', cls: 'prospect' },
  { key: 'conflicts', label: 'Conflicts', cls: 'conflict' },
  { key: 'power', label: 'Power/faction', cls: 'power' },
  { key: 'traffic', label: 'Traffic', cls: 'commander' },
];
const RANGE_OPTS = [25, 50, 100, 200];

export function RadarPage() {
  const radarThreshold = useAppStore((s) => s.settings.radarThreshold) ?? 70;
  const range = useAppStore((s) => s.settings.radarRange) ?? 200;
  const view = (useAppStore((s) => s.settings.radarView) === '3d' ? '3d' : '2d') as '2d' | '3d';
  const updateSettings = useAppStore((s) => s.updateSettings);
  const [azim, setAzim] = useState(0); // 3D orbit azimuth, degrees — drag to rotate
  const dragRef = useRef<{ x: number; az: number; moved: boolean } | null>(null);

  const [snap, setSnap] = useState<RadarSnap | null>(null);
  const [pings, setPings] = useState<Ping[]>([]);
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({
    builds: true, prospects: true, atmo: true, conflicts: true, power: false, traffic: true,
  });
  const [boxel, setBoxel] = useState<{ system: string; note: string } | null>(null);
  const [sel, setSel] = useState<Sel | null>(null);
  const [fs, setFs] = useState(false);
  const [pollFails, setPollFails] = useState(0);
  const seq = useRef(0);
  const boxelFor = useRef('');

  const load = useCallback(() => {
    fetch(q('/api/radar/state'))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (d && !d.error) { setSnap(d); setPollFails(0); } })
      .catch(() => setPollFails((n) => n + 1)); // server unreachable (exe closed?) — flag, don't lie
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 10_000);
    const off = sseSubscribe('radar_ping', (raw) => {
      const e = raw as Record<string, unknown>;
      const id2 = ++seq.current;
      setPings((p) => [...p, {
        kind: String(e.kind || 'traffic'), sys: e.sys ? String(e.sys) : undefined,
        pos: Array.isArray(e.pos) ? (e.pos as number[]) : undefined, at: Date.now(), id: id2,
      }].slice(-40));
      window.setTimeout(() => setPings((p) => p.filter((x) => x.id !== id2)), 12_000);
    });
    return () => { clearInterval(id); off(); };
  }, [load]);

  // Fullscreen: CSS overlay always works; the Fullscreen API is best-effort (hides browser
  // chrome where supported — iPad Safari 16.4+). Esc / system exit syncs the overlay off.
  const toggleFs = useCallback(() => {
    setFs((cur) => {
      const next = !cur;
      try {
        if (next) void document.documentElement.requestFullscreen?.();
        else if (document.fullscreenElement) void document.exitFullscreen?.();
      } catch { /* API unavailable — CSS overlay still applies */ }
      return next;
    });
  }, []);
  useEffect(() => {
    const h = () => { if (!document.fullscreenElement) setFs((cur) => (cur ? false : cur)); };
    document.addEventListener('fullscreenchange', h);
    return () => document.removeEventListener('fullscreenchange', h);
  }, []);

  // Boxel-gap notice — TEXT ONLY, never blips (gaps have no coordinates by definition).
  useEffect(() => {
    const sys = snap?.center.system || '';
    if (!sys || boxelFor.current === sys) return;
    boxelFor.current = sys;
    const b = parseBoxel(sys);
    if (!b) { setBoxel({ system: sys, note: 'Named system — no procedural boxel to check.' }); return; }
    setBoxel({ system: sys, note: `Checking boxel ${b.boxel}…` });
    enumerateBoxel(b.prefix)
      .then((en: BoxelEnumeration) => {
        if (boxelFor.current !== sys) return;
        // Gap names read like the in-game suffix: boxel "… d9" + index 13 → "d9-13".
        const suffix = b.boxel.split(' ').pop() || b.massCode;
        const gaps = en.gaps.slice(0, 8).map((g) => `${suffix}-${g.index}`);
        setBoxel({
          system: sys,
          note: en.gaps.length === 0
            ? `Current boxel ${b.boxel}: all ${en.known.length} expected systems known.`
            : `Current boxel ${b.boxel}: ${en.gaps.length} expected system(s) undiscovered — ${gaps.join(', ')}${en.gaps.length > 8 ? '…' : ''} (sequence runs to ${en.maxIndex}).`,
        });
      })
      .catch(() => { if (boxelFor.current === sys) setBoxel({ system: sys, note: 'Boxel check unavailable right now.' }); });
  }, [snap]);

  // ---- projection: X/Z plane top-down (+Z up), Y as leader stems ------------------------------
  // Scale derives from the zoom range; stems scale with it so vertical resolution improves as
  // you zoom (0.2·SCALE/ly ≈ the original 0.45 at 200 ly). Beyond-range blips are NOT drawn —
  // they're tallied into the on-scope/beyond counter instead (nothing hides silently).
  const C = snap?.center.pos ?? null;
  const SCALE = 448 / range;
  // 3D projection: disc tilted TILT deg from top-down; drag orbits (azim). Ground plane
  // foreshortens by cos(tilt) on the depth axis; the Y offset becomes REAL height at
  // sin(tilt), clamped so extreme off-plane contacts stay on screen. 2D is the classic
  // top-down with symbolic stems.
  const TILT_COS = 0.469, TILT_SIN = 0.883; // 62 deg
  const project = useCallback((pos?: number[] | null) => {
    if (!C || !pos || pos.length < 3) return null;
    const dx = pos[0] - C[0], dy = pos[1] - C[1], dz = pos[2] - C[2];
    if (Math.hypot(dx, dz) > range) return null;
    const dist = Math.hypot(dx, dy, dz);
    if (view === '3d') {
      const a = (azim * Math.PI) / 180;
      const u = dx * Math.cos(a) + dz * Math.sin(a);
      const v = -dx * Math.sin(a) + dz * Math.cos(a);
      return {
        x: 500 + u * SCALE,
        y: 500 - v * SCALE * TILT_COS,
        stem: Math.max(-150, Math.min(150, dy * SCALE * TILT_SIN)),
        dy,
        dist,
      };
    }
    return {
      x: 500 + dx * SCALE,
      y: 500 - dz * SCALE,
      stem: Math.max(-90, Math.min(90, dy * SCALE * 0.2)),
      dy,
      dist,
    };
  }, [C, SCALE, range, view, azim]);
  // Zoom-independent 3D distance for readout rows (the lists always show it, whatever the zoom).
  const distOf = useCallback((pos?: number[] | null) => {
    if (!C || !pos || pos.length < 3) return null;
    return Math.hypot(pos[0] - C[0], pos[1] - C[1], pos[2] - C[2]);
  }, [C]);

  const thresholded = useMemo(() => {
    const scouted = (snap?.scouted ?? []).filter((s) => s.score >= radarThreshold);
    // Score-0 partial captures are UNSCOREABLE (a couple of drive-by planet scans, no star
    // data), not honestly-rated-zero — they never enter the high-score layer at any
    // threshold. They stay visible as scan pings and atmosphere leads.
    const live = (snap?.liveProspects ?? []).filter((s) => !(s.partial && s.score === 0) && s.score >= radarThreshold);
    return { scouted, live };
  }, [snap, radarThreshold]);

  // Why-is-this-empty context: distance to the nearest scored scouted system. When your
  // scouted turf is thousands of ly away, the layer being dark is geography, not a bug.
  const scoutedAll = useAppStore((s) => s.scoutedSystems);
  const nearestScoutedLy = useMemo(() => {
    if (!C) return null;
    let best = Infinity;
    for (const v of Object.values(scoutedAll || {})) {
      const c = v && (v as { coordinates?: { x: number; y: number; z: number } }).coordinates;
      if (!c || typeof c.x !== 'number') continue;
      const d = Math.hypot(c.x - C[0], c.y - C[1], c.z - C[2]);
      if (d < best) best = d;
    }
    return Number.isFinite(best) ? best : null;
  }, [scoutedAll, C]);

  // Per-layer on-scope counts at the current zoom, plus how many the zoom is hiding.
  const plotted = useMemo(() => {
    const counts: Record<LayerKey, number> = { builds: 0, prospects: 0, atmo: 0, conflicts: 0, power: 0, traffic: 0 };
    let beyond = 0;
    const tally = (key: LayerKey, pos?: number[] | null) => {
      if (!C || !pos || pos.length < 3) return;
      if (Math.hypot(pos[0] - C[0], pos[2] - C[2]) > range) beyond += 1;
      else counts[key] += 1;
    };
    (snap?.builds ?? []).forEach((b) => tally('builds', b.pos));
    thresholded.scouted.forEach((s) => tally('prospects', s.pos));
    thresholded.live.forEach((s) => tally('prospects', s.pos));
    (snap?.atmoLeads ?? []).forEach((l) => tally('atmo', l.pos));
    (snap?.conflicts ?? []).forEach((c) => tally('conflicts', c.pos));
    (snap?.power ?? []).forEach((p) => tally('power', p.pos));
    pings.forEach((p) => tally('traffic', p.pos));
    const onScope = (Object.keys(counts) as LayerKey[]).reduce((a, k) => a + counts[k], 0);
    return { counts, beyond, onScope };
  }, [snap, thresholded, pings, C, range]);

  const linkDown = pollFails >= 2; // two missed polls ≈ 20 s — the server (the exe) is gone
  const showNames = range <= 50;   // labels for the noisy layers too once there's room
  const dismiss = useCallback(() => setSel(null), []);

  // ACTIVE NEARBY follows the zoom: count anonymous uploader positions within the selected
  // range (3D distance). Older servers don't send positions — fall back to the 200 ly count.
  const cmdrsNear = useMemo(() => {
    const posns = snap?.density.positions;
    if (!posns || !C) return { n: snap?.density.liveCmdrs ?? 0, ranged: false };
    return { n: posns.filter((p) => (distOf(p) ?? Infinity) <= range).length, ranged: true };
  }, [snap, C, range, distOf]);

  // Score input: local text state so the field can be emptied while typing (a controlled
  // number input that force-parses '' to 0 can never be cleared — iPad report). Valid numbers
  // commit live; blur restores the committed value if the field is left blank/junk.
  const [thrText, setThrText] = useState(String(radarThreshold));
  useEffect(() => { setThrText(String(radarThreshold)); }, [radarThreshold]);
  const onThr = useCallback((raw: string) => {
    setThrText(raw);
    if (raw.trim() === '') return;
    const n = Number(raw);
    if (Number.isFinite(n)) updateSettings({ radarThreshold: Math.max(0, Math.min(200, Math.round(n))) });
  }, [updateSettings]);

  const disc = 'Activity from EDDN — reflects commanders running data tools; counts are approximate and anonymized. "Quiet" means nothing heard, not necessarily empty space.';

  return (
    <div className={`rdr overflow-hidden ${fs ? 'fixed inset-0 z-50' : 'fixed inset-0 z-0 lg:static lg:h-[calc(100vh-3rem)]'}`}>
      <style>{RADAR_CSS}</style>
      <div className="rdr-frame">
        {/* top bar — auto-height: controls wrap into visible rows instead of clipping (iPad) */}
        <div className="rdr-topbar">
          <div className="rdr-brand"><span className="rdr-dot" /> PROXIMITY RADAR</div>
          <div className="rdr-loc">CENTER <b>{snap?.center.system || '—'}</b></div>
          <div className="rdr-spacer" />
          <div className="rdr-filters">
            {LAYERS.map((l) => (
              <button key={l.key}
                className={`rdr-filter ${layers[l.key] ? 'on' : ''} f-${l.cls}`}
                onClick={() => setLayers((s) => ({ ...s, [l.key]: !s[l.key] }))}>
                {l.label}<span className="ct">{plotted.counts[l.key]}</span>
              </button>
            ))}
          </div>
          <label className="rdr-thresh" title="High-score layer threshold — your composite rating">
            SCORE ≥ <input type="text" inputMode="numeric" value={thrText}
              onChange={(e) => onThr(e.target.value)}
              onBlur={() => { if (thrText.trim() === '' || !Number.isFinite(Number(thrText))) setThrText(String(radarThreshold)); }} />
          </label>
          <div className="rdr-rangectl" title="Radar zoom — display range in ly">
            {RANGE_OPTS.map((r) => (
              <button key={r} className={`rdr-rbtn ${range === r ? 'on' : ''}`}
                onClick={() => updateSettings({ radarRange: r })}>{r}</button>
            ))}
            <span className="u">LY</span>
          </div>
          <div className="rdr-rangectl" title="Projection — 3D tilts the disc; drag to orbit">
            {(['2d', '3d'] as const).map((v) => (
              <button key={v} className={`rdr-rbtn ${view === v ? 'on' : ''}`}
                onClick={() => updateSettings({ radarView: v })}>{v.toUpperCase()}</button>
            ))}
          </div>
          <button className="rdr-fsbtn" onClick={toggleFs}>{fs ? '✕ EXIT' : '⛶ FULL'}</button>
          <div className={`rdr-live ${linkDown || !snap?.eddn.connected ? 'down' : ''}`}>
            <span className="rdr-dot" /> {linkDown ? 'LINK DOWN' : snap?.eddn.connected ? 'EDDN LIVE' : 'EDDN DOWN'}
          </div>
        </div>

        {/* scope */}
        <div className="rdr-scope-wrap">
          <svg className="rdr-scope" viewBox="0 0 1000 1000"
            onClick={() => {
              // A drag that just ended must not dismiss the card
              if (dragRef.current?.moved) { dragRef.current = null; return; }
              dragRef.current = null;
              dismiss();
            }}
            onPointerDown={view === '3d' ? (e) => { dragRef.current = { x: e.clientX, az: azim, moved: false }; } : undefined}
            onPointerMove={view === '3d' ? (e) => {
              const d = dragRef.current;
              if (!d) return;
              const dx = e.clientX - d.x;
              if (Math.abs(dx) > 4) d.moved = true;
              if (d.moved) setAzim(((d.az + dx * 0.4) % 360 + 360) % 360);
            } : undefined}
            onPointerLeave={() => { dragRef.current = null; }}>
            {/* Plane geometry (rings/axes/sweep/center) — squashed to an ellipse in 3D.
                Text labels live OUTSIDE the scaled group so they never distort. */}
            <g transform={view === '3d' ? `translate(0 ${500 * (1 - TILT_COS)}) scale(1 ${TILT_COS})` : undefined}>
              {[0.25, 0.5, 0.75, 1].map((f) => (
                <circle key={f} className="rdr-ring" cx="500" cy="500" r={448 * f} />
              ))}
              <line className="rdr-ring rdr-axis" x1="500" y1="52" x2="500" y2="948" />
              <line className="rdr-ring rdr-axis" x1="52" y1="500" x2="948" y2="500" />
              <g className="rdr-sweep"><path d="M500,500 L500,52 A448,448 0 0 1 654,79 Z" /></g>
              <circle className="rdr-center-glow" cx="500" cy="500" r="26" />
              <circle className="rdr-center" cx="500" cy="500" r="5" />
            </g>
            {[0.25, 0.5, 0.75, 1].map((f) => (
              <text key={f} className="rdr-ring-label" x="505"
                y={500 - 448 * f * (view === '3d' ? TILT_COS : 1) + 12}>
                {Math.round(range * f)}{f === 1 ? ' LY' : ''}
              </text>
            ))}
            {/* Rim anchor: direction to Sagittarius A*. A compass "N" is Sol-neighborhood
                convention — this close to the core it means nothing; the core itself is THE
                landmark ("north loses its meaning a bit this close to Sag A*"). Projected
                like any contact, so it stays honest through zoom and 3D orbit. */}
            {C && (() => {
              const ddx = 25.21875 - C[0], ddz = 25899.96875 - C[2];
              const len = Math.hypot(ddx, ddz);
              if (len < 1) return null; // parked AT the core — no direction to point
              const ux = ddx / len, uz = ddz / len;
              let px: number, py: number;
              if (view === '3d') {
                const a = (azim * Math.PI) / 180;
                const u = ux * Math.cos(a) + uz * Math.sin(a);
                const v = -ux * Math.sin(a) + uz * Math.cos(a);
                px = 500 + u * 468; py = 500 - v * 468 * TILT_COS;
              } else {
                px = 500 + ux * 468; py = 500 - uz * 468;
              }
              return <text className="rdr-anchor" textAnchor="middle" x={px} y={py + 4}>{'✦'} SAG A*</text>;
            })()}

            {/* lookback scouted prospects (dim, static) */}
            {layers.prospects && thresholded.scouted.map((s) => {
              const p = project(s.pos); if (!p) return null;
              return <Blip key={`sc:${s.name}`} p={p} cls="prospect" dim name={s.name} onSel={setSel}
                info={{ title: s.name, lines: [`score ${s.score} · your list${s.isColonised ? ' · colonised' : ''}`, `${s.oxygen ? `${s.oxygen} oxygen · ` : ''}${s.atmospheres} atmospheres`, `${Math.round(p.dist)} ly · ${elev(p.dy)}`] }}
                label={`${s.name} · score ${s.score} · ${elev(p.dy)}`} />;
            })}
            {/* live prospects ≥ threshold */}
            {layers.prospects && thresholded.live.map((s) => {
              const p = project(s.pos); if (!p) return null;
              return <Blip key={`lp:${s.name}`} p={p} cls="prospect" ping name={s.name} onSel={setSel}
                info={{ title: s.name, lines: [`live score ${s.score}${s.partial ? ' (partial scan)' : ''}${s.newToYou ? ' · NEW TO YOU' : ''}`, `${s.bodies} bodies · ${ago(s.at)}`, `${Math.round(p.dist)} ly · ${elev(p.dy)}`] }}
                label={`${s.name} · live score ${s.score}${s.partial ? ' (partial)' : ''} · ${elev(p.dy)}`} />;
            })}
            {/* atmosphere leads */}
            {layers.atmo && (snap?.atmoLeads ?? []).map((l) => {
              const p = project(l.pos); if (!p) return null;
              const body = l.body.replace(l.sys, '').trim() || l.body;
              return <Blip key={`al:${l.sys}:${l.body}`} p={p} cls="prospect" ping={l.newToYou} name={l.sys} onSel={setSel}
                info={{ title: l.sys, lines: [`${body} · ${l.atmo}`, `${ago(l.at)}${l.newToYou ? ' · NEW TO YOU' : ' · already in your data'}`, `${Math.round(p.dist)} ly · ${elev(p.dy)}`] }}
                label={`${l.body} · ${l.atmo} · ${elev(p.dy)}`} />;
            })}
            {/* builds — the headline */}
            {layers.builds && (snap?.builds ?? []).map((b, i) => {
              const p = project(b.pos); if (!p) return null;
              return <Blip key={`b:${i}:${b.sys}`} p={p} cls="build" ping halo name={b.sys} onSel={setSel}
                info={{ title: b.sys, lines: [`${b.ev}${b.stationName ? ` · ${b.stationName}` : ''}`, ago(b.at), `${Math.round(p.dist)} ly · ${elev(p.dy)}`] }}
                label={`${b.sys} · ${b.ev} · ${elev(p.dy)}`} />;
            })}
            {/* conflicts */}
            {layers.conflicts && (snap?.conflicts ?? []).map((c) => {
              const p = project(c.pos); if (!p) return null;
              return <Blip key={`c:${c.sys}`} p={p} cls="conflict" name={c.sys} onSel={setSel}
                info={{ title: c.sys, lines: [c.factions.map((f) => f.state).join(' / '), c.factions.map((f) => f.name).slice(0, 2).join(' vs. '), `${Math.round(p.dist)} ly · ${elev(p.dy)}`] }}
                label={`${c.sys} · ${c.factions.map((f) => f.state).join('/')} · ${elev(p.dy)}`} />;
            })}
            {/* power (off by default; labels only when zoomed — these can be numerous) */}
            {layers.power && (snap?.power ?? []).map((c) => {
              const p = project(c.pos); if (!p) return null;
              return <Blip key={`p:${c.sys}`} p={p} cls="power" small name={showNames ? c.sys : undefined} onSel={setSel}
                info={{ title: c.sys, lines: [`${c.power || c.allegiance || '—'}${c.faction ? ` · ${c.faction}` : ''}`, `pop ${fmtPop(c.population)}`, `${Math.round(p.dist)} ly · ${elev(p.dy)}`] }}
                label={`${c.sys} · ${c.power || c.allegiance || ''} · pop ${fmtPop(c.population)}`} />;
            })}
            {/* transient live traffic pings (anonymous, fade out; tap for what little is known) */}
            {layers.traffic && pings.map((pg) => {
              const p = project(pg.pos); if (!p) return null;
              const cls = pg.kind === 'build' ? 'build' : pg.kind === 'lead' || pg.kind === 'scan' ? 'prospect' : 'commander';
              return (
                <g key={pg.id} className="rdr-blip" transform={`translate(${p.x},${p.y - p.stem})`}
                  onClick={(e) => { e.stopPropagation(); setSel({ cls, title: pg.sys || 'Traffic contact', lines: ['anonymous traffic — one message heard', ago(pg.at), `${Math.round(p.dist)} ly · ${elev(p.dy)}`] }); }}>
                  <title>{`${pg.sys || 'traffic'} · ${Math.round(p.dist)} ly · ${elev(p.dy)}`}</title>
                  <circle className={`rdr-ping ${cls}`} r="5" fill="none" strokeWidth="1.5" />
                  <circle className={`rdr-tr ${cls}`} r="2.4" />
                  {showNames && pg.sys && <text className={`rdr-lbl ${cls}`} x="9" y="3.5">{pg.sys}</text>}
                </g>
              );
            })}
          </svg>

          <div className="rdr-onscope">
            {plotted.onScope} ON SCOPE{plotted.beyond > 0 ? ` · +${plotted.beyond} BEYOND ${range} LY` : ''}
          </div>

          {sel && (
            <div className={`rdr-card ${sel.cls}`}>
              <div className="t"><span>{sel.title}</span><span className="x" onClick={dismiss}>✕</span></div>
              {sel.lines.map((l, i) => <div key={i} className="l">{l}</div>)}
            </div>
          )}

          <div className="rdr-legend">
            <div><span className="lg build" />Colonization / build</div>
            <div><span className="lg prospect" />Site match (your criteria)</div>
            <div><span className="lg conflict" />Conflict</div>
            <div><span className="lg power" />Power / faction</div>
            <div><span className="lg commander" />Traffic (anonymous)</div>
            <div className="lg-note">stem = above/below plane · tap a blip to identify</div>
          </div>
        </div>

        {/* readout */}
        <div className="rdr-readout">
          <div className="rdr-stat-grid">
            <div className="rdr-stat"><div className="k">ACTIVE NEARBY</div><div className="v">~{cmdrsNear.n}</div><div className="s">cmdrs{cmdrsNear.ranged ? ` ≤${range} ly` : ''}, {snap?.density.windowMin ?? 15} min — that I've heard of</div></div>
            <div className="rdr-stat"><div className="k">THIS WEEK</div><div className="v">{snap?.density.weekSystems ?? 0}</div><div className="s">systems updated ≤7 d in range</div></div>
            <div className="rdr-stat"><div className="k">STREAM</div><div className="v">{snap?.eddn.inRadius ?? 0}</div><div className="s">in-radius msgs since boot</div></div>
          </div>

          {/* center-system traffic: EDSM counts visits; the unique number is ours */}
          {snap?.centerTraffic && (
            <div className="rdr-ctraffic">
              <div className="k">🚦 CENTER TRAFFIC — {snap.centerTraffic.sys || '—'}</div>
              <div className="s">
                {snap.centerTraffic.edsm
                  ? `~${snap.centerTraffic.edsm.day} arrivals today · ${snap.centerTraffic.edsm.week} this week (EDSM-logged visits)`
                  : 'EDSM: no traffic data'}
                {` · ${snap.centerTraffic.liveVisitors} unique heard here ≤${snap.centerTraffic.windowH} h`}
              </div>
            </div>
          )}

          {/* boxel notice — text only, never a blip */}
          <div className="rdr-boxel">
            <div className="k">🔭 BOXEL WATCH</div>
            <div className="s">{boxel?.note || 'Waiting for position…'}</div>
          </div>

          <Section title="Site matches — your criteria">
            {(snap?.atmoLeads ?? []).slice(0, 12).map((l, i) => (
              <Feed key={`fl:${i}`} pip="prospect"
                sys={l.sys} tag={l.newToYou ? 'NEW TO YOU' : undefined} live={Date.now() - l.at < 30 * 60_000}
                meta={`${l.body.replace(l.sys, '').trim() || l.body} · ${l.atmo} · ${ago(l.at)}${!l.newToYou ? ' · already in your data' : ''}`}
                dist={l.distLy != null ? `${l.distLy} ly` : ''} />
            ))}
            {thresholded.live.slice(0, 4).map((s, i) => (
              <Feed key={`flp:${i}`} pip="prospect" sys={s.name} tag={s.newToYou ? 'NEW TO YOU' : undefined} live
                meta={`live score ${s.score}${s.partial ? ' (partial scan)' : ''} · ${s.bodies} bodies · ${ago(s.at)}`} dist="" />
            ))}
            {thresholded.scouted.slice(0, 6).map((s) => (
              <Feed key={`fsc:${s.name}`} pip="prospect" sys={s.name}
                meta={`score ${s.score}${s.oxygen ? ` · ${s.oxygen} oxygen` : ''}${s.isColonised ? ' · colonised' : ''} · your list`}
                dist={`${s.distLy} ly`} />
            ))}
            {(snap?.atmoLeads ?? []).length + thresholded.live.length + thresholded.scouted.length === 0 && (
              <div className="rdr-empty">
                {nearestScoutedLy != null && nearestScoutedLy > 200
                  ? `Nothing matching within 200 ly — your nearest scouted system is ~${nearestScoutedLy >= 1000 ? `${(nearestScoutedLy / 1000).toFixed(1)} kly` : `${Math.round(nearestScoutedLy)} ly`} away. Score this region via Expansion to light this layer up.`
                  : 'Nothing matching within 200 ly — quiet, or your threshold is high.'}
              </div>
            )}
          </Section>

          <Section title="Colonization activity">
            {(snap?.builds ?? []).slice(0, 8).map((b, i) => (
              <Feed key={`fb:${i}`} pip="build" sys={b.sys} live
                meta={`${b.ev}${b.stationName ? ` · ${b.stationName}` : ''} · ${ago(b.at)}`}
                dist={b.distLy != null ? `${b.distLy} ly` : ''} />
            ))}
            {(snap?.builds ?? []).length === 0 && <div className="rdr-empty">No colonisation events heard within range yet.</div>}
          </Section>

          <Section title="Conflicts">
            {(snap?.conflicts ?? []).slice(0, 6).map((c) => {
              const d = distOf(c.pos);
              return (
                <Feed key={`fc:${c.sys}`} pip="conflict" sys={c.sys}
                  meta={`${c.factions[0]?.state || 'Conflict'} · ${c.factions.map((f) => f.name).slice(0, 2).join(' vs. ')}`}
                  dist={d != null ? `${Math.round(d)} ly` : ''} />
              );
            })}
            {(snap?.conflicts ?? []).length === 0 && <div className="rdr-empty">No conflicts observed live in range.</div>}
          </Section>

          <Section title="Power & population">
            {(snap?.power ?? []).slice(0, 5).map((c) => {
              const d = distOf(c.pos);
              return (
                <Feed key={`fp:${c.sys}`} pip="power" sys={c.sys}
                  meta={`${c.power || c.allegiance || '—'}${c.faction ? ` · ${c.faction}` : ''} · pop ${fmtPop(c.population)}`}
                  dist={d != null ? `${Math.round(d)} ly` : ''} />
              );
            })}
            {(snap?.lookback.systems ?? []).filter((s) => s.population).slice(0, 4).map((s) => (
              <Feed key={`flb:${s.name}`} pip="power" sys={s.name}
                meta={`${s.power || s.allegiance || '—'}${s.faction ? ` · ${s.faction}` : ''} · pop ${fmtPop(s.population)} · ≤7 d data`}
                dist={`${s.distLy} ly`} />
            ))}
          </Section>

          <div className="rdr-disclaimer">{disc}</div>
        </div>
      </div>
    </div>
  );
}

// ---- small pieces ----------------------------------------------------------------------------

function Blip(props: {
  p: { x: number; y: number; stem: number; dy: number };
  cls: string; dim?: boolean; ping?: boolean; halo?: boolean; small?: boolean;
  label: string; name?: string; info?: { title: string; lines: string[] }; onSel?: (s: Sel) => void;
}) {
  const { p } = props;
  const by = p.y - p.stem;
  return (
    <g className={`rdr-blip ${props.dim ? 'dim' : ''}`}
      onClick={(e) => { if (props.info && props.onSel) { e.stopPropagation(); props.onSel({ cls: props.cls, ...props.info }); } }}>
      <title>{props.label}</title>
      {Math.abs(p.stem) > 3 && (
        <>
          <line className={`rdr-leader ${props.cls}`} x1={p.x} y1={p.y} x2={p.x} y2={by} />
          <circle className={`rdr-shadow ${props.cls}`} cx={p.x} cy={p.y} r="2" />
        </>
      )}
      {props.halo && <circle className={`rdr-halo ${props.cls}`} cx={p.x} cy={by} r="9" fill="none" />}
      {props.ping && <circle className={`rdr-ping ${props.cls}`} cx={p.x} cy={by} r="5" fill="none" strokeWidth="1.5" />}
      <circle className={`rdr-core ${props.cls}`} cx={p.x} cy={by} r={props.small ? 2.6 : 4.2} />
      {props.name && <text className={`rdr-lbl ${props.cls}`} x={p.x + 9} y={by + 3.5}>{props.name}</text>}
    </g>
  );
}

function Section(props: { title: string; children: React.ReactNode }) {
  return (
    <div className="rdr-section">
      <h3>{props.title}</h3>
      {props.children}
    </div>
  );
}

function Feed(props: { pip: string; sys: string; meta: string; dist: string; tag?: string; live?: boolean }) {
  return (
    <div className="rdr-feed">
      <span className={`rdr-pip ${props.pip}`} />
      <div className="rdr-body">
        <div className="rdr-sys">
          {props.sys}
          {props.tag && <span className="rdr-tag-new">{props.tag}</span>}
          {props.live && <span className="rdr-tag-live">LIVE</span>}
        </div>
        <div className="rdr-meta">{props.meta}</div>
      </div>
      <div className="rdr-dist">{props.dist}</div>
    </div>
  );
}

// ---- scoped CSS, ported from the mockup ------------------------------------------------------
const RADAR_CSS = `
.rdr{--void:#0a0d0f;--void2:#0f1416;--panel-line:#1e2a2f;--phos:#ffb347;--phos-dim:#5a4322;
  --ink:#e8e2d4;--ink-dim:#7d8a8f;--build:#ff6b3d;--prospect:#37e0a0;--conflict:#ff4d5e;
  --power:#4fc8ff;--commander:#cfe8ef;
  background:radial-gradient(120% 80% at 50% -10%, #10181b 0%, var(--void) 60%);
  color:var(--ink);font-family:"SF Mono","JetBrains Mono",ui-monospace,Menlo,monospace;}
.rdr-frame{height:100%;display:grid;grid-template-columns:1fr 360px;grid-template-rows:auto 1fr;gap:1px;background:var(--panel-line);}
.rdr-topbar{grid-column:1/-1;background:var(--void2);display:flex;align-items:center;gap:10px;row-gap:5px;padding:7px 14px;flex-wrap:wrap;min-height:48px;}
.rdr-brand{font-weight:700;letter-spacing:.24em;font-size:11px;color:var(--phos);display:flex;align-items:center;gap:8px;}
.rdr-dot{width:6px;height:6px;border-radius:50%;background:currentColor;box-shadow:0 0 8px currentColor;animation:rdrPulse 2.4s infinite;}
.rdr-loc{font-size:11px;color:var(--ink-dim);} .rdr-loc b{color:var(--ink);}
.rdr-spacer{flex:1}
.rdr-filters{display:flex;gap:5px;flex-wrap:wrap}
.rdr-filter{font-size:9px;letter-spacing:.1em;text-transform:uppercase;background:none;border:1px solid var(--panel-line);color:var(--ink-dim);padding:3px 7px;border-radius:2px;cursor:pointer;}
.rdr-filter .ct{opacity:.65;margin-left:5px;font-size:8.5px;display:inline-block;min-width:14px;text-align:right}
.rdr-filter.on.f-build{color:var(--build);border-color:var(--build)}
.rdr-filter.on.f-prospect{color:var(--prospect);border-color:var(--prospect)}
.rdr-filter.on.f-conflict{color:var(--conflict);border-color:var(--conflict)}
.rdr-filter.on.f-power{color:var(--power);border-color:var(--power)}
.rdr-filter.on.f-commander{color:var(--commander);border-color:var(--commander)}
.rdr-thresh{font-size:10px;letter-spacing:.12em;color:var(--prospect);display:flex;align-items:center;gap:5px;}
.rdr-thresh input{width:52px;background:var(--void);border:1px solid var(--panel-line);color:var(--ink);font:inherit;padding:2px 5px;border-radius:2px;}
.rdr-rangectl{display:flex;gap:3px;align-items:center;}
.rdr-rangectl .u{font-size:9px;letter-spacing:.14em;color:var(--phos);opacity:.7;margin-left:2px}
.rdr-rbtn{font-size:9.5px;letter-spacing:.08em;background:none;border:1px solid var(--panel-line);color:var(--ink-dim);padding:3px 7px;border-radius:2px;cursor:pointer;font-family:inherit;}
.rdr-rbtn.on{color:var(--phos);border-color:var(--phos);background:rgba(255,179,71,.08)}
.rdr-fsbtn{font-size:9.5px;letter-spacing:.1em;background:none;border:1px solid var(--panel-line);color:var(--ink-dim);padding:3px 8px;border-radius:2px;cursor:pointer;font-family:inherit;}
.rdr-fsbtn:hover{color:var(--ink);border-color:var(--ink-dim)}
.rdr-live{font-size:10px;letter-spacing:.14em;color:var(--prospect);display:flex;gap:6px;align-items:center;}
.rdr-live.down{color:var(--conflict)}
.rdr-scope-wrap{background:radial-gradient(80% 80% at 50% 45%, #0d1618 0%, var(--void) 78%);position:relative;display:flex;align-items:center;justify-content:center;overflow:hidden;}
.rdr-scope{width:min(86vh,100%);height:min(86vh,100%);display:block;touch-action:none}
.rdr-ring{fill:none;stroke:var(--phos);stroke-opacity:.13}
.rdr-axis{stroke-opacity:.06}
.rdr-ring-label{fill:var(--phos);opacity:.4;font-size:10px;letter-spacing:.1em}
.rdr-anchor{fill:var(--phos);opacity:.8;font-size:11px;letter-spacing:.1em;paint-order:stroke;stroke:rgba(10,13,15,.9);stroke-width:3px;pointer-events:none}
.rdr-sweep{transform-origin:500px 500px;animation:rdrSpin 7s linear infinite}
.rdr-sweep path{fill:var(--phos);opacity:.05}
.rdr-center{fill:var(--phos)} .rdr-center-glow{fill:var(--phos);opacity:.14;filter:blur(6px)}
.rdr-blip{cursor:pointer}
.rdr-blip.dim{opacity:.45}
.rdr-core.build{fill:var(--build)} .rdr-core.prospect{fill:var(--prospect)} .rdr-core.conflict{fill:var(--conflict)} .rdr-core.power{fill:var(--power)} .rdr-core.commander{fill:var(--commander);opacity:.6}
.rdr-halo.build{stroke:var(--build);stroke-opacity:.5}
.rdr-leader{stroke-width:1;stroke-opacity:.32}
.rdr-leader.build{stroke:var(--build)} .rdr-leader.prospect{stroke:var(--prospect)} .rdr-leader.conflict{stroke:var(--conflict)} .rdr-leader.power{stroke:var(--power)} .rdr-leader.commander{stroke:var(--commander)}
.rdr-shadow{fill-opacity:.28}
.rdr-shadow.build{fill:var(--build)} .rdr-shadow.prospect{fill:var(--prospect)} .rdr-shadow.conflict{fill:var(--conflict)} .rdr-shadow.power{fill:var(--power)} .rdr-shadow.commander{fill:var(--commander)}
.rdr-ping{animation:rdrPing 2.6s ease-out infinite}
.rdr-ping.build{stroke:var(--build)} .rdr-ping.prospect{stroke:var(--prospect)} .rdr-ping.commander{stroke:var(--commander)} .rdr-ping.conflict{stroke:var(--conflict)} .rdr-ping.power{stroke:var(--power)}
.rdr-tr.build{fill:var(--build)} .rdr-tr.prospect{fill:var(--prospect)} .rdr-tr.commander{fill:var(--commander);opacity:.7}
.rdr-lbl{font-size:10.5px;letter-spacing:.04em;pointer-events:none;paint-order:stroke;stroke:rgba(10,13,15,.9);stroke-width:3px;}
.rdr-lbl.build{fill:var(--build)} .rdr-lbl.prospect{fill:var(--prospect)} .rdr-lbl.conflict{fill:var(--conflict)} .rdr-lbl.power{fill:var(--power)} .rdr-lbl.commander{fill:var(--commander);opacity:.75}
.rdr-onscope{position:absolute;left:14px;top:10px;font-size:10px;letter-spacing:.1em;color:var(--ink-dim);}
.rdr-card{position:absolute;right:14px;bottom:12px;width:min(300px,72%);background:rgba(13,19,21,.95);border:1px solid var(--panel-line);border-left-width:3px;border-radius:3px;padding:9px 12px;z-index:6;}
.rdr-card.build{border-left-color:var(--build)} .rdr-card.prospect{border-left-color:var(--prospect)} .rdr-card.conflict{border-left-color:var(--conflict)} .rdr-card.power{border-left-color:var(--power)} .rdr-card.commander{border-left-color:var(--commander)}
.rdr-card .t{font-size:12.5px;color:var(--ink);margin-bottom:4px;display:flex;justify-content:space-between;gap:8px;align-items:baseline;}
.rdr-card .x{cursor:pointer;color:var(--ink-dim);padding:0 3px;font-size:11px;}
.rdr-card .l{font-size:10.5px;color:var(--ink-dim);line-height:1.55;}
.rdr-legend{position:absolute;left:14px;bottom:12px;display:flex;flex-direction:column;gap:5px;font-size:10px;color:var(--ink-dim);}
.rdr-legend .lg{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:7px;vertical-align:middle;}
.lg.build{background:var(--build)} .lg.prospect{background:var(--prospect)} .lg.conflict{background:var(--conflict)} .lg.power{background:var(--power)} .lg.commander{background:var(--commander)}
.lg-note{opacity:.6;font-size:9px;letter-spacing:.06em}
.rdr-readout{background:var(--void2);overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:12px;}
.rdr-stat-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;}
.rdr-stat{border:1px solid var(--panel-line);border-radius:3px;padding:8px;}
.rdr-stat .k{font-size:8.5px;letter-spacing:.16em;color:var(--ink-dim)}
.rdr-stat .v{font-size:21px;color:var(--phos);margin:2px 0}
.rdr-stat .s{font-size:9px;color:var(--ink-dim);line-height:1.35}
.rdr-ctraffic{border:1px solid var(--panel-line);border-radius:3px;padding:9px;}
.rdr-ctraffic .k{font-size:9px;letter-spacing:.18em;color:var(--commander);margin-bottom:4px;}
.rdr-ctraffic .s{font-size:10.5px;color:var(--ink-dim);line-height:1.45;}
.rdr-boxel{border:1px solid var(--phos-dim);border-radius:3px;padding:9px;background:rgba(255,179,71,.04);}
.rdr-boxel .k{font-size:9px;letter-spacing:.18em;color:var(--phos);margin-bottom:4px;}
.rdr-boxel .s{font-size:11px;color:var(--ink);line-height:1.45;}
.rdr-section h3{font-size:9.5px;letter-spacing:.2em;text-transform:uppercase;color:var(--ink-dim);margin-bottom:7px;border-bottom:1px solid var(--panel-line);padding-bottom:5px;}
.rdr-feed{display:flex;gap:8px;align-items:flex-start;padding:5px 0;border-bottom:1px dotted rgba(30,42,47,.7);}
.rdr-pip{width:7px;height:7px;border-radius:50%;margin-top:4px;flex:none;}
.rdr-pip.build{background:var(--build);box-shadow:0 0 7px var(--build)}
.rdr-pip.prospect{background:var(--prospect)}
.rdr-pip.conflict{background:var(--conflict)}
.rdr-pip.power{background:var(--power)}
.rdr-body{flex:1;min-width:0}
.rdr-sys{font-size:12px;color:var(--ink);display:flex;gap:7px;align-items:baseline;flex-wrap:wrap;}
.rdr-tag-new{font-size:8px;letter-spacing:.12em;color:var(--void);background:var(--prospect);border-radius:2px;padding:1px 5px;font-weight:700;}
.rdr-tag-live{font-size:8px;letter-spacing:.12em;color:var(--build);border:1px solid var(--build);border-radius:2px;padding:0 4px;}
.rdr-meta{font-size:10px;color:var(--ink-dim);margin-top:1px;line-height:1.4}
.rdr-dist{font-size:11px;color:var(--phos);flex:none}
.rdr-empty{font-size:10.5px;color:var(--ink-dim);padding:4px 0;font-style:italic;}
.rdr-disclaimer{font-size:9px;color:var(--ink-dim);opacity:.75;line-height:1.5;border-top:1px solid var(--panel-line);padding-top:8px;}
@keyframes rdrSpin{to{transform:rotate(360deg)}}
@keyframes rdrPulse{0%,100%{opacity:1}50%{opacity:.35}}
@keyframes rdrPing{0%{r:5;opacity:.9}70%{r:26;opacity:0}100%{opacity:0}}
@media (max-width:1000px){.rdr-frame{grid-template-columns:1fr;grid-template-rows:auto 55vh 1fr}}
`;
