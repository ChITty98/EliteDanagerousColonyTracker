/**
 * Surface Mining — the Rhino page, built to the same standard as the asteroid page.
 *
 * Same hierarchy as MiningPage, adapted to PLACE-centric mining:
 *   1. What is happening NOW — live hero: active/idle, this visit's tonnes and value, pace vs best,
 *      the body and site you are on. Moves per tonne over SSE, not per 15s poll.
 *   2. What you are LOOKING AT — the nav-locked site, from orbit, with a one-field tagger for the
 *      commodities the target panel lists. This is how a site's contents are retained without
 *      ever dropping on it.
 *   3. What you CAN'T see yet — landable bodies never DSS'd, so their site count is unknown.
 *      Prominent, because on the surface "unmapped" means "unavailable".
 *   4. Bodies → sites → deposits — the inventory. Sites carry the game's own index from the nav
 *      lock; deposits carry the F10 shot that documented them.
 *   5. Where to go back — deposits ranked by value per pull.
 *   6. Measured yield — value per deposit and t/hr per visit, charted; raw tables collapsed.
 *   7. Materials — surface composition, scoped, with grade and room.
 *
 * What the game withholds (verified, not assumed): rig deployment/progress/count, deposit amount
 * and density, and surface position for anything that happened while the exe was closed. Those
 * are stated where they matter, once, in small print — not as a section.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { findCommodityPrice, COMMODITY_PRICES } from '@/data/commodityPrices';
import { MATERIAL_BY_ID, MATERIAL_BY_DISPLAY_NAME } from '@/data/engineeringMaterials';
import { useAppStore } from '@/store';
import { sseSubscribe } from '@/services/sseBus';
import { cr, MiningHudCss, HBarChart } from '../mining/MiningHud';

// ---- payload types --------------------------------------------------------------------------

type Totals = Record<string, number>;

/** The commander's scores for a signal: latest driving, latest landing per hull. 1 easy, 5 brutal. */
interface SiteRatings {
  driving: { score: number; at: string } | null;
  landing: { score: number; ship: string | null; shipType: string | null; size?: string | null; at: string }[];
}

interface SiteRow {
  index: number;
  seen: boolean;      // nav-locked from orbit
  visited: boolean;   // dropped on
  worked: boolean;    // pulled tonnage
  expected: string[]; // tagged from the target panel, plus what was pulled
  commodities: Totals;
  tonnes: number;
  collections: number;
  lastAt: string | null;
  ratings?: SiteRatings;
  recall?: Recall | null;
}

interface BodyRow {
  body: string;
  system: string | null;
  spots: number | null;
  tonnes: number;
  collections: number;
  perCollection: number;
  commodities: Totals;
  materials: Totals;
  located: number;
  firstAt: string | null;
  lastAt: string | null;
  surface: Record<string, number> | null;
  gravity: number | null;
  planetClass?: string | null;
  atmosphere?: string | null;
  radius?: number | null;
  drive?: Drive | null;
  seen?: Record<string, number>;
  sitesKnown: number | null;
  sitesManual?: boolean;
  sitesSeen: number;
  sitesTagged: number;
  sitesVisited: number;
  sitesWorked: number;
  siteRows: SiteRow[];
}

interface DepositRow {
  id: string;
  body: string;
  system: string | null;
  lat: number;
  lon: number;
  tonnes: number;
  collections: number;
  perCollection: number;
  commodities: Totals;
  materials: Totals;
  firstAt: string;
  lastAt: string;
  amount?: string | null;
  density?: string | null;
  taggedCommodity?: string | null;
  site?: string | null;
  siteIndex?: number | null;
  /** How many rigs fit at this deposit at once — 1 unless you said otherwise. */
  rigs?: number | null;
  /** The app's estimate from the largest single collection (a full rig is 12 t since the 4 Sep 2026 patch, 9 before). Never overrides `rigs`. */
  rigsEstimate?: number | null;
  rigsBasis?: string | null;
  imageUrl?: string | null;
  imageId?: string | null;
  markedOnly?: boolean;
  metresFromDrop?: number | null;
  positions?: number;
  /** Deposits are place AND commodity — one commodity per deposit, as the game models it. */
  commodity?: string | null;
  /** Position inherited from the previous rig in a split burst — not measured here. */
  uncertain?: boolean;
  metresFromAnchor?: number | null;
  /** 'landing' = from where the ship set down; 'drop' = supercruise exit (fallback, can be km off). */
  anchor?: 'landing' | 'drop' | null;
}

interface MarkRow {
  id: string; at: string; body: string; system: string | null; lat: number; lon: number;
  altitude: number | null; metresFromDrop: number | null; imageUrl?: string | null; imageId?: string | null;
  siteIndex?: number | null;
  metresFromAnchor?: number | null; anchor?: 'landing' | 'drop' | null;
}

interface VisitRow {
  at: string; body: string; system: string | null; lat: number; lon: number;
  siteIndex: number | null; label: string | null;
  tonnes: number; collections: number; commodities: Totals; hours: number; tph: number | null;
  trips?: number; // hold-fulls dropped at the ship during the visit
  drive?: Drive | null;
}

interface SightingRow {
  at: string; body: string; system: string | null; commodity: string;
  site: string | null; amount: string | null; density: string | null;
}

/** The steering target — a deposit, the ship, a recall spot. One at a time. */
interface NavTarget { lat: number; lon: number; label: string; kind: string; body: string | null }
/** Where the target is from here, recomputed on every Status tick. turn: −180..180, + = right. */
interface Compass { label: string; kind: string; distance: number; bearing: number; turn: number | null; arrived?: boolean; lat: number; lon: number }
interface TrackPoint { at: string; lat: number; lon: number; srv: boolean }
/** Least-total-driving point among a signal's worked deposits, tonnage-weighted. */
interface Recall { lat: number; lon: number; distances: { id: string; commodity: string | null; metres: number }[] }
/** What the breadcrumb track says about a stretch of driving. */
interface Drive {
  drivenM: number; climbM: number; descentM: number; avgKmh: number | null; maxKmh: number | null; points: number;
  highest: { alt: number; lat: number; lon: number; at: string; how: string } | null;
}
/** A named point at your own position — the manual nav lock for things the game never writes. */
interface Pin { id: string; at: string; label: string; kind: string; lat: number; lon: number; body: string; system: string | null }
/** A brain-tree grove: a pin of that kind or a codex position, with the harvests attributed to it. */
interface Grove {
  id: string; body: string; system: string | null; lat: number; lon: number; label: string; source: 'pin' | 'codex'; at: string;
  harvest: { units: number; materials: Totals; byGrade: Record<string, number>; hours: number; unitsPerHour: number | null; first: string; last: string; pickups: number } | null;
}

interface Snapshot {
  active: boolean;
  inSrv: boolean;
  body: string | null;
  lat: number | null;
  lon: number | null;
  altitude: number | null;
  lock: { index: number; bodyId: number | null; systemAddress: number | null; label: string; at: string; body?: string | null } | null;
  drop: { at: string; body: string; bodyId: number | null; siteIndex: number | null; lat: number; lon: number; navLabel?: string | null } | null;
  session: { startedAt: string | null; body: string | null; tonnes: number; commodities: Totals; lastRefineAt: number | null };
  /** One Rhino hold cycle: since the last drop-off at the ship. */
  trip?: { startedAt: string | null; tonnes: number; commodities: Totals };
  hold?: number | null;
  holdMax?: number;
  heading?: number | null;
  radius?: number | null;
  landing?: { lat: number; lon: number; body: string | null } | null;
  target?: NavTarget | null;
  compass?: Compass | null;
  drive?: Drive | null;
}

interface Summary {
  bodies: BodyRow[];
  deposits: DepositRow[];
  marks: MarkRow[];
  visits: VisitRow[];
  sightings: SightingRow[];
  sites: Record<string, string[]>;
  snapshot: Snapshot;
  /** The hull you are flying, from the journal — name from the ship table, pad size when known. */
  ship?: { type: string; name: string; size: 'S' | 'M' | 'L' | null } | null;
  /** Breadcrumbs per body (48 h) — the drive, as a line. */
  track?: Record<string, TrackPoint[]>;
  target?: NavTarget | null;
  /** Tonnes a full rig holds today — the divisor behind the rig estimates. */
  rigCapacity?: number;
  pins?: Pin[];
  groves?: Grove[];
  /** Galactic average (the game's live mean when known) and the best sell among your visited markets. */
  prices?: Record<string, PriceInfo>;
}

interface PriceInfo {
  mean: number;
  best: { price: number; station: string | null; system: string | null; at: string | null; demand?: number | null } | null;
}

// ---- helpers ----------------------------------------------------------------------------------

const token = () => { try { return sessionStorage.getItem('colony-token'); } catch { return null; } };
const q = (p: string) => { const t = token(); return t ? `${p}${p.includes('?') ? '&' : '?'}token=${t}` : p; };

const short = (body: string, system: string | null) =>
  system && body.startsWith(system) ? body.slice(system.length).trim() || body : body;

const when = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  const d = Math.floor(ms / 86400000);
  if (d > 0) return `${d}d ago`;
  const h = Math.floor(ms / 3600000);
  if (h > 0) return `${h}h ago`;
  return `${Math.max(1, Math.floor(ms / 60000))}m ago`;
};

const coord = (lat: number, lon: number) => `${lat.toFixed(4)}°, ${lon.toFixed(4)}°`;
const km = (m: number | null | undefined) => (m == null ? '—' : m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`);

// Prices the summary sent: the game's live galactic mean per commodity, and the best sell among the
// markets the commander has opened (any station, anywhere, never a carrier). One price rules the
// page: what your best market paid, when that reading is under 30 days old; otherwise the galactic
// average. The baked table is the floor when the summary has nothing.
let LIVE_PRICES: Record<string, PriceInfo> = {};
const FRESH_MARKET_MS = 30 * 24 * 3600e3;

function freshBest(live: PriceInfo | undefined): PriceInfo['best'] {
  const b = live?.best;
  if (!b || !(b.price > 0) || !b.at) return null;
  const age = Date.now() - new Date(b.at).getTime();
  return Number.isFinite(age) && age <= FRESH_MARKET_MS ? b : null;
}

/** The one price per tonne: your best market this month, else the galactic average, else the table. */
function priceOf(commodity: string): number | null {
  const p = findCommodityPrice(commodity);
  const live = LIVE_PRICES[p?.name ?? commodity];
  const best = freshBest(live);
  if (best) return best.price;
  if (live && live.mean > 0) return live.mean;
  return p && p.avgSell > 0 ? p.avgSell : null;
}

/** Where the page's price for a commodity came from — for a tooltip, never a second number. */
function priceSource(commodity: string): string {
  const p = findCommodityPrice(commodity);
  const live = LIVE_PRICES[p?.name ?? commodity];
  const best = freshBest(live);
  if (best) return `${best.station ?? 'your best market'}${best.at ? `, ${when(best.at)}` : ''}${live && live.mean > 0 ? ` · galactic average ${live.mean.toLocaleString()}` : ''}`;
  return 'galactic average';
}

/** The price table's spelling for a name typed by hand — "Periclase dunite" renders as Periclase Dunite. */
function canonicalName(commodity: string): string {
  return findCommodityPrice(commodity)?.name ?? commodity;
}

function valueOf(totals: Totals): number | null {
  let sum = 0; let known = false;
  for (const [name, t] of Object.entries(totals || {})) {
    const p = priceOf(name);
    if (p) { sum += p * t; known = true; }
  }
  return known ? sum : null;
}

/** The commodity that made a place worth it — by value, unpriced last, ties by tonnage. */
function richestOf(totals: Totals): string | null {
  const e = Object.entries(totals || {})
    .map(([name, tonnes]) => ({ name, tonnes, value: (priceOf(name) ?? -1) * tonnes }))
    .sort((a, b) => b.value - a.value || b.tonnes - a.tonnes);
  return e.length ? e[0].name : null;
}

const AMOUNTS = ['low', 'medium', 'high'] as const;
const RARITY: Record<number, string> = { 1: 'Very Common', 2: 'Common', 3: 'Standard', 4: 'Rare' };

/** Autocomplete for every "what does this yield" field — one alphabetical list, no blocks. */
const DEPOSIT_COMMODITIES = COMMODITY_PRICES
  .filter((c) => c.category === 'Surface Mining' || c.category === 'Metals' || c.category === 'Minerals')
  .map((c) => c.name)
  .sort((a, b) => a.localeCompare(b));

/** Everything a signal is expected to hold — tagged from orbit or actually pulled — in table spelling. */
const rowCommodities = (s: SiteRow) => new Set([...s.expected, ...Object.keys(s.commodities)].map(canonicalName));

/**
 * A signal's expected value: the three highest-priced commodities it is expected to hold, one
 * tonne each — three because the Rhino's refinery holds three, so a six-commodity signal is
 * worked as its best three, not all six.
 */
const REFINERY_SLOTS = 3;
const rowScore = (s: SiteRow) => [...rowCommodities(s)].map((c) => priceOf(c) ?? 0).sort((a, b) => b - a).slice(0, REFINERY_SLOTS).reduce((t, p) => t + p, 0);

/**
 * The ground colour of a body, sampled from a deposit photo: the bottom-left quadrant (terrain —
 * clear of the sky at the top and the HUD panel on the right), averaged, then darkened so the dots,
 * the track and the labels keep their contrast. Same-origin images, so the canvas can be read.
 */
const tintCache = new Map<string, string | null>();
function useTerrainTint(photoUrl: string | null): string | null {
  const [tint, setTint] = useState<string | null>(photoUrl ? tintCache.get(photoUrl) ?? null : null);
  useEffect(() => {
    if (!photoUrl) { setTint(null); return; }
    if (tintCache.has(photoUrl)) { setTint(tintCache.get(photoUrl) ?? null); return; }
    let alive = true;
    const img = new Image();
    img.onload = () => {
      try {
        const w = 64; const h = 36;
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, w, h);
        const data = ctx.getImageData(0, Math.floor(h / 2), Math.floor(w / 2), Math.ceil(h / 2)).data;
        let r = 0; let g = 0; let b = 0; let n = 0;
        for (let i = 0; i < data.length; i += 4) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n += 1; }
        if (!n) return;
        const k = 0.45; // darken: the map draws on top of it
        const css = `rgb(${Math.round((r / n) * k)}, ${Math.round((g / n) * k)}, ${Math.round((b / n) * k)})`;
        tintCache.set(photoUrl, css);
        if (alive) setTint(css);
      } catch { tintCache.set(photoUrl, null); }
    };
    img.onerror = () => { tintCache.set(photoUrl, null); };
    img.src = photoUrl;
    return () => { alive = false; };
  }, [photoUrl]);
  return tint;
}

/** A stable colour per commodity name, so Grandidierite is the same dot on every map. */
function commodityHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

const fmtM = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);

/**
 * The signal map — local metres around the signal's deposits, not degrees. Deposits sized by
 * tonnage and coloured by commodity, the landing (ship), the recall spot, the breadcrumb track, and
 * you. Tapping a deposit, the ship or the recall spot sets the compass target.
 */
function SignalMap(props: {
  deposits: DepositRow[]; track: TrackPoint[]; landing: { lat: number; lon: number } | null;
  live: { lat: number; lon: number; heading: number | null } | null; recall: Recall | null;
  target: NavTarget | null; radius: number | null;
  /** A deposit photo from this body — its terrain colour becomes the ground of the map. */
  photoUrl: string | null;
  /** Pins and groves on this body — named points, steerable. */
  pois: { id: string; lat: number; lon: number; label: string; kind: string }[];
  onSteer: (t: { lat: number; lon: number; label: string; kind: string }) => void;
}) {
  const tint = useTerrainTint(props.photoUrl);
  const pts: { lat: number; lon: number }[] = [
    ...props.deposits.map((d) => ({ lat: d.lat, lon: d.lon })),
    ...(props.landing ? [props.landing] : []),
    ...(props.recall ? [props.recall] : []),
    ...(props.live ? [props.live] : []),
    ...props.pois.map((p) => ({ lat: p.lat, lon: p.lon })),
  ];
  if (!pts.length || !props.radius) return null;
  const rad = Math.PI / 180;
  const lat0 = pts.reduce((t, p) => t + p.lat, 0) / pts.length;
  const lon0 = pts.reduce((t, p) => t + p.lon, 0) / pts.length;
  const kx = props.radius * rad * Math.cos(lat0 * rad);
  const ky = props.radius * rad;
  const toM = (p: { lat: number; lon: number }) => ({ x: (p.lon - lon0) * kx, y: -(p.lat - lat0) * ky });
  // The track only within 20 km of the signal — the rest of the body is another story.
  const track = props.track.map((p) => ({ ...toM(p), at: p.at })).filter((p) => Math.hypot(p.x, p.y) < 20000);
  const all = [...pts.map(toM), ...track];
  const minX = Math.min(...all.map((p) => p.x)); const maxX = Math.max(...all.map((p) => p.x));
  const minY = Math.min(...all.map((p) => p.y)); const maxY = Math.max(...all.map((p) => p.y));
  const span = Math.max(400, maxX - minX, maxY - minY) * 1.25;
  const cx = (minX + maxX) / 2; const cy = (minY + maxY) / 2;
  const W = 640; const H = 360;
  const scale = Math.min(W, H) / span;
  const sx = (x: number) => W / 2 + (x - cx) * scale;
  const sy = (y: number) => H / 2 + (y - cy) * scale;
  const maxT = Math.max(1, ...props.deposits.map((d) => d.tonnes));
  const grid = span > 8000 ? 2000 : span > 3000 ? 1000 : span > 1200 ? 500 : 100; // metres per ring
  const isTarget = (p: { lat: number; lon: number }) => !!props.target && Math.abs(props.target.lat - p.lat) < 1e-6 && Math.abs(props.target.lon - p.lon) < 1e-6;
  return (
    <div className="rounded-lg border border-border bg-black/30 p-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto rounded" role="img" aria-label="signal map">
        {tint && <rect x={0} y={0} width={W} height={H} fill={tint} />}
        {/* range rings from the centre, labelled in metres */}
        {[1, 2, 3].map((n) => (
          <g key={n}>
            <circle cx={W / 2} cy={H / 2} r={n * grid * scale} fill="none" stroke="rgba(148,163,184,0.18)" strokeDasharray="4 6" />
            <text x={W / 2 + n * grid * scale + 3} y={H / 2 - 3} fill="rgba(148,163,184,0.5)" fontSize="9">{fmtM(n * grid)}</text>
          </g>
        ))}
        {track.length > 1 && (
          <polyline points={track.map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ')} fill="none" stroke="rgba(148,163,184,0.45)" strokeWidth="1.2" />
        )}
        {props.landing && (() => { const p = toM(props.landing); return (
          <g className="cursor-pointer" onClick={() => props.onSteer({ ...props.landing!, label: 'the ship', kind: 'ship' })}>
            <polygon points={`${sx(p.x)},${sy(p.y) - 9} ${sx(p.x) - 8},${sy(p.y) + 7} ${sx(p.x) + 8},${sy(p.y) + 7}`} fill="rgba(251,191,36,0.9)" stroke={isTarget(props.landing) ? '#38bdf8' : 'none'} strokeWidth="2" />
            <text x={sx(p.x) + 11} y={sy(p.y) + 4} fill="#fbbf24" fontSize="11">ship</text>
          </g>
        ); })()}
        {props.deposits.map((d) => { const p = toM(d); const r = 5 + 12 * Math.sqrt(d.tonnes / maxT); const name = d.commodity || d.taggedCommodity || richestOf(d.commodities) || '?'; return (
          <g key={d.id} className="cursor-pointer" onClick={() => props.onSteer({ lat: d.lat, lon: d.lon, label: `${name} deposit`, kind: 'deposit' })}>
            <circle cx={sx(p.x)} cy={sy(p.y)} r={r} fill={`hsla(${commodityHue(name)},70%,55%,0.8)`} stroke={isTarget(d) ? '#38bdf8' : 'rgba(0,0,0,0.5)'} strokeWidth={isTarget(d) ? 3 : 1} />
            <text x={sx(p.x) + r + 3} y={sy(p.y) + 4} fill="rgba(226,232,240,0.9)" fontSize="11">{name}{d.tonnes ? ` ${d.tonnes}t` : ''}</text>
          </g>
        ); })}
        {props.pois.map((poi) => { const p = toM(poi); const grove = poi.kind === 'braintree'; return (
          <g key={poi.id} className="cursor-pointer" onClick={() => props.onSteer({ lat: poi.lat, lon: poi.lon, label: poi.label, kind: poi.kind })}>
            <polygon points={`${sx(p.x)},${sy(p.y) - 8} ${sx(p.x) + 8},${sy(p.y)} ${sx(p.x)},${sy(p.y) + 8} ${sx(p.x) - 8},${sy(p.y)}`} fill={grove ? 'rgba(74,222,128,0.85)' : 'rgba(226,232,240,0.85)'} stroke={isTarget(poi) ? '#38bdf8' : 'rgba(0,0,0,0.5)'} strokeWidth={isTarget(poi) ? 3 : 1} />
            <text x={sx(p.x) + 11} y={sy(p.y) + 4} fill={grove ? '#4ade80' : 'rgba(226,232,240,0.9)'} fontSize="11">{grove ? '🌳 ' : ''}{poi.label}</text>
          </g>
        ); })}
        {props.recall && (() => { const p = toM(props.recall); return (
          <g className="cursor-pointer" onClick={() => props.onSteer({ ...props.recall!, label: 'recall spot', kind: 'recall' })}>
            <circle cx={sx(p.x)} cy={sy(p.y)} r={9} fill="none" stroke={isTarget(props.recall) ? '#38bdf8' : '#4ade80'} strokeWidth="2" />
            <line x1={sx(p.x) - 13} y1={sy(p.y)} x2={sx(p.x) + 13} y2={sy(p.y)} stroke="#4ade80" strokeWidth="1.5" />
            <line x1={sx(p.x)} y1={sy(p.y) - 13} x2={sx(p.x)} y2={sy(p.y) + 13} stroke="#4ade80" strokeWidth="1.5" />
            <text x={sx(p.x) + 14} y={sy(p.y) - 8} fill="#4ade80" fontSize="11">recall here</text>
          </g>
        ); })()}
        {props.live && (() => { const p = toM(props.live); const h = (props.live.heading ?? 0) * rad; return (
          <g>
            <circle cx={sx(p.x)} cy={sy(p.y)} r={6} fill="#38bdf8" stroke="#0f172a" strokeWidth="1.5" />
            {props.live.heading != null && <line x1={sx(p.x)} y1={sy(p.y)} x2={sx(p.x) + Math.sin(h) * 16} y2={sy(p.y) - Math.cos(h) * 16} stroke="#38bdf8" strokeWidth="2.5" />}
            <text x={sx(p.x) - 12} y={sy(p.y) + 20} fill="#38bdf8" fontSize="11">you</text>
          </g>
        ); })()}
      </svg>
      <div className="mt-1 text-[10px] text-muted-foreground">Local metres around this signal · north up · tap a deposit, the ship or the recall spot to steer there · the grey line is your drive (recorded from now on)</div>
    </div>
  );
}

/** Five tap targets, iPad-sized. 1 = easy, 5 = brutal. */
function RatingPicker({ value, onPick, title }: { value: number | null; onPick: (n: number) => void; title?: string }) {
  return (
    <span className="inline-flex gap-1" title={title}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n} type="button" onClick={() => onPick(n)}
          className={`h-7 w-7 rounded border text-xs tabular-nums ${value === n ? 'border-amber-400/70 bg-amber-500/20 text-amber-200' : 'border-white/15 text-slate-300 hover:border-amber-500/40'}`}
        >
          {n}
        </button>
      ))}
    </span>
  );
}

/** Rolling count-up so value pours rather than snaps — same feel as the asteroid hero. */
function useCountUp(target: number): number {
  const [shown, setShown] = useState(target);
  const shownRef = useRef(target);
  const raf = useRef<number | null>(null);
  useEffect(() => {
    const step = () => {
      const cur = shownRef.current;
      if (Math.abs(target - cur) > 1) {
        const next = cur + (target - cur) * 0.16;
        shownRef.current = next; setShown(next);
        raf.current = requestAnimationFrame(step);
      } else { shownRef.current = target; setShown(target); raf.current = null; }
    };
    if (raf.current == null) raf.current = requestAnimationFrame(step);
    return () => { if (raf.current != null) { cancelAnimationFrame(raf.current); raf.current = null; } };
  }, [target]);
  return shown;
}

type Scope = 'current' | 'mine';

// ---- hero -------------------------------------------------------------------------------------

function SurfaceHero(props: {
  active: boolean; inSrv: boolean;
  credits: number; tonnes: number; commodities: Totals; startedAt: string | null;
  tripTonnes: number; hold: number | null; holdMax: number;
  compass: Compass | null; onClearTarget: () => void; onBackToShip: (() => void) | null;
  drive: Drive | null; onPin: ((label: string, kind: string) => void) | null;
  bestTph: number; bestScope: string;
  body: string | null; system: string | null;
  siteIndex: number | null; sitesKnown: number | null; sitesWorked: number;
  indexLine: string;
  onRebuild: () => void; rebuilding: boolean;
  onSetSite: (n: number, moved?: boolean) => void; siteManual?: boolean;
}) {
  const siteRef = useRef<HTMLInputElement>(null);
  const shown = useCountUp(props.credits);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!props.active) return;
    const id = setInterval(() => tick((x) => x + 1), 5000);
    return () => clearInterval(id);
  }, [props.active]);
  const hours = props.startedAt ? (Date.now() - Date.parse(props.startedAt)) / 3600000 : 0;
  const tph = props.active && hours > 0.03 ? props.tonnes / hours : 0;
  const gauge = props.bestTph > 0 ? Math.min(1, tph / props.bestTph) : 0;
  const top = richestOf(props.commodities);

  return (
    <div className={`edc-chamfer edc-grid-bg relative border px-5 py-4 bg-card/80 ${props.active ? 'border-amber-400/50 edc-hero-active' : 'border-border'}`}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold tracking-wide">{'⛏'} SURFACE MINING</h1>
          {props.active
            ? <span className="text-[10px] font-bold tracking-widest text-amber-300" style={{ animation: 'edcPulse 1.6s ease-in-out infinite' }}>● ACTIVE</span>
            : props.inSrv
              ? <span className="text-[10px] tracking-widest text-emerald-400">IN SRV</span>
              : <span className="text-[10px] tracking-widest text-muted-foreground">IDLE</span>}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-muted-foreground">{props.indexLine}</span>
          <button
            onClick={props.onRebuild}
            disabled={props.rebuilding}
            title="Forces a re-read of every journal. Not normally needed — the exe does this at boot."
            className="rounded border border-border bg-muted/20 px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            {props.rebuilding ? 'rebuilding…' : 'rebuild'}
          </button>
        </div>
      </div>

      <div className="mt-3 grid gap-4 md:grid-cols-[auto_1fr_auto] items-end">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">This visit</div>
          <div className="text-4xl font-bold tabular-nums text-emerald-400 leading-none">
            {cr(shown)}<span className="ml-1 text-base font-normal text-muted-foreground">Cr</span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground tabular-nums">
            {props.tonnes}t collected{top ? <> · mostly {top}</> : null}
            {props.tonnes > 0 && props.credits === 0 && <> · <span className="text-amber-300/80">no price yet</span></>}
          </div>
          {(props.inSrv || props.tripTonnes > 0) && (
            <div className="mt-1 flex items-center gap-2 text-xs tabular-nums" title="This trip = refined since the last drop-off at the ship. Hold = the Rhino's cargo count from the journal, of 72.">
              <span className="text-muted-foreground">this trip <span className="text-foreground">{props.tripTonnes}t</span></span>
              <span className="text-muted-foreground">· hold <span className={props.hold != null && props.hold >= props.holdMax ? 'text-amber-300' : 'text-foreground'}>{props.hold ?? '?'}</span> / {props.holdMax}</span>
              <span className="relative h-1.5 w-20 overflow-hidden rounded-sm bg-muted/40">
                <span className="absolute inset-y-0 left-0 rounded-sm bg-sky-400/70 transition-[width] duration-500" style={{ width: `${Math.min(100, ((props.hold ?? 0) / props.holdMax) * 100).toFixed(0)}%` }} />
              </span>
            </div>
          )}
          {/* this visit's driving, from the breadcrumb track */}
          {props.drive && props.drive.drivenM > 0 && (
            <div className="mt-1 text-xs tabular-nums text-muted-foreground" title="From the breadcrumb track: SRV legs only; speed over legs 30 s or closer, so parked time does not count">
              {'🚗'} driven <span className="text-foreground">{fmtM(props.drive.drivenM)}</span>
              {props.drive.avgKmh != null && <> · avg <span className="text-foreground">{props.drive.avgKmh} km/h</span></>}
              {props.drive.maxKmh != null && <> · peak {props.drive.maxKmh}</>}
              {props.drive.climbM > 0 && <> · climb {props.drive.climbM} m</>}
            </div>
          )}
          {/* pin here: a named point at your own position — the manual nav lock */}
          {props.onPin && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
              <input
                id="surface-pin-label" type="text" placeholder="pin here… (name)" defaultValue=""
                className="w-36 rounded border border-white/15 bg-black/40 px-1.5 py-0.5 text-xs text-foreground placeholder:text-slate-600"
                onKeyDown={(e) => { if (e.key !== 'Enter') return; const el = e.target as HTMLInputElement; const v = el.value.trim(); if (v) { props.onPin!(v, 'point'); el.value = ''; } }}
              />
              <button type="button" onClick={() => props.onPin!('brain tree grove', 'braintree')} title="Pin a brain-tree grove at your current position — harvests inside 300 m attribute to it"
                className="rounded border border-emerald-500/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-emerald-300 hover:bg-emerald-500/15">
                {'🌳'} grove here
              </button>
            </div>
          )}
          {/* the compass: where the target is from here, every Status tick */}
          {props.compass ? (
            <div className="mt-2 flex flex-wrap items-center gap-3 rounded border border-sky-500/40 bg-sky-500/10 px-2 py-1 text-sm tabular-nums">
              <span className="text-sky-200">{'⤴'} {props.compass.label}</span>
              <span className="font-semibold text-foreground">{fmtM(props.compass.distance)}</span>
              <span className="text-muted-foreground">brg {props.compass.bearing}°</span>
              {props.compass.turn != null && (
                <span className={Math.abs(props.compass.turn) < 5 ? 'text-emerald-400' : 'text-amber-300'}>
                  {Math.abs(props.compass.turn) < 5 ? 'straight on' : `${props.compass.turn < 0 ? '←' : '→'} ${Math.abs(props.compass.turn)}°`}
                </span>
              )}
              <button type="button" onClick={props.onClearTarget} className="ml-auto rounded border border-white/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-slate-300 hover:text-foreground">clear</button>
            </div>
          ) : props.onBackToShip ? (
            <button type="button" onClick={props.onBackToShip} title="Steer to where the ship set down" className="mt-2 rounded border border-white/15 px-2 py-0.5 text-[11px] text-slate-300 hover:border-sky-500/50 hover:text-sky-300">
              {'⤴'} back to the ship
            </button>
          ) : null}
        </div>

        <div className="min-w-[10rem] max-w-[26rem]">
          <div className="flex items-baseline justify-between text-[10px] uppercase tracking-widest text-muted-foreground">
            <span>Pace</span>
            <span className="tabular-nums normal-case">
              {props.active && tph > 0 ? `${tph.toFixed(0)} t/hr` : '—'}
              {props.bestTph > 0 ? ` · ${props.bestScope} ${props.bestTph.toFixed(0)}` : ''}
            </span>
          </div>
          <div className="relative mt-1 h-2.5 rounded-sm bg-muted/40 overflow-hidden">
            <div className="h-full rounded-sm bg-amber-400/80 transition-[width] duration-700" style={{ width: `${(gauge * 100).toFixed(1)}%` }} />
          </div>
        </div>

        <div className="text-right">
          {props.body ? (
            <>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">On</div>
              <div className="text-sm font-semibold leading-tight">{short(props.body, props.system)}</div>
              <div className="text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1" title={props.siteIndex != null
                  ? (props.siteManual ? 'Signal set by you. Enter = this visit is really that signal. "Moved here" = new visit from now.' : 'Named by the nav lock at the drop. Wrong? Type the signal number: Enter fixes this visit, "moved here" starts a new one from now.')
                  : 'No nav lock at the drop — type the signal number from the left panel. Enter = this visit is that signal. "Moved here" = new visit from now.'}>
                  <span className={props.siteIndex != null ? 'text-amber-300' : ''}>Signal</span>
                  <input
                    ref={siteRef}
                    key={`${props.body}|${props.siteIndex ?? ''}`}
                    type="number" min={1} defaultValue={props.siteIndex ?? ''} placeholder="?"
                    className="w-12 rounded border border-white/15 bg-black/40 px-1 py-0.5 text-center text-xs text-amber-300 placeholder:text-slate-500"
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return;
                      const n = Number((e.target as HTMLInputElement).value);
                      if (Number.isFinite(n) && n > 0) props.onSetSite(n);
                    }}
                  />
                  {props.sitesKnown ? <span className="text-amber-300">of {props.sitesKnown}</span> : null}
                  <button
                    type="button"
                    title="New visit from now at the typed signal — for a move the journal never saw (a hop in normal space). The previous signal's window closes now; nothing already collected moves."
                    className="ml-1 rounded border border-white/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-slate-300 hover:border-amber-500/50 hover:text-amber-300"
                    onClick={() => {
                      const n = Number(siteRef.current?.value);
                      if (Number.isFinite(n) && n > 0) props.onSetSite(n, true);
                    }}
                  >
                    moved here
                  </button>
                  {props.siteManual ? <span className="text-[10px] uppercase tracking-wider text-slate-400">set by you</span> : null}
                </span>
                {props.sitesKnown ? <> · {props.sitesWorked} worked</> : null}
              </div>
            </>
          ) : <div className="text-xs text-muted-foreground">Not on a surface</div>}
        </div>
      </div>
    </div>
  );
}

// ---- page -------------------------------------------------------------------------------------

export function SurfaceMiningPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [live, setLive] = useState<{ tonnes: number; commodities: Totals; startedAt: string | null; at: number } | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [matQuery, setMatQuery] = useState('');
  const [targetInput, setTargetInput] = useState('');
  const [expandedBody, setExpandedBody] = useState<string | null>(null);
  const [editingSite, setEditingSite] = useState<string | null>(null); // "body|index" whose tag chips are open
  const [expandedSite, setExpandedSite] = useState<string | null>(null); // "body|index" whose deposits are shown
  const [findSet, setFindSet] = useState<Set<string>>(new Set()); // commodities a signal must hold to be shown
  const [rankByValue, setRankByValue] = useState(false); // sort signals by expected value instead of number
  const [compass, setCompass] = useState<Compass | null>(null); // live steering, from SSE and the snapshot
  const [dssOpen, setDssOpen] = useState(false); // Needs a DSS: collapsed by default, the count on the line

  const rawHeld = useAppStore((s) => s.materialInventory?.raw) as Record<string, number> | undefined;
  const currentSystem = useAppStore((s) => s.commanderPosition?.systemName ?? null) as string | null;
  // The hull you're flying, from the journal's Loadout — a landing score is always "in this ship".
  // Its display name and pad size come back on the summary (server ship table + your one-time answer).
  const currentShip = useAppStore((s) => s.currentShip) as { type: string; name?: string } | null;
  const projects = useAppStore((s) => s.projects);
  const manualColonized = useAppStore((s) => s.manualColonizedSystems);
  // Default to where you are — the commander's call. Falls back to "my systems" only when the
  // current system is not known yet (see inScope), so the page never comes up empty.
  const [scope, setScope] = useState<Scope>('current');

  // "My systems" — the same definition colonySystemsOf() uses server-side.
  const myLower = useMemo(() => {
    const set = new Set<string>();
    for (const p of projects ?? []) { const n = (p as { systemName?: string }).systemName; if (n) set.add(n.toLowerCase()); }
    for (const n of manualColonized ?? []) set.add(String(n).toLowerCase());
    return set;
  }, [projects, manualColonized]);

  const loadSummary = useCallback(() => {
    fetch(q('/api/surface-mining/summary'))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && !d.error) {
          LIVE_PRICES = (d as Summary).prices ?? {};
          setSummary(d); if (d.snapshot) setSnap(d.snapshot);
        } else if (d?.error) setError(d.error);
      })
      .catch((e) => setError(String(e)));
  }, []);

  const loadSnapshot = useCallback(() => {
    fetch(q('/api/surface-mining/snapshot'))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && !d.error) {
          setSnap(d);
          // The snapshot carries the last computed compass reading — the fallback when SSE is quiet.
          if (d.target && d.compass && !d.compass.arrived) setCompass(d.compass);
          if (!d.target) setCompass(null);
        }
      })
      .catch(() => { /* keep the last one */ });
  }, []);

  useEffect(() => {
    loadSummary(); loadSnapshot();
    const a = setInterval(loadSummary, 15000);
    const b = setInterval(loadSnapshot, 5000);
    return () => { clearInterval(a); clearInterval(b); };
  }, [loadSummary, loadSnapshot]);

  // Live layer: a refined tonne moves the hero immediately; a drop re-reads everything.
  useEffect(() => {
    const offs = [
      sseSubscribe('surface_refined', (raw) => {
        const e = raw as Record<string, unknown>;
        setLive({
          tonnes: Number(e.sessionTonnes) || 0,
          commodities: (e.sessionCommodities as Totals) || {},
          startedAt: (e.sessionStartedAt as string) || null,
          at: Date.now(),
        });
      }),
      sseSubscribe('surface_drop', () => { setLive(null); loadSummary(); loadSnapshot(); }),
      sseSubscribe('surface_compass', (raw) => {
        const e = raw as Record<string, unknown>;
        if (e.cleared) { setCompass(null); return; }
        setCompass({ label: String(e.label), kind: String(e.kind), distance: Number(e.distance), bearing: Number(e.bearing), turn: e.turn == null ? null : Number(e.turn), arrived: !!e.arrived, lat: Number(e.lat), lon: Number(e.lon) });
        if (e.arrived) setTimeout(() => setCompass(null), 8000);
      }),
    ];
    return () => { offs.forEach((f) => f()); };
  }, [loadSummary, loadSnapshot]);

  // ---- actions -----------------------------------------------------------------------------

  const post = useCallback((path: string, body: unknown, done: (d: { ok?: boolean; error?: string } | null) => void) => {
    fetch(q(path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then((r) => r.json()).then(done).catch((e) => done({ error: e.message }));
  }, []);

  const annotate = useCallback((id: string, fields: Record<string, unknown>) => {
    post('/api/surface-mining/annotate', { id, ...fields }, (d) => {
      if (!d || !d.ok) setNote(`Could not save: ${(d && d.error) || 'unknown'}`);
      loadSummary();
    });
  }, [post, loadSummary]);

  const sight = useCallback((fields: { body: string; system: string | null; commodity: string; bodyId?: number | null; siteIndex?: number | null; systemAddress?: number | null; site?: string; amount?: string; density?: string }) => {
    post('/api/surface-mining/sight', fields, (d) => {
      const where = `${fields.siteIndex != null ? `Signal ${fields.siteIndex} on ` : ''}${short(fields.body, fields.system)}`;
      setNote(d && d.ok
        ? ((d as { exists?: boolean }).exists
          ? `${fields.commodity} is already on ${where} — tagged or pulled there before. Nothing added.`
          : `Logged ${fields.commodity} at ${where} — no tonnage, so it never skews your rates.`)
        : `Could not save: ${(d && d.error) || 'unknown'}`);
      loadSummary();
    });
  }, [post, loadSummary]);

  // The compass target: a deposit, the ship, a recall spot. One at a time; steering runs server-side
  // on every Status tick and reaches the overlay, this page and the Companion.
  const setTarget = useCallback((t: { lat: number; lon: number; label: string; kind: string; body?: string | null }) => {
    post('/api/surface-mining/target', t, (d) => {
      setNote(d && d.ok ? `Steering to ${t.label}.` : `Could not set the target: ${(d && d.error) || 'unknown'}`);
      loadSnapshot();
    });
  }, [post, loadSnapshot]);
  const clearTarget = useCallback(() => {
    post('/api/surface-mining/target', { clear: true }, () => { setCompass(null); loadSnapshot(); });
  }, [post, loadSnapshot]);

  // A named point at your own position. The game writes nothing when you park at a grove; you do.
  const pin = useCallback((label: string, kind: string) => {
    if (!snap?.body || snap.lat == null || snap.lon == null) { setNote('Not on a surface — nothing to pin.'); return; }
    post('/api/surface-mining/pin', { label, kind, lat: snap.lat, lon: snap.lon, body: snap.body, system: currentSystem }, (d) => {
      setNote(d && d.ok ? `Pinned "${label}" at ${coord(snap.lat!, snap.lon!)} on ${short(snap.body!, currentSystem)}.` : `Could not pin: ${(d && d.error) || 'unknown'}`);
      loadSummary();
    });
  }, [post, snap, currentSystem, loadSummary]);
  const unpin = useCallback((id: string) => {
    post('/api/surface-mining/pin', { remove: id }, () => loadSummary());
  }, [post, loadSummary]);

  // The photo was the way in; once its information is logged it is optional. Details always stay.
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleteOriginal, setDeleteOriginal] = useState(false);
  const removePhoto = useCallback((d: DepositRow) => {
    post('/api/surface-mining/photo/delete', { imageId: d.imageId, original: deleteOriginal }, (dd) => {
      const r = dd as { ok?: boolean; removed?: { gallery?: boolean; original?: boolean }; error?: string } | null;
      setNote(r && r.ok
        ? `Photo removed${r.removed?.original ? ' — original screenshot deleted too' : deleteOriginal ? ' — the original was not one of ours or already gone, left alone' : ''}. Position, signal and tags stay.`
        : `Could not remove: ${(r && r.error) || 'unknown'}`);
      setConfirmDelete(null);
      loadSummary();
    });
  }, [post, deleteOriginal, loadSummary]);

  const promote = useCallback((id: string, commodity: string, imageId?: string | null) => {
    const known = findCommodityPrice(commodity);
    post('/api/surface-mining/annotate', { id, commodity, imageId }, (d) => {
      setNote(d && d.ok
        ? `Marker promoted — ${commodity}${known ? '' : ' (not a commodity I recognise — check the spelling)'} is now a deposit.`
        : `Could not save: ${(d && d.error) || 'unknown'}`);
      loadSummary();
    });
  }, [post, loadSummary]);

  // The site count the map shows before any DSS. The journal withholds it until you map the body,
  // so the commander types it; a DSS later replaces it.
  const setSiteCount = useCallback((b: { body: string; system: string | null }, count: number | null) => {
    const systemAddress = (b as { systemAddress?: number | null }).systemAddress ?? null;
    post('/api/surface-mining/site-count', { body: b.body, system: b.system, systemAddress, count, clear: count == null }, (d) => {
      setNote(d && d.ok
        ? (count == null
          ? `${short(b.body, b.system)}: count cleared — back to Needs a DSS.`
          : `${short(b.body, b.system)}: ${count} signals, from the map. Retype to change it; a DSS will replace it.`)
        : `Could not save: ${(d && d.error) || 'unknown'}`);
      loadSummary();
    });
  }, [post, loadSummary]);

  // "I know where I am": pin the signal for the body you are on. The server writes a manual drop
  // record dated to the start of this visit, so everything collected here attaches to that site.
  // Enter = "this visit is really Site N" (dated to the visit's own drop, so nothing else moves).
  // "Moved here" = a new visit from now, for moves the journal never saw.
  const setSite = useCallback((siteIndex: number, moved = false) => {
    if (!snap?.body) { setNote('Not on a surface — nothing to pin a signal to.'); return; }
    const lock = snap.lock as { systemAddress?: number | null } | null | undefined;
    post('/api/surface-mining/site', { body: snap.body, siteIndex, system: currentSystem, systemAddress: lock?.systemAddress ?? null, moved }, (d) => {
      setNote(d && d.ok
        ? (moved
          ? `Moved to Signal ${siteIndex} on ${short(snap.body!, currentSystem)} — new visit from now, the previous signal keeps what it had.`
          : `This visit is Signal ${siteIndex} on ${short(snap.body!, currentSystem)}.`)
        : `Could not set the signal: ${(d && d.error) || 'unknown'}`);
      loadSummary(); loadSnapshot();
    });
  }, [post, snap, currentSystem, loadSummary, loadSnapshot]);

  // A signal's difficulty, from you: landing in the hull you're flying, driving once down.
  const rate = useCallback((b: { body: string; system: string | null }, siteIndex: number, fields: { landing?: number; driving?: number }) => {
    const systemAddress = (b as { systemAddress?: number | null }).systemAddress ?? null;
    const shipType = currentShip ? currentShip.type : null; // the server names it and sizes it
    const shipName = summary?.ship?.name ?? shipType ?? 'unknown hull';
    post('/api/surface-mining/rate', { body: b.body, system: b.system, systemAddress, siteIndex, landing: fields.landing ?? null, driving: fields.driving ?? null, shipType }, (d) => {
      setNote(d && d.ok
        ? (fields.landing != null ? `Landing at Signal ${siteIndex} on ${short(b.body, b.system)}: ${fields.landing}/5 in the ${shipName}.` : `Driving at Signal ${siteIndex} on ${short(b.body, b.system)}: ${fields.driving}/5.`)
        : `Could not save: ${(d && d.error) || 'unknown'}`);
      loadSummary();
    });
  }, [post, currentShip, summary, loadSummary]);

  // Pad size for a hull the ship table does not know — asked once, remembered in the annotations file.
  const setHullSize = useCallback((size: 'S' | 'M' | 'L') => {
    if (!currentShip?.type) return;
    post('/api/surface-mining/hull-size', { shipType: currentShip.type, size }, (d) => {
      setNote(d && d.ok ? `${summary?.ship?.name ?? currentShip.type}: ${size} pad — remembered.` : `Could not save: ${(d && d.error) || 'unknown'}`);
      loadSummary();
    });
  }, [post, currentShip, summary, loadSummary]);

  // Take a tag back — append-only; the tag and the retraction both stay in the ledger.
  const unsight = useCallback((body: string, siteIndex: number, commodity: string) => {
    post('/api/surface-mining/unsight', { body, siteIndex, commodity }, (d) => {
      setNote(d && d.ok ? `${commodity} taken off Signal ${siteIndex}. Tag it again if that was wrong.` : `Could not remove: ${(d && d.error) || 'unknown'}`);
      loadSummary();
    });
  }, [post, loadSummary]);

  const runRebuild = useCallback(() => {
    setRebuilding(true); setNote(null);
    post('/api/surface-mining/backfill', {}, (d) => {
      const r = d as { ok?: boolean; files?: number; added?: number; adopted?: number; error?: string } | null;
      setNote(r && r.ok
        ? `Re-read ${r.files} journals — ${r.added} record${r.added === 1 ? '' : 's'} added${r.adopted ? `, ${r.adopted} F10 shot${r.adopted === 1 ? '' : 's'} adopted` : ''}.`
        : `Rebuild failed: ${(r && r.error) || 'unknown'}`);
      setRebuilding(false); loadSummary();
    });
  }, [post, loadSummary]);

  // ---- derived -----------------------------------------------------------------------------

  const bodies = summary?.bodies ?? [];
  const ship = summary?.ship ?? null;
  const deposits = summary?.deposits ?? [];
  const marks = summary?.marks ?? [];
  const visits = summary?.visits ?? [];
  const sightings = summary?.sightings ?? [];

  const inScope = useCallback((sys: string | null) => {
    const s = (sys ?? '').toLowerCase();
    if (scope === 'mine') return myLower.has(s);
    if (!currentSystem) return myLower.has(s); // position not known yet — show your systems, not nothing
    return s === currentSystem.toLowerCase();
  }, [scope, myLower, currentSystem]);

  // Live overlay wins over the 5s snapshot when fresher.
  const session = useMemo(() => {
    const s = snap?.session;
    const useLive = live && (!s?.lastRefineAt || live.at > (s.lastRefineAt ?? 0));
    const tonnes = useLive ? live!.tonnes : (s?.tonnes ?? 0);
    const commodities = useLive ? live!.commodities : (s?.commodities ?? {});
    return { tonnes, commodities, startedAt: useLive ? live!.startedAt : (s?.startedAt ?? null), credits: valueOf(commodities) ?? 0 };
  }, [snap, live]);

  const bestTph = useMemo(() => {
    const here = snap?.body;
    const onBody = here ? visits.filter((v) => v.body === here && v.tph) : [];
    const pool = onBody.length ? onBody : visits.filter((v) => v.tph);
    return { tph: pool.length ? Math.max(...pool.map((v) => v.tph as number)) : 0, scope: onBody.length ? 'your best here' : 'your best anywhere' };
  }, [visits, snap]);

  const bodyOf = useCallback((name: string | null | undefined) => (name ? bodies.find((b) => b.body === name) ?? null : null), [bodies]);
  const hereRow = bodyOf(snap?.body);
  // The site you are on: the live drop first, else the most recent visit on this body from the
  // ledger — so a restart never turns a known site into "site unknown" again.
  const currentSiteIndex = (snap?.drop && snap.drop.body === snap.body ? snap.drop.siteIndex : null)
    ?? (snap?.body ? (visits.find((v) => v.body === snap.body)?.siteIndex ?? null) : null);
  const currentSiteManual = !!(snap?.drop && snap.drop.body === snap.body && (snap.drop as { manual?: boolean }).manual);

  // The nav-locked site: what you are looking at from orbit, plus what you have already said is there.
  const lock = snap?.lock ?? null;
  const lockRow = bodyOf(lock?.body ?? null);
  const lockTags = useMemo(() => {
    if (!lock || !lock.body) return [];
    return [...new Set(sightings.filter((s) => s.body === lock.body && s.site === String(lock.index)).map((s) => canonicalName(s.commodity)))]
      .sort((a, b) => a.localeCompare(b));
  }, [sightings, lock]);
  const lockSiteRow = lockRow?.siteRows.find((r) => r.index === lock?.index) ?? null;

  const tagTarget = () => {
    const c = targetInput.trim();
    if (!lock || !lock.body || !c) return;
    sight({ body: lock.body, system: lockRow?.system ?? currentSystem, commodity: c, bodyId: lock.bodyId, siteIndex: lock.index, systemAddress: lock.systemAddress });
    setTargetInput('');
  };

  const surveyed = useMemo(() => bodies.filter((b) => b.surface && Object.keys(b.surface).length > 0), [bodies]);
  const needsScan = useMemo(() => surveyed.filter((b) => b.spots == null && inScope(b.system)), [surveyed, inScope]);

  // The card for the body you are on opens once when you arrive. Not derived live from the
  // snapshot: a poll that came back without a body collapsed the card — and the signals table with
  // the input being typed into — under the commander's fingers on the iPad. A tap still toggles it.
  const snapBody = snap?.body ?? null;
  useEffect(() => { if (snapBody) setExpandedBody(snapBody); }, [snapBody]);
  // ...and the signal you are on opens with it, once, the same way.
  const currentSiteKey = snapBody && currentSiteIndex != null ? `${snapBody}|${currentSiteIndex}` : null;
  useEffect(() => { if (currentSiteKey) setExpandedSite(currentSiteKey); }, [currentSiteKey]);

  // Find by commodity: a signal matches when it holds EVERY selected commodity (tagged or pulled).
  const rowMatches = useCallback((s: SiteRow) => {
    if (!findSet.size) return true;
    const have = rowCommodities(s);
    return [...findSet].every((c) => have.has(c));
  }, [findSet]);

  // Every commodity any signal in scope holds, with how many signals hold it — the find chips.
  const commodityCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const b of bodies) {
      if (!inScope(b.system)) continue;
      for (const s of b.siteRows) for (const c of rowCommodities(s)) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [bodies, inScope]);

  // Bodies with anything to say: known signals, worked tonnage, or tagged signals. Current system
  // first. With a find active, only bodies with a matching signal.
  const bodyCards = useMemo(() => {
    const here = (currentSystem ?? '').toLowerCase();
    return bodies
      .filter((b) => inScope(b.system) && ((b.sitesKnown ?? 0) > 0 || b.tonnes > 0 || b.siteRows.length > 0))
      .filter((b) => !findSet.size || b.siteRows.some(rowMatches))
      .sort((a, b) => {
        // The inventory reads like the system map: current system first, then systems and bodies in
        // natural order (1 a, 1 b, 1 c, 2 a …). Tonnage no longer moves a body up the list.
        const natural = (x: string, y: string) => x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' });
        const ah = (a.system ?? '').toLowerCase() === here ? 0 : 1;
        const bh = (b.system ?? '').toLowerCase() === here ? 0 : 1;
        return ah - bh || natural(a.system ?? '', b.system ?? '') || natural(short(a.body, a.system), short(b.body, b.system));
      });
  }, [bodies, inScope, currentSystem, findSet, rowMatches]);

  // Where to go back: per SITE, credits per hour from the visits — the thing you nav-target, ranked
  // by what it actually paid per hour of being there. The old "per collection" was noise: a
  // collection is a 60s-gap heuristic, and one 25t record outranked a 120t site.
  const bestSites = useMemo(() => {
    type Agg = { body: string; system: string | null; siteIndex: number | null; tonnes: number; hours: number; credits: number; visits: number; commodities: Totals; lastAt: string };
    const acc = new Map<string, Agg>();
    for (const v of visits) {
      if (!inScope(v.system) || !(v.tonnes > 0) || !(v.hours > 0)) continue;
      const key = `${v.body}|${v.siteIndex ?? 'none'}`;
      const a = acc.get(key) ?? { body: v.body, system: v.system, siteIndex: v.siteIndex, tonnes: 0, hours: 0, credits: 0, visits: 0, commodities: {}, lastAt: v.at };
      a.tonnes += v.tonnes; a.hours += v.hours; a.credits += valueOf(v.commodities) ?? 0; a.visits += 1;
      for (const [c, t] of Object.entries(v.commodities || {})) a.commodities[c] = (a.commodities[c] || 0) + t;
      if (v.at > a.lastAt) a.lastAt = v.at;
      acc.set(key, a);
    }
    return [...acc.values()]
      .filter((a) => a.hours >= 5 / 60) // a rate from a two-minute visit is not a rate
      .map((a) => ({
        ...a,
        crPerHour: a.credits / a.hours,
        tph: a.tonnes / a.hours,
        best: deposits
          .filter((d) => d.body === a.body && (d.siteIndex ?? null) === a.siteIndex && d.tonnes > 0 && !d.uncertain)
          .sort((x, y) => (valueOf(y.commodities) ?? 0) - (valueOf(x.commodities) ?? 0))[0] ?? null,
      }))
      .sort((x, y) => y.crPerHour - x.crPerHour)
      .slice(0, 3);
  }, [visits, deposits, inScope]);

  const matRows = useMemo(() => {
    const held = rawHeld || {};
    const qy = matQuery.trim().toLowerCase();
    const byMat = new Map<string, { id: string; name: string; grade: number; cap: number; held: number | null; room: number | null; bestPct: number; bestBody: string; bestSystem: string | null; bodies: number }>();
    for (const b of surveyed) {
      if (!inScope(b.system)) continue;
      for (const [id, pct] of Object.entries(b.surface ?? {})) {
        const def = MATERIAL_BY_ID.get(id) || MATERIAL_BY_DISPLAY_NAME.get(id);
        if (!def) continue;
        if (qy && !def.id.includes(qy) && !def.displayName.toLowerCase().includes(qy)) continue;
        const h = typeof held[def.id] === 'number' ? held[def.id] : null;
        const cur = byMat.get(def.id);
        if (!cur) byMat.set(def.id, { id: def.id, name: def.displayName, grade: def.grade, cap: def.cap, held: h, room: h == null ? null : def.cap - h, bestPct: pct, bestBody: b.body, bestSystem: b.system, bodies: 1 });
        else { cur.bodies += 1; if (pct > cur.bestPct) { cur.bestPct = pct; cur.bestBody = b.body; cur.bestSystem = b.system; } }
      }
    }
    return [...byMat.values()].sort((a, b) => b.grade - a.grade || b.bestPct - a.bestPct);
  }, [surveyed, inScope, rawHeld, matQuery]);

  const lifetimeTonnes = bodies.reduce((t, b) => t + b.tonnes, 0);

  if (!summary) {
    return (
      <div className="p-4">
        <MiningHudCss />
        <p className="text-sm text-muted-foreground">{error ? `Surface mining: ${error}` : 'Reading the surface-mining ledger…'}</p>
      </div>
    );
  }

  const scopeLabel: Record<Scope, string> = {
    current: currentSystem ? short(currentSystem, null) : 'This system',
    mine: 'My systems',
  };

  return (
    <div className="p-4 space-y-5 max-w-[1400px]">
      <MiningHudCss />
      <datalist id="deposit-commodities">
        {DEPOSIT_COMMODITIES.map((n) => <option key={n} value={n} />)}
      </datalist>

      <SurfaceHero
        active={!!snap?.active}
        inSrv={!!snap?.inSrv}
        credits={session.credits}
        tonnes={session.tonnes}
        commodities={session.commodities}
        startedAt={session.startedAt}
        bestTph={bestTph.tph}
        bestScope={bestTph.scope}
        body={snap?.body ?? null}
        system={hereRow?.system ?? currentSystem}
        siteIndex={currentSiteIndex}
        sitesKnown={hereRow?.sitesKnown ?? null}
        sitesWorked={hereRow?.sitesWorked ?? 0}
        indexLine={`${surveyed.length.toLocaleString()} bodies surveyed · ${lifetimeTonnes.toLocaleString()}t lifetime`}
        onRebuild={runRebuild}
        rebuilding={rebuilding}
        onSetSite={setSite}
        siteManual={currentSiteManual}
        tripTonnes={snap?.trip?.tonnes ?? 0}
        hold={snap?.hold ?? null}
        holdMax={snap?.holdMax ?? 72}
        compass={compass}
        onClearTarget={clearTarget}
        onBackToShip={snap?.landing && snap.landing.lat != null && snap.body && snap.landing.body === snap.body
          ? () => setTarget({ lat: snap.landing!.lat, lon: snap.landing!.lon, label: 'the ship', kind: 'ship', body: snap.body })
          : null}
        drive={snap?.drive ?? null}
        onPin={snap?.body && snap.lat != null ? pin : null}
      />

      {error && <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}
      {note && <p className="text-xs text-amber-300">{note}</p>}

      {/* ---- What you are looking at ---- */}
      {lock && (
        <section className="edc-chamfer border border-sky-500/40 bg-card/70 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-sky-300">Targeting</div>
              <div className="mt-0.5 text-sm font-semibold">
                Signal {lock.index}{lockRow?.sitesKnown ? ` of ${lockRow.sitesKnown}` : ''}
                <span className="ml-2 text-muted-foreground">{lock.body ? short(lock.body, lockRow?.system ?? null) : `Body ${lock.bodyId ?? '?'}`}</span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">{lock.label}
                {lockSiteRow?.worked && <span className="ml-2 text-emerald-400">worked · {lockSiteRow.tonnes}t</span>}
                {lockSiteRow?.visited && !lockSiteRow.worked && <span className="ml-2 text-amber-300">visited</span>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                list="deposit-commodities"
                value={targetInput}
                onChange={(e) => setTargetInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') tagTarget(); }}
                disabled={!lock.body}
                placeholder={lock.body ? 'the panel lists… (Enter adds)' : 'scan this body first'}
                className="w-64 rounded border border-border bg-background px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground/60 disabled:opacity-50"
              />
              <button onClick={tagTarget} disabled={!lock.body || !targetInput.trim()} className="rounded border border-sky-500/40 bg-muted/20 px-3 py-1 text-xs text-sky-300 hover:bg-muted/50 disabled:opacity-40">Add</button>
            </div>
          </div>
          {(lockTags.length > 0 || (lockSiteRow && Object.keys(lockSiteRow.commodities).length > 0)) && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {lockTags.map((c) => {
                const p = priceOf(c);
                return (
                  <span key={c} className="rounded bg-sky-500/15 px-2 py-0.5 text-xs text-sky-200">
                    {c}{p ? <span className="ml-1 tabular-nums opacity-70">{cr(p)}</span> : <span className="ml-1 opacity-60">unpriced</span>}
                  </span>
                );
              })}
              {lockSiteRow && Object.entries(lockSiteRow.commodities).map(([c, t]) => (
                <span key={`got:${c}`} className="rounded bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-300" title="Actually pulled from this signal">{c} {t}t</span>
              ))}
            </div>
          )}
          <p className="mt-2 text-[11px] text-muted-foreground/70">
            The nav lock names the signal; you name what the target panel lists. Retained whether or not you ever drop here.
          </p>
        </section>
      )}

      {/* ---- Scope ---- */}
      <div className="flex flex-wrap items-center gap-2">
        {(['current', 'mine'] as Scope[]).map((k) => (
          <button
            key={k}
            onClick={() => setScope(k)}
            disabled={k === 'current' && !currentSystem}
            className={`rounded border px-2 py-0.5 text-[10px] uppercase tracking-wider disabled:opacity-40 ${scope === k ? 'border-amber-500/50 text-amber-300' : 'border-border text-muted-foreground hover:text-foreground'}`}
          >
            {scopeLabel[k]}
          </button>
        ))}
      </div>

      {/* ---- Find by commodity · rank by expected value ---- */}
      {commodityCounts.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="mr-1 text-[10px] uppercase tracking-wider text-muted-foreground">Find</span>
          {commodityCounts.map(([c, n]) => {
            const on = findSet.has(c);
            return (
              <button
                key={c} type="button"
                onClick={() => setFindSet((prev) => { const next = new Set(prev); if (next.has(c)) next.delete(c); else next.add(c); return next; })}
                title={`${n} signal${n === 1 ? '' : 's'} in scope hold ${c}${on ? ' — tap to clear' : ''}`}
                className={`rounded border px-2 py-0.5 ${on ? 'border-sky-400/70 bg-sky-500/20 text-sky-100' : 'border-border text-muted-foreground hover:text-foreground'}`}
              >
                {c} <span className="tabular-nums opacity-60">{n}</span>
              </button>
            );
          })}
          {findSet.size > 0 && (
            <button type="button" onClick={() => setFindSet(new Set())} className="px-1 text-slate-400 hover:text-foreground">clear</button>
          )}
          <span className="mx-2 h-4 w-px bg-border" />
          <button
            type="button" onClick={() => setRankByValue((v) => !v)}
            title="Sort signals by their three highest-priced expected commodities, one tonne each — three because the Rhino's refinery holds three. Prices are your best market this month, else the galactic average."
            className={`rounded border px-2 py-0.5 ${rankByValue ? 'border-emerald-400/70 bg-emerald-500/20 text-emerald-100' : 'border-border text-muted-foreground hover:text-foreground'}`}
          >
            rank by expected value
          </button>
        </div>
      )}

      {/* ---- Needs a DSS — prominent: unmapped means unavailable ---- */}
      <section className="space-y-2">
        <button
          type="button" onClick={() => setDssOpen((v) => !v)} aria-expanded={dssOpen}
          className="flex w-full items-baseline gap-3 text-left"
          title={dssOpen ? 'Collapse' : 'Expand'}
        >
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            <span className="mr-1 inline-block w-3 text-[10px]">{dssOpen ? '▼' : '▶'}</span>{'🔭'} Needs a DSS
            <span className="ml-2 rounded bg-muted/40 px-1.5 py-0.5 text-[11px] normal-case tracking-normal tabular-nums text-foreground">{needsScan.length}</span>
          </h2>
          <span className="text-xs text-muted-foreground">
            {needsScan.length === 0
              ? 'every landable body in scope is mapped'
              : `landable ${needsScan.length === 1 ? 'body' : 'bodies'} in scope with no signal count — DSS them, or type the count the system map shows you`}
          </span>
        </button>
        {!dssOpen ? null : needsScan.length === 0 ? (
          <p className="text-sm text-muted-foreground">Every landable body in scope is mapped. {'🎉'}</p>
        ) : (
          <div className="space-y-3">
            {(() => {
              // Grouped by system, the one you are in first; bodies in natural order (1 b, 2 b, 10 a).
              const here = (currentSystem ?? '').toLowerCase();
              const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
              const groups = new Map<string, BodyRow[]>();
              for (const b of needsScan) { const k = b.system ?? '—'; if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(b); }
              const order = [...groups.keys()].sort((a, b) => ((a.toLowerCase() === here ? 0 : 1) - (b.toLowerCase() === here ? 0 : 1)) || natural(a, b));
              return order.map((sys) => {
                const list = groups.get(sys)!.slice().sort((a, b) => natural(short(a.body, a.system), short(b.body, b.system)));
                return (
                  <div key={sys}>
                    <div className="mb-1.5 flex items-baseline gap-2">
                      <span className="text-sm font-semibold">{sys}</span>
                      <span className="text-xs text-muted-foreground">{list.length} unmapped</span>
                      {sys.toLowerCase() === here && <span className="text-[10px] uppercase tracking-wider text-amber-300">here</span>}
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      {list.map((b) => {
                        // An ice ball is a skip by the commander's standing rule — greyed, never hidden.
                        const icy = /\b(icy|ice)\b/i.test(b.planetClass ?? '');
                        const atmo = b.atmosphere == null ? null : /^none$/i.test(b.atmosphere) ? 'no atmosphere' : b.atmosphere;
                        return (
                          <div key={b.body} className={`edc-chamfer border bg-card/70 px-3 py-2 ${icy ? 'border-border/40 opacity-60' : 'border-border'}`} title={icy ? 'Icy — an ice ball' : undefined}>
                            <div className="text-sm font-semibold">{short(b.body, b.system)}{icy ? <span className="ml-1.5 text-xs">{'❄'}</span> : null}</div>
                            <div className="text-xs text-muted-foreground">{b.planetClass ?? 'class unknown — rescan or boot backfill fills it'}{b.gravity != null ? ` · ${b.gravity}g` : ''}{atmo ? ` · ${atmo}` : ''}</div>
                            {b.surface && (
                              <div className="mt-1 text-[11px] text-muted-foreground truncate" title="surface composition">
                                {Object.entries(b.surface).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, v]) => `${MATERIAL_BY_ID.get(k)?.displayName ?? k} ${v}%`).join(' · ')}
                              </div>
                            )}
                            <div className="mt-2 flex items-center gap-1.5 text-xs" title="The system map shows 'Planetary Mining Location (N)' before any DSS — type N and press Enter. A DSS replaces it.">
                              <input
                                type="number" min={0} placeholder="signals"
                                className="w-16 rounded border border-white/15 bg-black/40 px-1.5 py-0.5 text-center text-xs text-amber-300 placeholder:text-slate-600"
                                onKeyDown={(e) => {
                                  if (e.key !== 'Enter') return;
                                  const n = Number((e.target as HTMLInputElement).value);
                                  if (Number.isFinite(n) && n >= 0) setSiteCount(b, n);
                                }}
                              />
                              <span className="text-muted-foreground">from the map</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        )}
      </section>

      {/* ---- Bodies → sites → deposits ---- */}
      <section className="space-y-2">
        <div className="flex items-baseline gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Bodies</h2>
          <span className="text-xs text-muted-foreground">signals from the DSS · what you saw from orbit · what you actually pulled</span>
          <span className="ml-auto text-xs text-muted-foreground" title="The divisor behind the rig estimates: the largest single collection at a deposit ÷ this. 12 t since the patch of 4 September 2026; collections before it divide by 9.">
            full rig = {summary?.rigCapacity ?? 12} t
          </span>
        </div>
        {bodyCards.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing in scope yet. DSS a landable body and its signals appear here.</p>
        ) : (
          <div className="space-y-2">
            {bodyCards.map((b) => {
              const open = expandedBody === b.body || bodyCards.length <= 2;
              // Tap-to-tag: what this body, then this system, has already shown or given up.
              const bodyKnown = new Set<string>([...Object.keys(b.seen ?? {}), ...Object.keys(b.commodities)]);
              const systemKnown = new Set<string>();
              for (const o of bodies) {
                if (!o.system || o.system !== b.system || o.body === b.body) continue;
                for (const c of [...Object.keys(o.seen ?? {}), ...Object.keys(o.commodities)]) if (!bodyKnown.has(c)) systemKnown.add(c);
              }
              const bodyDeposits = deposits.filter((d) => d.body === b.body);
              const bodyMarks = marks.filter((m) => m.body === b.body);
              const top = richestOf(b.commodities);
              const worth = valueOf(b.commodities);

              // A deposit row: the photo, where it is, what it gives, what the panel said about it.
              // Rendered inside the signal it belongs to — the signal is how you navigate, the deposit is
              // what you came for.
              const renderDeposit = (d: DepositRow) => {
                const hasYield = Object.keys(d.commodities).length > 0;
                const w = valueOf(d.commodities);
                return (
                  <div key={d.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 bg-muted/10 px-3 py-2">
                    <div className="min-w-[9rem]">
                      <div className="text-xs font-mono text-muted-foreground" title={d.uncertain ? 'Position inherited from the previous rig — this commodity was refined after the SRV moved, before the app split bursts by commodity. Not measured here.' : undefined}>
                        {d.uncertain ? <span className="text-amber-300/80">~ </span> : null}{coord(d.lat, d.lon)}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {d.siteIndex != null ? <span className="text-amber-300">Signal {d.siteIndex}</span> : (
                          <span className="inline-flex items-center gap-1" title="No nav lock at the drop — type the signal number you can see in the left panel">
                            <span>signal</span>
                            <input
                              type="number" min={1} defaultValue={d.site ?? ''} placeholder="?"
                              className="w-12 rounded border border-white/15 bg-black/40 px-1 py-0.5 text-center text-xs text-amber-300 placeholder:text-slate-600"
                              onKeyDown={(e) => {
                                if (e.key !== 'Enter') return;
                                const n = Number((e.target as HTMLInputElement).value);
                                if (Number.isFinite(n) && n > 0) void annotate(d.id, { site: n });
                              }}
                            />
                          </span>
                        )}
                        {(d.metresFromAnchor ?? d.metresFromDrop) != null && (
                          <> · {km(d.metresFromAnchor ?? d.metresFromDrop)} from {d.anchor ?? 'drop'}</>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => setTarget({ lat: d.lat, lon: d.lon, label: `${d.commodity || d.taggedCommodity || richestOf(d.commodities) || 'deposit'} deposit`, kind: 'deposit', body: d.body })}
                        title="Set the compass on this deposit — distance, bearing and turn on the overlay, here and on the Companion"
                        className="mt-1 rounded border border-white/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-slate-300 hover:border-sky-500/50 hover:text-sky-300"
                      >
                        {'⤴'} steer here
                      </button>
                    </div>
                    <div className="flex-1 text-xs">
                      {hasYield
                        ? Object.entries(d.commodities).sort((x, y) => y[1] - x[1]).map(([c, t]) => { const p = priceOf(c); return <span key={c} className="mr-3 whitespace-nowrap" title={p ? priceSource(c) : undefined}>{c} <span className="tabular-nums">{t}t</span> <span className={p ? 'text-muted-foreground' : 'text-amber-300/70'}>{p ? `@ ${p.toLocaleString()}` : 'no price yet'}</span></span>; })
                        : d.taggedCommodity
                          ? <span>{d.taggedCommodity} <span className="text-muted-foreground">{priceOf(d.taggedCommodity) ? `@ ${priceOf(d.taggedCommodity)!.toLocaleString()} · ` : ''}not yet worked</span></span>
                          : <span className="text-muted-foreground">—</span>}
                    </div>
                    <div className="flex gap-1.5">
                      {(['amount', 'density'] as const).map((f) => {
                        const val = (d[f] as string) || '';
                        return (
                          <select key={f} value={val} onChange={(e) => annotate(d.id, { [f]: e.target.value })} title={f === 'amount' ? 'MINERAL AMOUNT from the deposit panel' : 'DENSITY from the deposit panel'}
                            className={`rounded border px-1.5 py-1 text-xs capitalize ${val ? 'border-amber-500/40 bg-background text-foreground' : 'border-border bg-background text-muted-foreground'}`}>
                            <option value="" className="bg-background text-muted-foreground">{f}…</option>
                            {AMOUNTS.map((a) => <option key={a} value={a} className="bg-background text-foreground">{f}: {a}</option>)}
                          </select>
                        );
                      })}
                      <select
                        value={d.rigs != null ? String(d.rigs) : ''}
                        onChange={(e) => { if (e.target.value) annotate(d.id, { rigs: Number(e.target.value) }); }}
                        title={d.rigs != null ? 'How many rigs fit at this deposit at once — set by you' : d.rigsEstimate ? `Estimate: ${d.rigsBasis}. Pick a value to confirm or correct it.` : 'How many rigs fit at this deposit at once — 1 unless you say otherwise'}
                        className={`rounded border px-1.5 py-1 text-xs ${d.rigs != null ? 'border-amber-500/40 bg-background text-foreground' : 'border-border bg-background text-muted-foreground'}`}
                      >
                        <option value="" className="bg-background text-muted-foreground">{d.rigsEstimate ? `≈ ${d.rigsEstimate} rig${d.rigsEstimate === 1 ? '' : 's'}?` : 'rigs…'}</option>
                        {[1, 2, 3, 4].map((n) => <option key={n} value={n} className="bg-background text-foreground">{n} rig{n === 1 ? '' : 's'}</option>)}
                      </select>
                      {d.rigs == null && d.rigsEstimate != null && d.rigsEstimate > 1 && (
                        <button type="button" onClick={() => annotate(d.id, { rigs: d.rigsEstimate! })} title={`Confirm ${d.rigsEstimate} rigs — ${d.rigsBasis}`}
                          className="rounded border border-emerald-500/40 px-1.5 py-1 text-xs text-emerald-300 hover:bg-emerald-500/15">
                          ✓ {d.rigsEstimate}
                        </button>
                      )}
                    </div>
                    <div className="text-right tabular-nums">
                      <div className="text-sm font-semibold">{d.tonnes ? `${d.tonnes}t` : '—'}</div>
                      <div className="text-[11px] text-muted-foreground">{d.collections ? `${d.perCollection}t per collection` : ''}{w != null ? ` · ${cr(w)}` : ''}</div>
                    </div>
                    {/* the photo is a reference, not a picture: a small square, tap to open; remove folds under it */}
                    {d.imageUrl && (
                      <div className="flex flex-col items-center gap-0.5">
                        <a href={d.imageUrl} target="_blank" rel="noreferrer" title="Open the F10 shot — the HUD panel names the commodity, amount and density">
                          <img src={d.imageUrl} alt="" loading="lazy" className="h-8 w-8 rounded border border-border object-cover hover:border-amber-400" />
                        </a>
                        {d.imageId && (d.commodity || d.taggedCommodity || d.tonnes > 0) && (
                          confirmDelete === d.id ? (
                            <span className="flex flex-col items-center gap-0.5 text-[10px]">
                              <label className="flex items-center gap-1 text-slate-400" title="The 31 MB BMP in the game's screenshot folder. Off = only the app's copy goes.">
                                <input type="checkbox" checked={deleteOriginal} onChange={(e) => setDeleteOriginal(e.target.checked)} /> original too
                              </label>
                              <span className="flex gap-1">
                                <button type="button" onClick={() => removePhoto(d)} className="rounded border border-red-500/50 px-1.5 py-0.5 text-red-300 hover:bg-red-500/15">delete</button>
                                <button type="button" onClick={() => setConfirmDelete(null)} className="rounded border border-white/15 px-1.5 py-0.5 text-slate-300">keep</button>
                              </span>
                            </span>
                          ) : (
                            <button type="button" onClick={() => { setConfirmDelete(d.id); setDeleteOriginal(false); }}
                              title="The details stay — position, signal, commodity, amount, density. Only the picture goes."
                              className="text-[9px] text-slate-500 hover:text-red-300">
                              remove
                            </button>
                          )
                        )}
                      </div>
                    )}
                  </div>
                );
              };

              // An F10 shot at a site that is not a deposit yet — name what it is a deposit of, or leave it.
              const renderMark = (m: MarkRow) => (
                <div key={m.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-border/60 px-3 py-2">
                  {m.imageUrl
                    ? <a href={m.imageUrl} target="_blank" rel="noreferrer"><img src={m.imageUrl} alt="" loading="lazy" className="h-10 w-16 rounded border border-border object-cover hover:border-amber-400" /></a>
                    : <div className="h-10 w-16 rounded border border-dashed border-border/60" />}
                  <div className="text-xs">
                    <div className="font-mono text-muted-foreground">{coord(m.lat, m.lon)} · {when(m.at)}</div>
                    <div className="text-[11px] text-muted-foreground">F10 shot on the surface — a deposit, or a postcard?</div>
                  </div>
                  {(() => {
                    // The signal already says what it holds — one tap names the deposit from that list.
                    const row = m.siteIndex != null ? b.siteRows.find((r) => r.index === m.siteIndex) : null;
                    const names = row ? [...rowCommodities(row)].sort((x, y) => x.localeCompare(y)) : [];
                    return names.length ? (
                      <span className="flex flex-wrap gap-1">
                        {names.map((c) => (
                          <button key={c} type="button" onClick={() => promote(m.id, c, m.imageId)} title={`Signal ${m.siteIndex} lists ${c} — tap to name this deposit`}
                            className="rounded border border-dashed border-sky-500/40 px-1.5 py-0.5 text-[11px] text-sky-300/80 hover:bg-sky-500/15">
                            {c}
                          </button>
                        ))}
                      </span>
                    ) : null;
                  })()}
                  <input type="text" list="deposit-commodities" placeholder={m.siteIndex != null ? 'or something else…' : 'deposit of… (blank = postcard)'}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                    onBlur={(e) => { const v = e.target.value.trim(); if (v) promote(m.id, v, m.imageId); }}
                    className="w-56 rounded border border-border bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground/60" />
                </div>
              );

              // Anything that never got a site: drops made without a nav lock, or before the exe ran.
              const looseDeposits = bodyDeposits.filter((d) => d.siteIndex == null);
              const looseMarks = bodyMarks.filter((m) => m.siteIndex == null);
              const looseKey = `${b.body}|none`;
              const openLoose = expandedSite === looseKey;
              // The signal rows to show: filtered by the find chips, ordered by number or by expected value.
              const rows = (findSet.size ? b.siteRows.filter(rowMatches) : b.siteRows)
                .slice()
                .sort((x, y) => (rankByValue ? (rowScore(y) - rowScore(x)) || (x.index - y.index) : x.index - y.index));
              const icyBody = /\b(icy|ice)\b/i.test(b.planetClass ?? '');

              return (
                <div key={b.body} className={`edc-chamfer border bg-card/70 ${b.tonnes > 0 ? 'border-amber-500/30' : 'border-border'}`}>
                  <div
                    role="button" tabIndex={0}
                    onClick={() => setExpandedBody(open && bodyCards.length > 2 ? null : b.body)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setExpandedBody(open && bodyCards.length > 2 ? null : b.body); }}
                    className="w-full cursor-pointer px-4 py-3 text-left"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-3">
                      <div>
                        <span className="text-sm font-semibold">{short(b.body, b.system)}{icyBody ? <span className="ml-1.5 text-xs" title="Icy — an ice ball">{'❄'}</span> : null}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{b.system ?? '—'}</span>
                        {b.planetClass && <span className={`ml-2 text-[11px] ${icyBody ? 'text-slate-500' : 'text-muted-foreground'}`}>{b.planetClass}{b.atmosphere && !/^none$/i.test(b.atmosphere) ? ` · ${b.atmosphere}` : ''}</span>}
                        {b.drive && b.drive.drivenM > 0 && <span className="ml-2 text-[11px] tabular-nums text-muted-foreground" title="Lifetime driving on this body, from the breadcrumb track">{'🚗'} {fmtM(b.drive.drivenM)}</span>}
                        {b.drive?.highest && <span className="ml-2 text-[11px] tabular-nums text-muted-foreground" title={`Highest ground reached ${b.drive.highest.how} at ${coord(b.drive.highest.lat, b.drive.highest.lon)} — SRV jumps excluded`}>{'⛰'} {b.drive.highest.alt.toLocaleString()} m</span>}
                        {findSet.size > 0 && <span className="ml-2 text-[11px] text-sky-300">{rows.length} of {b.siteRows.length} signals match</span>}
                      </div>
                      <div className="flex flex-wrap items-baseline gap-3 text-xs tabular-nums">
                        {b.sitesManual ? (
                          <span className="inline-flex items-center gap-1 text-amber-300 font-semibold" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                            <input
                              key={`${b.body}|${b.sitesKnown ?? ''}`}
                              type="number" min={0} defaultValue={b.sitesKnown ?? ''} placeholder="?"
                              title="Typed from the system map. Retype and press Enter to replace it; empty + Enter clears it (back to Needs a DSS). A DSS always wins."
                              className="w-14 rounded border border-white/15 bg-black/40 px-1 py-0.5 text-center text-xs text-amber-300 placeholder:text-slate-600"
                              onKeyDown={(e) => {
                                if (e.key !== 'Enter') return;
                                const v = (e.target as HTMLInputElement).value.trim();
                                if (!v) { setSiteCount(b, null); return; }
                                const n = Number(v);
                                if (Number.isFinite(n) && n >= 0) setSiteCount(b, n);
                              }}
                            />
                            signals<span className="ml-1 text-[10px] font-normal uppercase tracking-wider text-slate-400">from the map</span>
                          </span>
                        ) : (
                          <span className="text-amber-300 font-semibold" title="Count from the DSS">{b.sitesKnown ?? '?'} signals</span>
                        )}
                        <span className="text-muted-foreground">{b.sitesSeen} seen · {b.sitesVisited} visited · <span className="text-emerald-400">{b.sitesWorked} worked</span></span>
                        {b.tonnes > 0 && <span>{b.tonnes.toLocaleString()}t{top ? ` · ${top}` : ''}{worth != null ? ` · ${cr(worth)}` : ''}</span>}
                      </div>
                    </div>
                  </div>

                  {open && (
                    <div className="border-t border-border/60 px-4 py-3 space-y-3">
                      {/* sites */}
                      {(b.siteRows.length > 0 || bodyDeposits.length > 0 || bodyMarks.length > 0) && (
                        <div className="overflow-x-auto rounded-lg border border-border">
                          <table className="w-full text-sm">
                            <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                              <tr>
                                <th className="px-3 py-2 text-left">Signal</th>
                                <th className="px-3 py-2 text-left">Status</th>
                                <th className="px-3 py-2 text-left">Expected · galactic avg</th>
                                <th className="px-3 py-2 text-left">Collected</th>
                                <th className="px-3 py-2 text-right">Tonnes</th>
                                <th className="px-3 py-2 text-right">Collections</th>
                                <th className="px-3 py-2 text-right">Last</th>
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map((s) => {
                                const siteKey = `${b.body}|${s.index}`;
                                const openSite = expandedSite === siteKey;
                                const siteDeposits = bodyDeposits.filter((d) => d.siteIndex === s.index);
                                const siteMarks = bodyMarks.filter((m) => m.siteIndex === s.index);
                                const photos = siteDeposits.filter((d) => d.imageUrl).length + siteMarks.filter((m) => m.imageUrl).length;
                                // The hull a landing score is filed under: the one the journal says you are flying.
                                const hullType = ship?.type ?? null;
                                const landingNow = hullType ? (s.ratings?.landing.find((l) => l.shipType === hullType)?.score ?? null) : null;
                                return (
                                <Fragment key={s.index}>
                                <tr className={`border-t border-border/60 cursor-pointer ${openSite ? 'bg-black/20' : 'hover:bg-white/[0.03]'}`} onClick={() => setExpandedSite(openSite ? null : siteKey)}>
                                  <td className="px-3 py-2 font-semibold text-amber-300 whitespace-nowrap">
                                    <span className="mr-1.5 inline-block w-3 text-[10px] text-muted-foreground">{openSite ? '▾' : '▸'}</span>Signal {s.index}
                                    {photos > 0 && <span className="ml-1.5 text-xs" title={`${photos} photo${photos === 1 ? '' : 's'} at this signal`}>{'📷'}</span>}
                                    {s.ratings?.landing.map((l) => (
                                      <span key={`l:${l.shipType ?? l.ship ?? '?'}`} className="ml-1.5 text-[11px] font-normal text-slate-300" title={`Landing ${l.score}/5 in ${l.ship ?? l.shipType ?? 'unknown hull'} (1 easy, 5 brutal)`}>{'🛬'}{l.score} {l.ship ?? l.shipType}{l.size ? ` ${l.size}` : ''}</span>
                                    ))}
                                    {s.ratings?.driving && (
                                      <span className="ml-1.5 text-[11px] font-normal text-slate-300" title={`Driving ${s.ratings.driving.score}/5 (1 easy, 5 brutal)`}>{'🚗'}{s.ratings.driving.score}</span>
                                    )}
                                    {rankByValue && (
                                      <span className="ml-2 text-[11px] font-normal tabular-nums text-emerald-300" title="Sum of galactic-average prices of the expected commodities — one deposit of each, one tonne each">{cr(rowScore(s))}</span>
                                    )}
                                  </td>
                                  <td className="px-3 py-2 text-xs">
                                    {s.worked ? <span className="text-emerald-400">worked</span> : s.visited ? <span className="text-amber-300">visited</span> : s.seen ? <span className="text-sky-300">seen from orbit</span> : <span className="text-muted-foreground">tagged</span>}
                                  </td>
                                  <td className="px-3 py-2">
                                    <div className="flex flex-wrap items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                      {(() => {
                                        // "Already there" = tagged OR pulled at this signal. Neither the chips nor the box offer it again.
                                        const have = new Set([...s.expected, ...Object.keys(s.commodities)].map((c) => c.toLowerCase()));
                                        const rowKey = `${b.body}|${s.index}`;
                                        const editing = editingSite === rowKey;
                                        // Table spelling, alphabetical — the ledger keeps what was typed.
                                        const shown = [...new Set(s.expected.map(canonicalName))].sort((x, y) => x.localeCompare(y));
                                        // Pulled commodities are journal facts — no ×. Tagged ones can be taken back.
                                        const pulled = new Set(Object.keys(s.commodities).map((c) => canonicalName(c).toLowerCase()));
                                        // The commander's observation: a signal holds at most six. A seventh is a mistake somewhere.
                                        const MAX_PER_SIGNAL = 6;
                                        const full = shown.length >= MAX_PER_SIGNAL;
                                        const offer = (set: Set<string>) => [...new Set([...set].filter((c) => !have.has(c.toLowerCase())).map(canonicalName))].sort((x, y) => x.localeCompare(y));
                                        const chip = (c: string, dim: boolean) => (
                                          <button
                                            key={`tag:${c}`} type="button"
                                            onClick={() => sight({ body: b.body, system: b.system, commodity: c, siteIndex: s.index })}
                                            title={dim ? `Seen or pulled elsewhere in ${b.system ?? 'this system'} — tap to tag it on Signal ${s.index}` : `Seen or pulled on this body — tap to tag it on Signal ${s.index}`}
                                            className={`rounded border border-dashed px-1.5 py-0.5 text-[11px] ${dim ? 'border-white/10 text-slate-500 hover:text-slate-300' : 'border-sky-500/40 text-sky-300/80 hover:bg-sky-500/15'}`}
                                          >
                                            + {c}
                                          </button>
                                        );
                                        return (
                                          <>
                                            {shown.length === 0
                                              ? <span className="text-xs text-muted-foreground">—</span>
                                              : shown.map((c) => {
                                                const p = priceOf(c);
                                                const canRetract = editing && !pulled.has(c.toLowerCase());
                                                return (
                                                  <span key={c} className="inline-flex items-center rounded bg-sky-500/15 px-1.5 py-0.5 text-[11px] text-sky-200" title={p ? `${p.toLocaleString()} cr/t · ${priceSource(c)}` : 'No price on file'}>
                                                    {c}{p ? <span className="ml-1 opacity-70 tabular-nums">{cr(p)}</span> : null}
                                                    {canRetract && (
                                                      <button type="button" onClick={() => unsight(b.body, s.index, c)} title={`Take ${c} off Signal ${s.index} — it was tagged by hand`} className="ml-1 text-sky-300/70 hover:text-red-300">×</button>
                                                    )}
                                                  </span>
                                                );
                                              })}
                                            {!editing && (
                                              <button type="button" onClick={() => setEditingSite(rowKey)} title="Add what the left panel says this signal holds"
                                                className="rounded border border-white/10 px-1.5 py-0.5 text-[11px] text-slate-400 hover:border-sky-500/40 hover:text-sky-300">
                                                edit
                                              </button>
                                            )}
                                            {editing && (
                                              <span className={`text-[10px] tabular-nums ${full ? 'text-amber-300' : 'text-muted-foreground'}`} title="A signal holds at most six commodities">{shown.length}/{MAX_PER_SIGNAL}</span>
                                            )}
                                            {editing && full && (
                                              <span className="text-[11px] text-amber-300/80">six is the cap — take one off with × before adding another</span>
                                            )}
                                            {editing && !full && offer(bodyKnown).map((c) => chip(c, false))}
                                            {editing && !full && offer(systemKnown).map((c) => chip(c, true))}
                                            {editing && !full && <input
                                              list="deposit-commodities" placeholder="+ commodity" title="Anything not in the chips — Enter to add. No tonnage, never skews your rates."
                                              className="w-28 rounded border border-white/15 bg-black/40 px-1.5 py-0.5 text-[11px] text-sky-200 placeholder:text-slate-600"
                                              onKeyDown={(e) => {
                                                if (e.key !== 'Enter') return;
                                                const el = e.target as HTMLInputElement;
                                                const commodity = el.value.trim();
                                                if (!commodity) return;
                                                if (have.has(commodity.toLowerCase())) { setNote(`${commodity} is already on Signal ${s.index} — tagged or pulled there before.`); el.value = ''; return; }
                                                sight({ body: b.body, system: b.system, commodity, siteIndex: s.index });
                                                el.value = '';
                                              }}
                                            />}
                                            {editing && (
                                              <button type="button" onClick={() => setEditingSite(null)}
                                                className="rounded border border-emerald-500/40 px-2 py-0.5 text-[11px] text-emerald-300 hover:bg-emerald-500/15">
                                                done
                                              </button>
                                            )}
                                          </>
                                        );
                                      })()}
                                    </div>
                                  </td>
                                  <td className="px-3 py-2 text-xs">{Object.entries(s.commodities).sort((x, y) => y[1] - x[1]).map(([c, t]) => `${c} ${t}t`).join(', ') || '—'}</td>
                                  <td className="px-3 py-2 text-right tabular-nums">{s.tonnes || '—'}</td>
                                  <td className="px-3 py-2 text-right tabular-nums">{s.collections || '—'}</td>
                                  <td className="px-3 py-2 text-right text-xs text-muted-foreground">{when(s.lastAt)}</td>
                                </tr>
                                {openSite && (
                                  <tr className="border-t border-border/40 bg-black/20">
                                    <td colSpan={7} className="px-3 py-2">
                                      <div className="space-y-1.5">
                                        {/* your scores — landing is filed under the hull, driving under the signal */}
                                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
                                          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                                            Landing in <span className="text-foreground">{ship ? ship.name : 'unknown hull'}</span>
                                            {ship?.size
                                              ? <span className="rounded border border-white/15 px-1 text-[10px] text-slate-300" title="Landing-pad size of this hull">{ship.size}</span>
                                              : ship ? (
                                                <span className="inline-flex items-center gap-1" title="The ship table has no pad size for this hull — tap once, it is remembered for good">
                                                  <span className="text-[10px] text-amber-300/80">pad size?</span>
                                                  {(['S', 'M', 'L'] as const).map((sz) => (
                                                    <button key={sz} type="button" onClick={() => setHullSize(sz)} className="h-6 w-6 rounded border border-white/15 text-[10px] text-slate-300 hover:border-amber-500/40">{sz}</button>
                                                  ))}
                                                </span>
                                              ) : null}
                                          </span>
                                          <RatingPicker value={landingNow} title="Landing difficulty in this hull — 1 easy, 5 brutal" onPick={(n) => rate(b, s.index, { landing: n })} />
                                          <span className="text-muted-foreground">Driving</span>
                                          <RatingPicker value={s.ratings?.driving?.score ?? null} title="Driving difficulty once down — 1 easy, 5 brutal" onPick={(n) => rate(b, s.index, { driving: n })} />
                                          <span className="text-[10px] text-muted-foreground/70">1 easy · 5 brutal</span>
                                        </div>
                                        {siteDeposits.length === 0 && siteMarks.length === 0 && (
                                          <div className="text-xs text-muted-foreground">Nothing placed at Signal {s.index} yet — a deposit appears here once you work it, or promote an F10 shot taken there.</div>
                                        )}
                                        {siteDeposits.some((d) => d.lat != null) && (
                                          <SignalMap
                                            deposits={siteDeposits.filter((d) => d.lat != null && d.lon != null && !d.uncertain)}
                                            track={summary?.track?.[b.body] ?? []}
                                            landing={snap?.landing && snap.landing.body === b.body ? { lat: snap.landing.lat, lon: snap.landing.lon } : null}
                                            live={snap?.body === b.body && snap.lat != null && snap.lon != null ? { lat: snap.lat, lon: snap.lon, heading: snap.heading ?? null } : null}
                                            recall={s.recall ?? null}
                                            target={snap?.target ?? null}
                                            radius={b.radius ?? snap?.radius ?? null}
                                            photoUrl={siteDeposits.find((d) => d.imageUrl)?.imageUrl ?? bodyDeposits.find((d) => d.imageUrl)?.imageUrl ?? null}
                                            pois={[
                                              ...(summary?.groves ?? []).filter((g) => g.body === b.body).map((g) => ({ id: g.id, lat: g.lat, lon: g.lon, label: g.label, kind: 'braintree' })),
                                              ...(summary?.pins ?? []).filter((p) => p.body === b.body && p.kind !== 'braintree').map((p) => ({ id: p.id, lat: p.lat, lon: p.lon, label: p.label, kind: p.kind })),
                                            ]}
                                            onSteer={(t) => setTarget({ ...t, body: b.body })}
                                          />
                                        )}
                                        {s.recall && (
                                          <div className="flex flex-wrap items-center gap-2 text-xs">
                                            <span className="text-emerald-400">{'⌖'} recall here</span>
                                            <span className="font-mono text-muted-foreground">{coord(s.recall.lat, s.recall.lon)}</span>
                                            <span className="text-muted-foreground" title="Tonnage-weighted least-total-driving point among this signal's worked deposits. Terrain is yours to judge on arrival.">
                                              {s.recall.distances.map((x) => `${x.commodity ?? 'deposit'} ${fmtM(x.metres)}`).join(' · ')}
                                            </span>
                                            <button type="button" onClick={() => setTarget({ lat: s.recall!.lat, lon: s.recall!.lon, label: 'recall spot', kind: 'recall', body: b.body })}
                                              className="rounded border border-white/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-slate-300 hover:border-sky-500/50 hover:text-sky-300">
                                              {'⤴'} steer here
                                            </button>
                                          </div>
                                        )}
                                        {siteDeposits.map(renderDeposit)}
                                        {siteMarks.map(renderMark)}
                                      </div>
                                    </td>
                                  </tr>
                                )}
                                </Fragment>
                                );
                              })}
                              {(looseDeposits.length > 0 || looseMarks.length > 0) && (
                                <Fragment key="none">
                                  <tr className={`border-t border-border/60 cursor-pointer ${openLoose ? 'bg-black/20' : 'hover:bg-white/[0.03]'}`} onClick={() => setExpandedSite(openLoose ? null : looseKey)}>
                                    <td colSpan={7} className="px-3 py-2 text-slate-400">
                                      <span className="mr-1.5 inline-block w-3 text-[10px] text-muted-foreground">{openLoose ? '▾' : '▸'}</span>
                                      <span className="font-semibold">no signal yet</span>
                                      <span className="ml-2 text-xs tabular-nums">{looseDeposits.length + looseMarks.length}</span>
                                      <span className="ml-2 text-[11px] text-muted-foreground">dropped without a nav lock — open it and type the signal number on each</span>
                                    </td>
                                  </tr>
                                  {openLoose && (
                                    <tr className="border-t border-border/40 bg-black/20">
                                      <td colSpan={7} className="px-3 py-2">
                                        <div className="space-y-1.5">
                                          {looseDeposits.map(renderDeposit)}
                                          {looseMarks.map(renderMark)}
                                        </div>
                                      </td>
                                    </tr>
                                  )}
                                </Fragment>
                              )}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {/* brain-tree groves on this body — a place with a yield, like a deposit, only in materials */}
                      {(summary?.groves ?? []).some((g) => g.body === b.body) && (
                        <div className="space-y-1.5">
                          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{'🌳'} Brain-tree groves</div>
                          {(summary?.groves ?? []).filter((g) => g.body === b.body).map((g) => (
                            <div key={g.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs">
                              <div>
                                <div className="font-semibold text-emerald-300">{g.label} <span className="font-normal text-muted-foreground">· {g.source === 'codex' ? 'from the codex' : 'pinned by you'}</span></div>
                                <div className="font-mono text-muted-foreground">{coord(g.lat, g.lon)}</div>
                              </div>
                              <div className="flex-1">
                                {g.harvest ? (
                                  <span>
                                    {Object.entries(g.harvest.materials).sort((x, y) => y[1] - x[1]).map(([m, n]) => `${m} ${n}`).join(' · ')}
                                    <span className="ml-2 text-muted-foreground">{g.harvest.units} units{g.harvest.unitsPerHour != null ? ` · ${g.harvest.unitsPerHour}/h` : ''}{Object.entries(g.harvest.byGrade).filter(([gr]) => gr !== '0').sort((x, y) => Number(y[0]) - Number(x[0])).map(([gr, n]) => ` · G${gr} ${n}`).join('')}</span>
                                  </span>
                                ) : <span className="text-muted-foreground">no harvest recorded yet — pickups inside 300 m of it will show here</span>}
                              </div>
                              <button type="button" onClick={() => setTarget({ lat: g.lat, lon: g.lon, label: g.label, kind: 'braintree', body: b.body })}
                                className="rounded border border-white/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-slate-300 hover:border-sky-500/50 hover:text-sky-300">{'⤴'} steer here</button>
                              {g.source === 'pin' && (
                                <button type="button" onClick={() => unpin(g.id)} title="Remove this pin (harvests already recorded stay in the ledger)" className="text-[10px] text-slate-500 hover:text-red-300">remove</button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      {(summary?.pins ?? []).some((p) => p.body === b.body && p.kind !== 'braintree') && (
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Pins</span>
                          {(summary?.pins ?? []).filter((p) => p.body === b.body && p.kind !== 'braintree').map((p) => (
                            <span key={p.id} className="inline-flex items-center gap-1 rounded border border-white/15 px-1.5 py-0.5">
                              <button type="button" onClick={() => setTarget({ lat: p.lat, lon: p.lon, label: p.label, kind: p.kind, body: b.body })} className="hover:text-sky-300">{'⤴'} {p.label}</button>
                              <span className="font-mono text-muted-foreground">{coord(p.lat, p.lon)}</span>
                              <button type="button" onClick={() => unpin(p.id)} className="text-slate-500 hover:text-red-300">×</button>
                            </span>
                          ))}
                        </div>
                      )}

                      {/* log something seen here without a nav lock — only when there are no site rows to tag into */}
                      {b.siteRows.length === 0 && (
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="text-muted-foreground">Saw a deposit here:</span>
                        <input type="text" list="deposit-commodities" placeholder="commodity"
                          onKeyDown={(e) => {
                            if (e.key !== 'Enter') return;
                            const el = e.target as HTMLInputElement; const v = el.value.trim(); if (!v) return;
                            const siteEl = el.nextElementSibling as HTMLInputElement | null; const site = siteEl?.value.trim() || '';
                            sight({ body: b.body, system: b.system, commodity: v, site, siteIndex: site && /^\d+$/.test(site) ? Number(site) : null });
                            el.value = ''; if (siteEl) siteEl.value = '';
                          }}
                          className="w-48 rounded border border-border bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground/60" />
                        <input type="text" placeholder="signal #" className="w-16 rounded border border-border bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground/60" />
                        <span className="text-muted-foreground/70">Enter to log · use the Targeting box above when you're nav-locked; it fills the signal for you</span>
                      </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ---- Where to go back ---- */}
      {bestSites.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-baseline gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Where to go back</h2>
            <span className="text-xs text-muted-foreground">by signal · credits per hour of being there · priced at your best market this month, else galactic average · in scope</span>
          </div>
          <div className="grid gap-2 md:grid-cols-3">
            {bestSites.map((s, i) => (
              <div key={`${s.body}|${s.siteIndex ?? 'none'}`} className={`edc-chamfer relative border bg-card/70 px-4 py-3 ${i === 0 ? 'border-amber-400/50 shadow-[0_0_22px_-8px_rgba(251,146,60,0.5)]' : 'border-border'}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className={`text-[10px] font-bold tracking-widest ${i === 0 ? 'text-amber-300' : 'text-muted-foreground'}`}>#{i + 1}{i === 0 ? ' · BEST BET' : ''}</span>
                  <span className="text-[10px] text-muted-foreground">{s.visits} visit{s.visits === 1 ? '' : 's'} · last {when(s.lastAt)}</span>
                </div>
                <div className="mt-1 text-sm font-semibold leading-tight">{short(s.body, s.system)} <span className="text-amber-300">{s.siteIndex != null ? `Signal ${s.siteIndex}` : 'signal unknown'}</span></div>
                <div className="mt-1 text-xs text-muted-foreground">{Object.entries(s.commodities).sort((x, y) => y[1] - x[1]).map(([c, t]) => `${c} ${t}t`).join(' · ')}</div>
                {(() => {
                  const r = bodies.find((bb) => bb.body === s.body)?.siteRows.find((row) => row.index === s.siteIndex)?.ratings;
                  if (!r || (!r.driving && !r.landing.length)) return null;
                  return (
                    <div className="mt-1 text-[11px] text-slate-300">
                      {r.landing.map((l) => <span key={`l:${l.shipType ?? l.ship ?? '?'}`} className="mr-2" title="Landing, 1 easy · 5 brutal">{'🛬'}{l.score} {l.ship ?? l.shipType}{l.size ? ` ${l.size}` : ''}</span>)}
                      {r.driving && <span title="Driving, 1 easy · 5 brutal">{'🚗'}{r.driving.score}</span>}
                    </div>
                  );
                })()}
                <div className="mt-1.5 flex items-baseline gap-3 tabular-nums text-sm">
                  <span className="text-emerald-400">{s.crPerHour > 0 ? `${cr(s.crPerHour)}/h` : 'unpriced'}</span>
                  <span className="text-muted-foreground">{Math.round(s.tph)} t/h · {s.tonnes}t in {s.hours < 1 ? `${Math.round(s.hours * 60)} min` : `${s.hours.toFixed(1)} h`}</span>
                </div>
                {s.best && (
                  <div className="mt-1 font-mono text-[11px] text-muted-foreground" title="The best deposit at this signal by value — where to park">
                    {coord(s.best.lat, s.best.lon)}{s.best.amount || s.best.density ? ` · ${s.best.amount ?? '—'} / ${s.best.density ?? '—'}` : ''}{s.best.rigs != null && s.best.rigs > 1 ? ` · ${s.best.rigs} rigs fit` : s.best.rigs == null && (s.best.rigsEstimate ?? 1) > 1 ? ` · ≈${s.best.rigsEstimate} rigs (est.)` : ''}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ---- Measured yield ---- */}
      {(deposits.some((d) => d.tonnes > 0) || visits.some((v) => v.tph)) && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Measured yield</h2>
          <div className="grid gap-3 lg:grid-cols-2">
            <HBarChart
              title="Value pulled per deposit — galactic average"
              rows={deposits.filter((d) => d.tonnes > 0).map((d) => ({ label: `${short(d.body, d.system)}${d.siteIndex != null ? ` · Signal ${d.siteIndex}` : ''}`, sub: `${d.tonnes}t · ${d.collections} collections`, value: valueOf(d.commodities) ?? 0 })).slice(0, 8)}
              fmt={(v) => `~${cr(v)}`}
              barClass="bg-emerald-400/70"
            />
            <HBarChart
              title="Tonnes per hour — per visit, measured from landing to last collection"
              rows={visits.filter((v) => v.tph).map((v) => ({ label: `${short(v.body, v.system)}${v.siteIndex != null ? ` · Signal ${v.siteIndex}` : ''}`, sub: `${v.at.slice(0, 10)} · ${v.tonnes}t in ${v.hours}h`, value: v.tph as number })).slice(0, 8)}
              fmt={(v) => `${v.toFixed(0)} t/hr`}
              barClass="bg-sky-400/70"
            />
          </div>
          {/* driving rating against measured driving — one line per rated signal with track data */}
          {(() => {
            const rows: { label: string; score: number; kmh: number | null; climb: number; driven: number; visits: number }[] = [];
            for (const b of bodies) {
              for (const r of b.siteRows) {
                const score = r.ratings?.driving?.score;
                if (score == null) continue;
                const vs = visits.filter((v) => v.body === b.body && v.siteIndex === r.index && v.drive && v.drive.drivenM > 0);
                if (!vs.length) continue;
                const driven = vs.reduce((t, v) => t + (v.drive!.drivenM), 0);
                const climb = vs.reduce((t, v) => t + (v.drive!.climbM), 0);
                const speeds = vs.map((v) => v.drive!.avgKmh).filter((x): x is number => x != null);
                rows.push({ label: `${short(b.body, b.system)} Signal ${r.index}`, score, kmh: speeds.length ? Math.round(speeds.reduce((a, x) => a + x, 0) / speeds.length) : null, climb: Math.round(climb / vs.length), driven, visits: vs.length });
              }
            }
            if (!rows.length) return null;
            return (
              <div className="rounded-lg border border-border px-3 py-2 text-xs">
                <div className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">Driving rating vs the track</div>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {rows.sort((x, y) => x.score - y.score).map((r) => (
                    <span key={r.label} className="tabular-nums"><span className="text-amber-300">{'🚗'}{r.score}</span> {r.label}: {r.kmh != null ? `${r.kmh} km/h avg` : 'no speed'} · {r.climb} m climb/visit · {fmtM(r.driven)} over {r.visits} visit{r.visits === 1 ? '' : 's'}</span>
                  ))}
                </div>
              </div>
            );
          })()}
          <details className="rounded-lg border border-border">
            <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground hover:text-foreground">Raw table — every visit</summary>
            <div className="overflow-x-auto border-t border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">When</th>
                    <th className="px-3 py-2 text-left">Body</th>
                    <th className="px-3 py-2 text-left">Signal</th>
                    <th className="px-3 py-2 text-left">Collected</th>
                    <th className="px-3 py-2 text-right">Tonnes</th>
                    <th className="px-3 py-2 text-right">Collections</th>
                    <th className="px-3 py-2 text-right">Hours</th>
                    <th className="px-3 py-2 text-right" title="Hold-fulls dropped at the ship during the visit">Trips</th>
                    <th className="px-3 py-2 text-right">t/hr</th>
                    <th className="px-3 py-2 text-right" title="From the breadcrumb track — SRV legs only; recorded from build 1.56 on">Driven</th>
                    <th className="px-3 py-2 text-right" title="Average moving speed (legs 30 s or closer) · peak">km/h</th>
                    <th className="px-3 py-2 text-right" title="Metres climbed during the visit">Climb</th>
                    <th className="px-3 py-2 text-right" title="Your driving rating for the signal, 1 easy · 5 brutal">Driving</th>
                  </tr>
                </thead>
                <tbody>
                  {visits.map((v) => (
                    <tr key={`${v.at}|${v.body}`} className="border-t border-border/60">
                      <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{v.at.slice(0, 16).replace('T', ' ')}</td>
                      <td className="px-3 py-2">{short(v.body, v.system)}</td>
                      <td className="px-3 py-2 text-amber-300">{v.siteIndex != null ? `Signal ${v.siteIndex}` : '—'}</td>
                      <td className="px-3 py-2 text-xs">{Object.entries(v.commodities).sort((x, y) => y[1] - x[1]).map(([c, t]) => `${c} ${t}t`).join(', ') || '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{v.tonnes}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{v.collections}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{v.hours || '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{v.trips || '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-400">{v.tph ?? '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{v.drive && v.drive.drivenM > 0 ? fmtM(v.drive.drivenM) : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{v.drive?.avgKmh != null ? `${v.drive.avgKmh}${v.drive.maxKmh != null ? ` · ${v.drive.maxKmh}` : ''}` : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{v.drive && v.drive.climbM > 0 ? `${v.drive.climbM} m` : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{bodies.find((bb) => bb.body === v.body)?.siteRows.find((r) => r.index === v.siteIndex)?.ratings?.driving?.score ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <p className="text-xs text-muted-foreground/70">
            A collection is one rig-hatch emptying, read from the burst of refines while in the SRV. Rigs deployed, rig progress and rigs
            remaining are never written by the game, so they are not shown. Coordinates exist only for collections made while the exe was running.
          </p>
        </section>
      )}

      {/* ---- Materials ---- */}
      {surveyed.length > 0 && (
        <section className="space-y-2">
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Materials</h2>
            <input type="text" value={matQuery} onChange={(e) => setMatQuery(e.target.value)} placeholder="filter — yttrium, tellurium, …"
              className="w-52 rounded border border-border bg-muted/30 px-2 py-0.5 text-xs text-foreground placeholder:text-muted-foreground/60" />
            <span className="text-xs text-muted-foreground">{surveyed.filter((b) => inScope(b.system)).length} of {surveyed.length} surveyed bodies in scope</span>
          </div>
          {matRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing scanned in scope. Widen it, or DSS a landable body.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Material</th>
                    <th className="px-3 py-2 text-left">Grade</th>
                    <th className="px-3 py-2 text-right">Held</th>
                    <th className="px-3 py-2 text-right">Room</th>
                    <th className="px-3 py-2 text-left">Richest body</th>
                    <th className="px-3 py-2 text-right">Best %</th>
                    <th className="px-3 py-2 text-right">Bodies</th>
                  </tr>
                </thead>
                <tbody>
                  {matRows.map((m) => (
                    <tr key={m.id} className="border-t border-border/60">
                      <td className="px-3 py-2 whitespace-nowrap">{m.name}</td>
                      <td className="px-3 py-2"><span className={m.grade >= 4 ? 'text-amber-300' : m.grade === 3 ? 'text-emerald-400' : 'text-muted-foreground'}>G{m.grade} · {RARITY[m.grade]}</span></td>
                      <td className="px-3 py-2 text-right tabular-nums">{m.held == null ? '—' : `${m.held}/${m.cap}`}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{m.room == null ? '—' : m.room <= 0 ? <span className="text-muted-foreground">FULL</span> : m.room}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-xs">{short(m.bestBody, m.bestSystem)}{scope !== 'current' && m.bestSystem ? <span className="ml-1 text-muted-foreground">{m.bestSystem}</span> : null}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{m.bestPct}%</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{m.bodies}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
