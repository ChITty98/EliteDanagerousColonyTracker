import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '@/store';
import { ImageGallery } from '@/components/ImageGallery';
import { galleryKey } from '@/store/galleryStore';
import { useGalleryStore } from '@/store/galleryStore';
import { fetchSystemDump, type SpanshDumpBody } from '@/services/spanshApi';
import {
  extractExplorationData,
  journalBodiesToSpanshFormat,
  getJournalFolderHandle,
} from '@/services/journalReader';
import {
  classifyStars,
  filterQualifyingBodies,
  scoreSystem,
  buildBodyString,
  type StarInfo,
  type QualifyingBody,
} from '@/lib/scoutingScorer';

interface SystemBodiesTabProps {
  systemName: string;
  id64: number | null;
  systemAddress: number | null;
}

type DataSource = 'spansh' | 'journal' | null;

// --- Tree node for orbital hierarchy ---
interface BodyTreeNode {
  body: SpanshDumpBody;
  children: BodyTreeNode[];
}

// --- Helpers ---

function shortenBodyName(fullName: string, systemName: string): string {
  if (fullName.toLowerCase().startsWith(systemName.toLowerCase())) {
    const suffix = fullName.slice(systemName.length).trim();
    if (suffix) return suffix.toUpperCase();
  }
  return fullName;
}

/**
 * Sort bodies by orbital designation.
 * Single-letter star designations (A, B, C, D) come before multi-letter ones (AB, ABCD).
 * Then numeric: "1" < "2" < "8 A" < "8 B" < "9"
 */
function compareBodyNames(a: SpanshDumpBody, b: SpanshDumpBody, systemName: string): number {
  const aName = shortenBodyName(a.name, systemName);
  const bName = shortenBodyName(b.name, systemName);
  // Split into parts: "ABCD 1 A" → ["ABCD", "1", "A"]
  const aParts = aName.split(/\s+/);
  const bParts = bName.split(/\s+/);
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const ap = aParts[i] ?? '';
    const bp = bParts[i] ?? '';
    if (ap === bp) continue;
    // Try numeric comparison first
    const aNum = parseInt(ap, 10);
    const bNum = parseInt(bp, 10);
    if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
    if (!isNaN(aNum)) return -1; // numbers before letters
    if (!isNaN(bNum)) return 1;
    // For all-letter parts: shorter designations first (A before AB, AB before ABCD)
    // This ensures single-letter star names (A, B, C, D) sort before compound ones (ABCD)
    const aIsLetters = /^[A-Z]+$/.test(ap);
    const bIsLetters = /^[A-Z]+$/.test(bp);
    if (aIsLetters && bIsLetters && ap.length !== bp.length) {
      return ap.length - bp.length;
    }
    // Alphabetical
    return ap.localeCompare(bp);
  }
  return 0;
}

function formatDistance(ls: number): string {
  if (ls >= 10_000) return `${(ls / 1_000).toFixed(0)}K ls`;
  if (ls >= 1_000) return `${(ls / 1_000).toFixed(1)}K ls`;
  return `${Math.round(ls)} ls`;
}

function formatMass(em?: number): string {
  if (em == null) return '';
  if (em < 0.01) return `${(em * 1000).toFixed(1)} mM\u2295`;
  return `${em.toFixed(3)} M\u2295`;
}

function formatGravity(g?: number): string {
  if (g == null) return '';
  return `${g.toFixed(2)}g`;
}

function formatTemp(k?: number): string {
  if (k == null) return '';
  return `${Math.round(k)} K`;
}

const ATMOSPHERE_COLORS: Record<string, string> = {
  oxygen: 'text-green-400',
  nitrogen: 'text-blue-400',
  ammonia: 'text-yellow-400',
  helium: 'text-purple-400',
  'carbon dioxide': 'text-orange-400',
  'sulphur dioxide': 'text-amber-400',
  water: 'text-cyan-400',
};

function getAtmoColor(atmoType?: string | null): string {
  if (!atmoType) return 'text-muted-foreground';
  const lower = atmoType.toLowerCase();
  for (const [key, cls] of Object.entries(ATMOSPHERE_COLORS)) {
    if (lower.includes(key)) return cls;
  }
  return 'text-sky-300';
}

function isBeltCluster(body: SpanshDumpBody): boolean {
  return body.subType === 'Belt Cluster' ||
    body.name.toLowerCase().includes('belt cluster');
}

function isBarycentre(body: SpanshDumpBody): boolean {
  return body.subType === 'Barycentre' ||
    body.name.toLowerCase().includes('barycentre');
}

// --- Build orbital hierarchy tree ---

function buildBodyTree(bodies: SpanshDumpBody[], systemName: string): { starRoots: BodyTreeNode[]; orphanRoots: BodyTreeNode[] } {
  // Filter out barycentres — they're structural, not real bodies
  const realBodies = bodies.filter((b) => !isBarycentre(b));

  const byId = new Map<number, SpanshDumpBody>();
  for (const b of realBodies) byId.set(b.bodyId, b);

  // Map of parentId -> children
  const childrenOf = new Map<number, SpanshDumpBody[]>();
  const rootBodies: SpanshDumpBody[] = [];

  for (const b of realBodies) {
    const parentId = getDirectParentId(b, byId);
    if (parentId == null) {
      rootBodies.push(b);
    } else {
      const list = childrenOf.get(parentId) ?? [];
      list.push(b);
      childrenOf.set(parentId, list);
    }
  }

  function buildNode(body: SpanshDumpBody): BodyTreeNode {
    const kids = (childrenOf.get(body.bodyId) ?? [])
      .sort((a, b) => compareBodyNames(a, b, systemName));
    return { body, children: kids.map(buildNode) };
  }

  const sorted = rootBodies.sort((a, b) => compareBodyNames(a, b, systemName));
  const starRoots = sorted.filter((b) => b.type === 'Star').map(buildNode);
  const orphanRoots = sorted.filter((b) => b.type !== 'Star').map(buildNode);

  return { starRoots, orphanRoots };
}

/**
 * Walk the parents chain to find the first real (non-barycenter) parent
 * that exists in our body list. Barycenters (Null) are skipped since they're
 * structural grouping nodes, not real bodies we display.
 */
function getDirectParentId(body: SpanshDumpBody, allBodies: Map<number, SpanshDumpBody>): number | null {
  if (!body.parents || body.parents.length === 0) return null;
  // parents[] is ordered from immediate parent outward.
  // Walk through each parent entry, skip barycenters, find first real body.
  for (const parentEntry of body.parents) {
    for (const [key, val] of Object.entries(parentEntry)) {
      if (key === 'Null') continue; // barycenter — skip to next parent in chain
      const parentId = val as number;
      if (allBodies.has(parentId)) return parentId;
    }
  }
  return null; // all parents are barycenters or not in our body list → root
}

// --- Main Component ---

export function SystemBodiesTab({ systemName, id64, systemAddress }: SystemBodiesTabProps) {
  const scoutedSystems = useAppStore((s) => s.scoutedSystems);
  const upsertScoutedSystem = useAppStore((s) => s.upsertScoutedSystem);
  const galleryImages = useGalleryStore((s) => s.images);

  const [bodies, setBodies] = useState<SpanshDumpBody[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dataSource, setDataSource] = useState<DataSource>(null);
  const [hideNonQualifying, setHideNonQualifying] = useState(false);
  const [expandedBodyId, setExpandedBodyId] = useState<number | null>(null);
  const [fillingFromSpansh, setFillingFromSpansh] = useState(false);

  // Step 1: Load from cache or journal (local only, no network)
  const loadLocal = useCallback(async () => {
    // Check cached bodies first (instant)
    if (id64) {
      const cached = scoutedSystems[id64]?.cachedBodies;
      if (cached && cached.length > 0) {
        const filtered = cached.filter((b) => !isBeltCluster(b) && !isBarycentre(b));
        setBodies(filtered);
        setDataSource(scoutedSystems[id64]?.fromJournal ? 'journal' : 'spansh');
        return;
      }
    }

    // Try journal data (local files, no network)
    setLoading(true);
    setError(null);
    try {
      const handle = getJournalFolderHandle();
      if (handle) {
        const explorationData = await extractExplorationData(handle);
        const addr = systemAddress || id64;
        const journalSystem = addr ? explorationData.get(addr) : undefined;

        if (journalSystem && journalSystem.scannedBodies.length > 0) {
          const journalBodies = journalBodiesToSpanshFormat(journalSystem.scannedBodies, systemName)
            .filter((b) => !isBeltCluster(b) && !isBarycentre(b));
          setBodies(journalBodies);
          setDataSource('journal');

          // Cache locally
          if (id64) {
            const existing = scoutedSystems[id64];
            if (existing) {
              upsertScoutedSystem({ ...existing, cachedBodies: journalBodies });
            }
          }

          setLoading(false);
          return;
        }
      }
    } catch {
      // Journal read failed — continue to show empty state
    }

    setLoading(false);
    // No local data — show empty state with option to fetch from Spansh
    if (!bodies) {
      setError('No journal scan data. Use "Fill from Spansh" to load body details.');
    }
  }, [id64, systemAddress, systemName, scoutedSystems, upsertScoutedSystem, bodies]);

  // Step 2: Fill from Spansh on demand (user-triggered only)
  const fillFromSpansh = useCallback(async () => {
    if (!id64) return;
    setFillingFromSpansh(true);
    try {
      const dump = await fetchSystemDump(id64);
      if (dump.bodies && dump.bodies.length > 0) {
        const filtered = dump.bodies.filter((b: SpanshDumpBody) => !isBeltCluster(b) && !isBarycentre(b));
        setBodies(filtered);
        setDataSource('spansh');
        setError(null);

        // Score and cache
        const score = scoreSystem(filtered);
        const stars = classifyStars(filtered);
        const qualBodies = filterQualifyingBodies(filtered);
        const bodyString = buildBodyString(qualBodies, stars);
        const existing = scoutedSystems[id64];
        upsertScoutedSystem({
          ...(existing || { id64, name: systemName, scoutedAt: new Date().toISOString() }),
          id64,
          name: dump.name || systemName,
          score,
          bodyString,
          spanshBodyCount: filtered.length,
          spanshUpdatedAt: dump.updateTime || new Date().toISOString(),
          cachedBodies: filtered,
          scoutedAt: new Date().toISOString(),
        });
      }
    } catch (err) {
      setError('Failed to fetch from Spansh. Check your internet connection.');
    }
    setFillingFromSpansh(false);
  }, [id64, systemName, scoutedSystems, upsertScoutedSystem]);

  // Auto-load local data on mount (journal + cache only, no network)
  useEffect(() => {
    loadLocal();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on mount
  }, []);

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="text-3xl mb-3 animate-pulse">{'\u{1F30D}'}</div>
        <p className="text-muted-foreground">Loading body data from journals...</p>
      </div>
    );
  }

  if (error || !bodies || bodies.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="text-3xl mb-3">{'\u{1F50D}'}</div>
        <p className="text-muted-foreground mb-4">{error || 'No body data available from journals.'}</p>
        <button
          onClick={fillFromSpansh}
          disabled={fillingFromSpansh}
          className="px-4 py-2 bg-sky-500/20 text-sky-400 rounded-lg text-sm font-medium hover:bg-sky-500/30 transition-colors disabled:opacity-50"
        >
          {fillingFromSpansh ? 'Fetching from Spansh...' : 'Fill from Spansh'}
        </button>
      </div>
    );
  }

  // Process bodies
  const stars = classifyStars(bodies);
  const qualBodies = filterQualifyingBodies(bodies);
  const qualBodyIds = new Set(qualBodies.map((qb) => qb.body.bodyId));
  const qualMap = new Map(qualBodies.map((qb) => [qb.body.bodyId, qb]));

  // Build stations lookup
  const bodyStations = new Map<number, { name: string; type: string }[]>();
  for (const b of bodies) {
    if (b.stations && b.stations.length > 0) {
      bodyStations.set(b.bodyId, b.stations.map((s) => ({ name: s.name, type: s.type })));
    }
  }

  // Star info lookup
  const starInfoMap = new Map(stars.map((s) => [s.bodyId, s]));

  // Count
  const planetCount = bodies.filter((b) => b.type === 'Planet').length;
  const starCount = bodies.filter((b) => b.type === 'Star').length;

  // Build tree
  const { starRoots, orphanRoots } = buildBodyTree(bodies, systemName);

  // Check if a body has gallery images
  function bodyHasImages(bodyName: string): boolean {
    const key = galleryKey(systemName, 'body', bodyName);
    return (galleryImages[key]?.length ?? 0) > 0;
  }

  return (
    <div>
      {/* Data source badge + counts */}
      <div className="flex items-center gap-2 mb-4">
        <span className={`text-xs px-2 py-1 rounded ${dataSource === 'spansh' ? 'bg-sky-500/20 text-sky-400' : 'bg-amber-500/20 text-amber-400'}`}>
          {dataSource === 'spansh' ? 'Spansh API' : 'Journal Scans'}
        </span>
        <span className="text-xs text-muted-foreground">
          {bodies.length} bodies ({starCount} star{starCount !== 1 ? 's' : ''}, {planetCount} planet{planetCount !== 1 ? 's' : ''})
          {qualBodies.length > 0 && <span className="text-primary ml-1" title="Landable, non-icy, under 2.5 Earth masses — prime surface installation candidates">&middot; {qualBodies.length} prime</span>}
        </span>
        <span className="text-xs text-muted-foreground/50 hidden sm:inline" title="🟢 Prime body (landable + atmosphere) · ◉ Prime body (landable) · ○ Other body">
          {'\u{1F7E2}'} prime &middot; {'\u25CB'} other
        </span>
        <div className="ml-auto flex items-center gap-2">
          {qualBodies.length > 0 && (
            <label className="text-xs text-muted-foreground flex items-center gap-1 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={hideNonQualifying}
                onChange={(e) => setHideNonQualifying(e.target.checked)}
                className="w-3 h-3"
              />
              Prime only
            </label>
          )}
          <button onClick={fillFromSpansh} className="text-xs text-muted-foreground hover:text-foreground transition-colors" title="Re-fetch from Spansh">
            {'\u{1F504}'} Refresh
          </button>
        </div>
      </div>

      {/* Tree */}
      <div className="space-y-0.5">
        {starRoots.map((node) => (
          <TreeSection
            key={node.body.bodyId}
            node={node}
            depth={0}
            systemName={systemName}
            qualBodyIds={qualBodyIds}
            qualMap={qualMap}
            starInfoMap={starInfoMap}
            bodyStations={bodyStations}
            hideNonQualifying={hideNonQualifying}
            expandedBodyId={expandedBodyId}
            setExpandedBodyId={setExpandedBodyId}
            bodyHasImages={bodyHasImages}
          />
        ))}
        {orphanRoots.length > 0 && (
          <>
            {starRoots.length > 0 && <div className="h-2" />}
            {orphanRoots.map((node) => (
              <TreeSection
                key={node.body.bodyId}
                node={node}
                depth={0}
                systemName={systemName}
                qualBodyIds={qualBodyIds}
                qualMap={qualMap}
                starInfoMap={starInfoMap}
                bodyStations={bodyStations}
                hideNonQualifying={hideNonQualifying}
                expandedBodyId={expandedBodyId}
                setExpandedBodyId={setExpandedBodyId}
                bodyHasImages={bodyHasImages}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// --- Recursive tree renderer ---

interface TreeSectionProps {
  node: BodyTreeNode;
  depth: number;
  systemName: string;
  qualBodyIds: Set<number>;
  qualMap: Map<number, QualifyingBody>;
  starInfoMap: Map<number, StarInfo>;
  bodyStations: Map<number, { name: string; type: string }[]>;
  hideNonQualifying: boolean;
  expandedBodyId: number | null;
  setExpandedBodyId: (id: number | null) => void;
  bodyHasImages: (bodyName: string) => boolean;
}

function TreeSection({
  node,
  depth,
  systemName,
  qualBodyIds,
  qualMap,
  starInfoMap,
  bodyStations,
  hideNonQualifying,
  expandedBodyId,
  setExpandedBodyId,
  bodyHasImages,
}: TreeSectionProps) {
  const { body, children } = node;
  const isStar = body.type === 'Star';
  const isQualifying = qualBodyIds.has(body.bodyId);
  const stations = bodyStations.get(body.bodyId);
  const hasImages = bodyHasImages(body.name);
  const isExpanded = expandedBodyId === body.bodyId;

  // In hide-non-qualifying mode, skip non-qualifying non-star bodies (but show if they have qualifying descendants or images)
  if (hideNonQualifying && !isStar && !isQualifying && !hasImages) {
    const hasQualDescendant = hasQualifyingDescendant(node, qualBodyIds);
    if (!hasQualDescendant) return null;
  }

  const shortName = shortenBodyName(body.name, systemName);
  const starInfo = starInfoMap.get(body.bodyId);

  return (
    <>
      {isStar ? (
        <StarRow
          body={body}
          starInfo={starInfo}
          shortName={shortName}
          depth={depth}
          hasImages={hasImages}
          isExpanded={isExpanded}
          onToggleExpand={() => setExpandedBodyId(isExpanded ? null : body.bodyId)}
          systemName={systemName}
        />
      ) : (
        <BodyRow
          body={body}
          shortName={shortName}
          depth={depth}
          isQualifying={isQualifying}
          qualData={qualMap.get(body.bodyId)}
          stations={stations}
          hasImages={hasImages}
          isExpanded={isExpanded}
          onToggleExpand={() => setExpandedBodyId(isExpanded ? null : body.bodyId)}
          systemName={systemName}
        />
      )}
      {children.map((child) => (
        <TreeSection
          key={child.body.bodyId}
          node={child}
          depth={depth + 1}
          systemName={systemName}
          qualBodyIds={qualBodyIds}
          qualMap={qualMap}
          starInfoMap={starInfoMap}
          bodyStations={bodyStations}
          hideNonQualifying={hideNonQualifying}
          expandedBodyId={expandedBodyId}
          setExpandedBodyId={setExpandedBodyId}
          bodyHasImages={bodyHasImages}
        />
      ))}
    </>
  );
}

function hasQualifyingDescendant(node: BodyTreeNode, qualBodyIds: Set<number>): boolean {
  for (const child of node.children) {
    if (qualBodyIds.has(child.body.bodyId)) return true;
    if (hasQualifyingDescendant(child, qualBodyIds)) return true;
  }
  return false;
}

// --- Star Row ---

function StarRow({
  body,
  starInfo,
  shortName,
  depth,
  hasImages,
  isExpanded,
  onToggleExpand,
  systemName,
}: {
  body: SpanshDumpBody;
  starInfo?: StarInfo;
  shortName: string;
  depth: number;
  hasImages: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
  systemName: string;
}) {
  const indent = depth * 20;
  const emoji = starInfo?.emoji ?? '\u2605';
  const isHazardous = starInfo?.isHazardous ?? false;

  return (
    <div>
      <div
        className={`flex items-center gap-2 py-1.5 px-2 rounded-md cursor-pointer hover:bg-muted/30 transition-colors ${isHazardous ? 'bg-red-950/10' : ''}`}
        style={{ paddingLeft: `${indent + 8}px` }}
        onClick={onToggleExpand}
      >
        <span className="text-lg shrink-0">{emoji}</span>
        <span className="font-bold text-foreground">{shortName}</span>
        <span className="text-sm text-muted-foreground">{body.subType}</span>
        {body.solarMasses != null && (
          <span className="text-xs text-muted-foreground">{body.solarMasses.toFixed(2)} M{'\u2609'}</span>
        )}
        {body.luminosity && (
          <span className="text-xs text-muted-foreground">L: {body.luminosity}</span>
        )}
        {starInfo?.isMainStar && (
          <span className="text-xs text-primary bg-primary/10 px-1.5 py-0.5 rounded">Main</span>
        )}
        {isHazardous && (
          <span className="text-xs text-red-400">{'\u26A0'} Hazardous</span>
        )}
        {starInfo && starInfo.scorePoints > 0 && (
          <span className="text-xs text-primary/70 ml-auto">+{starInfo.scorePoints}</span>
        )}
        {hasImages && !isExpanded && (
          <span className="text-xs text-muted-foreground ml-1">{'\u{1F4F7}'}</span>
        )}
      </div>
      {/* Auto-show images or expanded gallery */}
      {(hasImages || isExpanded) && (
        <div className="pb-1" style={{ paddingLeft: `${indent + 36}px` }}>
          <ImageGallery galleryKey={galleryKey(systemName, 'body', body.name)} compact />
        </div>
      )}
    </div>
  );
}

// --- Body Row (planet/moon) ---

function BodyRow({
  body,
  shortName,
  depth,
  isQualifying,
  qualData,
  stations,
  hasImages,
  isExpanded,
  onToggleExpand,
  systemName,
}: {
  body: SpanshDumpBody;
  shortName: string;
  depth: number;
  isQualifying: boolean;
  qualData?: QualifyingBody;
  stations?: { name: string; type: string }[];
  hasImages: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
  systemName: string;
}) {
  const bodyVisits = useAppStore((s) => s.bodyVisits);
  // Look up visit by matching body name across all visits for this system
  const visit = Object.values(bodyVisits).find(
    (v) => v.bodyName === body.name && v.systemName.toLowerCase() === systemName.toLowerCase()
  );

  const indent = depth * 20;
  const atmoType = body.atmosphereType || null;
  const hasAtmo = atmoType && !['no atmosphere', 'none', 'no', 'null', ''].includes(atmoType.toLowerCase().trim());
  const hasRings = Array.isArray(body.rings) && body.rings.length > 0;
  const volc = body.volcanismType && body.volcanismType.toLowerCase() !== 'no volcanism' ? body.volcanismType : null;
  const isTerraformable = body.terraformingState && body.terraformingState !== 'Not terraformable' && body.terraformingState !== '';

  // Icon based on status
  let icon: string;
  if (isQualifying && hasAtmo) {
    icon = '\u{1F7E2}'; // 🟢 green circle — prime with atmosphere
  } else if (isQualifying) {
    icon = '\u25C9'; // ◉ filled circle — prime without atmosphere
  } else {
    icon = '\u25CB'; // ○ hollow circle — everything else
  }

  const dimmed = !isQualifying;

  // Build inline detail chips
  const chips: string[] = [];
  if (body.subType) chips.push(body.subType);
  const mass = formatMass(body.earthMasses);
  if (mass) chips.push(mass);
  const grav = formatGravity(body.gravity);
  if (grav) chips.push(grav);

  return (
    <div>
      <div
        className={`flex items-center gap-1.5 py-1 px-2 rounded-md cursor-pointer transition-colors
          ${isQualifying ? 'hover:bg-primary/5 border-l-2 border-primary/40' : 'hover:bg-muted/20 border-l-2 border-transparent'}
          ${dimmed ? 'opacity-50' : ''}`}
        style={{ paddingLeft: `${indent + 8}px` }}
        onClick={onToggleExpand}
      >
        {/* Icon */}
        <span className={`text-sm shrink-0 ${isQualifying ? (hasAtmo ? getAtmoColor(atmoType) : 'text-primary') : 'text-muted-foreground/60'}`}>
          {icon}
        </span>

        {/* Name */}
        <span className={`font-medium text-sm min-w-[3rem] shrink-0 ${isQualifying ? 'text-foreground' : 'text-muted-foreground'}`}>
          {shortName}
        </span>

        {/* Distance */}
        <span className="text-xs text-muted-foreground/70 min-w-[4rem] text-right shrink-0">
          {formatDistance(body.distanceToArrival)}
        </span>

        {/* Details */}
        <span className={`text-xs truncate ${isQualifying ? 'text-muted-foreground' : 'text-muted-foreground/60'}`}>
          {chips.join(' \u2022 ')}
        </span>

        {/* Inline badges */}
        {hasAtmo && (
          <span className={`text-xs shrink-0 ${getAtmoColor(atmoType)}`} title={atmoType ?? undefined}>
            {'\u{1F32C}'}{/* 🌬 wind face for atmosphere */}
          </span>
        )}
        {qualData?.economy && (
          <span className="text-xs text-primary/70 shrink-0" title={`Economy: ${qualData.economy}`}>
            {qualData.economy === 'Agriculture' ? '\u{1F33F}' : qualData.economy === 'Industrial' ? '\u{1F3ED}' : qualData.economy === 'Refinery' ? '\u26CF' : '\u{1F4E6}'}
          </span>
        )}
        {body.isLandable && isQualifying && (
          <span className="text-xs text-green-400 shrink-0" title="Landable">{'\u2713'}</span>
        )}
        {hasRings && (
          <span className="text-xs text-amber-400 shrink-0" title={body.rings!.map((r) => r.type).join(', ')}>{'\u{1F48D}'}</span>
        )}
        {volc && (
          <span className="text-xs text-orange-400 shrink-0" title={volc}>{'\u{1F30B}'}</span>
        )}
        {isTerraformable && (
          <span className="text-xs text-emerald-400 shrink-0" title={body.terraformingState ?? undefined}>{'\u{1F30D}'}</span>
        )}
        {stations && stations.length > 0 && (
          <span className="text-xs text-primary shrink-0" title={stations.map((s) => s.name).join(', ')}>
            {'\u{1F6F0}'}{stations.length > 1 ? `\u00D7${stations.length}` : ''}
          </span>
        )}
        {hasImages && !isExpanded && (
          <span className="text-xs text-muted-foreground shrink-0">{'\u{1F4F7}'}</span>
        )}
        {visit && (
          <span className="text-xs text-sky-400 shrink-0" title={`Landed ${visit.landingCount} time${visit.landingCount !== 1 ? 's' : ''} · Last: ${new Date(visit.lastLanded).toLocaleDateString()}`}>
            {'\u{1F6EC}'}{visit.landingCount > 1 ? `\u00D7${visit.landingCount}` : ''}
          </span>
        )}
      </div>

      {/* Expanded detail area or auto-show images */}
      {isExpanded && (
        <BodyDetailPanel
          body={body}
          systemName={systemName}
          indent={indent}
          qualData={qualData}
          stations={stations}
          hasAtmo={!!hasAtmo}
          atmoType={atmoType}
          hasRings={!!hasRings}
          volc={volc}
        />
      )}
      {!isExpanded && hasImages && (
        <div className="pb-0.5" style={{ paddingLeft: `${indent + 36}px` }}>
          <ImageGallery galleryKey={galleryKey(systemName, 'body', body.name)} compact />
        </div>
      )}
    </div>
  );
}

function BodyVisitInfo({ bodyName, systemName }: { bodyName: string; systemName: string }) {
  const visit = Object.values(useAppStore((s) => s.bodyVisits)).find(
    (v) => v.bodyName === bodyName && v.systemName.toLowerCase() === systemName.toLowerCase()
  );
  if (!visit) return null;
  const lastDate = new Date(visit.lastLanded);
  const dateStr = lastDate.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  return (
    <div className="text-sky-400">
      {'\u{1F6EC}'} Landed {visit.landingCount} time{visit.landingCount !== 1 ? 's' : ''} {'\u2022'} Last: {dateStr}
      {visit.lastCoords && (
        <span className="text-muted-foreground ml-2">
          ({visit.lastCoords.lat.toFixed(2)}, {visit.lastCoords.lon.toFixed(2)})
        </span>
      )}
    </div>
  );
}

// --- Expanded body detail panel ---

function BodyDetailPanel({
  body,
  systemName,
  indent,
  qualData,
  stations,
  hasAtmo,
  atmoType,
  hasRings,
  volc,
}: {
  body: SpanshDumpBody;
  systemName: string;
  indent: number;
  qualData?: QualifyingBody;
  stations?: { name: string; type: string }[];
  hasAtmo: boolean;
  atmoType: string | null;
  hasRings: boolean;
  volc: string | null;
}) {
  return (
    <div
      className="pb-2 text-xs space-y-1"
      style={{ paddingLeft: `${indent + 36}px` }}
    >
      {/* Type + mass + gravity + temp */}
      <div className="text-muted-foreground">
        <span>{body.subType}</span>
        {body.earthMasses != null && <span className="ml-2">{'\u2022'} {formatMass(body.earthMasses)}</span>}
        {body.gravity != null && <span className="ml-2">{'\u2022'} {formatGravity(body.gravity)}</span>}
        {body.surfaceTemperature != null && <span className="ml-2">{'\u2022'} {formatTemp(body.surfaceTemperature)}</span>}
        {body.isLandable && <span className="ml-2 text-green-400">{'\u2713'} Landable</span>}
      </div>

      {/* Atmosphere */}
      {hasAtmo && (
        <div className={getAtmoColor(atmoType)}>
          Atmosphere: {atmoType}
          {qualData?.economy && <span className="text-muted-foreground ml-2">{'\u2022'} {qualData.economy}</span>}
        </div>
      )}

      {/* Rings */}
      {hasRings && (
        <div className="text-amber-400">
          {'\u{1F48D}'} {body.rings!.map((r) => r.type.replace(/Ring$/, '').trim()).join(', ')} ring{body.rings!.length > 1 ? 's' : ''}
        </div>
      )}

      {/* Volcanism */}
      {volc && <div className="text-orange-400">{'\u{1F30B}'} {volc}</div>}

      {/* Terraforming */}
      {body.terraformingState && body.terraformingState !== 'Not terraformable' && body.terraformingState !== '' && (
        <div className="text-emerald-400">{'\u{1F30D}'} {body.terraformingState}</div>
      )}

      {/* Stations */}
      {stations && stations.length > 0 && (
        <div>
          {stations.map((st, i) => (
            <div key={i} className="text-primary">
              {'\u{1F6F0}'} {st.name} <span className="text-muted-foreground">({st.type})</span>
            </div>
          ))}
        </div>
      )}

      {/* Body visit info */}
      <BodyVisitInfo bodyName={body.name} systemName={systemName} />

      {/* Body note */}
      <BodyNoteInput bodyName={body.name} systemName={systemName} />

      {/* Image gallery */}
      <div className="pt-1">
        <ImageGallery galleryKey={galleryKey(systemName, 'body', body.name)} compact />
      </div>
    </div>
  );
}

function BodyNoteInput({ bodyName, systemName }: { bodyName: string; systemName: string }) {
  const key = `${systemName}|${bodyName}`;
  const note = useAppStore((s) => s.bodyNotes[key] || '');
  const setBodyNote = useAppStore((s) => s.setBodyNote);

  return (
    <div className="pt-1">
      <input
        type="text"
        placeholder="Add a note..."
        value={note}
        onChange={(e) => setBodyNote(systemName, bodyName, e.target.value)}
        onClick={(e) => e.stopPropagation()}
        className="w-full bg-muted/50 border border-border/50 rounded px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary"
      />
    </div>
  );
}
