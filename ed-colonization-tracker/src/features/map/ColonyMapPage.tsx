import { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import { useAppStore } from '@/store';
import { getSystemTier } from '@/features/dashboard/tierUtils';

interface MapPoint {
  name: string;
  x: number; // galactic X
  z: number; // negated galactic Z for SVG (positive = up = toward galactic center)
  y: number; // galactic Y (for tooltip)
  rawZ: number; // original galactic Z for display
  kind: 'colony' | 'ship' | 'sol' | 'home' | 'scouted' | 'landmark';
  tier?: number;
  tierLabel?: string;
  tierIcon?: string;
  installations?: number;
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
  const systemAddressMap = useAppStore((s) => s.systemAddressMap);
  const manualColonized = useAppStore((s) => s.manualColonizedSystems);

  // Toggles
  const [showFavorites, setShowFavorites] = useState(false);
  const [showSagA, setShowSagA] = useState(false);
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
  }, [projects, knownSystems, knownStations, commanderPosition, settings.homeSystem, scoutedSystems, manualColonized, showFavorites, showSagA]);

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

          {/* Connection lines */}
          {connections.map((c, i) => (
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
          {points.map((pt) => {
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
        </div>

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
