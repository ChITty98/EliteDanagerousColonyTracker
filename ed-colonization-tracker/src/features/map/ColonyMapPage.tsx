import { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import { useAppStore } from '@/store';
import { getSystemTier } from '@/features/dashboard/tierUtils';
import { GALACTIC_REGION_LINES, GALACTIC_REGION_LABELS, GALACTIC_REGION_SOURCE } from '@/data/galacticRegions';

interface MapPoint {
  name: string;
  x: number; // galactic X
  z: number; // negated galactic Z for SVG (positive = up = toward galactic center)
  y: number; // galactic Y (for tooltip)
  rawZ: number; // original galactic Z for display
  kind: 'colony' | 'ship' | 'sol' | 'home' | 'scouted' | 'landmark' | 'target';
  tier?: number;
  tierLabel?: string;
  tierIcon?: string;
  installations?: number;
  score?: number | null;   // watched targets carry their scouting score
  status?: string | null;  // ...and whether something is closing in on them
}

/** The Populated layer: /api/populated-systems — seeded from the Spansh dump, kept current from the journal stream. */
interface PopulatedSet {
  generatedAt: string | null; source: string | null; centre: { name: string; x: number; y: number; z: number };
  radiusLy: number; bubbles?: { name: string; radiusLy: number }[]; live: number; count: number;
  systems: { name: string; x: number; y: number; z: number; pop: number; economy: string | null; live?: boolean }[];
}

/** Server-owned: the threat watcher writes these into colony-data.json; the client only reads them. */
interface WatchedSystem {
  id: string;
  name: string;
  score?: number | null;
  status?: string | null;
  coordinates?: { x: number; y: number; z: number } | null;
}

// Tier SVG colors
const TIER_COLORS: Record<number, string> = {
  1: '#94a3b8', // slate
  2: '#34d399', // emerald
  3: '#a78bfa', // violet
  4: '#fbbf24', // amber/gold
};

export function ColonyMapPage() {
  const projects = useAppStore((s) => s.projects);
  const knownSystems = useAppStore((s) => s.knownSystems);
  const knownStations = useAppStore((s) => s.knownStations);
  const commanderPosition = useAppStore((s) => s.commanderPosition);
  const settings = useAppStore((s) => s.settings);
  const scoutedSystems = useAppStore((s) => s.scoutedSystems);
  const manualColonized = useAppStore((s) => s.manualColonizedSystems);
  // Watched systems are written by the server's threat watcher and arrive through hydration; they
  // are deliberately not in the store's partialize list (the client never authors them), so the
  // shape is declared here rather than pulled into the persisted-state type.
  const watchedSystems = useAppStore((s) => (s as unknown as { watchedSystems?: Record<string, WatchedSystem> }).watchedSystems);

  // Toggles
  const [showFavorites, setShowFavorites] = useState(false);
  const [showSagA, setShowSagA] = useState(false);
  const [showColonies, setShowColonies] = useState(true);
  const [showTargets, setShowTargets] = useState(false);
  const [showGalaxy, setShowGalaxy] = useState(false);
  const [showRegions, setShowRegions] = useState(false);
  const [showLandmarks, setShowLandmarks] = useState(false);
  const [showPopulated, setShowPopulated] = useState(false);
  const [hoveredPoint, setHoveredPoint] = useState<MapPoint | null>(null);

  // Pan/zoom state
  const svgRef = useRef<SVGSVGElement>(null);
  const [viewBox, setViewBox] = useState({ x: -200, y: -200, w: 400, h: 400 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0, vx: 0, vy: 0 });

  // Build map points
  const points = useMemo(() => {
    const pts: MapPoint[] = [];

    // Sol
    pts.push({ name: 'Sol', x: 0, z: 0, y: 0, rawZ: 0, kind: 'sol' });

    // Home system
    if (settings.homeSystem) {
      const homeKey = settings.homeSystem.toLowerCase();
      const homeSys = knownSystems[homeKey];
      if (homeSys?.coordinates) {
        pts.push({
          name: settings.homeSystem,
          x: homeSys.coordinates.x,
          z: -homeSys.coordinates.z,
          y: homeSys.coordinates.y,
          rawZ: homeSys.coordinates.z,
          kind: 'home',
        });
      }
    }

    // Colony systems
    const colonySystems = new Set<string>();
    for (const p of projects) {
      if (!p.systemName) continue;
      const key = p.systemName.toLowerCase();
      if (colonySystems.has(key)) continue;
      colonySystems.add(key);

      const sys = knownSystems[key];
      const id64 = sys?.systemAddress || p.systemAddress;
      const scoutCoords = id64 ? scoutedSystems[id64]?.coordinates : undefined;
      const coords = sys?.coordinates || p.systemInfo?.coordinates || scoutCoords;
      if (!coords) continue;

      // Count installations for tier
      const stationCount = Object.values(knownStations).filter(
        (st) => st.systemName?.toLowerCase() === key
      ).length;
      const tierInfo = getSystemTier(stationCount);

      pts.push({
        name: p.systemName,
        x: coords.x,
        z: -coords.z,
        y: coords.y,
        rawZ: coords.z,
        kind: 'colony',
        tier: tierInfo.tier,
        tierLabel: tierInfo.label,
        tierIcon: tierInfo.icon,
        installations: stationCount,
      });
    }

    // Manual colonized systems (not in projects)
    for (const sysName of manualColonized) {
      const key = sysName.toLowerCase();
      if (colonySystems.has(key)) continue;
      colonySystems.add(key);
      const sys = knownSystems[key];
      const manualId64 = sys?.systemAddress;
      const manualScoutCoords = manualId64 ? scoutedSystems[manualId64]?.coordinates : undefined;
      const manualCoords = sys?.coordinates || manualScoutCoords;
      if (!manualCoords) continue;
      const stationCount = Object.values(knownStations).filter(
        (st) => st.systemName?.toLowerCase() === key
      ).length;
      const tierInfo = getSystemTier(stationCount);
      pts.push({
        name: sysName,
        x: manualCoords.x,
        z: -manualCoords.z,
        y: manualCoords.y,
        rawZ: manualCoords.z,
        kind: 'colony',
        tier: tierInfo.tier,
        tierLabel: tierInfo.label,
        tierIcon: tierInfo.icon,
        installations: stationCount,
      });
    }

    // Scouted favorites
    if (showFavorites) {
      for (const [, s] of Object.entries(scoutedSystems)) {
        if (!s.isFavorite || !s.coordinates) continue;
        const key = s.name.toLowerCase();
        if (colonySystems.has(key)) continue;
        pts.push({
          name: s.name,
          x: s.coordinates.x,
          z: -s.coordinates.z,
          y: s.coordinates.y,
          rawZ: s.coordinates.z,
          kind: 'scouted',
        });
      }
    }

    // Watched targets — the systems being tracked for a claim, threat status and all.
    if (showTargets) {
      for (const w of Object.values(watchedSystems || {})) {
        if (!w || !w.coordinates) continue;
        const key = w.name.toLowerCase();
        if (colonySystems.has(key)) continue;
        pts.push({
          name: w.name,
          x: w.coordinates.x,
          z: -w.coordinates.z,
          y: w.coordinates.y,
          rawZ: w.coordinates.z,
          kind: 'target',
          score: w.score ?? null,
          status: w.status ?? null,
        });
      }
    }

    // Sagittarius A*
    if (showSagA) {
      pts.push({ name: 'Sagittarius A*', x: 25.21875, z: -25899.96875, y: -20.90625, rawZ: 25899.96875, kind: 'landmark' });
    }

    // Commander ship
    if (commanderPosition?.coordinates) {
      pts.push({
        name: commanderPosition.systemName,
        x: commanderPosition.coordinates.x,
        z: -commanderPosition.coordinates.z,
        y: commanderPosition.coordinates.y,
        rawZ: commanderPosition.coordinates.z,
        kind: 'ship',
      });
    }

    return pts;
  }, [projects, knownSystems, knownStations, commanderPosition, settings.homeSystem, scoutedSystems, manualColonized, showFavorites, showSagA, showTargets, watchedSystems]);

  // Auto-fit view to colony points on mount (exclude Sol to avoid stretching)
  useEffect(() => {
    const fitPts = points.filter((p) => p.kind !== 'sol');
    if (fitPts.length < 1) return;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of fitPts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    const dx = maxX - minX || 100;
    const dz = maxZ - minZ || 100;
    const pad = Math.max(dx, dz) * 0.1;

    // Match container aspect ratio so map fills the space
    const rect = svgRef.current?.getBoundingClientRect();
    const aspect = rect ? rect.width / rect.height : 16 / 9;
    let w = dx + pad * 2;
    let h = dz + pad * 2;
    const cx = minX + dx / 2;
    const cy = minZ + dz / 2;
    if (w / h < aspect) {
      w = h * aspect;
    } else {
      h = w / aspect;
    }
    setViewBox({ x: cx - w / 2, y: cy - h / 2, w, h });
  }, [points]);

  // Connection lines between nearby colonies
  const connections = useMemo(() => {
    const colonies = points.filter((p) => p.kind === 'colony');
    const lines: { from: MapPoint; to: MapPoint; dist: number }[] = [];
    for (let i = 0; i < colonies.length; i++) {
      let nearest = Infinity;
      let nearestIdx = -1;
      for (let j = 0; j < colonies.length; j++) {
        if (i === j) continue;
        const dx = colonies[i].x - colonies[j].x;
        const dz = colonies[i].z - colonies[j].z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < nearest) {
          nearest = dist;
          nearestIdx = j;
        }
      }
      if (nearestIdx >= 0 && nearest < 200) {
        // Avoid duplicate lines
        const exists = lines.some(
          (l) =>
            (l.from.name === colonies[i].name && l.to.name === colonies[nearestIdx].name) ||
            (l.from.name === colonies[nearestIdx].name && l.to.name === colonies[i].name)
        );
        if (!exists) {
          lines.push({ from: colonies[i], to: colonies[nearestIdx], dist: nearest });
        }
      }
    }
    return lines;
  }, [points]);

  // Pinch zoom state
  const pinchRef = useRef<{ dist: number; vb: typeof viewBox } | null>(null);

  // Mouse pan handlers
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    setIsPanning(true);
    setPanStart({ x: e.clientX, y: e.clientY, vx: viewBox.x, vy: viewBox.y });
  }, [viewBox]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning || !svgRef.current) return;
    const svg = svgRef.current;
    const rect = svg.getBoundingClientRect();
    const scaleX = viewBox.w / rect.width;
    const scaleY = viewBox.h / rect.height;
    const dx = (e.clientX - panStart.x) * scaleX;
    const dy = (e.clientY - panStart.y) * scaleY;
    setViewBox((v) => ({ ...v, x: panStart.vx - dx, y: panStart.vy - dy }));
  }, [isPanning, panStart, viewBox.w, viewBox.h]);

  const onMouseUp = useCallback(() => setIsPanning(false), []);

  // Touch handlers (iPad/mobile)
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      const t = e.touches[0];
      setIsPanning(true);
      setPanStart({ x: t.clientX, y: t.clientY, vx: viewBox.x, vy: viewBox.y });
    } else if (e.touches.length === 2) {
      setIsPanning(false);
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchRef.current = { dist: Math.sqrt(dx * dx + dy * dy), vb: { ...viewBox } };
    }
  }, [viewBox]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    if (e.touches.length === 1 && isPanning && svgRef.current) {
      const t = e.touches[0];
      const svg = svgRef.current;
      const rect = svg.getBoundingClientRect();
      const scaleX = viewBox.w / rect.width;
      const scaleY = viewBox.h / rect.height;
      const dx = (t.clientX - panStart.x) * scaleX;
      const dy = (t.clientY - panStart.y) * scaleY;
      setViewBox((v) => ({ ...v, x: panStart.vx - dx, y: panStart.vy - dy }));
    } else if (e.touches.length === 2 && pinchRef.current) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const newDist = Math.sqrt(dx * dx + dy * dy);
      const scale = pinchRef.current.dist / newDist;
      const vb = pinchRef.current.vb;
      const cx = vb.x + vb.w / 2;
      const cy = vb.y + vb.h / 2;
      const nw = vb.w * scale;
      const nh = vb.h * scale;
      setViewBox({ x: cx - nw / 2, y: cy - nh / 2, w: nw, h: nh });
    }
  }, [isPanning, panStart, viewBox.w, viewBox.h]);

  const onTouchEnd = useCallback(() => {
    setIsPanning(false);
    pinchRef.current = null;
  }, []);

  // Scroll zoom handler (desktop)
  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.15 : 0.87;
    setViewBox((v) => {
      const cx = v.x + v.w / 2;
      const cy = v.y + v.h / 2;
      const nw = v.w * factor;
      const nh = v.h * factor;
      return { x: cx - nw / 2, y: cy - nh / 2, w: nw, h: nh };
    });
  }, []);

  // Zoom to a specific point
  const zoomToPoint = useCallback((pt: MapPoint) => {
    const rect = svgRef.current?.getBoundingClientRect();
    const aspect = rect ? rect.width / rect.height : 16 / 9;
    const h = 120; // ly visible height when zoomed in
    const w = h * aspect;
    setViewBox({ x: pt.x - w / 2, y: pt.z - h / 2, w, h });
    setHoveredPoint(pt);
  }, []);

  // Zoom to fit colonies
  const zoomToFit = useCallback(() => {
    const fitPts = points.filter((p) => p.kind !== 'sol');
    if (fitPts.length < 1) return;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of fitPts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    const dx = maxX - minX || 100;
    const dz = maxZ - minZ || 100;
    const pad = Math.max(dx, dz) * 0.1;
    const rect = svgRef.current?.getBoundingClientRect();
    const aspect = rect ? rect.width / rect.height : 16 / 9;
    let w = dx + pad * 2;
    let h = dz + pad * 2;
    const cx = minX + dx / 2;
    const cy = minZ + dz / 2;
    if (w / h < aspect) w = h * aspect;
    else h = w / aspect;
    setViewBox({ x: cx - w / 2, y: cy - h / 2, w, h });
    setHoveredPoint(null);
  }, [points]);

  // Scale factor for consistent point sizes
  const pointScale = viewBox.w / 400;

  // System list panel toggle
  const [showList, setShowList] = useState(false);

  // ---- The journey: where you have actually been, and what happened along the way -------------
  // Path points are jump positions from the journals (server/journal/commanderLog.js); pins are
  // the weighted events that landed in a system with a known position. Loaded on demand — it is
  // a full journal replay server-side, cached there, and nobody needs it unless they ask.
  interface JourneyPin { at: string; weight: string; kind: string; system: string; pos: [number, number, number]; line: string }
  interface Journey { path: { at: string; system: string; pos: [number, number, number]; carrier?: boolean }[]; pins: JourneyPin[] }
  const [journey, setJourney] = useState<Journey | null>(null);
  // Populated systems — seeded from the Spansh regional dump and kept current from the journal
  // stream (server/radar/populatedStore.js). Fetched once, the first time the layer is switched on.
  const [populated, setPopulated] = useState<PopulatedSet | null>(null);
  const [populatedLoading, setPopulatedLoading] = useState(false);
  useEffect(() => {
    if (!showPopulated || populated || populatedLoading) return;
    setPopulatedLoading(true);
    let t: string | null = null;
    try { t = sessionStorage.getItem('colony-token'); } catch { /* no storage */ }
    fetch(t ? `/api/populated-systems?token=${t}` : '/api/populated-systems')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && Array.isArray(d.systems)) setPopulated(d as PopulatedSet); })
      .catch(() => { /* the layer simply stays empty */ })
      .finally(() => setPopulatedLoading(false));
  }, [showPopulated, populated, populatedLoading]);
  // Three population bands, each ONE path of small squares — thousands of points pan without lag.
  const populatedPaths = useMemo(() => {
    if (!populated) return null;
    const bands: { min: number; r: number; fill: string; opacity: number; d: string[] }[] = [
      { min: 10_000_000, r: 0.9, fill: '#fbbf24', opacity: 0.9, d: [] },
      { min: 1_000_000, r: 0.7, fill: '#f59e0b', opacity: 0.7, d: [] },
      { min: 0, r: 0.55, fill: '#a16207', opacity: 0.55, d: [] },
    ];
    for (const s of populated.systems) {
      const b = bands.find((x) => s.pop >= x.min)!;
      const r = b.r * pointScale;
      b.d.push(`M${(s.x - r).toFixed(2)} ${(-s.z - r).toFixed(2)}h${(2 * r).toFixed(2)}v${(2 * r).toFixed(2)}h${(-2 * r).toFixed(2)}z`);
    }
    return bands.map((b) => ({ fill: b.fill, opacity: b.opacity, d: b.d.join('') }));
  }, [populated, pointScale]);

  const [showJourney, setShowJourney] = useState(false);
  const [journeyLoading, setJourneyLoading] = useState(false);
  const [hoveredPin, setHoveredPin] = useState<JourneyPin | null>(null);
  useEffect(() => {
    if (!showJourney || journey || journeyLoading) return;
    setJourneyLoading(true);
    let t: string | null = null;
    try { t = sessionStorage.getItem('colony-token'); } catch { /* no storage */ }
    fetch(t ? `/api/commander-log/journey?min=major&token=${t}` : '/api/commander-log/journey?min=major')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && Array.isArray(d.path)) setJourney(d as Journey); })
      .catch(() => { /* the layer simply stays empty */ })
      .finally(() => setJourneyLoading(false));
  }, [showJourney, journey, journeyLoading]);

  // One polyline per continuous run: a carrier jump or a gap of more than 500 ly is a break, not
  // a line across the galaxy. Drawn in the X/Z plane like everything else on this map.
  //
  // SVG's y grows downward, so every colony point on this map is stored with its galactic z NEGATED
  // (`z: -coordinates.z`). The journey arrives as raw galactic coordinates and has to be put through
  // the same flip, or the two layers face opposite ways and nothing lines up.
  const projZ = (z: number) => -z;
  const journeyLegs = useMemo(() => {
    if (!journey) return [];
    const legs: string[][] = [];
    let leg: string[] = [];
    let prev: [number, number, number] | null = null;
    for (const p of journey.path) {
      const jump = prev ? Math.hypot(p.pos[0] - prev[0], p.pos[1] - prev[1], p.pos[2] - prev[2]) : 0;
      if (prev && (p.carrier || jump > 500)) { if (leg.length > 1) legs.push(leg); leg = []; }
      leg.push(`${p.pos[0].toFixed(1)},${projZ(p.pos[2]).toFixed(1)}`);
      prev = p.pos;
    }
    if (leg.length > 1) legs.push(leg);
    return legs;
  }, [journey]);
  // Galaxy-layer text is sized as a fraction of the view, not in light years, so the region
  // names stay legible at any zoom instead of being right only when the whole disc is on screen.
  const galaxyFont = Math.max(viewBox.w * 0.016, 0.5);

  const PIN_COLOR: Record<string, string> = { huge: '#fbbf24', major: '#38bdf8' };

  // A representative galaxy, not a survey. Sol is the origin of ED's coordinates and Sagittarius A*
  // sits 25,900 ly away on +z, so the disc is drawn as a circle about that point and the arms as
  // logarithmic spirals from the bar — r = r0·e^(kθ), pitch ~12°, the shape a barred spiral makes.
  // The phase is chosen so an arm runs through Sol, which is what puts the Orion Spur where you
  // expect it. Arm names and layout follow the galactic-regions reference at edastro.com/galmap;
  // the geometry here is redrawn, approximate, and good only for orientation.
  const GC = { x: 25.21875, z: -25899.96875 };   // Sagittarius A* in this map's coordinates
    // Landmarks, placed from REAL coordinates or not at all. Each entry names the systems that make
  // up the place; the label sits at the centroid of the ones actually in your data. A prefix that
  // matches nothing renders nothing — so a name listed here can never appear at a made-up position,
  // and a nebula you have not visited simply stays off the map until you do.
  const LANDMARK_SOURCES: { label: string; match: string[]; exact?: string[] }[] = [
    { label: 'Colonia', match: [], exact: ['colonia'] },
    { label: 'Pleiades Nebula', match: ['pleiades sector'], exact: ['merope', 'maia', 'asterope', 'electra', 'celaeno', 'atlas', 'pleione', 'taygeta'] },
    { label: 'Coalsack Nebula', match: ['coalsack sector', 'musca dark region'] },
    { label: 'California Nebula', match: ['california sector'] },
    { label: "Barnard's Loop", match: ['barnards loop sector', "barnard's loop sector"] },
    { label: 'Witch Head Nebula', match: ['witch head sector'] },
    { label: 'Horsehead Nebula', match: ['horsehead sector', 'hind sector'] },
    { label: 'Rosette Nebula', match: ['omicron sector'] },
    { label: 'Eagle Nebula', match: ['eagle sector'] },
    { label: 'Omega Nebula', match: ['omega sector'] },
    { label: 'Crab Nebula', match: ['crab sector'] },
    { label: 'Veil Nebula', match: ['veil west sector', 'veil east sector'] },
    { label: "Elephant's Trunk Nebula", match: ["elephant's trunk sector"] },
    { label: 'Cone Nebula', match: ['cone sector'] },
    { label: 'Heart Nebula', match: ['heart sector'] },
    { label: 'Soul Nebula', match: ['soul sector'] },
    { label: 'Shinrarta Dezhra', match: [], exact: ['shinrarta dezhra'] },
    { label: 'Beagle Point', match: [], exact: ['beagle point'] },
    { label: 'Sagittarius A*', match: [], exact: ['sagittarius a*'] },
  ];
  const LANDMARKS = useMemo(() => {
    const all: { name: string; x: number; z: number }[] = [];
    for (const sys of Object.values(knownSystems)) {
      if (sys.coordinates) all.push({ name: (sys.systemName || '').toLowerCase(), x: sys.coordinates.x, z: sys.coordinates.z });
    }
    for (const sys of Object.values(scoutedSystems)) {
      if (sys.coordinates) all.push({ name: (sys.name || '').toLowerCase(), x: sys.coordinates.x, z: sys.coordinates.z });
    }
    const out: { label: string; x: number; z: number; n: number }[] = [];
    for (const L of LANDMARK_SOURCES) {
      const hits = all.filter((s2) => (L.exact || []).includes(s2.name) || L.match.some((m) => s2.name.startsWith(m)));
      if (!hits.length) continue;
      const x = hits.reduce((a, h) => a + h.x, 0) / hits.length;
      const z = hits.reduce((a, h) => a + h.z, 0) / hits.length;
      out.push({ label: L.label, x, z: -z, n: hits.length });
    }
    return out;
  }, [knownSystems, scoutedSystems]);

  const GALAXY = useMemo(() => {
    const k = Math.tan((12 * Math.PI) / 180);
    const r0 = 4000, rMax = 46000, phase = 7.214;
    // Four arms, unnamed on purpose: the real-astronomy arm names are not what the game shows you,
    // and the labels that ARE meaningful — the galactic regions — come from your own scouted data
    // below, where every name is one Spansh actually returned for a system you visited.
    const arms = [{ turn: 0 }, { turn: Math.PI / 2 }, { turn: Math.PI }, { turn: (3 * Math.PI) / 2 }];
    const maxT = Math.log(rMax / r0) / k;
    return arms.map((a) => {
      const pts: string[] = [];
      let label = { x: 0, z: 0 };
      for (let i = 0; i <= 90; i++) {
        const t = (i / 90) * maxT;
        const r = r0 * Math.exp(k * t);
        const ang = t - phase + a.turn;
        const x = GC.x + r * Math.cos(ang);
        const z = GC.z + r * Math.sin(ang);
        pts.push(`${x.toFixed(0)},${z.toFixed(0)}`);
        if (i === 66) label = { x, z };
      }
      return { points: pts.join(' '), label };
    });
  }, []);

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 1rem)' }}>
      {/* Map — full area */}
      <div className="flex-1 min-h-0 bg-card border border-border rounded-lg overflow-hidden relative touch-none">
        <svg
          ref={svgRef}
          viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
          className="w-full h-full cursor-grab active:cursor-grabbing"
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onWheel={onWheel}
          style={{ background: 'radial-gradient(ellipse at center, #0f172a 0%, #020617 100%)' }}
        >
          {/* Grid lines */}
          <defs>
            <pattern id="grid" width={50} height={50} patternUnits="userSpaceOnUse">
              <path d="M 50 0 L 0 0 0 50" fill="none" stroke="#1e293b" strokeWidth={0.3} />
            </pattern>
          </defs>
          <rect x={viewBox.x - viewBox.w} y={viewBox.y - viewBox.h} width={viewBox.w * 3} height={viewBox.h * 3} fill="url(#grid)" />

          {/* The galaxy, approximate — under everything, purely for orientation */}
          {showGalaxy && (
            <g pointerEvents="none">
              <defs>
                <radialGradient id="disc">
                  <stop offset="0%" stopColor="#c4b5fd" stopOpacity={0.16} />
                  <stop offset="55%" stopColor="#818cf8" stopOpacity={0.07} />
                  <stop offset="100%" stopColor="#1e1b4b" stopOpacity={0} />
                </radialGradient>
              </defs>
              <circle cx={GC.x} cy={GC.z} r={46000} fill="url(#disc)" />
              <circle cx={GC.x} cy={GC.z} r={46000} fill="none" stroke="#6366f1" strokeWidth={40} opacity={0.18} />
              {GALAXY.map((arm, i) => (
                <polyline key={`arm-${i}`} points={arm.points} fill="none" stroke="#a5b4fc" strokeWidth={900} opacity={0.1} strokeLinecap="round" />
              ))}
              {/* The bar through the core */}
              <ellipse cx={GC.x} cy={GC.z} rx={7000} ry={2600} transform={`rotate(28 ${GC.x} ${GC.z})`} fill="#fcd34d" opacity={0.13} />
              <circle cx={GC.x} cy={GC.z} r={1200} fill="#fde68a" opacity={0.22} />
              <text x={GC.x} y={GC.z - galaxyFont * 1.4} fill="#fcd34d" opacity={0.65} fontSize={galaxyFont} textAnchor="middle">Sagittarius A*</text>
            </g>
          )}

          {/* The 42 galactic regions — real borders, from the community region map, not placed by eye.
              Same z-flip as every other point on this map. Rim lines are the edge of the disc. */}
          {showRegions && (
            <g pointerEvents="none">
              {GALACTIC_REGION_LINES.map((line, i) => {
                const pts: string[] = [];
                for (let j = 1; j < line.length; j += 2) pts.push(`${line[j]},${-line[j + 1]}`);
                return (
                  <polyline key={`rgn-${i}`} points={pts.join(' ')} fill="none"
                    stroke={line[0] ? '#6366f1' : '#a5b4fc'} strokeOpacity={line[0] ? 0.35 : 0.55}
                    strokeWidth={Math.max(viewBox.w * 0.0012, 0.3)} strokeLinejoin="round" />
                );
              })}
              {GALACTIC_REGION_LABELS.map(([name, x, z]) => (
                <text key={`rgl-${name}`} x={x} y={-z} fill="#c7d2fe" opacity={0.8}
                  fontSize={galaxyFont * 0.8} textAnchor="middle" style={{ pointerEvents: 'none' }}>{name}</text>
              ))}
            </g>
          )}

          {/* Populated systems — under the landmarks and colonies, so they read as the ground the
              bubble sits on. Same x / −z projection as everything else. */}
          {showPopulated && populatedPaths && (
            <g pointerEvents="none">
              {populatedPaths.map((b, i) => <path key={`pop-${i}`} d={b.d} fill={b.fill} opacity={b.opacity} />)}
            </g>
          )}

          {/* Landmarks — Colonia, the nebulae, Founders World. Positions are the centroid of the
              systems you actually have coordinates for, so nothing here is placed by eye. */}
          {showLandmarks && LANDMARKS.map((L) => (
            <g key={`lm-${L.label}`} pointerEvents="none">
              <circle cx={L.x} cy={L.z} r={2.6 * pointScale} fill="none" stroke="#f0abfc" strokeWidth={0.35 * pointScale} opacity={0.55} strokeDasharray={`${1.2 * pointScale},${1.2 * pointScale}`} />
              <text x={L.x} y={L.z - 4 * pointScale} fill="#f0abfc" fontSize={2.2 * pointScale} textAnchor="middle" opacity={0.85}>{L.label}</text>
            </g>
          ))}

          {/* The journey — under everything else, so the colonies still read first */}
          {showJourney && journeyLegs.map((leg, i) => (
            <polyline key={`leg-${i}`} points={leg.join(' ')} fill="none" stroke="#a78bfa" strokeWidth={0.35 * pointScale} opacity={0.45} strokeLinejoin="round" />
          ))}
          {showJourney && journey?.pins.map((p, i) => (
            <g key={`pin-${p.at}-${i}`} onMouseEnter={() => setHoveredPin(p)} onMouseLeave={() => setHoveredPin(null)} style={{ cursor: 'help' }}>
              <circle cx={p.pos[0]} cy={projZ(p.pos[2])} r={(p.weight === 'huge' ? 3.5 : 2) * pointScale} fill={PIN_COLOR[p.weight] || '#94a3b8'} opacity={0.18} />
              <circle cx={p.pos[0]} cy={projZ(p.pos[2])} r={(p.weight === 'huge' ? 1.4 : 0.9) * pointScale} fill={PIN_COLOR[p.weight] || '#94a3b8'} />
            </g>
          ))}

          {/* Connection lines */}
          {showColonies && connections.map((c, i) => (
            <g key={`conn-${i}`}>
              <line
                x1={c.from.x} y1={c.from.z}
                x2={c.to.x} y2={c.to.z}
                stroke="#334155" strokeWidth={0.5 * pointScale}
                strokeDasharray={`${2 * pointScale},${2 * pointScale}`}
                opacity={0.5}
              />
              <text
                x={(c.from.x + c.to.x) / 2}
                y={(c.from.z + c.to.z) / 2 - 1.5 * pointScale}
                fill="#475569"
                fontSize={2.5 * pointScale}
                textAnchor="middle"
              >
                {c.dist.toFixed(1)} ly
              </text>
            </g>
          ))}

          {/* Points */}
          {/* The colonies. Turning them off leaves the journey and its pins to read on their own —
              a hundred labelled sites drown the events they sit under. Sol, Sag A* and where the
              commander is stay put, so the map keeps its landmarks either way. */}
          {points.filter((pt) => showColonies || pt.kind !== 'colony').map((pt) => {
            if (pt.kind === 'sol') {
              return (
                <g key="sol"
                  onMouseEnter={() => setHoveredPoint(pt)}
                  onMouseLeave={() => setHoveredPoint(null)}
                  onClick={(e) => { e.stopPropagation(); zoomToPoint(pt); }}
                  style={{ cursor: 'pointer' }}
                >
                  <circle cx={pt.x} cy={pt.z} r={3 * pointScale} fill="#fde047" opacity={0.15} />
                  <circle cx={pt.x} cy={pt.z} r={1.5 * pointScale} fill="#fde047" stroke="#eab308" strokeWidth={0.3 * pointScale} />
                  <text x={pt.x} y={pt.z + 4 * pointScale} fill="#fde047" fontSize={3 * pointScale} textAnchor="middle" fontWeight="bold">Sol</text>
                </g>
              );
            }
            if (pt.kind === 'home') {
              return (
                <g key="home"
                  onMouseEnter={() => setHoveredPoint(pt)}
                  onMouseLeave={() => setHoveredPoint(null)}
                  onClick={(e) => { e.stopPropagation(); zoomToPoint(pt); }}
                  style={{ cursor: 'pointer' }}
                >
                  <circle cx={pt.x} cy={pt.z} r={2.5 * pointScale} fill="#22d3ee" opacity={0.2} />
                  <circle cx={pt.x} cy={pt.z} r={1.5 * pointScale} fill="#22d3ee" stroke="#06b6d4" strokeWidth={0.3 * pointScale} />
                  <text x={pt.x} y={pt.z + 4 * pointScale} fill="#22d3ee" fontSize={2.5 * pointScale} textAnchor="middle">{pt.name}</text>
                </g>
              );
            }
            if (pt.kind === 'ship') {
              return (
                <g key="ship"
                  onMouseEnter={() => setHoveredPoint(pt)}
                  onMouseLeave={() => setHoveredPoint(null)}
                  onClick={(e) => { e.stopPropagation(); zoomToPoint(pt); }}
                  style={{ cursor: 'pointer' }}
                >
                  {/* Pulse ring */}
                  <circle cx={pt.x} cy={pt.z} r={4 * pointScale} fill="none" stroke="#22d3ee" strokeWidth={0.3 * pointScale} opacity={0.4}>
                    <animate attributeName="r" from={2 * pointScale} to={6 * pointScale} dur="2s" repeatCount="indefinite" />
                    <animate attributeName="opacity" from="0.6" to="0" dur="2s" repeatCount="indefinite" />
                  </circle>
                  {/* Ship triangle */}
                  <polygon
                    points={`${pt.x},${pt.z - 2.5 * pointScale} ${pt.x + 1.8 * pointScale},${pt.z + 1.8 * pointScale} ${pt.x - 1.8 * pointScale},${pt.z + 1.8 * pointScale}`}
                    fill="#22d3ee"
                    stroke="#06b6d4"
                    strokeWidth={0.3 * pointScale}
                  />
                  <text x={pt.x} y={pt.z + 5 * pointScale} fill="#22d3ee" fontSize={2.5 * pointScale} textAnchor="middle" fontWeight="bold">{pt.name}</text>
                </g>
              );
            }
            if (pt.kind === 'landmark') {
              return (
                <g key={`landmark-${pt.name}`}
                  onMouseEnter={() => setHoveredPoint(pt)}
                  onMouseLeave={() => setHoveredPoint(null)}
                  onClick={(e) => { e.stopPropagation(); zoomToPoint(pt); }}
                  style={{ cursor: 'pointer' }}
                >
                  <circle cx={pt.x} cy={pt.z} r={3 * pointScale} fill="#f97316" opacity={0.15} />
                  <circle cx={pt.x} cy={pt.z} r={1.5 * pointScale} fill="#f97316" stroke="#ea580c" strokeWidth={0.3 * pointScale} />
                  <text x={pt.x} y={pt.z + 4 * pointScale} fill="#f97316" fontSize={2.5 * pointScale} textAnchor="middle" fontWeight="bold">{pt.name}</text>
                </g>
              );
            }
            if (pt.kind === 'scouted') {
              return (
                <g key={`scouted-${pt.name}`}
                  onMouseEnter={() => setHoveredPoint(pt)}
                  onMouseLeave={() => setHoveredPoint(null)}
                >
                  <circle cx={pt.x} cy={pt.z} r={1 * pointScale} fill="#38bdf8" opacity={0.5} stroke="#38bdf8" strokeWidth={0.2 * pointScale} />
                  <text x={pt.x} y={pt.z + 3 * pointScale} fill="#38bdf8" fontSize={2 * pointScale} textAnchor="middle" opacity={0.7}>{pt.name}</text>
                </g>
              );
            }
            if (pt.kind === 'target') {
              // A watched target reads as a ring, not a dot — it is a place you have not taken yet.
              // Amber when something is closing on it, which is the whole reason it is watched.
              const c = pt.status === 'threatened' ? '#f59e0b' : '#a78bfa';
              return (
                <g key={`target-${pt.name}`}
                  onMouseEnter={() => setHoveredPoint(pt)}
                  onMouseLeave={() => setHoveredPoint(null)}
                >
                  <circle cx={pt.x} cy={pt.z} r={2.4 * pointScale} fill="none" stroke={c} strokeWidth={0.45 * pointScale} opacity={0.9} />
                  <circle cx={pt.x} cy={pt.z} r={0.6 * pointScale} fill={c} />
                  <text x={pt.x} y={pt.z - 3.4 * pointScale} fill={c} fontSize={2 * pointScale} textAnchor="middle" opacity={0.85}>
                    {pt.name}{pt.score != null ? ` · ${pt.score}` : ''}
                  </text>
                </g>
              );
            }
            // Colony
            const color = TIER_COLORS[pt.tier || 1];
            const r = (2 + (pt.tier || 1) * 0.5) * pointScale;
            return (
              <g key={`colony-${pt.name}`}
                onMouseEnter={() => setHoveredPoint(pt)}
                onMouseLeave={() => setHoveredPoint(null)}
                onClick={(e) => { e.stopPropagation(); zoomToPoint(pt); }}
                style={{ cursor: 'pointer' }}
              >
                {/* Glow */}
                <circle cx={pt.x} cy={pt.z} r={r * 2.5} fill={color} opacity={0.08} />
                <circle cx={pt.x} cy={pt.z} r={r * 1.5} fill={color} opacity={0.15} />
                {/* Dot */}
                <circle cx={pt.x} cy={pt.z} r={r} fill={color} stroke={color} strokeWidth={0.3 * pointScale} />
                {/* Label */}
                <text x={pt.x} y={pt.z + (r + 3 * pointScale)} fill={color} fontSize={2.8 * pointScale} textAnchor="middle" fontWeight="600">
                  {pt.name}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Top-left controls */}
        <div className="absolute top-2 left-2 flex gap-1.5">
          <button
            onClick={zoomToFit}
            className="px-2 py-1 rounded bg-background/80 border border-border text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Fit All
          </button>
          <button
            onClick={() => setShowList(!showList)}
            className="px-2 py-1 rounded bg-background/80 border border-border text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {showList ? 'Hide' : 'Systems'}
          </button>
          <label className="flex items-center gap-1 px-2 py-1 rounded bg-background/80 border border-border text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={showFavorites}
              onChange={(e) => setShowFavorites(e.target.checked)}
              className="rounded border-border w-3 h-3"
            />
            Fav
          </label>
          {(() => {
            const colonyPts = points.filter((p) => p.kind === 'colony');
            const totalProjects = new Set([...projects.map(p => p.systemName?.toLowerCase()).filter(Boolean), ...manualColonized.map(s => s.toLowerCase())]).size;
            return colonyPts.length < totalProjects ? (
              <span className="px-2 py-1 rounded bg-yellow-500/20 border border-yellow-500/30 text-xs text-yellow-400">
                {colonyPts.length}/{totalProjects} mapped
              </span>
            ) : null;
          })()}
          <label className="flex items-center gap-1 px-2 py-1 rounded bg-background/80 border border-border text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={showSagA}
              onChange={(e) => setShowSagA(e.target.checked)}
              className="rounded border-border w-3 h-3"
            />
            Sag A*
          </label>
          <label
            className="flex items-center gap-1 px-2 py-1 rounded bg-background/80 border border-border text-xs text-muted-foreground cursor-pointer"
            title="Turn the colony sites off to read the journey and its pins on their own"
          >
            <input
              type="checkbox"
              checked={showColonies}
              onChange={(e) => setShowColonies(e.target.checked)}
              className="rounded border-border w-3 h-3"
            />
            Colonies
          </label>
          <label
            className="flex items-center gap-1 px-2 py-1 rounded bg-background/80 border border-border text-xs text-muted-foreground cursor-pointer"
            title="Systems you are watching for a claim — amber when something is closing on one"
          >
            <input
              type="checkbox"
              checked={showTargets}
              onChange={(e) => setShowTargets(e.target.checked)}
              className="rounded border-border w-3 h-3"
            />
            Targets
            {showTargets && <span className="text-violet-300/80">{Object.keys(watchedSystems || {}).length}</span>}
          </label>
          <label
            className="flex items-center gap-1 px-2 py-1 rounded bg-background/80 border border-border text-xs text-muted-foreground cursor-pointer"
            title="An approximate galaxy for orientation — disc, bar and four arms. Layout after edastro.com/galmap; the geometry is redrawn, not surveyed."
          >
            <input
              type="checkbox"
              checked={showGalaxy}
              onChange={(e) => setShowGalaxy(e.target.checked)}
              className="rounded border-border w-3 h-3"
            />
            Galaxy
          </label>
          <label
            className="flex items-center gap-1 px-2 py-1 rounded bg-background/80 border border-border text-xs text-muted-foreground cursor-pointer"
            title={`The 42 galactic regions with their real borders. ${GALACTIC_REGION_SOURCE}`}
          >
            <input
              type="checkbox"
              checked={showRegions}
              onChange={(e) => setShowRegions(e.target.checked)}
              className="rounded border-border w-3 h-3"
            />
            Regions
          </label>
          <label
            className="flex items-center gap-1 px-2 py-1 rounded bg-background/80 border border-border text-xs text-muted-foreground cursor-pointer"
            title="Colonia, the nebulae and Founders World, placed from the coordinates in your own data"
          >
            <input
              type="checkbox"
              checked={showLandmarks}
              onChange={(e) => setShowLandmarks(e.target.checked)}
              className="rounded border-border w-3 h-3"
            />
            Landmarks
            {showLandmarks && <span className="text-fuchsia-300/80">{LANDMARKS.length}</span>}
          </label>
          <label
            className="flex items-center gap-1 px-2 py-1 rounded bg-background/80 border border-border text-xs text-muted-foreground cursor-pointer"
            title={populated ? `Populated systems within ${(populated.bubbles && populated.bubbles.length ? populated.bubbles : [{ name: populated.centre.name, radiusLy: populated.radiusLy }]).map((b) => `${b.radiusLy} ly of ${b.name}`).join(' and ')}: ${populated.count.toLocaleString()} on file (${populated.live} added or refreshed live from the journal stream)${populated.source ? `, seeded from ${populated.source}` : ''}${populated.generatedAt ? ` on ${populated.generatedAt.slice(0, 10)}` : ''}. Brighter = bigger population.` : 'Populated systems — seeded from your Spansh dump, kept current from the journal stream'}
          >
            <input
              type="checkbox"
              checked={showPopulated}
              onChange={(e) => setShowPopulated(e.target.checked)}
              className="rounded border-border w-3 h-3"
            />
            Populated
            {showPopulated && populated && <span className="text-amber-300/80">{populated.count.toLocaleString()}</span>}
            {showPopulated && populatedLoading && <span className="text-muted-foreground/60">…</span>}
            {showPopulated && !populatedLoading && populated && populated.count === 0 && <span className="text-muted-foreground/60">not seeded</span>}
          </label>
          <label
            className="flex items-center gap-1 px-2 py-1 rounded bg-background/80 border border-border text-xs text-muted-foreground cursor-pointer"
            title="Every jump you have made, from the journals, with a pin on the big moments"
          >
            <input
              type="checkbox"
              checked={showJourney}
              onChange={(e) => setShowJourney(e.target.checked)}
              className="rounded border-border w-3 h-3"
            />
            {journeyLoading ? 'Journey…' : 'Journey'}
            {journey && showJourney && (
              <span className="text-violet-300/80">{journey.path.length.toLocaleString()} · {journey.pins.length} pins</span>
            )}
          </label>
        </div>

        {/* What a pin is — the log's own line, shown on hover */}
        {hoveredPin && (
          <div className="absolute bottom-2 left-2 z-10 max-w-md rounded-lg border border-violet-500/40 bg-background/95 px-3 py-2 text-xs">
            <div className="text-[10px] uppercase tracking-wider text-violet-300/80">
              {new Date(hoveredPin.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} {new Date(hoveredPin.at).getFullYear() + 1286} · {hoveredPin.weight}
            </div>
            <div className="mt-0.5 text-foreground">{hoveredPin.line}</div>
          </div>
        )}

        {/* System list overlay */}
        {showList && (
          <div className="absolute top-10 left-2 bg-background/90 border border-border rounded-lg p-2 max-h-80 overflow-y-auto w-48 z-10">
            <div className="space-y-0.5">
              {points.filter((p) => p.kind === 'colony').sort((a, b) => (b.tier || 0) - (a.tier || 0)).map((pt) => (
                <button
                  key={pt.name}
                  onClick={() => { zoomToPoint(pt); setShowList(false); }}
                  className="w-full text-left px-2 py-1 rounded text-xs hover:bg-muted/50 transition-colors flex items-center gap-1.5"
                  style={{ color: TIER_COLORS[pt.tier || 1] }}
                >
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: TIER_COLORS[pt.tier || 1] }} />
                  <span className="truncate">{pt.name}</span>
                </button>
              ))}
              {commanderPosition && (
                <button
                  onClick={() => { zoomToPoint(points.find((p) => p.kind === 'ship')!); setShowList(false); }}
                  className="w-full text-left px-2 py-1 rounded text-xs hover:bg-muted/50 transition-colors flex items-center gap-1.5 text-cyan-400"
                >
                  <span className="w-0 h-0 shrink-0" style={{ borderLeft: '4px solid transparent', borderRight: '4px solid transparent', borderBottom: '6px solid #22d3ee' }} />
                  <span className="truncate">{commanderPosition.systemName}</span>
                </button>
              )}
              <button
                onClick={() => { zoomToPoint(points.find((p) => p.kind === 'sol')!); setShowList(false); }}
                className="w-full text-left px-2 py-1 rounded text-xs hover:bg-muted/50 transition-colors flex items-center gap-1.5 text-yellow-400"
              >
                <span className="w-2 h-2 rounded-full shrink-0 bg-yellow-400" />
                Sol
              </button>
              {showSagA && (
                <button
                  onClick={() => { const p = points.find((p) => p.kind === 'landmark'); if (p) { zoomToPoint(p); setShowList(false); } }}
                  className="w-full text-left px-2 py-1 rounded text-xs hover:bg-muted/50 transition-colors flex items-center gap-1.5 text-orange-400"
                >
                  <span className="w-2 h-2 rounded-full shrink-0 bg-orange-400" />
                  Sagittarius A*
                </button>
              )}
            </div>
          </div>
        )}

        {/* Hover tooltip */}
        {hoveredPoint && (
          <div className="absolute top-2 right-2 bg-background/90 border border-border rounded-lg px-3 py-2 text-sm pointer-events-none">
            <div className="font-semibold text-foreground">{hoveredPoint.name}</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              X: {hoveredPoint.x.toFixed(1)} | Y: {hoveredPoint.y.toFixed(1)} | Z: {hoveredPoint.rawZ.toFixed(1)}
            </div>
            {hoveredPoint.kind === 'colony' && (
              <>
                <div className="text-xs mt-0.5" style={{ color: TIER_COLORS[hoveredPoint.tier || 1] }}>
                  {hoveredPoint.tierIcon} {hoveredPoint.tierLabel} (Tier {hoveredPoint.tier})
                </div>
                <div className="text-xs text-muted-foreground">
                  {hoveredPoint.installations} installation{hoveredPoint.installations !== 1 ? 's' : ''}
                </div>
              </>
            )}
            {hoveredPoint.kind === 'ship' && (
              <div className="text-xs text-cyan-400 mt-0.5">Commander position</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
