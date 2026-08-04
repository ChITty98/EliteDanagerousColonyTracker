/**
 * Live scout map — search results plotted at their true positions around the reference,
 * radar idiom at search scale. Top-down disc + side elevation (ly above/below the
 * reference plane). Unscored = dim dots; blips light up in score-tier colors as the
 * scout runner lands them; ≥60s and ✨ epics get stems/halos so they pop out of the cloud.
 *
 * Rendered inline on the Expansion page AND as the popped-out /scout-map tab. The
 * component only knows MapPoint — both hosts adapt their data to it.
 */
import { useMemo, useState } from 'react';

export interface MapPoint {
  id64: number;
  name: string;
  x: number;
  y: number;
  z: number;
  scored: boolean;
  loading?: boolean;
  score?: number;
  epic?: boolean;
}

export interface ScoutMapSnapshot {
  ref: { name: string; coords: { x: number; y: number; z: number } };
  systems: Array<{ id64: number; name: string; x: number; y: number; z: number }>;
  savedAt: string;
  prescoutedIds?: number[];
}

export const SCOUT_MAP_SNAPSHOT_KEY = 'scout-map-snapshot';

const tier = (t: number) => (t >= 100 ? '#facc15' : t >= 60 ? '#4ade80' : t >= 30 ? '#38bdf8' : '#64748b');

type TierKey = 'unscored' | 't0' | 't30' | 't60' | 't100';
const tierOf = (p: MapPoint): TierKey =>
  !p.scored ? 'unscored' : (p.score ?? 0) >= 100 ? 't100' : (p.score ?? 0) >= 60 ? 't60' : (p.score ?? 0) >= 30 ? 't30' : 't0';

export function ScoutMap({ points, refCoords, onPick, tall, prescoutedIds }: {
  points: MapPoint[];
  refCoords: { x: number; y: number; z: number } | null;
  onPick: (id64: number) => void;
  tall?: boolean; // popped-out: fill the window instead of capping height
  prescoutedIds?: Set<number>; // systems scouted BEFORE this run — toggleable off to spotlight fresh finds
}) {
  // Legend chips are the filter ("the gold are getting crushed"): click a tier to hide it.
  // Low tiers start HIDDEN ("by default I don't want to see low scoring — not exciting"):
  // the map opens showing ≥60s, golds, epics, and the unscored cloud filling in.
  const [hiddenTiers, setHiddenTiers] = useState<Set<TierKey>>(new Set(['t0', 't30']));
  const [epicOnly, setEpicOnly] = useState(false);
  const [hidePrescouted, setHidePrescouted] = useState(false);
  const toggleTier = (t: TierKey) => setHiddenTiers((s) => {
    const n = new Set(s);
    if (n.has(t)) n.delete(t); else n.add(t);
    return n;
  });
  const visible = (p: MapPoint) => {
    if (p.loading) return true; // in-flight pulse is always signal
    if (hiddenTiers.has(tierOf(p))) return false;
    if (epicOnly && !p.epic) return false;
    if (hidePrescouted && prescoutedIds?.has(p.id64)) return false;
    return true;
  };
  const pts = useMemo(() => {
    if (!refCoords) return { list: [] as Array<{ p: MapPoint; x: number; y: number; stem: number; dy: number; dist: number }>, R: 10, maxDy: 5 };
    let maxR = 0, maxDy = 0;
    const raw = points.map((p) => {
      const dx = p.x - refCoords.x;
      const dy = p.y - refCoords.y;
      const dz = p.z - refCoords.z;
      const flat = Math.hypot(dx, dz);
      if (flat > maxR) maxR = flat;
      if (Math.abs(dy) > maxDy) maxDy = Math.abs(dy);
      return { p, dx, dy, dz, dist: Math.hypot(dx, dy, dz) };
    });
    const R = Math.max(10, Math.ceil(maxR / 5) * 5);
    const SC = 210 / R;
    return {
      R,
      maxDy: Math.max(5, Math.ceil(maxDy / 5) * 5),
      list: raw.map((r) => ({
        p: r.p,
        x: 240 + r.dx * SC,
        y: 240 - r.dz * SC,
        stem: Math.max(-40, Math.min(40, r.dy * SC * 0.35)),
        dy: r.dy,
        dist: r.dist,
      })),
    };
  }, [points, refCoords]);

  if (!refCoords || pts.list.length === 0) return null;
  return (
    <div className="rounded-lg border border-border overflow-hidden mb-3" style={{ background: 'radial-gradient(80% 80% at 50% 45%, #0d1618 0%, #0a0d0f 78%)' }}>
      <style>{`@keyframes scoutPulse{0%{r:3;opacity:.9}70%{r:12;opacity:0}100%{opacity:0}}`}</style>
      <svg viewBox="0 0 480 480" className="w-full" style={{ maxHeight: tall ? '68vh' : '72vh' }}>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <circle cx="240" cy="240" r={210 * f} fill="none" stroke="#ffb347" strokeOpacity="0.13" />
            <text x="244" y={240 - 210 * f + 10} fill="#ffb347" opacity="0.4" fontSize="9">{Math.round(pts.R * f)}{f === 1 ? ' LY' : ''}</text>
          </g>
        ))}
        <circle cx="240" cy="240" r="3" fill="#ffb347" />
        {pts.list.filter(({ p }) => visible(p)).map(({ p, x, y, stem, dist }) => {
          const t = p.score ?? 0;
          const showStem = p.scored && (t >= 60 || p.epic) && Math.abs(stem) > 3;
          const c = p.scored ? tier(t) : '#475569';
          return (
            <g key={p.id64} onClick={() => onPick(p.id64)} style={{ cursor: 'pointer' }}>
              <title>{`${p.name} · ${p.scored ? `score ${t}` : p.loading ? 'scoring…' : 'unscored'} · ${dist.toFixed(1)} ly`}</title>
              {showStem && (
                <>
                  <line x1={x} y1={y} x2={x} y2={y - stem} stroke={c} strokeOpacity="0.35" strokeWidth="1" />
                  <circle cx={x} cy={y} r="1.3" fill={c} fillOpacity="0.3" />
                </>
              )}
              {p.epic && <circle cx={x} cy={y - (showStem ? stem : 0)} r="5" fill="none" stroke="#a78bfa" strokeOpacity="0.7" strokeWidth="1" />}
              {p.loading && <circle cx={x} cy={y} r="3" fill="none" stroke="#ffb347" strokeWidth="1.5" style={{ animation: 'scoutPulse 1.6s ease-out infinite' }} />}
              <circle cx={x} cy={y - (showStem ? stem : 0)} r={p.scored ? (t >= 60 ? 3.2 : 2.2) : 1.6} fill={c} fillOpacity={p.scored ? 0.95 : 0.4} />
            </g>
          );
        })}
      </svg>

      {/* Side elevation — same X axis, vertical = ly above/below the reference's plane */}
      <div className="border-t border-border/50">
        <svg viewBox="0 0 480 150" className="w-full" style={{ maxHeight: tall ? '26vh' : '24vh' }}>
          <line x1="20" y1="75" x2="460" y2="75" stroke="#ffb347" strokeOpacity="0.25" strokeDasharray="3,3" />
          <line x1="20" y1={75 - 60} x2="460" y2={75 - 60} stroke="#ffb347" strokeOpacity="0.08" />
          <line x1="20" y1={75 + 60} x2="460" y2={75 + 60} stroke="#ffb347" strokeOpacity="0.08" />
          <text x="24" y={75 - 62} fill="#ffb347" opacity="0.4" fontSize="8">+{pts.maxDy} ly</text>
          <text x="24" y={75 + 70} fill="#ffb347" opacity="0.4" fontSize="8">−{pts.maxDy} ly</text>
          <text x="440" y="72" fill="#ffb347" opacity="0.35" fontSize="8">plane</text>
          <circle cx="240" cy="75" r="2.5" fill="#ffb347" />
          {pts.list.filter(({ p }) => visible(p)).map(({ p, x, dy, dist }) => {
            const t = p.score ?? 0;
            const c = p.scored ? tier(t) : '#475569';
            const ey = 75 - (dy / pts.maxDy) * 60;
            return (
              <g key={`e:${p.id64}`} onClick={() => onPick(p.id64)} style={{ cursor: 'pointer' }}>
                <title>{`${p.name} · ${dy >= 0 ? '+' : ''}${dy.toFixed(1)} ly ${dy >= 0 ? 'above' : 'below'} plane · ${dist.toFixed(1)} ly`}</title>
                {p.epic && <circle cx={x} cy={ey} r="4.5" fill="none" stroke="#a78bfa" strokeOpacity="0.7" strokeWidth="1" />}
                {p.loading && <circle cx={x} cy={ey} r="3" fill="none" stroke="#ffb347" strokeWidth="1.5" style={{ animation: 'scoutPulse 1.6s ease-out infinite' }} />}
                <circle cx={x} cy={ey} r={p.scored ? (t >= 60 ? 2.8 : 2) : 1.4} fill={c} fillOpacity={p.scored ? 0.95 : 0.4} />
              </g>
            );
          })}
        </svg>
      </div>

      {/* Legend = filters. Click a chip to show/hide that class; dim + strikethrough = hidden. */}
      <div className="border-t border-border/50 px-3 py-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground items-center">
        {([
          ['unscored', 'unscored', '#475569', false],
          ['t100', '≥100', '#facc15', true],
          ['t60', '≥60', '#4ade80', true],
          ['t30', '≥30', '#38bdf8', true],
          ['t0', '<30', '#64748b', true],
        ] as Array<[TierKey, string, string, boolean]>).map(([key, label, color, solid]) => {
          const off = hiddenTiers.has(key);
          return (
            <button key={key} onClick={() => toggleTier(key)}
              className={`flex items-center gap-1 ${off ? 'opacity-40 line-through' : ''}`}
              title={off ? `Show ${label}` : `Hide ${label}`}>
              <span className={`inline-block w-2 h-2 rounded-full ${solid ? '' : 'opacity-50'}`} style={{ background: color }} />
              {label}
            </button>
          );
        })}
        <button onClick={() => setEpicOnly((v) => !v)}
          className={`flex items-center gap-1 ${epicOnly ? 'text-violet-300' : ''}`}
          title={epicOnly ? 'Showing epics only — click to show all' : 'Click to show ONLY ✨ epics'}>
          <span className="inline-block w-2 h-2 rounded-full border" style={{ borderColor: '#a78bfa' }} />
          ✨ epic{epicOnly ? ' only' : ''}
        </button>
        {prescoutedIds && prescoutedIds.size > 0 && (
          <button onClick={() => setHidePrescouted((v) => !v)}
            className={`flex items-center gap-1 ${hidePrescouted ? 'text-amber-300' : ''}`}
            title="Hide systems that were already scouted before this run — spotlight the fresh finds">
            {hidePrescouted ? '◈ new only' : '◈ hide pre-scouted'}
          </button>
        )}
        <span className="opacity-70 ml-auto">scoring-now pulses always show · stems = ly above/below plane · amber center = reference</span>
      </div>
    </div>
  );
}
