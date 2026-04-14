import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAppStore } from '@/store';
import { classifyStar, classifyAtmo, classifyPlanet, atmoStyle, formatAtmoRaw } from '@/features/domain/domainHelpers';
import { startJournalWatcher, isWatcherRunning } from '@/services/journalWatcher';
import { selectJournalFolder, getJournalFolderHandle, extractExplorationData } from '@/services/journalReader';
import type { JournalScannedBody } from '@/services/journalReader';
import { fetchSystemDump, resolveSystemName } from '@/services/spanshApi';

// ─── Constants ─────────────────────────────────────────────────────

const STAR_COLORS: Record<string, { fill: string; glow: string; glowSize: number }> = {
  'Black Hole':   { fill: '#1a1a2e', glow: 'rgba(168,85,247,0.8)', glowSize: 40 },
  'Neutron Star': { fill: '#e0b0ff', glow: 'rgba(192,132,252,0.9)', glowSize: 35 },
  'Wolf-Rayet':   { fill: '#60a5fa', glow: 'rgba(96,165,250,0.7)', glowSize: 30 },
  'White Dwarf':  { fill: '#f0f0ff', glow: 'rgba(224,224,255,0.6)', glowSize: 25 },
  'O-class':      { fill: '#93c5fd', glow: 'rgba(147,197,253,0.5)', glowSize: 22 },
  'B-class':      { fill: '#bfdbfe', glow: 'rgba(191,219,254,0.4)', glowSize: 20 },
  'A-class':      { fill: '#e0f2fe', glow: 'rgba(224,242,254,0.4)', glowSize: 18 },
  'F-class':      { fill: '#fef9c3', glow: 'rgba(254,249,195,0.4)', glowSize: 16 },
  'G-class':      { fill: '#fef08a', glow: 'rgba(254,240,138,0.5)', glowSize: 16 },
  'K-class':      { fill: '#fdba74', glow: 'rgba(253,186,116,0.5)', glowSize: 14 },
  'M-class':      { fill: '#f87171', glow: 'rgba(248,113,113,0.5)', glowSize: 14 },
  'Carbon Star':  { fill: '#dc2626', glow: 'rgba(220,38,38,0.6)', glowSize: 18 },
  'Brown Dwarf':  { fill: '#92400e', glow: 'rgba(146,64,14,0.3)', glowSize: 10 },
};

const ATMO_GLOW_COLORS: Record<string, string> = {
  'Oxygen': 'rgba(167,139,250,0.6)',
  'Nitrogen': 'rgba(96,165,250,0.5)',
  'Ammonia': 'rgba(74,222,128,0.5)',
  'Carbon Dioxide': 'rgba(250,204,21,0.4)',
  'Sulphur Dioxide': 'rgba(251,146,60,0.4)',
  'Neon': 'rgba(248,113,113,0.4)',
  'Argon': 'rgba(165,180,252,0.3)',
  'Methane': 'rgba(148,163,184,0.3)',
  'Helium': 'rgba(148,163,184,0.3)',
};

const ATMO_RARITY: Record<string, number> = {
  'Oxygen': 10, 'Ammonia': 8, 'Nitrogen': 6, 'Neon': 4,
  'Sulphur Dioxide': 3, 'Carbon Dioxide': 2, 'Argon': 1, 'Methane': 1, 'Helium': 1,
};

// ─── Types ─────────────────────────────────────────────────────────

interface OrreryBody {
  body: JournalScannedBody;
  cls: ReturnType<typeof classifyPlanet>;
  starCls?: string;
  atmoType?: string;
  importance: number; // higher = bigger/brighter
  orbitRadius: number; // normalized 0-1 position from star
}

// ─── Orrery Canvas (pan/zoom, horizontal layout) ───────────────────

function OrreryCanvas({ systemData, flash, relativeSizes }: { systemData: NonNullable<ReturnType<typeof useOrreryData>>; flash: boolean; relativeSizes: boolean }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [vb, setVb] = useState({ x: 0, y: 0, w: 1200, h: 600 });
  const [isPanning, setIsPanning] = useState(false);
  const panRef = useRef({ x: 0, y: 0, vx: 0, vy: 0 });

  // Build positioned nodes — even horizontal spacing, distance labels, moons tucked near parents
  const nodeData = useMemo(() => {
    type Node = { body: OrreryBody; x: number; y: number; size: number; fill: string; parentX?: number; parentY?: number; distLabel?: string };
    type Bracket = { starYs: number[]; starX: number; planetX: number; midY: number; label: string };
    const result: Node[] = [];
    const brackets: Bracket[] = [];

    // ─── Tree layout from BODY NAMES ───
    // The name encodes the full hierarchy:
    //   "A" = star, "A 3" = planet of A, "A 3 A" = moon of A 3
    //   "ABCD 1" = planet of ABCD barycenter, "BC 2" = planet of BC barycenter

    const allBodies = [...systemData.stars, ...systemData.planets];
    const sysName = systemData.name;

    // Parse name suffix into path tokens
    const getPath = (ob: OrreryBody): string[] => {
      const name = ob.body.bodyName;
      // If the body name IS the system name, it's the main star — empty path
      if (name === sysName || name.toLowerCase() === sysName.toLowerCase()) return [];
      // Strip system name prefix
      const suffix = name.startsWith(sysName + ' ') ? name.slice(sysName.length + 1).trim() : name.trim();
      if (!suffix || suffix === sysName) return [];
      return suffix.split(' ');
    };

    // Build tree from names: group by parent path
    const childrenOf = new Map<string, OrreryBody[]>(); // parentPath → children
    for (const ob of allBodies) {
      const path = getPath(ob);
      // Empty path = main star (body name IS system name) — add to __root__
      const parentPath = path.length === 0 ? '__root__' : (path.slice(0, -1).join(' ') || '__root__');
      if (!childrenOf.has(parentPath)) childrenOf.set(parentPath, []);
      childrenOf.get(parentPath)!.push(ob);
    }

    // Sort children by name
    for (const [, children] of childrenOf) {
      children.sort((a, b) => a.body.bodyName.localeCompare(b.body.bodyName, undefined, { numeric: true }));
    }

    const totalBodies = allBodies.length;
    const H_STEP = Math.max(80, 250 - totalBodies * 4);
    const V_GAP = Math.max(12, 50 - totalBodies);

    // Helpers
    const sizeOf = (ob: OrreryBody) => ob.body.type === 'Star' ? getStarSize(ob, relativeSizes) : getBodySize(ob, relativeSizes);
    const fillOf = (ob: OrreryBody) => ob.body.type === 'Star' ? (STAR_COLORS[ob.starCls || ''] || STAR_COLORS['G-class']).fill : getBodyColor(ob);
    const distOf = (ob: OrreryBody) => { const d = ob.body.distanceToArrival || 0; return d < 1 ? '' : d < 1000 ? `${d.toFixed(0)} ls` : `${(d / 1000).toFixed(1)}K ls`; };
    const isLetterSuffix = (s: string) => /^[A-Z]+$/i.test(s);

    // Layout: stars (letters) stack vertically left, planets (numbers) go horizontal right
    // Moons drop below their parent planet
    const STAR_X = 30;
    const placedIds = new Set<number>();
    let yPos = 30;

    // Recursive group layout by path
    const layoutPath = (parentPath: string, depth: number, groupY: number): number => {
      const children = childrenOf.get(parentPath) || [];
      if (children.length === 0) return groupY;

      // Split into stars (letter suffix) and planets (number suffix)
      const starBodies: OrreryBody[] = [];
      let planetBodies: OrreryBody[] = [];
      for (const c of children) {
        const path = getPath(c);
        const lastToken = path[path.length - 1] || '';
        if ((isLetterSuffix(lastToken) || lastToken === '') && depth === 0 && (c.body.type === 'Star' || path.length === 0)) {
          starBodies.push(c);
        } else {
          planetBodies.push(c);
        }
      }
      // Single star: numbered planets belong to the star, not shared barycenter
      if (starBodies.length === 1) {
        planetBodies = [];
      }

      let bottom = groupY;
      const starPositions: { y: number }[] = [];
      let maxStarPlanetX = STAR_X + H_STEP; // track rightmost X of any star's planets

      // Stars: vertical column at depth-based X
      // Single star with children: place at top of its planet row
      const starX = STAR_X + depth * 30;
      for (let si = 0; si < starBodies.length; si++) {
        const star = starBodies[si];
        if (placedIds.has(star.body.bodyId)) continue;
        const size = sizeOf(star);
        const cy = si === 0 ? groupY + size + 5 : bottom + size + V_GAP;
        result.push({ body: star, x: starX, y: cy, size, fill: fillOf(star), distLabel: distOf(star) });
        placedIds.add(star.body.bodyId);
        starPositions.push({ y: cy });

        // This star's own children (its path = current star's suffix)
        const starPath = getPath(star).join(' ');
        // Main star (empty path) — its planets are the numbered root children
        const starChildren = starPath
          ? (childrenOf.get(starPath) || [])
          : (childrenOf.get('__root__') || []).filter(c => !starBodies.includes(c));
        if (starChildren.length > 0) {
          // Planets go horizontal
          let xPos = starX + H_STEP;
          for (const p of starChildren) {
            if (placedIds.has(p.body.bodyId)) continue;
            const pSize = sizeOf(p);
            result.push({ body: p, x: xPos, y: cy, size: pSize, fill: fillOf(p), parentX: starX, parentY: cy, distLabel: distOf(p) });
            placedIds.add(p.body.bodyId);
            // Moons vertical below parent
            let moonY = cy + pSize + V_GAP + 3;
            let maxMoonX = xPos;
            const pPath = getPath(p).join(' ');
            const layoutMoons = (path: string, mx: number) => {
              for (const m of (childrenOf.get(path) || [])) {
                if (placedIds.has(m.body.bodyId)) continue;
                const ms = sizeOf(m);
                result.push({ body: m, x: mx, y: moonY + ms, size: ms, fill: fillOf(m), parentX: xPos, parentY: cy, distLabel: distOf(m) });
                placedIds.add(m.body.bodyId);
                maxMoonX = Math.max(maxMoonX, mx + ms + 10);
                moonY += ms * 2 + V_GAP + 20;
                layoutMoons(getPath(m).join(' '), mx + 15);
              }
            };
            layoutMoons(pPath, xPos);
            bottom = Math.max(bottom, moonY);
            xPos = Math.max(xPos + Math.max(pSize * 3, H_STEP * 0.7), maxMoonX + V_GAP);
          }
          maxStarPlanetX = Math.max(maxStarPlanetX, xPos);
        }

        bottom = Math.max(bottom, cy + size + V_GAP + 5);
      }

      // Multi-star group planets (e.g., "BC" group for B+C barycenter, "ABCD" for all stars)
      // Find parent paths that are letter combos matching star names
      const starNameMap = new Map<string, { y: number }>();
      for (let si = 0; si < starBodies.length; si++) {
        const sp = getPath(starBodies[si]);
        if (sp.length > 0) starNameMap.set(sp[sp.length - 1], starPositions[si]);
      }
      const groupPaths = [...childrenOf.keys()].filter(gp => {
        if (gp === parentPath || gp === '__root__') return false;
        // Check if this path is a letter combo of known stars (e.g., "BC", "ABCD")
        return /^[A-Z]+$/i.test(gp) && gp.length > 1 && [...gp].every(ch => starNameMap.has(ch));
      });

      for (const gp of groupPaths) {
        const groupBodies = childrenOf.get(gp) || [];
        if (groupBodies.length === 0) continue;
        // Find bracket Y from constituent stars
        const starYs = [...gp].map(ch => starNameMap.get(ch)?.y).filter((y): y is number => y != null);
        const bracketMidY = starYs.length > 0 ? (Math.min(...starYs) + Math.max(...starYs)) / 2 : bottom + 15;
        // Bracket starts after the rightmost star-specific planet
        const bracketX = maxStarPlanetX + 10;
        let xPos = bracketX + H_STEP * 0.5;
        // Store bracket visual data
        brackets.push({ starYs, starX: bracketX, planetX: bracketX + H_STEP * 0.4, midY: bracketMidY, label: gp });

        for (const p of groupBodies) {
          if (placedIds.has(p.body.bodyId)) continue;
          const pSize = sizeOf(p);
          result.push({ body: p, x: xPos, y: bracketMidY, size: pSize, fill: fillOf(p), parentX: bracketX, parentY: bracketMidY, distLabel: distOf(p) });
          placedIds.add(p.body.bodyId);
          // Moons vertical below parent
          let moonY2 = bracketMidY + pSize + V_GAP + 3;
          const pPath2 = getPath(p).join(' ');
          const layoutMoons2 = (path: string, mx: number) => {
            for (const m of (childrenOf.get(path) || [])) {
              if (placedIds.has(m.body.bodyId)) continue;
              const ms = sizeOf(m);
              result.push({ body: m, x: mx, y: moonY2 + ms, size: ms, fill: fillOf(m), parentX: xPos, parentY: bracketMidY, distLabel: distOf(m) });
              placedIds.add(m.body.bodyId);
              moonY2 += ms * 2 + V_GAP + 20;
              layoutMoons2(getPath(m).join(' '), mx + 15);
            }
          };
          layoutMoons2(pPath2, xPos);
          bottom = Math.max(bottom, moonY2);
          xPos += Math.max(pSize * 3, H_STEP * 0.7);
        }
        bottom = Math.max(bottom, bracketMidY + 20);
      }

      // Shared planets: orbit the group barycenter
      // If only 1 star, put planets on the star's row (they're effectively the star's planets)
      if (planetBodies.length > 0) {
        const bracketY = starPositions.length === 1
          ? starPositions[0].y  // single star: same row
          : starPositions.length > 1
            ? (starPositions[0].y + starPositions[starPositions.length - 1].y) / 2
            : groupY + 15;
        const planetX = maxStarPlanetX + 10;
        let xPos = planetX + H_STEP * 0.5;

        for (const p of planetBodies) {
          if (placedIds.has(p.body.bodyId)) continue;
          const pSize = sizeOf(p);
          result.push({ body: p, x: xPos, y: bracketY, size: pSize, fill: fillOf(p), parentX: planetX, parentY: bracketY, distLabel: distOf(p) });
          placedIds.add(p.body.bodyId);

          // Moons vertical below parent
          let moonY3 = bracketY + pSize + V_GAP + 3;
          const pPath3 = getPath(p).join(' ');
          const layoutMoons3 = (path: string, mx: number) => {
            for (const m of (childrenOf.get(path) || [])) {
              if (placedIds.has(m.body.bodyId)) continue;
              const ms = sizeOf(m);
              result.push({ body: m, x: mx, y: moonY3 + ms, size: ms, fill: fillOf(m), parentX: xPos, parentY: bracketY, distLabel: distOf(m) });
              placedIds.add(m.body.bodyId);
              moonY3 += ms * 2 + V_GAP + 20;
              layoutMoons3(getPath(m).join(' '), mx + 15);
            }
          };
          layoutMoons3(pPath3, xPos);
          bottom = Math.max(bottom, moonY3);
          xPos += Math.max(pSize * 3, H_STEP * 0.7);
        }
        bottom = Math.max(bottom, bracketY + 20);
      }

      return bottom;
    };

    yPos = layoutPath('__root__', 0, yPos);

    // Place any unplaced bodies
    for (const ob of allBodies) {
      if (placedIds.has(ob.body.bodyId)) continue;
      const size = sizeOf(ob);
      result.push({ body: ob, x: STAR_X + H_STEP, y: yPos + size, size, fill: fillOf(ob), distLabel: distOf(ob) });
      placedIds.add(ob.body.bodyId);
      yPos += size * 2 + V_GAP;
    }

    return { nodes: result, brackets };
  }, [systemData, relativeSizes]);
  useEffect(() => {
    const nodes = nodeData.nodes;
    if (nodes.length === 0) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of nodes) {
      const r = n.size + 15;
      if (n.x - r < minX) minX = n.x - r;
      if (n.x + r > maxX) maxX = n.x + r;
      if (n.y - r < minY) minY = n.y - r;
      if (n.y + r > maxY) maxY = n.y + r;
    }
    const pad = 20;
    const rect = svgRef.current?.getBoundingClientRect();
    const containerH = rect?.height || 600;
    // Fixed vertical scale — fit height to container, let width scroll
    const h = maxY - minY + pad * 2;
    const scale = containerH / h;
    const w = rect ? rect.width / scale : (maxX - minX + pad * 2);
    setVb({ x: minX - pad, y: minY - pad, w: Math.max(w, maxX - minX + pad * 2), h });
  }, [nodeData]);

  // Pan handlers
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    setIsPanning(true);
    panRef.current = { x: e.clientX, y: e.clientY, vx: vb.x, vy: vb.y };
  }, [vb]);
  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const sx = vb.w / rect.width;
    const sy = vb.h / rect.height;
    setVb(v => ({ ...v, x: panRef.current.vx - (e.clientX - panRef.current.x) * sx, y: panRef.current.vy - (e.clientY - panRef.current.y) * sy }));
  }, [isPanning, vb.w, vb.h]);
  const onMouseUp = useCallback(() => setIsPanning(false), []);
  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const f = e.deltaY > 0 ? 1.12 : 0.89;
    setVb(v => {
      const cx = v.x + v.w / 2, cy = v.y + v.h / 2;
      const nw = v.w * f, nh = v.h * f;
      return { x: cx - nw / 2, y: cy - nh / 2, w: nw, h: nh };
    });
  }, []);

  // Touch handlers
  const pinchRef = useRef<{ dist: number; vb: typeof vb } | null>(null);
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      setIsPanning(true);
      panRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, vx: vb.x, vy: vb.y };
    } else if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchRef.current = { dist: Math.sqrt(dx * dx + dy * dy), vb: { ...vb } };
    }
  }, [vb]);
  const onTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    if (e.touches.length === 1 && isPanning && svgRef.current) {
      const rect = svgRef.current.getBoundingClientRect();
      const sx = vb.w / rect.width;
      const sy = vb.h / rect.height;
      setVb(v => ({ ...v, x: panRef.current.vx - (e.touches[0].clientX - panRef.current.x) * sx, y: panRef.current.vy - (e.touches[0].clientY - panRef.current.y) * sy }));
    } else if (e.touches.length === 2 && pinchRef.current) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const newDist = Math.sqrt(dx * dx + dy * dy);
      const scale = pinchRef.current.dist / newDist;
      const old = pinchRef.current.vb;
      const cx = old.x + old.w / 2, cy = old.y + old.h / 2;
      setVb({ x: cx - old.w * scale / 2, y: cy - old.h * scale / 2, w: old.w * scale, h: old.h * scale });
    }
  }, [isPanning, vb.w, vb.h]);
  const onTouchEnd = useCallback(() => { setIsPanning(false); pinchRef.current = null; }, []);

  const scale = vb.w / 1000;

  return (
    <div className="flex-1 w-full h-full absolute inset-0" style={{ background: 'radial-gradient(ellipse at 10% 50%, #0f172a 0%, #020617 50%, #000 100%)' }}>
      <svg ref={svgRef} className="w-full h-full cursor-grab active:cursor-grabbing"
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
        onWheel={onWheel} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
      >
        <defs>
          <filter id="glow-big" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="8" />
          </filter>
          <filter id="glow-med" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="4" />
          </filter>
          <filter id="glow-sm" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="2" />
          </filter>
          {/* Body texture gradients */}
          <radialGradient id="tex-rocky" cx="35%" cy="35%">
            <stop offset="0%" stopColor="#a8a29e" />
            <stop offset="50%" stopColor="#78716c" />
            <stop offset="100%" stopColor="#44403c" />
          </radialGradient>
          <radialGradient id="tex-icy" cx="30%" cy="30%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="30%" stopColor="#bae6fd" />
            <stop offset="70%" stopColor="#38bdf8" />
            <stop offset="100%" stopColor="#0284c7" />
          </radialGradient>
          <radialGradient id="tex-hmc" cx="35%" cy="35%">
            <stop offset="0%" stopColor="#fcd34d" />
            <stop offset="40%" stopColor="#b45309" />
            <stop offset="100%" stopColor="#78350f" />
          </radialGradient>
          <radialGradient id="tex-gas" cx="40%" cy="30%">
            <stop offset="0%" stopColor="#fbbf24" />
            <stop offset="40%" stopColor="#d97706" />
            <stop offset="100%" stopColor="#78350f" />
          </radialGradient>
          <linearGradient id="tex-gas-bands" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(255,255,255,0.15)" />
            <stop offset="20%" stopColor="rgba(0,0,0,0)" />
            <stop offset="35%" stopColor="rgba(255,255,255,0.1)" />
            <stop offset="50%" stopColor="rgba(0,0,0,0.1)" />
            <stop offset="65%" stopColor="rgba(255,255,255,0.08)" />
            <stop offset="80%" stopColor="rgba(0,0,0,0)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0.12)" />
          </linearGradient>
          <radialGradient id="tex-earthlike" cx="35%" cy="35%">
            <stop offset="0%" stopColor="#67e8f9" />
            <stop offset="30%" stopColor="#22d3ee" />
            <stop offset="60%" stopColor="#15803d" />
            <stop offset="100%" stopColor="#0c4a6e" />
          </radialGradient>
          <radialGradient id="tex-water" cx="35%" cy="35%">
            <stop offset="0%" stopColor="#38bdf8" />
            <stop offset="50%" stopColor="#0284c7" />
            <stop offset="100%" stopColor="#0c4a6e" />
          </radialGradient>
          <radialGradient id="tex-ammonia" cx="35%" cy="35%">
            <stop offset="0%" stopColor="#86efac" />
            <stop offset="50%" stopColor="#22c55e" />
            <stop offset="100%" stopColor="#14532d" />
          </radialGradient>
          {/* Grid pattern */}
          <pattern id="orrery-grid" width="50" height="50" patternUnits="userSpaceOnUse">
            <path d="M 50 0 L 0 0 0 50" fill="none" stroke="rgba(30,41,59,0.4)" strokeWidth="0.5" />
          </pattern>
          {/* Body texture patterns */}
          <pattern id="pat-rocky" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(25)">
            <rect width="4" height="4" fill="#78716c" />
            <rect width="2" height="1" fill="#57534e" x="1" y="1" />
            <rect width="1" height="2" fill="#a8a29e" x="0" y="2" />
          </pattern>
          <pattern id="pat-hmc" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
            <rect width="3" height="3" fill="#92400e" />
            <rect width="3" height="1" fill="#b45309" y="1" />
            <circle cx="1.5" cy="1.5" r="0.5" fill="#fbbf24" opacity="0.4" />
          </pattern>
          <pattern id="pat-icy" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(15)">
            <rect width="4" height="4" fill="#a5f3fc" />
            <circle cx="1" cy="1" r="0.7" fill="#fff" opacity="0.7" />
            <circle cx="3" cy="3" r="0.5" fill="#e0f2fe" opacity="0.5" />
          </pattern>
          <pattern id="pat-gas" width="6" height="3" patternUnits="userSpaceOnUse">
            <rect width="6" height="3" fill="#d97706" />
            <rect width="6" height="1" fill="#92400e" y="1" />
            <rect width="6" height="0.5" fill="#fbbf24" y="0" opacity="0.3" />
          </pattern>
          {/* Ring gradients */}
          <linearGradient id="ring-icy" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgba(186,230,253,0)" />
            <stop offset="20%" stopColor="rgba(186,230,253,0.4)" />
            <stop offset="50%" stopColor="rgba(224,242,254,0.5)" />
            <stop offset="80%" stopColor="rgba(186,230,253,0.4)" />
            <stop offset="100%" stopColor="rgba(186,230,253,0)" />
          </linearGradient>
          <linearGradient id="ring-rocky" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgba(168,162,158,0)" />
            <stop offset="20%" stopColor="rgba(168,162,158,0.3)" />
            <stop offset="50%" stopColor="rgba(214,211,209,0.4)" />
            <stop offset="80%" stopColor="rgba(168,162,158,0.3)" />
            <stop offset="100%" stopColor="rgba(168,162,158,0)" />
          </linearGradient>
          <linearGradient id="ring-metallic" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgba(253,186,116,0)" />
            <stop offset="20%" stopColor="rgba(253,186,116,0.3)" />
            <stop offset="50%" stopColor="rgba(254,215,170,0.5)" />
            <stop offset="80%" stopColor="rgba(253,186,116,0.3)" />
            <stop offset="100%" stopColor="rgba(253,186,116,0)" />
          </linearGradient>
        </defs>

        {/* Grid background */}
        <rect x={vb.x - vb.w} y={vb.y - vb.h} width={vb.w * 3} height={vb.h * 3} fill="url(#orrery-grid)" />

        {/* No main axis line — tree layout uses parent-child connections */}

        {/* Parent-child connection lines — vertical drops for moons, horizontal for planets to star */}
        {/* Bracket visuals for multi-star groups */}
        {nodeData.brackets.map((b, i) => {
          const topY = Math.min(...b.starYs);
          const botY = Math.max(...b.starYs);
          return (
            <g key={`bracket-${i}`}>
              {/* Vertical line along stars */}
              <line x1={b.starX + 45} y1={topY} x2={b.starX + 45} y2={botY}
                stroke="rgba(148,163,184,0.4)" strokeWidth={Math.max(1.5, scale * 2)} />
              {/* Horizontal branch to planets */}
              <line x1={b.starX + 45} y1={b.midY} x2={b.planetX} y2={b.midY}
                stroke="rgba(148,163,184,0.4)" strokeWidth={Math.max(1.5, scale * 2)} />
              {/* Bracket dot at junction */}
              <circle cx={b.starX + 45} cy={b.midY} r={Math.max(2, scale * 2.5)} fill="rgba(148,163,184,0.5)" />
            </g>
          );
        })}

        {nodeData.nodes.filter(n => n.parentX !== undefined).map((n, i) => {
          const isMoon = n.body.body.parents?.some(pr => 'Planet' in pr);
          if (isMoon) {
            // Vertical drop: parent → node connector point → horizontal to moon
            return (
              <g key={`conn-${i}`}>
                <line x1={n.parentX} y1={n.parentY} x2={n.parentX} y2={n.y}
                  stroke="rgba(100,116,139,0.3)" strokeWidth={Math.max(0.5, scale)} />
                <line x1={n.parentX} y1={n.y} x2={n.x} y2={n.y}
                  stroke="rgba(100,116,139,0.3)" strokeWidth={Math.max(0.5, scale)} />
                {/* Node connector dot */}
                <circle cx={n.parentX} cy={n.y} r={Math.max(2, scale * 2)} fill="rgba(100,116,139,0.4)" stroke="rgba(148,163,184,0.3)" strokeWidth={0.5} />
              </g>
            );
          }
          return null; // Top-level planets connected via main axis line
        })}

        {/* Distance labels — to the right for moons, above for planets */}
        {nodeData.nodes.filter(n => (n as { distLabel?: string }).distLabel).map((n, i) => {
          const dl = (n as { distLabel?: string }).distLabel!;
          if (!dl) return null;
          const isMoon = n.body.body.parents?.some(pr => 'Planet' in pr);
          if (isMoon) {
            return (
              <text key={`dist-${i}`} x={n.x + n.size + Math.max(3, 3 * scale)} y={n.y - 2}
                fill="#475569" fontSize={Math.max(5, 5 * scale)} textAnchor="start">
                {dl}
              </text>
            );
          }
          return (
            <text key={`dist-${i}`} x={n.x} y={n.y - n.size - Math.max(4, 3 * scale)}
              fill="#475569" fontSize={Math.max(5, 5 * scale)} textAnchor="middle">
              {dl}
            </text>
          );
        })}

        {/* Render each node */}
        {nodeData.nodes.map((n, i) => {
          const { body: ob, x, y, size, fill } = n;
          const isStar = ob.body.type === 'Star';
          const atmoGlow = ob.atmoType ? ATMO_GLOW_COLORS[ob.atmoType] : undefined;
          const isHighlight = ob.importance >= 6;
          const colors = isStar ? (STAR_COLORS[ob.starCls || ''] || STAR_COLORS['G-class']) : null;
          const label = ob.body.bodyName.replace(systemData.name + ' ', '').toUpperCase();

          return (
            <g key={`node-${i}`} style={{ animation: `orrery-body-pop 0.5s cubic-bezier(0.34,1.56,0.64,1) ${0.1 + i * 0.03}s both` }}>
              {/* Star glow — compact for normal stars, intense for neutron/black hole */}
              {isStar && colors && (
                <circle cx={x} cy={y} r={ob.starCls === 'Neutron Star' || ob.starCls === 'Black Hole' ? size * 2.5 : size * 1.3}
                  fill={colors.glow} filter={ob.starCls === 'Neutron Star' || ob.starCls === 'Black Hole' ? 'url(#glow-big)' : 'url(#glow-sm)'}
                  opacity={ob.starCls === 'Neutron Star' || ob.starCls === 'Black Hole' ? 0.8 : 0.4} />
              )}
              {/* Neutron star cross marker */}
              {isStar && ob.starCls === 'Neutron Star' && (
                <>
                  <line x1={x - size * 1.2} y1={y - size * 1.2} x2={x + size * 1.2} y2={y + size * 1.2} stroke={colors?.glow || '#c084fc'} strokeWidth={1} opacity={0.5} />
                  <line x1={x + size * 1.2} y1={y - size * 1.2} x2={x - size * 1.2} y2={y + size * 1.2} stroke={colors?.glow || '#c084fc'} strokeWidth={1} opacity={0.5} />
                </>
              )}

              {/* Atmosphere glow */}
              {!isStar && atmoGlow && ob.cls.isLandable && (
                <circle cx={x} cy={y} r={size * 2.5} fill={atmoGlow} filter="url(#glow-med)" opacity={0.7}>
                  <animate attributeName="opacity" values="0.4;0.9;0.4" dur="3s" repeatCount="indefinite" />
                </circle>
              )}

              {/* Landable ring — bright cyan for atmo gems, dim for dirt */}
              {!isStar && ob.cls.isLandable && (
                <circle cx={x} cy={y} r={size + Math.max(3, scale * 3)} fill="none"
                  stroke={ob.cls.hasAtmo ? 'rgba(34,211,238,0.9)' : 'rgba(34,211,238,0.3)'}
                  strokeWidth={Math.max(ob.cls.hasAtmo ? 2 : 1, scale * (ob.cls.hasAtmo ? 2.5 : 1))}
                  opacity={ob.cls.hasAtmo ? 1 : 0.4}>
                </circle>
              )}

              {/* Rings — colored by type */}
              {!isStar && ob.cls.hasRings && (
                <ellipse cx={x} cy={y} rx={size * 2.5} ry={size * 0.6}
                  fill={getRingGradient(ob)} stroke="rgba(255,255,255,0.15)" strokeWidth={Math.max(0.5, scale * 0.5)}
                  transform={`rotate(-15 ${x} ${y})`}
                />
              )}

              {/* Body circle + specular highlight */}
              <circle cx={x} cy={y} r={size} fill={fill}>
                {isStar && <animate attributeName="r" values={`${size};${size * 1.06};${size}`} dur="3s" repeatCount="indefinite" />}
              </circle>
              {!isStar && size >= 4 && (
                <circle cx={x - size * 0.2} cy={y - size * 0.2} r={size * 0.3} fill="rgba(255,255,255,0.2)" />
              )}

              {/* Tight orbit marker */}
              {!isStar && ob.body.semiMajorAxis && ob.body.semiMajorAxis < 50000000 && (
                <circle cx={x} cy={y} r={size + 10} fill="none" stroke="rgba(34,211,238,0.4)" strokeWidth={scale} strokeDasharray={`${2 * scale},${2 * scale}`}>
                  <animate attributeName="r" values={`${size + 8};${size + 14};${size + 8}`} dur="2s" repeatCount="indefinite" />
                </circle>
              )}

              {/* Bio signal indicator */}
              {!isStar && ob.body.bioSignals && ob.body.bioSignals > 0 && (
                <text x={x + size + Math.max(3, 3 * scale)} y={y + 4}
                  fill="#22c55e" fontSize={Math.max(6, 7 * scale)} fontWeight="700">
                  {'\u{1F9EC}'}{ob.body.bioSignals}
                </text>
              )}
              {/* Geo signal indicator */}
              {!isStar && ob.body.geoSignals && ob.body.geoSignals > 0 && !ob.body.bioSignals && (
                <text x={x + size + Math.max(3, 3 * scale)} y={y + 4}
                  fill="#f59e0b" fontSize={Math.max(6, 7 * scale)} fontWeight="700">
                  {'\u{1F30B}'}{ob.body.geoSignals}
                </text>
              )}

              {/* Label — gems and top-level visible, dirt moons hidden */}
              {(isHighlight || isStar || !ob.body.parents?.some(pr => 'Planet' in pr) || ob.cls.isLandable && ob.cls.hasAtmo) && (
                <text x={x} y={y + size + Math.max(14, 12 * scale)}
                  fill={isHighlight || isStar ? '#e2e8f0' : '#475569'}
                  fontSize={Math.max(7, (isHighlight || isStar ? 10 : 7) * scale)}
                  textAnchor="middle" fontWeight={isHighlight || isStar ? '700' : '400'}
                  opacity={isHighlight || isStar ? 1 : 0.5}>
                  {label}{!isStar && (() => {
                    const illum = getIllumination(ob.body, systemData.stars);
                    return illum !== null && illum < 0.1 ? ' \u{1F311}' : '';
                  })()}
                </text>
              )}
              {/* Dark zone indicator — to the right of label */}

              {/* Star class label — only if not overlapping other bodies */}
              {isStar && ob.starCls && systemData.stars.length <= 2 && (
                <text x={x + size + 6} y={y + 3} fill="#475569"
                  fontSize={Math.max(6, 7 * scale)} textAnchor="start">
                  {ob.starCls.toUpperCase()}
                </text>
              )}
            </g>
          );
        })}

        {/* CMDR and FC markers — placed near the closest body to their station's distance */}
        {(() => {
          if (!systemData.stations || systemData.stations.length === 0) return null;
          const markers: React.ReactNode[] = [];
          // Find last docked station (from SSE or journal) for CMDR marker
          // For now, show CMDR at any station in the system, and FC at FC stations
          for (const station of systemData.stations) {
            const stDist = station.distFromStarLS || 0;
            // Find nearest orrery node to this distance
            let nearestNode = nodeData.nodes[0];
            let nearestDelta = Infinity;
            for (const n of nodeData.nodes) {
              const d = Math.abs((n.body.body.distanceToArrival || 0) - stDist);
              if (d < nearestDelta) { nearestDelta = d; nearestNode = n; }
            }
            const isFC = station.stationType?.toLowerCase().includes('fleetcarrier') ||
              (systemData.myFcCallsign && station.stationName.toUpperCase().includes(systemData.myFcCallsign.toUpperCase()));
            if (isFC) {
              markers.push(
                <g key={`fc-${station.marketId}`}>
                  <rect x={nearestNode.x + nearestNode.size + 5} y={nearestNode.y - 8} width={16} height={16} rx={3}
                    fill="rgba(251,146,60,0.3)" stroke="#fb923c" strokeWidth={1} />
                  <text x={nearestNode.x + nearestNode.size + 13} y={nearestNode.y + 4} fontSize={9} fill="#fb923c" textAnchor="middle" fontWeight="bold">FC</text>
                </g>
              );
            }
          }
          return markers;
        })()}
      </svg>
    </div>
  );
}

const UNIFORM_SIZE = 8;
const UNIFORM_STAR_SIZE = 10;

// Calculate illumination relative to Earth (1.0 = Earth-like light from Sol at 1 AU)
// Uses mass-luminosity relation: L ≈ M^3.5 for main sequence stars
function getIllumination(body: JournalScannedBody, stars: OrreryBody[]): number | null {
  if (body.type === 'Star' || !body.distanceToArrival || body.distanceToArrival < 1) return null;
  // Find the parent star — use the closest/brightest for simplicity
  let totalLuminosity = 0;
  for (const s of stars) {
    const mass = s.body.stellarMass || 0.5;
    totalLuminosity += Math.pow(mass, 3.5);
  }
  if (totalLuminosity === 0) return null;
  const distAU = body.distanceToArrival / 499; // ls to AU
  if (distAU < 0.01) return null;
  return totalLuminosity / (distAU * distAU);
}

function getStarSize(s: OrreryBody, relative = true): number {
  if (!relative) return UNIFORM_STAR_SIZE;
  const cls = s.starCls || '';
  if (cls === 'Neutron Star' || cls === 'Black Hole') return 5;
  if (cls === 'White Dwarf') return 7;
  if (cls === 'Brown Dwarf') return 8;
  return Math.min(15, 8 + Math.log2((s.body.stellarMass || 1) + 1) * 2);
}

function getBodySize(p: OrreryBody, relative = true): number {
  if (!relative) return UNIFORM_SIZE;
  if (p.cls.isLandable && p.cls.hasAtmo) return 14;
  if (p.cls.type === 'Earth-like World') return 16;
  if (p.cls.type === 'Ammonia World') return 14;
  if (p.cls.type === 'Gas Giant') return 18;
  if (p.cls.hasRings) return 10;
  if (p.cls.isLandable) return 6;
  if (p.cls.type.includes('Icy')) return 4;
  if (p.cls.type.includes('High Metal')) return 6;
  return 5;
}

function getBodyColor(p: OrreryBody): string {
  const sub = (p.body.subType || '').toLowerCase();
  if (sub.includes('earth')) return '#22d3ee';
  if (sub.includes('water world')) return '#0ea5e9';
  if (sub.includes('ammonia')) return '#22c55e';
  if (sub.includes('gas giant') || sub.includes('sudarsky')) return '#f59e0b';
  if (sub.includes('icy')) return '#22d3ee';               // bright cyan
  if (sub.includes('high metal') || sub.includes('metal rich')) return '#7c2d12'; // dark iron brown
  if (sub.includes('rocky')) return '#a3a3a3';              // neutral grey
  return '#737373';                                        // unknown/other
}

function renderBodyTexture(x: number, y: number, size: number, fill: string, bodyType: string): React.ReactNode[] {
  const layers: React.ReactNode[] = [];
  // Base circle
  layers.push(<circle key="base" cx={x} cy={y} r={size} fill={fill} />);

  if (bodyType.includes('Gas Giant')) {
    // Horizontal bands
    layers.push(<ellipse key="band1" cx={x} cy={y - size * 0.3} rx={size} ry={size * 0.15} fill="rgba(0,0,0,0.2)" />);
    layers.push(<ellipse key="band2" cx={x} cy={y + size * 0.2} rx={size} ry={size * 0.12} fill="rgba(255,255,255,0.1)" />);
    layers.push(<ellipse key="band3" cx={x} cy={y + size * 0.5} rx={size * 0.9} ry={size * 0.1} fill="rgba(0,0,0,0.15)" />);
  } else if (bodyType.includes('Icy')) {
    // Bright specular + blue shadow
    layers.push(<circle key="shadow" cx={x + size * 0.15} cy={y + size * 0.15} r={size * 0.85} fill="rgba(14,116,144,0.3)" />);
    layers.push(<circle key="spec" cx={x - size * 0.25} cy={y - size * 0.25} r={size * 0.4} fill="rgba(255,255,255,0.5)" />);
  } else if (bodyType.includes('High Metal')) {
    // Metallic sheen — bright edge highlight
    layers.push(<circle key="dark" cx={x + size * 0.1} cy={y + size * 0.1} r={size * 0.9} fill="rgba(0,0,0,0.2)" />);
    layers.push(<circle key="sheen" cx={x - size * 0.3} cy={y - size * 0.3} r={size * 0.35} fill="rgba(251,191,36,0.4)" />);
  } else if (bodyType.includes('Rocky')) {
    // Rough surface — mottled overlay
    layers.push(<circle key="dark1" cx={x + size * 0.2} cy={y - size * 0.1} r={size * 0.4} fill="rgba(0,0,0,0.15)" />);
    layers.push(<circle key="dark2" cx={x - size * 0.15} cy={y + size * 0.25} r={size * 0.3} fill="rgba(0,0,0,0.1)" />);
    layers.push(<circle key="light" cx={x - size * 0.2} cy={y - size * 0.2} r={size * 0.3} fill="rgba(255,255,255,0.12)" />);
  } else {
    // Default: simple specular
    layers.push(<circle key="spec" cx={x - size * 0.25} cy={y - size * 0.25} r={size * 0.3} fill="rgba(255,255,255,0.15)" />);
  }

  return layers;
}

function getRingGradient(p: OrreryBody): string {
  const ringClass = p.body.rings?.[0]?.ringClass?.toLowerCase() || '';
  if (ringClass.includes('icy')) return 'url(#ring-icy)';
  if (ringClass.includes('metal') || ringClass.includes('metallic')) return 'url(#ring-metallic)';
  return 'url(#ring-rocky)';
}

// Helper to use orrery data (avoids duplication)
function useOrreryData() { return null as unknown; }

// ─── Page ──────────────────────────────────────────────────────────

export function OrreryPage() {
  const [searchParams] = useSearchParams();
  const urlSystem = searchParams.get('system');

  const knownSystems = useAppStore((s) => s.knownSystems);
  const knownStations = useAppStore((s) => s.knownStations);
  const journalExplorationCache = useAppStore((s) => s.journalExplorationCache);
  const commanderPosition = useAppStore((s) => s.commanderPosition);
  const settings = useAppStore((s) => s.settings);
  const fleetCarriers = useAppStore((s) => s.fleetCarriers);

  const [systemName, setSystemName] = useState<string | null>(urlSystem || commanderPosition?.systemName || null);
  const [flash, setFlash] = useState(false);
  const [scanPop, setScanPop] = useState<string | null>(null);
  const prevSystem = useRef<string | null>(null);
  const [, forceUpdate] = useState(0);
  const [watcherStatus, setWatcherStatus] = useState(isWatcherRunning() ? 'running' : 'stopped');
  const [dataSource, setDataSource] = useState<'journal' | 'spansh' | 'auto'>('auto');
  const [spanshBodies, setSpanshBodies] = useState<JournalScannedBody[] | null>(null);
  const [spanshLoading, setSpanshLoading] = useState(false);
  const [relativeSizes, setRelativeSizes] = useState(false);

  // Fetch Spansh data when toggled
  const fetchSpansh = useCallback(async () => {
    if (!systemName) return;
    setSpanshLoading(true);
    try {
      const resolved = await resolveSystemName(systemName);
      if (!resolved) { setSpanshBodies([]); return; }
      const dump = await fetchSystemDump(resolved.id64);
      if (dump?.bodies) {
        const bodies: JournalScannedBody[] = dump.bodies.map((b: Record<string, unknown>) => ({
          bodyId: b.bodyId as number || 0,
          bodyName: b.name as string || '',
          type: (b.type === 'Star' ? 'Star' : 'Planet') as 'Star' | 'Planet',
          subType: (b.subType as string) || '',
          distanceToArrival: (b.distanceToArrival as number) || 0,
          starType: b.spectralClass as string | undefined,
          stellarMass: b.solarMasses as number | undefined,
          isLandable: b.isLandable as boolean | undefined,
          earthMasses: b.earthMasses as number | undefined,
          gravity: b.gravity != null ? (b.gravity as number) * 9.81 : undefined,
          atmosphereType: b.atmosphereType as string | undefined,
          volcanism: b.volcanismType as string | undefined,
          surfaceTemperature: b.surfaceTemperature as number | undefined,
          surfacePressure: b.surfacePressure as number | undefined,
          radius: b.radius ? (b.radius as number) * 1000 : undefined,
          semiMajorAxis: b.semiMajorAxis ? (b.semiMajorAxis as number) * 149597870700 : undefined,
          rings: (b.rings as { name: string; type: string }[] | undefined)?.map(r => ({ name: r.name, ringClass: r.type })),
          parents: b.parents as Record<string, number>[] | undefined,
        }));
        setSpanshBodies(bodies);
      } else {
        setSpanshBodies([]);
      }
    } catch {
      setSpanshBodies([]);
    } finally {
      setSpanshLoading(false);
    }
  }, [systemName]);

  const handleStartWatcher = useCallback(async () => {
    if (!getJournalFolderHandle()) {
      const handle = await selectJournalFolder();
      if (!handle) return;
    }
    startJournalWatcher();
    setWatcherStatus('running');
  }, []);

  // Auto-start watcher if not running and journal folder available
  useEffect(() => {
    if (!isWatcherRunning() && getJournalFolderHandle()) {
      console.log('[Orrery] Auto-starting journal watcher');
      startJournalWatcher();
      setWatcherStatus('running');
    }
    const t = setInterval(() => {
      setWatcherStatus(isWatcherRunning() ? 'running' : 'stopped');
    }, 3000);
    return () => clearInterval(t);
  }, []);

  // Load current system from commanderPosition if we don't have one
  useEffect(() => {
    if (!systemName && commanderPosition?.systemName) {
      setSystemName(commanderPosition.systemName);
    }
  }, [commanderPosition?.systemName, systemName]);

  // Poll for commander position on remote devices (every 3s)
  const lastSSEJump = useRef(0);
  useEffect(() => {
    const token = (() => { try { return sessionStorage.getItem('colony-token'); } catch { return null; } })();
    if (!token) return;
    const poll = () => {
      if (Date.now() - lastSSEJump.current < 5000) return;
      fetch(`/api/state?token=${token}`).then(r => r.ok ? r.json() : null).then(data => {
        if (data?.commanderPosition?.systemName && data.commanderPosition.systemName !== systemName) {
          setSystemName(data.commanderPosition.systemName);
          useAppStore.getState().setCommanderPosition(data.commanderPosition);
        }
      }).catch(() => {});
    };
    const t = setInterval(poll, 3000);
    return () => clearInterval(t);
  }, [systemName]);

  // Load complete body data from journal files when system changes
  const journalLoadDone = useRef<string | null>(null);
  useEffect(() => {
    if (!systemName || journalLoadDone.current === systemName) return;
    const handle = getJournalFolderHandle();
    if (!handle) return;
    journalLoadDone.current = systemName;
    extractExplorationData(handle).then((data) => {
      const store = useAppStore.getState();
      const cache = { ...store.journalExplorationCache };
      let changed = false;
      for (const [addr, sys] of data) {
        if (!cache[addr] || sys.scannedBodies.length > (cache[addr].scannedBodies?.length || 0)) {
          cache[addr] = sys;
          changed = true;
        }
      }
      if (changed) store.setJournalExplorationCache(cache);
    }).catch(() => { /* journal unavailable */ });
    // Also auto-fetch Spansh for best-data comparison
    if (!spanshBodies) fetchSpansh();
  }, [systemName]);

  // SSE listener for jump events AND scan highlights
  useEffect(() => {
    const token = (() => { try { return sessionStorage.getItem('colony-token'); } catch { return null; } })();
    const url = token ? `/api/events?token=${token}` : '/api/events';
    const es = new EventSource(url);
    es.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data);
        if (ev.type === 'fsd_jump' && ev.system) {
          lastSSEJump.current = Date.now(); // suppress polling for 15s
          setSystemName(ev.system as string);
          // Update commanderPosition on remote devices
          if (ev.systemAddress && ev.starPos) {
            const pos = ev.starPos as [number, number, number];
            useAppStore.getState().setCommanderPosition({
              systemName: ev.system as string,
              systemAddress: ev.systemAddress as number,
              coordinates: { x: pos[0], y: pos[1], z: pos[2] },
            });
          }
          // Start polling for body data on remote devices (watcher doesn't run there)
          if (ev.systemAddress) {
            const addr = ev.systemAddress as number;
            const tk = (() => { try { return sessionStorage.getItem('colony-token'); } catch { return null; } })();
            const pollForData = () => {
              const exploUrl = tk ? `/api/exploration/${addr}?token=${tk}` : `/api/exploration/${addr}`;
              fetch(exploUrl).then(r => r.ok ? r.json() : null).then(sys => {
                if (sys && sys.scannedBodies && sys.scannedBodies.length > 0) {
                  const store = useAppStore.getState();
                  const existingCount = store.journalExplorationCache[addr]?.scannedBodies?.length || 0;
                  if (sys.scannedBodies.length > existingCount) {
                    store.setJournalExplorationCache({ ...store.journalExplorationCache, [addr]: sys });
                  }
                }
              }).catch(() => {});
            };
            // Poll a few times to catch up
            setTimeout(pollForData, 2000);
            setTimeout(pollForData, 5000);
            setTimeout(pollForData, 10000);
          }
        }
        // Live scan updates — force re-render to pick up new bodies in journalExplorationCache
        if (ev.type === 'scan_highlight' || ev.type === 'fss_complete' || ev.type === 'exploration_update') {
          // Show scan pop notification
          if (ev.body) {
            const bodyShort = (ev.body as string).replace(systemName || '', '').trim();
            setScanPop(bodyShort || ev.body as string);
            setTimeout(() => setScanPop(null), 3000);
          }
          // Update system name from event if provided
          if (ev.system && !systemName) {
            setSystemName(ev.system as string);
          }
          // Use inline exploration data if available
          const addr = ev.systemAddress as number | undefined;
          const inlineData = ev.explorationData as Record<string, unknown> | undefined;
          if (addr && inlineData && (inlineData as { scannedBodies?: unknown[] }).scannedBodies) {
            const store = useAppStore.getState();
            const cache = { ...store.journalExplorationCache, [addr]: inlineData };
            store.setJournalExplorationCache(cache as typeof store.journalExplorationCache);
          } else if (addr) {
            // Fallback: fetch from server
            const tk = (() => { try { return sessionStorage.getItem('colony-token'); } catch { return null; } })();
            const exploUrl = tk ? `/api/exploration/${addr}?token=${tk}` : `/api/exploration/${addr}`;
            fetch(exploUrl).then(r => r.ok ? r.json() : null).then(sys => {
              if (sys && sys.scannedBodies) {
                const store = useAppStore.getState();
                store.setJournalExplorationCache({ ...store.journalExplorationCache, [addr]: sys });
              }
            }).catch(() => {});
          }
          forceUpdate((n) => n + 1);
        }
      } catch { /* ignore */ }
    };
    return () => es.close();
  }, []);

  // Flash animation on system change
  useEffect(() => {
    if (systemName && systemName !== prevSystem.current) {
      prevSystem.current = systemName;
      setSpanshBodies(null);
      setDataSource('auto');
      journalLoadDone.current = null; // allow journal reload for new system
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 1500);
      return () => clearTimeout(t);
    }
  }, [systemName]);

  // Get system data
  const systemData = useMemo(() => {
    if (!systemName) return null;
    const key = systemName.toLowerCase();
    const kb = knownSystems[key];
    const addr = kb?.systemAddress;

    // Choose data source
    let bodySource: JournalScannedBody[];
    let bodyCount = 0;
    let activeSource: 'journal' | 'spansh' = 'journal';

    const explo = addr ? journalExplorationCache[addr] : null;
    const isBarycentre = (b: JournalScannedBody) => b.bodyName.toLowerCase().includes('barycentre');
    const journalCount = explo?.scannedBodies?.filter(b => !isBarycentre(b)).length || 0;
    const spanshCount = spanshBodies?.filter(b => !isBarycentre(b)).length || 0;

    if (dataSource === 'spansh' && spanshBodies && spanshCount > 0) {
      // Manual toggle to Spansh
      bodySource = spanshBodies;
      bodyCount = spanshCount;
      activeSource = 'spansh';
    } else if (dataSource === 'journal' && spanshBodies && spanshCount > journalCount) {
      // Auto: Spansh has more bodies — use it (but user toggled to journal, respect that)
      bodySource = explo?.scannedBodies || [];
      bodyCount = explo?.bodyCount || journalCount;
      if (bodySource.length === 0) return null;
    } else if (dataSource === 'auto' || (!spanshBodies && journalCount === 0)) {
      // Auto mode or no data yet
      if (spanshBodies && spanshCount > journalCount) {
        bodySource = spanshBodies;
        bodyCount = spanshCount;
        activeSource = 'spansh';
      } else if (explo && journalCount > 0) {
        bodySource = explo.scannedBodies;
        bodyCount = explo.bodyCount || journalCount;
      } else {
        return null;
      }
    } else {
      if (!explo || journalCount === 0) return null;
      bodySource = explo.scannedBodies;
      bodyCount = explo.bodyCount || journalCount;
    }

    // Filter out barycentres
    bodySource = bodySource.filter(b => !b.bodyName.toLowerCase().includes('barycentre'));

    const stars: OrreryBody[] = [];
    const planets: OrreryBody[] = [];
    const maxDist = Math.max(...bodySource.map((b) => b.distanceToArrival || 0), 1);

    // Read user's highlight preferences
    const hlStars = new Set(useAppStore.getState().settings.domainHighlightStars || []);
    const hlAtmos = new Set(useAppStore.getState().settings.domainHighlightAtmos || []);

    for (const body of bodySource) {
      const orbitRadius = (body.distanceToArrival || 0) / maxDist;

      if (body.type === 'Star') {
        const starCls = classifyStar(body.subType);
        let importance = 5;
        // Boost stars that user configured as highlights
        if (hlStars.has(starCls)) importance = 10;
        else if (starCls === 'Black Hole' || starCls === 'Neutron Star') importance = 10;
        else if (starCls === 'Wolf-Rayet' || starCls === 'White Dwarf') importance = 8;
        else if (starCls === 'O-class' || starCls === 'Carbon Star') importance = 7;
        if (body.stellarMass && body.stellarMass > 5) importance += 2;
        if (body.stellarMass && body.stellarMass > 20) importance += 3;
        stars.push({ body, cls: { type: '', isLandable: false, hasAtmo: false, hasRings: false, atmoType: '' }, starCls, importance, orbitRadius });
      } else if (body.type === 'Planet') {
        const cls = classifyPlanet(body);
        const atmoType = cls.atmoType ? classifyAtmo(cls.atmoType) : undefined;
        let importance = 1;

        // Priority 1: Landable atmospheric — user highlight atmos score highest
        if (cls.isLandable && cls.hasAtmo && atmoType) {
          importance = 10 + (ATMO_RARITY[atmoType] || 0);
          if (hlAtmos.has(atmoType)) importance += 5;
        } else if (cls.isLandable) {
          importance = 4;
        }

        // Priority 3: Close proximity
        if (body.semiMajorAxis && body.semiMajorAxis < 50000000) { // < 50,000 km
          importance += 3;
        }

        // Priority 4: Ringed gas giants
        if (cls.hasRings && cls.type === 'Gas Giant') {
          importance = Math.max(importance, 7);
        } else if (cls.hasRings) {
          importance = Math.max(importance, 6);
        }

        // Earth-likes and water worlds
        if (cls.type === 'Earth-like World') importance = Math.max(importance, 12);
        if (cls.type === 'Ammonia World') importance = Math.max(importance, 9);

        planets.push({ body, cls, atmoType, importance, orbitRadius });
      }
    }

    // Sort planets by importance descending for the info panel
    const sortedPlanets = [...planets].sort((a, b) => b.importance - a.importance);
    const sortedStars = [...stars].sort((a, b) => b.importance - a.importance);

    const isColony = [...useAppStore.getState().projects, ...useAppStore.getState().manualColonizedSystems.map(n => ({ systemName: n }))]
      .some((p) => ('systemName' in p ? p.systemName : p)?.toString().toLowerCase() === key);

    return {
      name: kb?.systemName || systemName,
      stars: sortedStars,
      planets: sortedPlanets,
      allBodies: [...stars, ...planets],
      bodyCount: bodyCount,
      scannedCount: bodySource.length,
      activeSource,
      population: kb?.population || 0,
      economy: kb?.economyLocalised || kb?.economy,
      isColony,
      // Stations in this system for CMDR/FC markers
      stations: Object.values(knownStations).filter(
        (st) => st.systemName?.toLowerCase() === key
      ),
      myFcCallsign: settings.myFleetCarrier,
    };
  }, [systemName, knownSystems, knownStations, journalExplorationCache, dataSource, spanshBodies, settings.myFleetCarrier, relativeSizes]);

  // ─── Render ────────────────────────────────────────────────────────

  if (!systemName) {
    return (
      <div className="flex items-center justify-center h-screen bg-black text-muted-foreground">
        <div className="text-center">
          <div className="text-4xl mb-4">&#x1F52D;</div>
          <div className="text-lg">Waiting for FSD Jump...</div>
          <div className="text-sm mt-2">Start the journal watcher and jump to a system</div>
          {watcherStatus === 'stopped' && (
            <div className="mt-3">
              <button onClick={handleStartWatcher} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium">
                Select Journal Folder & Start Watcher
              </button>
              <div className="text-xs text-slate-500 mt-1">Or scan from another device — data syncs automatically</div>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!systemData) {
    return (
      <div className="flex items-center justify-center h-screen bg-black text-muted-foreground">
        <div className="text-center">
          <div className="text-4xl mb-4">&#x1F30C;</div>
          <div className="text-2xl font-bold text-foreground mb-2">{systemName}</div>
          <div className="text-sm">Honk the system to start scanning</div>
          <div className="text-xs text-muted-foreground/60 mt-2">Fire the Discovery Scanner to detect bodies</div>
          {watcherStatus === 'stopped' && (
            <div className="mt-3">
              <button onClick={handleStartWatcher} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium">
                Select Journal Folder & Start Watcher
              </button>
              <div className="text-xs text-slate-500 mt-1">Or scan from another device — data syncs automatically</div>
            </div>
          )}
        </div>
      </div>
    );
  }

  const highlights = systemData.planets.filter((p) => p.importance >= 6);
  const landableAtmo = systemData.planets.filter((p) => p.cls.isLandable && p.cls.hasAtmo);
  const landableNoAtmo = systemData.planets.filter((p) => p.cls.isLandable && !p.cls.hasAtmo);

  return (
    <div className="flex h-screen bg-black overflow-hidden">
      {/* Flash overlay on jump */}
      {flash && (
        <div className="absolute inset-0 z-50 pointer-events-none"
          style={{ background: 'radial-gradient(circle at center, rgba(59,130,246,0.4), transparent 70%)', animation: 'orrery-flash 1.5s ease-out forwards' }}
        />
      )}

      {/* Left: Info Panel */}
      <div className="w-72 shrink-0 bg-gradient-to-b from-slate-900/95 to-slate-950/98 border-r border-blue-500/20 p-4 flex flex-col gap-3 overflow-y-auto z-10">
        {/* System header */}
        <div>
          <div className="text-2xl font-extrabold text-white tracking-wide">{systemData.name}</div>
          <div className="flex items-baseline gap-3 mt-1">
            {systemData.economy && systemData.economy !== 'Unknown' && (
              <span className="text-sm text-primary">{systemData.economy}</span>
            )}
            {systemData.isColony && (
              <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">Your Colony</span>
            )}
          </div>
        </div>

        {/* Data source toggle */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setDataSource('auto')}
            className={`text-[10px] px-2 py-0.5 rounded ${dataSource === 'auto' ? 'bg-green-600 text-white' : 'bg-slate-700 text-slate-400'}`}
          >Auto</button>
          <button
            onClick={() => setDataSource('journal')}
            className={`text-[10px] px-2 py-0.5 rounded ${dataSource === 'journal' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-400'}`}
          >Journal</button>
          <button
            onClick={() => { setDataSource('spansh'); if (!spanshBodies) fetchSpansh(); }}
            className={`text-[10px] px-2 py-0.5 rounded ${dataSource === 'spansh' ? 'bg-purple-600 text-white' : 'bg-slate-700 text-slate-400'}`}
          >{spanshLoading ? 'Loading...' : 'Spansh'}</button>
          <button
            onClick={() => setRelativeSizes(!relativeSizes)}
            className={`text-[10px] px-2 py-0.5 rounded ${relativeSizes ? 'bg-cyan-600 text-white' : 'bg-slate-700 text-slate-400'}`}
          >{relativeSizes ? 'Relative' : 'Uniform'}</button>
        </div>

        {/* Body counts + scan progress */}
        <div className="flex gap-3">
          <div className="text-center">
            <div className="text-lg font-bold text-white">{systemData.stars.length}</div>
            <div className="text-[8px] text-slate-500 uppercase tracking-wider">Stars</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-white">{systemData.planets.length}</div>
            <div className="text-[8px] text-slate-500 uppercase tracking-wider">Planets</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-white">{landableAtmo.length}</div>
            <div className="text-[8px] text-slate-500 uppercase tracking-wider">Atmo</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-white">{landableNoAtmo.length + landableAtmo.length}</div>
            <div className="text-[8px] text-slate-500 uppercase tracking-wider">Land</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-slate-400">{systemData.scannedCount}<span className="text-slate-600">/{systemData.bodyCount || '?'}</span></div>
            <div className="text-[8px] text-slate-500 uppercase tracking-wider">Scanned</div>
          </div>
        </div>

        <div className="h-px bg-gradient-to-r from-blue-500/30 to-transparent" />

        {/* Stars */}
        {systemData.stars.length > 0 && (
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-2">Stars</div>
            {systemData.stars.map((s, i) => {
              const colors = STAR_COLORS[s.starCls || ''] || STAR_COLORS['G-class'];
              return (
                <div key={i} className="flex items-center gap-2 mb-2">
                  <div className="w-6 h-6 rounded-full shrink-0" style={{
                    background: colors.fill,
                    boxShadow: `0 0 ${colors.glowSize / 2}px ${colors.glow}`,
                  }} />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-white truncate">{s.body.bodyName.replace(systemData.name + ' ', '')}</div>
                    <div className="text-[11px] text-slate-400">
                      {s.starCls}{s.body.stellarMass ? ` \u00B7 ${s.body.stellarMass.toFixed(2)} M\u2609` : ''}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="h-px bg-gradient-to-r from-blue-500/30 to-transparent" />

        {/* Priority highlights */}
        {highlights.length > 0 && (
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-2">Highlights</div>
            {highlights.map((p, i) => {
              const atmo = p.atmoType ? atmoStyle(p.atmoType) : null;
              const isTight = p.body.semiMajorAxis && p.body.semiMajorAxis < 50000000;
              return (
                <div key={i} className="rounded-lg border px-3 py-2 mb-2" style={{
                  borderColor: atmo ? ATMO_GLOW_COLORS[p.atmoType || ''] || 'rgba(100,116,139,0.3)' : p.cls.hasRings ? 'rgba(236,72,153,0.3)' : 'rgba(59,130,246,0.3)',
                  background: atmo ? (ATMO_GLOW_COLORS[p.atmoType || ''] || 'rgba(30,41,59,0.5)').replace(/[\d.]+\)$/, '0.08)') : 'rgba(30,41,59,0.5)',
                }}>
                  <div className="flex items-center gap-2">
                    {atmo && <span className="text-lg">{atmo.icon}</span>}
                    {p.cls.hasRings && !atmo && <span className="text-lg">&#x1F48D;</span>}
                    {p.cls.type === 'Earth-like World' && <span className="text-lg">&#x1F30D;</span>}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-white truncate">
                        {p.body.bodyName.replace(systemData.name + ' ', '')}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {p.cls.type}
                        {p.body.gravity ? ` \u00B7 ${(p.body.gravity / 9.81).toFixed(2)}g` : ''}
                        {p.body.surfaceTemperature ? (() => {
                          const t = Math.round(p.body.surfaceTemperature!);
                          const label = t < 180 ? 'Cold' : t > 500 ? (t > 700 ? 'Dangerous' : 'Hot') : 'Normal';
                          return ` \u00B7 ${t} Kelvin (${label})`;
                        })() : ''}
                        {p.body.surfacePressure && p.body.surfacePressure / 101325 >= 0.01 ? ` \u00B7 ${(p.body.surfacePressure / 101325).toFixed(2)} atm` : ''}
                      </div>
                      {isTight && (
                        <div className="text-[10px] text-cyan-400 mt-0.5">
                          &#x1F300; {(() => {
                            const sma = p.body.semiMajorAxis!;
                            const ls = sma / 299792458;
                            const isBinary = p.body.parents?.some(pr => 'Planet' in pr || 'Null' in pr);
                            const label = isBinary ? 'from binary partner' : 'orbit';
                            return ls >= 0.01 ? `${ls.toFixed(2)} ls ${label}` : `${(sma / 1000000).toFixed(1)} Mm ${label}`;
                          })()}
                        </div>
                      )}
                    </div>
                    {p.atmoType && (
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${atmo?.color || ''}`} style={{
                        background: (ATMO_GLOW_COLORS[p.atmoType] || 'rgba(100,116,139,0.2)').replace(/[\d.]+\)$/, '0.15)'),
                      }}>
                        {p.atmoType}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* All landable bodies */}
        {(landableAtmo.length > 0 || landableNoAtmo.length > 0) && (
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-2">Landable Bodies</div>
            {[...landableAtmo, ...landableNoAtmo].map((p, i) => {
              const atmo = p.atmoType ? atmoStyle(p.atmoType) : null;
              return (
                <div key={i} className="flex items-center justify-between py-1 text-xs">
                  <span className="flex items-center gap-1.5">
                    {atmo ? <span>{atmo.icon}</span> : <span className="text-slate-600">{'\u2014'}</span>}
                    <span className="text-white">{p.body.bodyName.replace(systemData.name + ' ', '')}</span>
                  </span>
                  <span className={atmo ? atmo.color : 'text-slate-600'}>
                    {p.atmoType || 'None'} {p.body.gravity ? `\u00B7 ${(p.body.gravity / 9.81).toFixed(2)}g` : ''}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Right: Orrery SVG with pan/zoom + overlays — must fill all vertical space */}
      <div className="flex-1 flex flex-col relative overflow-hidden">
        <OrreryCanvas systemData={systemData} flash={flash} relativeSizes={relativeSizes} />

        {/* Back to app */}
        <Link to="/" className="absolute top-3 left-3 bg-slate-800/80 hover:bg-slate-700/80 border border-slate-600/40 rounded-lg px-3 py-1.5 text-xs text-slate-300 hover:text-white transition-colors z-20">
          {'\u2190'} Menu
        </Link>

        {/* Refresh button — fetch current system from server */}
        <button
          onClick={() => {
            const token = (() => { try { return sessionStorage.getItem('colony-token'); } catch { return null; } })();
            const url = token ? `/api/state?token=${token}` : '/api/state';
            fetch(url).then(r => r.ok ? r.json() : null).then(data => {
              if (data?.commanderPosition?.systemName) {
                setSystemName(data.commanderPosition.systemName);
                useAppStore.getState().setCommanderPosition(data.commanderPosition);
              }
            }).catch(() => {});
          }}
          className="absolute top-3 left-24 bg-slate-800/80 hover:bg-slate-700/80 border border-slate-600/40 rounded-lg px-3 py-1.5 text-xs text-slate-300 hover:text-white transition-colors z-20"
        >
          {'\u{1F504}'} Refresh
        </button>

        {/* Colony badge */}
        {systemData.isColony && (
          <div className="absolute top-4 right-4 bg-gradient-to-r from-amber-500/20 to-amber-500/5 border border-amber-500/40 rounded-lg px-3 py-2">
            <span className="text-xs font-bold text-amber-400 uppercase tracking-widest">Your Colony</span>
          </div>
        )}

        {/* Scan pop notification */}
        {scanPop && (
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 pointer-events-none z-30" style={{ animation: 'orrery-scan-pop 3s ease-out forwards' }}>
            <div className="bg-cyan-500/20 border border-cyan-400/40 rounded-xl px-6 py-3 backdrop-blur-sm">
              <div className="text-cyan-300 text-sm font-bold tracking-wide text-center">BODY SCANNED</div>
              <div className="text-white text-lg font-extrabold text-center mt-1">{scanPop}</div>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes orrery-flash {
          0% { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes orrery-body-pop {
          0% { opacity: 0; transform: scale(0); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes orrery-scan-pop {
          0% { opacity: 0; transform: translate(-50%, 20px) scale(0.8); }
          15% { opacity: 1; transform: translate(-50%, 0) scale(1.05); }
          25% { transform: translate(-50%, 0) scale(1); }
          80% { opacity: 1; }
          100% { opacity: 0; transform: translate(-50%, -10px) scale(0.95); }
        }
      `}</style>
    </div>
  );
}
