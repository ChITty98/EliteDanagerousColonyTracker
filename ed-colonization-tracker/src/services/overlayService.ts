/**
 * EDMCModernOverlay integration service.
 * Composes overlay messages and POSTs them to the server's /overlay endpoint,
 * which forwards them to the EDMCModernOverlay TCP socket.
 */
import { useAppStore } from '@/store';
import { useGalleryStore, galleryKey } from '@/store/galleryStore';
import { fetchSystemDump } from '@/services/spanshApi';
import { scoreSystem, buildBodyString } from '@/lib/scoutingScorer';
import { isFleetCarrier, journalBodiesToSpanshFormat, mapStarType } from '@/services/journalReader';
import type { JournalScannedBody } from '@/services/journalReader';

// --- Types ---

interface OverlayMessage {
  id: string;
  text: string;
  color: string;
  x: number;
  y: number;
  ttl: number;
  type?: string;
}

// --- Layout constants ---
const X_LEFT = 40;
const Y_SCORE = 40;
const Y_MARKET = 80;
const Y_SCAN = 120;
const Y_IMAGE = 160;
const Y_DISTANCE = 200;

// Max items to show per overlay line (keep it readable)
const MAX_OVERLAY_ITEMS = 6;

/**
 * Format a list of commodity matches into a compact string.
 * Shows up to MAX_OVERLAY_ITEMS, with "+N more" suffix if truncated.
 */
function formatCommodityList(items: { name: string; count: number }[]): string {
  const shown = items.slice(0, MAX_OVERLAY_ITEMS);
  const rest = items.length - shown.length;
  const parts = shown.map((i) => `${i.name} ${i.count.toLocaleString()}`);
  if (rest > 0) parts.push(`+${rest} more`);
  return parts.join(' | ');
}

// --- Pending system state for unknown system scanning ---
let pendingSystemAddress: number | null = null;
let pendingSystemName: string | null = null;
// Accumulate scan events for the pending system so we can score from journal data
let pendingScanBodies: JournalScannedBody[] = [];
// Track last known system for chat commands
let lastSystemAddress: number | null = null;
let lastSystemName: string | null = null;
// Track last docked station for companion "Buy Here"
let lastDockedMarketId: number | null = null;
let lastDockedStationName: string | null = null;
let lastDockedSystemName: string | null = null;

/** Allow companion page (including iPad) to read current system */
export function getLastSystem(): { address: number | null; name: string | null } {
  return { address: lastSystemAddress, name: lastSystemName };
}
/** Set last system from SSE event (iPad receives fsd_jump broadcasts) */
export function setLastSystem(address: number, name: string): void {
  lastSystemAddress = address;
  lastSystemName = name;
}
/** Allow companion to read last docked station */
export function getLastDocked(): { marketId: number | null; stationName: string | null; systemName: string | null } {
  return { marketId: lastDockedMarketId, stationName: lastDockedStationName, systemName: lastDockedSystemName };
}
/** Set last docked from SSE event */
export function setLastDocked(marketId: number, stationName: string, systemName: string): void {
  lastDockedMarketId = marketId;
  lastDockedStationName = stationName;
  lastDockedSystemName = systemName;
}

// --- Core send function ---

async function sendOverlay(msg: OverlayMessage): Promise<void> {
  try {
    // EDMCModernOverlay legacy protocol requires "type" field
    const payload = { ...msg, type: msg.type || 'message' };
    // Include auth token for network access (iPad/remote devices)
    const token = (() => { try { return sessionStorage.getItem('colony-token'); } catch { return null; } })();
    const url = token ? `/overlay?token=${token}` : '/overlay';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    await res.json();
  } catch (err) {
    console.warn('[Overlay] Send failed:', err);
  }
}

// --- Public API ---

/**
 * Check if overlay is enabled in settings.
 */
function isEnabled(): boolean {
  return useAppStore.getState().settings.overlayEnabled !== false;
}

/**
 * Handle FSDJump event — show score, market relevance, missing images.
 */
export async function handleFSDJump(event: {
  StarSystem: string;
  SystemAddress: number;
  Population?: number;
  StarPos?: [number, number, number];
}): Promise<void> {
  if (!isEnabled()) return;

  // Reset pending scan state for the new system — always set so scans accumulate
  pendingScanBodies = [];
  pendingSystemAddress = event.SystemAddress;
  pendingSystemName = event.StarSystem;
  lastSystemAddress = event.SystemAddress;
  lastSystemName = event.StarSystem;

  const store = useAppStore.getState();
  const { scoutedSystems, projects, activeSessionId, sessions, marketSnapshots, knownStations } = store;

  // 1. Scouting score overlay — always show something on jump
  const scouted = scoutedSystems[event.SystemAddress];

  // Check if this is one of our colonized systems
  const isColonized =
    projects.some((p) => p.systemName?.toLowerCase() === event.StarSystem.toLowerCase()) ||
    store.manualColonizedSystems.some((s) => s.toLowerCase() === event.StarSystem.toLowerCase());

  if (isColonized) {
    // Colonized system — special treatment
    sendOverlay({
      id: `edcolony_score_${event.SystemAddress}`,
      text: `${event.StarSystem} \u2014 Your Colony`,
      color: '#c084fc',
      x: X_LEFT,
      y: Y_SCORE,
      ttl: 10,
    });
  } else if (scouted && scouted.score && scouted.score.total > 0) {
    // Previously scored system — show source info
    const source = buildSourceTag(scouted);
    const needsScan = !scouted.fssAllBodiesFound;
    const color = scouted.score.total >= 100 ? '#fcd34d' : scouted.score.total >= 60 ? '#4ade80' : '#38bdf8';
    let text = `${event.StarSystem} \u2014 Score: ${scouted.score.total} [${source}] | ${scouted.bodyString || ''}`;
    if (needsScan) {
      text += ' \u2014 FSS scan incomplete';
    }
    sendOverlay({
      id: `edcolony_score_${event.SystemAddress}`,
      text,
      color,
      x: X_LEFT,
      y: Y_SCORE,
      ttl: 12,
    });
    // Also show scan prompt on a separate line if needed
    if (needsScan) {
      sendOverlay({
        id: `edcolony_scan_prompt`,
        text: `\u{1F50D} FSS scan all bodies for accurate scoring`,
        color: '#22d3ee',
        x: X_LEFT,
        y: Y_SCAN,
        ttl: 10,
      });
    }
  } else if (scouted && (!scouted.score || scouted.score.total === 0)) {
    // In journal/scouted list but unscored — try Spansh
    const source = buildSourceTag(scouted);
    sendOverlay({
      id: `edcolony_score_${event.SystemAddress}`,
      text: `${event.StarSystem} \u2014 Known [${source}], scoring...`,
      color: '#38bdf8',
      x: X_LEFT,
      y: Y_SCORE,
      ttl: 8,
    });
    if (!scouted.fssAllBodiesFound) {
      sendOverlay({
        id: `edcolony_scan_prompt`,
        text: `\u{1F50D} FSS scan all bodies for accurate scoring`,
        color: '#22d3ee',
        x: X_LEFT,
        y: Y_SCAN,
        ttl: 10,
      });
    }
    scoreUnknownSystem(event.SystemAddress, event.StarSystem);
  } else {
    // Completely new system — try Spansh, show status
    sendOverlay({
      id: `edcolony_score_${event.SystemAddress}`,
      text: `${event.StarSystem} \u2014 New system, checking Spansh...`,
      color: '#e2e8f0',
      x: X_LEFT,
      y: Y_SCORE,
      ttl: 8,
    });
    sendOverlay({
      id: `edcolony_scan_prompt`,
      text: `\u{1F50D} FSS scan all bodies to score this system`,
      color: '#22d3ee',
      x: X_LEFT,
      y: Y_SCAN,
      ttl: 10,
    });
    scoreUnknownSystem(event.SystemAddress, event.StarSystem);
  }

  // 1b. Distance from Sol, home, and nearest colony
  if (event.StarPos) {
    const [x, y, z] = event.StarPos;
    const dist3d = (ox: number, oy: number, oz: number) =>
      Math.sqrt((x - ox) ** 2 + (y - oy) ** 2 + (z - oz) ** 2);
    const solDist = dist3d(0, 0, 0);

    const parts: string[] = [`Sol: ${solDist.toFixed(1)} ly`];

    // Distance from home system
    const homeSystemName = store.settings.homeSystem;
    if (homeSystemName) {
      const homeKey = homeSystemName.toLowerCase();
      const homeSys = store.knownSystems?.[homeKey];
      if (homeSys?.coordinates) {
        const homeDist = dist3d(homeSys.coordinates.x, homeSys.coordinates.y, homeSys.coordinates.z);
        parts.push(`Home: ${homeDist.toFixed(1)} ly`);
      }
    }

    // Distance to nearest colony
    let nearestColonyDist = Infinity;
    let nearestColonyName = '';
    for (const p of projects) {
      const pKey = (p.systemName || '').toLowerCase();
      const pSys = store.knownSystems?.[pKey];
      if (pSys?.coordinates) {
        const d = dist3d(pSys.coordinates.x, pSys.coordinates.y, pSys.coordinates.z);
        if (d < nearestColonyDist) {
          nearestColonyDist = d;
          nearestColonyName = pSys.systemName || p.systemName || '';
        }
      }
    }
    if (nearestColonyDist < Infinity) {
      parts.push(`${nearestColonyName}: ${nearestColonyDist.toFixed(1)} ly`);
    }

    sendOverlay({
      id: 'edcolony_distance',
      text: `\u{1F4CD} ${parts.join(' | ')}`,
      color: '#94a3b8',
      x: X_LEFT,
      y: Y_DISTANCE,
      ttl: 10,
    });

    // Also broadcast for companion/iPad
    postCompanionEvent({
      type: 'distance_info',
      system: event.StarSystem,
      distances: parts,
    });
  }

  // 2. Active project market relevance
  const activeProject = getActiveProject(store);
  if (activeProject) {
    // Find stations in this system with relevant market data
    const systemStations = Object.values(knownStations).filter(
      (st) => st.systemName?.toLowerCase() === event.StarSystem.toLowerCase()
    );

    for (const station of systemStations) {
      if (isFleetCarrier(station.stationType, station.marketId)) continue;
      const snapshot = marketSnapshots[station.marketId];
      if (!snapshot) continue;

      const matches = findMarketMatches(snapshot.commodities, activeProject);
      if (matches.length > 0) {
        const list = formatCommodityList(matches.map((m) => ({ name: m.name, count: m.needToBuy })));
        sendOverlay({
          id: `edcolony_market_${event.SystemAddress}`,
          text: `${station.stationName} — Need: ${list}`,
          color: '#22d3ee',
          x: X_LEFT,
          y: Y_MARKET,
          ttl: 10,
        });
        break; // Show best station only
      }
    }
  }

  // 3. Missing images in colonised system
  checkMissingImages(event.StarSystem);
}

/**
 * Handle Docked event — show load/buy suggestions, missing image prompt.
 */
export function handleDocked(event: {
  StationName: string;
  StationType: string;
  StarSystem: string;
  SystemAddress: number;
  MarketID: number;
}): void {
  // Track last docked station for companion "Buy Here" button
  lastDockedMarketId = event.MarketID;
  lastDockedStationName = event.StationName;
  lastDockedSystemName = event.StarSystem;

  if (!isEnabled()) return;

  const store = useAppStore.getState();
  const activeProject = getActiveProject(store);

  // 1. Docked at own Fleet Carrier with active session — show project summary + load suggestions
  if (activeProject && isFleetCarrier(event.StationType, event.MarketID)) {
    const settings = store.settings;
    const isMyFC =
      settings.myFleetCarrierMarketId === event.MarketID ||
      (settings.myFleetCarrier && event.StationName.toUpperCase().includes(settings.myFleetCarrier.toUpperCase()));

    if (isMyFC) {
      // Always show project needs summary when docking at own FC
      showProjectNeedsSummary(activeProject, event.SystemAddress);

      const carrierCargo = store.carrierCargo;
      const fcCallsign = settings.myFleetCarrier;
      const cargo = fcCallsign ? carrierCargo[fcCallsign] : undefined;

      if (cargo && cargo.items.length > 0) {
        const matches = findCarrierLoadMatches(cargo.items, activeProject);
        if (matches.length > 0) {
          const list = formatCommodityList(matches.map((m) => ({ name: m.name, count: m.loadQty })));
          sendOverlay({
            id: `edcolony_fc_load`,
            text: `Load from FC: ${list}`,
            color: '#38bdf8',
            x: X_LEFT,
            y: Y_SCAN,
            ttl: 20,
          });
        }
      }

      // Reminder to visit market tab to update FC cargo data
      sendOverlay({
        id: `edcolony_fc_reminder`,
        text: `Remember: open Carrier Market tab to sync cargo before leaving`,
        color: '#fcd34d',
        x: X_LEFT,
        y: Y_IMAGE,
        ttl: 15,
      });
    }
  }

  // 2. Docked at any non-FC station — check market needs or prompt to sync
  if (!isFleetCarrier(event.StationType, event.MarketID)) {
    const snapshot = store.marketSnapshots[event.MarketID];
    if (snapshot && activeProject) {
      const matches = findMarketMatches(snapshot.commodities, activeProject);
      if (matches.length > 0) {
        const list = formatCommodityList(matches.map((m) => ({ name: m.name, count: m.needToBuy })));
        sendOverlay({
          id: `edcolony_station_needs`,
          text: `Buy here: ${list}`,
          color: '#4ade80',
          x: X_LEFT,
          y: Y_MARKET,
          ttl: 10,
        });
      }
    } else if (!snapshot) {
      sendOverlay({
        id: `edcolony_station_needs`,
        text: `No market data for ${event.StationName} \u2014 sync in app to capture`,
        color: '#e2e8f0',
        x: X_LEFT,
        y: Y_MARKET,
        ttl: 8,
      });
    }
  }

  // 3. Docked at own installation with no image (skip fleet carriers)
  if (!isFleetCarrier(event.StationType, event.MarketID)) {
    checkInstallationImage(event.StationName, event.StarSystem);
  }
}

/**
 * Handle Scan event — show callouts for special bodies and accumulate for scoring.
 */
export function handleScanEvent(event: {
  BodyName: string;
  BodyID: number;
  DistanceFromArrivalLS: number;
  Landable?: boolean;
  Atmosphere?: string;
  AtmosphereType?: string;
  Volcanism?: string;
  SurfaceGravity?: number;
  SurfaceTemperature?: number;
  TerraformState?: string;
  PlanetClass?: string;
  StarType?: string;
  StellarMass?: number;
  MassEM?: number;
  Rings?: { Name: string; RingClass: string }[];
  Parents?: Record<string, number>[];
  WasDiscovered?: boolean;
  WasMapped?: boolean;
  WasFootfalled?: boolean;
  SystemAddress?: number;
}): void {
  if (!isEnabled()) return;
  if (!pendingSystemAddress) return;
  if (event.SystemAddress && event.SystemAddress !== pendingSystemAddress) return;

  // Accumulate body data for journal-based scoring
  const isStar = !!event.StarType;
  pendingScanBodies.push({
    bodyId: event.BodyID,
    bodyName: event.BodyName,
    type: isStar ? 'Star' : 'Planet',
    subType: isStar ? (event.StarType ? mapStarType(event.StarType) : 'Unknown Star') : (event.PlanetClass || 'Unknown Planet'),
    distanceToArrival: event.DistanceFromArrivalLS,
    starType: event.StarType,
    stellarMass: event.StellarMass,
    isLandable: event.Landable,
    earthMasses: event.MassEM,
    gravity: event.SurfaceGravity,
    atmosphereType: event.AtmosphereType || event.Atmosphere,
    volcanism: event.Volcanism,
    surfaceTemperature: event.SurfaceTemperature,
    terraformState: event.TerraformState,
    rings: event.Rings?.map((r) => ({ name: r.Name, ringClass: r.RingClass })),
    parents: event.Parents,
    wasDiscovered: event.WasDiscovered,
    wasMapped: event.WasMapped,
  });

  // Ringed landable body
  if (event.Landable && event.Rings && event.Rings.length > 0) {
    sendOverlay({
      id: `edcolony_scan_ring_${event.BodyName}`,
      text: `\u{1F48D} Ringed landable \u2014 ${event.BodyName}`,
      color: '#fcd34d',
      x: X_LEFT,
      y: Y_SCAN,
      ttl: 15,
    });
  }

  // Oxygen atmosphere
  const atmo = (event.AtmosphereType || event.Atmosphere || '').toLowerCase();
  if (atmo.includes('oxygen')) {
    sendOverlay({
      id: `edcolony_scan_oxy_${event.BodyName}`,
      text: `\u{1F7E2} Oxygen atmosphere \u2014 ${event.BodyName}`,
      color: '#4ade80',
      x: X_LEFT,
      y: Y_SCAN,
      ttl: 15,
    });
  }

  // Nitrogen atmosphere
  if (atmo.includes('nitrogen')) {
    sendOverlay({
      id: `edcolony_scan_n2_${event.BodyName}`,
      text: `\u{1F535} Nitrogen atmosphere \u2014 ${event.BodyName}`,
      color: '#22d3ee',
      x: X_LEFT,
      y: Y_SCAN,
      ttl: 15,
    });
  }

  // First footfall opportunity — landable body that was discovered by someone else
  // but never footfalled, and within reasonable distance (< 60,000 Ls)
  if (
    event.Landable &&
    event.WasDiscovered === true &&
    event.WasFootfalled === false &&
    event.DistanceFromArrivalLS < 60000
  ) {
    const distLabel = event.DistanceFromArrivalLS < 10
      ? `${event.DistanceFromArrivalLS.toFixed(1)} Ls`
      : `${Math.round(event.DistanceFromArrivalLS).toLocaleString()} Ls`;
    // Use unique Y offset per body to prevent overlap (cycle through 4 slots)
    const footfallSlot = event.BodyID % 4;
    const footfallY = Y_IMAGE + footfallSlot * 30;
    sendOverlay({
      id: `edcolony_scan_footfall_${event.BodyName}`,
      text: `\u{1F9B6} First footfall available \u2014 ${event.BodyName} (${distLabel})`,
      color: '#c084fc',
      x: X_LEFT,
      y: footfallY,
      ttl: 15,
    });
  }
}

/**
 * Handle FSSAllBodiesFound — score from Spansh or from accumulated journal scans.
 */
export async function handleFSSAllBodiesFound(event: {
  StarSystem?: string;
  SystemName?: string;
  SystemAddress: number;
  Count: number;
}): Promise<void> {
  if (!isEnabled()) return;
  if (pendingSystemAddress !== event.SystemAddress) return;

  // Journal uses SystemName, not StarSystem — fall back to pendingSystemName
  const systemName = event.StarSystem || event.SystemName || pendingSystemName || 'Unknown';

  sendOverlay({
    id: `edcolony_score_${event.SystemAddress}`,
    text: `${systemName} \u2014 All ${event.Count} bodies found, scoring...`,
    color: '#38bdf8',
    x: X_LEFT,
    y: Y_SCORE,
    ttl: 8,
  });

  // Try Spansh first
  try {
    const dump = await fetchSystemDump(event.SystemAddress);
    if (dump && dump.bodies && dump.bodies.length > 0) {
      const score = scoreSystem(dump.bodies);
      const bodyString = buildBodyString(dump.bodies);
      const store = useAppStore.getState();
      store.upsertScoutedSystem({
        id64: event.SystemAddress,
        name: systemName,
        score,
        bodyString,
        scoutedAt: new Date().toISOString(),
        spanshBodyCount: dump.bodies.length,
        fssAllBodiesFound: true,
        journalBodyCount: event.Count,
      });
      const color = score.total >= 100 ? '#fcd34d' : score.total >= 60 ? '#4ade80' : '#38bdf8';
      sendOverlay({
        id: `edcolony_score_${event.SystemAddress}`,
        text: `${systemName} \u2014 Score: ${score.total} [Spansh] | ${bodyString}`,
        color,
        x: X_LEFT,
        y: Y_SCORE,
        ttl: 12,
      });
      // Broadcast score to companion/iPad
      postCompanionEvent({ type: 'score_update', system: systemName, score: score.total, source: 'Spansh', bodyString });
      // Show highlights from journal scans if available
      if (pendingScanBodies.length > 0) {
        const highlights = buildScanHighlights(pendingScanBodies);
        if (highlights) {
          sendOverlay({
            id: `edcolony_highlights`,
            text: `\u2728 ${highlights}`,
            color: '#fcd34d',
            x: X_LEFT,
            y: Y_SCAN,
            ttl: 12,
          });
        }
      }
      pendingSystemAddress = null;
      pendingSystemName = null;
      pendingScanBodies = [];
      return;
    }
  } catch {
    // Spansh failed — fall through to journal scoring
  }

  // Spansh doesn't have it — score from accumulated journal scan data
  if (pendingScanBodies.length > 0 && pendingSystemName) {
    try {
      const spanshBodies = journalBodiesToSpanshFormat(pendingScanBodies, pendingSystemName);
      const score = scoreSystem(spanshBodies);
      const bodyString = buildBodyString(spanshBodies);
      const store = useAppStore.getState();
      store.upsertScoutedSystem({
        id64: event.SystemAddress,
        name: systemName,
        score,
        bodyString,
        scoutedAt: new Date().toISOString(),
        fromJournal: true,
        spanshBodyCount: 0,
        fssAllBodiesFound: true,
        journalBodyCount: event.Count,
        journalScannedCount: pendingScanBodies.length,
      });
      const color = score.total >= 100 ? '#fcd34d' : score.total >= 60 ? '#4ade80' : '#38bdf8';
      sendOverlay({
        id: `edcolony_score_${event.SystemAddress}`,
        text: `${systemName} \u2014 Score: ${score.total} [Journal] | ${bodyString}`,
        color,
        x: X_LEFT,
        y: Y_SCORE,
        ttl: 12,
      });
      // Broadcast score to companion/iPad
      postCompanionEvent({ type: 'score_update', system: systemName, score: score.total, source: 'Journal', bodyString });
      // Show interesting highlights if any
      const highlights = buildScanHighlights(pendingScanBodies);
      if (highlights) {
        sendOverlay({
          id: `edcolony_highlights`,
          text: `\u2728 ${highlights}`,
          color: '#fcd34d',
          x: X_LEFT,
          y: Y_SCAN,
          ttl: 12,
        });
      }
    } catch (err) {
      console.error('[Overlay] Journal scoring failed:', err);
      sendOverlay({
        id: `edcolony_score_${event.SystemAddress}`,
        text: `${systemName} \u2014 Journal scoring failed`,
        color: '#ef4444',
        x: X_LEFT,
        y: Y_SCORE,
        ttl: 10,
      });
    }
  } else {
    console.warn(`[Overlay] No scan data to score: pendingScanBodies=${pendingScanBodies.length}, pendingSystemName=${pendingSystemName}`);
    sendOverlay({
      id: `edcolony_score_${event.SystemAddress}`,
      text: `${systemName} \u2014 ${event.Count} bodies, no scan data to score`,
      color: '#e2e8f0',
      x: X_LEFT,
      y: Y_SCORE,
      ttl: 10,
    });
  }

  pendingSystemAddress = null;
  pendingSystemName = null;
  pendingScanBodies = [];
}

// --- Internal helpers ---

/**
 * Build a highlights string from accumulated scan bodies.
 * Shows ringed landables, special atmospheres, terraform candidates, etc.
 */
function buildScanHighlights(bodies: JournalScannedBody[]): string {
  const highlights: string[] = [];
  let ringedLandables = 0;
  let oxygenWorlds = 0;
  let nitrogenWorlds = 0;
  let terraformCandidates = 0;
  let elws = 0;

  for (const b of bodies) {
    if (b.type !== 'Planet') continue;
    const atmo = (b.atmosphereType || '').toLowerCase();
    if (b.isLandable && b.rings && b.rings.length > 0) ringedLandables++;
    if (atmo.includes('oxygen')) oxygenWorlds++;
    if (atmo.includes('nitrogen')) nitrogenWorlds++;
    if (b.terraformState && b.terraformState !== 'None' && b.terraformState !== '') terraformCandidates++;
    const sub = (b.subType || '').toLowerCase();
    if (sub.includes('earth-like') || sub.includes('earthlike')) elws++;
  }

  if (elws > 0) highlights.push(`${elws} ELW`);
  if (oxygenWorlds > 0) highlights.push(`${oxygenWorlds} O2`);
  if (nitrogenWorlds > 0) highlights.push(`${nitrogenWorlds} N2`);
  if (ringedLandables > 0) highlights.push(`${ringedLandables} ringed landable`);
  if (terraformCandidates > 0) highlights.push(`${terraformCandidates} terraform`);

  return highlights.join(', ');
}

/**
 * Build a short tag describing where the system data comes from.
 */
function buildSourceTag(scouted: { spanshBodyCount?: number; fromJournal?: boolean; fssAllBodiesFound?: boolean; journalBodyCount?: number }): string {
  const hasSpansh = (scouted.spanshBodyCount ?? 0) > 0;
  const hasJournal = !!scouted.fromJournal || !!scouted.fssAllBodiesFound || (scouted.journalBodyCount ?? 0) > 0;
  if (hasSpansh && hasJournal) return 'Spansh+Journal';
  if (hasSpansh) return 'Spansh';
  if (hasJournal) return 'Journal';
  return 'Unknown';
}

function getActiveProject(store: ReturnType<typeof useAppStore.getState>) {
  if (!store.activeSessionId) return null;
  const session = store.sessions.find((s) => s.id === store.activeSessionId);
  if (!session) return null;
  const project = store.projects.find((p) => p.id === session.projectId);
  return project && project.status === 'active' ? project : null;
}

interface MarketMatch {
  name: string;
  available: number;
  needToBuy: number;
}

/**
 * Find commodities at this market that we still need to BUY.
 * "Need to buy" = remaining - myFcStock - shipStock.
 * Only includes items where needToBuy > 0 AND the market has stock.
 */
function findMarketMatches(
  commodities: { commodityId: string; name: string; stock: number; buyPrice: number }[],
  project: { commodities: { commodityId: string; name: string; requiredQuantity: number; providedQuantity: number }[] }
): MarketMatch[] {
  const store = useAppStore.getState();
  const settings = store.settings;

  // Get my FC cargo (only mine, not squadron)
  const myFcCallsign = settings.myFleetCarrier;
  const myFcCargo = myFcCallsign ? store.carrierCargo[myFcCallsign] : undefined;
  const myFcItems = myFcCargo?.items || [];

  // Get ship cargo
  const shipItems = store.liveShipCargo?.items || [];

  const matches: MarketMatch[] = [];
  for (const pc of project.commodities) {
    const remaining = pc.requiredQuantity - pc.providedQuantity;
    if (remaining <= 0) continue;

    // Subtract what's already on my FC and in my ship
    const fcStock = myFcItems.find(
      (i) => i.commodityId.toLowerCase() === pc.commodityId.toLowerCase()
    )?.count || 0;
    const shipStock = shipItems.find(
      (i) => i.commodityId.toLowerCase() === pc.commodityId.toLowerCase()
    )?.count || 0;
    const needToBuy = Math.max(0, remaining - fcStock - shipStock);

    if (needToBuy <= 0) continue;

    // Check if this market actually stocks it
    const marketItem = commodities.find(
      (c) => c.commodityId.toLowerCase() === pc.commodityId.toLowerCase() && c.stock > 0 && c.buyPrice > 0
    );
    if (marketItem) {
      matches.push({ name: pc.name, available: marketItem.stock, needToBuy });
    }
  }
  // Sort by smallest need first (closest to fulfilling)
  return matches.sort((a, b) => a.needToBuy - b.needToBuy);
}

function findCarrierLoadMatches(
  carrierItems: { commodityId: string; name: string; count: number }[],
  project: { name: string; commodities: { commodityId: string; name: string; requiredQuantity: number; providedQuantity: number }[] }
): { name: string; loadQty: number }[] {
  const matches: { name: string; loadQty: number; remaining: number }[] = [];
  for (const pc of project.commodities) {
    const remaining = pc.requiredQuantity - pc.providedQuantity;
    if (remaining <= 0) continue;
    const fcItem = carrierItems.find(
      (c) => c.commodityId.toLowerCase() === pc.commodityId.toLowerCase()
    );
    if (fcItem && fcItem.count > 0) {
      matches.push({ name: pc.name, loadQty: Math.min(fcItem.count, remaining), remaining });
    }
  }
  return matches.sort((a, b) => a.remaining - b.remaining);
}

async function scoreUnknownSystem(systemAddress: number, systemName: string): Promise<void> {
  try {
    const dump = await fetchSystemDump(systemAddress);
    if (!dump || !dump.bodies || dump.bodies.length === 0) {
      // Not in Spansh — truly unexplored
      sendOverlay({
        id: `edcolony_score_${systemAddress}`,
        text: `${systemName} \u2014 Not in Spansh \u2014 scan to score`,
        color: '#e2e8f0',
        x: X_LEFT,
        y: Y_SCORE,
        ttl: 10,
      });
      return;
    }

    const score = scoreSystem(dump.bodies);
    const bodyString = buildBodyString(dump.bodies);

    const store = useAppStore.getState();
    store.upsertScoutedSystem({
      id64: systemAddress,
      name: systemName,
      score,
      bodyString,
      scoutedAt: new Date().toISOString(),
      spanshBodyCount: dump.bodies.length,
    });

    const color = score.total >= 100 ? '#fcd34d' : score.total >= 60 ? '#4ade80' : '#38bdf8';
    sendOverlay({
      id: `edcolony_score_${systemAddress}`,
      text: `${systemName} \u2014 Score: ${score.total} | ${bodyString}`,
      color,
      x: X_LEFT,
      y: Y_SCORE,
      ttl: 12,
    });
    // Broadcast score to companion/iPad
    postCompanionEvent({ type: 'score_update', system: systemName, score: score.total, source: 'Spansh', bodyString });
  } catch {
    sendOverlay({
      id: `edcolony_score_${systemAddress}`,
      text: `${systemName} \u2014 Spansh lookup failed`,
      color: '#ef4444',
      x: X_LEFT,
      y: Y_SCORE,
      ttl: 8,
    });
  }
}

function checkMissingImages(systemName: string): void {
  const store = useAppStore.getState();
  const gallery = useGalleryStore.getState();

  // Check if this is a colonised system
  const isColonised =
    store.projects.some((p) => p.systemName?.toLowerCase() === systemName.toLowerCase()) ||
    store.manualColonizedSystems.some((s) => s.toLowerCase() === systemName.toLowerCase());

  if (!isColonised) return;

  // Find installations without images, prioritized by visit count > large pads > closest distance
  const stations = Object.values(store.knownStations)
    .filter((st) => st.systemName?.toLowerCase() === systemName.toLowerCase() && !isFleetCarrier(st.stationType, st.marketId))
    .sort((a, b) => {
      // 1. Visit count descending (most visited first)
      const visitsA = a.visitCount ?? 0;
      const visitsB = b.visitCount ?? 0;
      if (visitsB !== visitsA) return visitsB - visitsA;
      // 2. Large pad count descending
      const largeA = a.landingPads?.large ?? 0;
      const largeB = b.landingPads?.large ?? 0;
      if (largeB !== largeA) return largeB - largeA;
      // 3. Distance from star ascending (closest first)
      const distA = a.distFromStarLS ?? Infinity;
      const distB = b.distFromStarLS ?? Infinity;
      return distA - distB;
    });

  const missing: string[] = [];
  for (const st of stations) {
    const key = galleryKey(systemName, 'station', st.stationName);
    const images = gallery.getImages(key);
    if (images.length === 0) {
      missing.push(st.stationName);
    }
  }

  if (missing.length > 0) {
    // Show at most 3 names, then a count for the rest
    const shown = missing.slice(0, 3).join(', ');
    const extra = missing.length > 3 ? ` +${missing.length - 3} more` : '';
    sendOverlay({
      id: `edcolony_missing_images`,
      text: `\u{1F4F7} ${missing.length} missing images: ${shown}${extra}`,
      color: '#38bdf8',
      x: X_LEFT,
      y: Y_IMAGE,
      ttl: 10,
    });
  }
}

/**
 * Show a summary of project needs: total remaining, total need-to-buy, top commodities.
 */
function showProjectNeedsSummary(
  project: { name: string; commodities: { commodityId: string; name: string; requiredQuantity: number; providedQuantity: number }[] },
  _systemAddress: number,
): void {
  const store = useAppStore.getState();
  const settings = store.settings;
  const myFcCallsign = settings.myFleetCarrier;
  const myFcCargo = myFcCallsign ? store.carrierCargo[myFcCallsign] : undefined;
  const myFcItems = myFcCargo?.items || [];
  const shipItems = store.liveShipCargo?.items || [];

  let totalRemaining = 0;
  let totalNeedToBuy = 0;
  const needsList: { name: string; count: number }[] = [];

  for (const c of project.commodities) {
    const remaining = Math.max(0, c.requiredQuantity - c.providedQuantity);
    if (remaining <= 0) continue;
    totalRemaining += remaining;

    const fcStock = myFcItems.find((i) => i.commodityId.toLowerCase() === c.commodityId.toLowerCase())?.count || 0;
    const shipStock = shipItems.find((i) => i.commodityId.toLowerCase() === c.commodityId.toLowerCase())?.count || 0;
    const needToBuy = Math.max(0, remaining - fcStock - shipStock);
    totalNeedToBuy += needToBuy;
    if (needToBuy > 0) {
      needsList.push({ name: c.name, count: needToBuy });
    }
  }

  const totalRequired = project.commodities.reduce((s, c) => s + c.requiredQuantity, 0);
  const totalProvided = project.commodities.reduce((s, c) => s + c.providedQuantity, 0);
  const pct = totalRequired > 0 ? Math.round((totalProvided / totalRequired) * 100) : 0;

  // Line 1: Project progress
  sendOverlay({
    id: `edcolony_project_summary`,
    text: `${project.name}: ${pct}% done | ${totalRemaining.toLocaleString()}t remaining | ${totalNeedToBuy.toLocaleString()}t to buy`,
    color: '#c084fc',
    x: X_LEFT,
    y: Y_SCORE,
    ttl: 15,
  });

  // Line 2: Top commodities to buy
  if (needsList.length > 0) {
    needsList.sort((a, b) => b.count - a.count);
    const list = formatCommodityList(needsList);
    sendOverlay({
      id: `edcolony_needs_detail`,
      text: `Need to buy: ${list}`,
      color: '#22d3ee',
      x: X_LEFT,
      y: Y_MARKET,
      ttl: 15,
    });
  }
}

/**
 * Handle construction completion — bright yellow overlay prompting to dock at the new station.
 */
export function handleConstructionComplete(projectName: string): void {
  const settings = useAppStore.getState().settings;
  if (!settings.overlayEnabled) return;

  sendOverlay({
    id: 'edcolony_construction_complete',
    text: `Construction complete: ${projectName} — dock at the new station to register it!`,
    color: '#facc15',
    x: X_LEFT,
    y: Y_SCORE,
    ttl: 20,
  });
}

/**
 * Handle SendText chat command — triggered by typing in game chat.
 * Supported commands: !colony needs, !colony score, !colony status
 */
export function handleChatCommand(event: {
  Message: string;
}): void {
  console.log('[Overlay] Chat command received:', event.Message);
  if (!isEnabled()) return;

  const msg = event.Message.trim().toLowerCase();
  if (!msg.startsWith('!colony')) return;
  console.log('[Overlay] Processing !colony command:', msg);

  const cmd = msg.replace('!colony', '').trim();

  if (cmd === 'needs' || cmd === 'need' || cmd === 'buy') {
    // Show project needs summary
    const store = useAppStore.getState();
    const activeProject = getActiveProject(store);
    if (!activeProject) {
      sendOverlay({
        id: `edcolony_cmd`,
        text: `No active hauling session`,
        color: '#ef4444',
        x: X_LEFT,
        y: Y_SCORE,
        ttl: 8,
      });
      return;
    }
    showProjectNeedsSummary(activeProject, 0);
  } else if (cmd === 'score') {
    // Show current system score
    if (lastSystemAddress) {
      const store = useAppStore.getState();
      const scouted = store.scoutedSystems[lastSystemAddress];
      if (scouted && scouted.score && scouted.score.total > 0) {
        const source = buildSourceTag(scouted);
        const color = scouted.score.total >= 100 ? '#fcd34d' : scouted.score.total >= 60 ? '#4ade80' : '#38bdf8';
        sendOverlay({
          id: `edcolony_cmd_score`,
          text: `${scouted.name} \u2014 Score: ${scouted.score.total} [${source}] | ${scouted.bodyString || ''}`,
          color,
          x: X_LEFT,
          y: Y_SCORE,
          ttl: 12,
        });
      } else {
        sendOverlay({
          id: `edcolony_cmd_score`,
          text: `${lastSystemName || 'Current system'} \u2014 Not scored yet`,
          color: '#e2e8f0',
          x: X_LEFT,
          y: Y_SCORE,
          ttl: 8,
        });
      }
    } else {
      sendOverlay({
        id: `edcolony_cmd_score`,
        text: `No system jump detected yet this session`,
        color: '#e2e8f0',
        x: X_LEFT,
        y: Y_SCORE,
        ttl: 8,
      });
    }
  } else if (cmd === 'status' || cmd === '') {
    // Show project status
    const store = useAppStore.getState();
    const activeProject = getActiveProject(store);
    if (activeProject) {
      showProjectNeedsSummary(activeProject, 0);
    } else {
      // Show general info
      const projectCount = store.projects.filter((p) => p.status === 'active').length;
      sendOverlay({
        id: `edcolony_cmd`,
        text: `${projectCount} active project${projectCount !== 1 ? 's' : ''} | No hauling session active`,
        color: '#38bdf8',
        x: X_LEFT,
        y: Y_SCORE,
        ttl: 10,
      });
    }
  } else if (cmd === 'haul' || cmd === 'load') {
    // Show FC load suggestions (same as docking at own FC)
    const store = useAppStore.getState();
    const activeProject = getActiveProject(store);
    if (!activeProject) {
      sendOverlay({
        id: `edcolony_cmd`,
        text: `No active hauling session`,
        color: '#ef4444',
        x: X_LEFT,
        y: Y_SCORE,
        ttl: 8,
      });
      return;
    }
    showProjectNeedsSummary(activeProject, 0);

    const settings = store.settings;
    const fcCallsign = settings.myFleetCarrier;
    const cargo = fcCallsign ? store.carrierCargo[fcCallsign] : undefined;

    if (cargo && cargo.items.length > 0) {
      const matches = findCarrierLoadMatches(cargo.items, activeProject);
      if (matches.length > 0) {
        const list = formatCommodityList(matches.map((m) => ({ name: m.name, count: m.loadQty })));
        sendOverlay({
          id: `edcolony_fc_load`,
          text: `Load from FC: ${list}`,
          color: '#38bdf8',
          x: X_LEFT,
          y: Y_SCAN,
          ttl: 20,
        });
      } else {
        sendOverlay({
          id: `edcolony_fc_load`,
          text: `No matching cargo on FC to load`,
          color: '#e2e8f0',
          x: X_LEFT,
          y: Y_SCAN,
          ttl: 8,
        });
      }
    } else {
      sendOverlay({
        id: `edcolony_fc_load`,
        text: `No FC cargo data — visit Carrier Management to sync`,
        color: '#e2e8f0',
        x: X_LEFT,
        y: Y_SCAN,
        ttl: 8,
      });
    }
  } else if (cmd === 'help' || cmd === '?') {
    sendOverlay({
      id: `edcolony_cmd_help`,
      text: `!colony needs | !colony haul | !colony score | !colony status | !colony help`,
      color: '#38bdf8',
      x: X_LEFT,
      y: Y_SCORE,
      ttl: 12,
    });
  }
}

function checkInstallationImage(stationName: string, systemName: string): void {
  const store = useAppStore.getState();
  const gallery = useGalleryStore.getState();

  // Check if this is one of the commander's own installations
  const isOwn =
    store.projects.some((p) => p.systemName?.toLowerCase() === systemName.toLowerCase()) ||
    store.manualColonizedSystems.some((s) => s.toLowerCase() === systemName.toLowerCase());

  if (!isOwn) return;

  const key = galleryKey(systemName, 'station', stationName);
  const images = gallery.getImages(key);
  if (images.length === 0) {
    sendOverlay({
      id: `edcolony_no_image_${stationName}`,
      text: `\u{1F4F7} No image for ${stationName} \u2014 add one in the app`,
      color: '#38bdf8',
      x: X_LEFT,
      y: Y_IMAGE,
      ttl: 12,
    });
  }
}

// --- Companion page: content computation (exported) ---
// These return display content without sending overlay messages.
// The Companion page uses these to show content locally AND optionally send to overlay.

export interface CompanionContent {
  lines: { text: string; color: string }[];
}

export function computeNeedsContent(): CompanionContent {
  const store = useAppStore.getState();
  const project = getActiveProject(store);
  if (!project) return { lines: [{ text: 'No active hauling session', color: '#ef4444' }] };

  const settings = store.settings;
  const myFcCallsign = settings.myFleetCarrier;
  const myFcCargo = myFcCallsign ? store.carrierCargo[myFcCallsign] : undefined;
  const myFcItems = myFcCargo?.items || [];
  const shipItems = store.liveShipCargo?.items || [];

  let totalRemaining = 0;
  let totalNeedToBuy = 0;
  const needsList: { name: string; count: number }[] = [];
  for (const c of project.commodities) {
    const remaining = Math.max(0, c.requiredQuantity - c.providedQuantity);
    if (remaining <= 0) continue;
    totalRemaining += remaining;
    const fcStock = myFcItems.find((i) => i.commodityId.toLowerCase() === c.commodityId.toLowerCase())?.count || 0;
    const shipStock = shipItems.find((i) => i.commodityId.toLowerCase() === c.commodityId.toLowerCase())?.count || 0;
    const needToBuy = Math.max(0, remaining - fcStock - shipStock);
    totalNeedToBuy += needToBuy;
    if (needToBuy > 0) needsList.push({ name: c.name, count: needToBuy });
  }

  const totalRequired = project.commodities.reduce((s, c) => s + c.requiredQuantity, 0);
  const totalProvided = project.commodities.reduce((s, c) => s + c.providedQuantity, 0);
  const pct = totalRequired > 0 ? Math.round((totalProvided / totalRequired) * 100) : 0;

  const lines: { text: string; color: string }[] = [
    { text: `${project.name}: ${pct}% done | ${totalRemaining.toLocaleString()}t remaining | ${totalNeedToBuy.toLocaleString()}t to buy`, color: '#c084fc' },
  ];
  if (needsList.length > 0) {
    needsList.sort((a, b) => b.count - a.count);
    lines.push({ text: `Need: ${formatCommodityList(needsList)}`, color: '#22d3ee' });
  }
  return { lines };
}

export function computeScoreContent(): CompanionContent {
  if (!lastSystemAddress) return { lines: [{ text: 'No system jump detected yet', color: '#e2e8f0' }] };
  const store = useAppStore.getState();
  const scouted = store.scoutedSystems[lastSystemAddress];
  if (scouted && scouted.score && scouted.score.total > 0) {
    const source = buildSourceTag(scouted);
    const color = scouted.score.total >= 100 ? '#fcd34d' : scouted.score.total >= 60 ? '#4ade80' : '#38bdf8';
    return { lines: [{ text: `${scouted.name} \u2014 Score: ${scouted.score.total} [${source}] | ${scouted.bodyString || ''}`, color }] };
  }
  return { lines: [{ text: `${lastSystemName || 'Current system'} \u2014 Not scored yet`, color: '#e2e8f0' }] };
}

export function computeHaulContent(): CompanionContent {
  const needs = computeNeedsContent();
  const store = useAppStore.getState();
  const project = getActiveProject(store);
  if (!project) return needs;

  const settings = store.settings;
  const fcCallsign = settings.myFleetCarrier;
  const cargo = fcCallsign ? store.carrierCargo[fcCallsign] : undefined;

  if (cargo && cargo.items.length > 0) {
    const matches = findCarrierLoadMatches(cargo.items, project);
    if (matches.length > 0) {
      const list = formatCommodityList(matches.map((m) => ({ name: m.name, count: m.loadQty })));
      needs.lines.push({ text: `Load from FC: ${list}`, color: '#38bdf8' });
    } else {
      needs.lines.push({ text: 'No matching cargo on FC to load', color: '#e2e8f0' });
    }
  } else {
    needs.lines.push({ text: 'No FC cargo data \u2014 visit Carrier Management to sync', color: '#e2e8f0' });
  }
  return needs;
}

export function computeBuyHereContent(): CompanionContent {
  const store = useAppStore.getState();
  const project = getActiveProject(store);
  if (!project) return { lines: [{ text: 'No active hauling session', color: '#ef4444' }] };

  const docked = getLastDocked();
  if (!docked.marketId || !docked.stationName) {
    return { lines: [{ text: 'Not docked at a station', color: '#ef4444' }] };
  }

  // Check if docked at own FC
  const settings = store.settings;
  if (settings.myFleetCarrierMarketId === docked.marketId) {
    return { lines: [{ text: `Docked at your FC — use "Show Haul" for load list`, color: '#38bdf8' }] };
  }

  const snapshot = store.marketSnapshots[docked.marketId];
  if (!snapshot) {
    return { lines: [{ text: `No market data for ${docked.stationName} — dock to read market`, color: '#fbbf24' }] };
  }

  // Factor in FC cargo — don't recommend buying what's already on the carrier
  const fcCallsign = settings.myFleetCarrier;
  const fcCargo = fcCallsign ? store.carrierCargo[fcCallsign] : undefined;
  const fcItems = fcCargo?.items || [];

  const matches: { name: string; available: number; needToBuy: number; onFC: number; buyPrice: number }[] = [];
  for (const c of project.commodities) {
    const remaining = c.requiredQuantity - c.providedQuantity;
    if (remaining <= 0) continue;
    // Subtract what's already on the FC
    const onFC = fcItems.find((i) => i.commodityId === c.commodityId)?.count || 0;
    const needToBuy = Math.max(0, remaining - onFC);
    if (needToBuy <= 0) continue;
    const item = snapshot.commodities.find((m) => m.commodityId === c.commodityId);
    if (item && item.stock > 0 && item.buyPrice > 0) {
      matches.push({ name: c.name, available: item.stock, needToBuy, onFC, buyPrice: item.buyPrice });
    }
  }

  if (matches.length === 0) {
    return { lines: [{ text: `${docked.stationName}: nothing needed here (FC has the rest)`, color: '#94a3b8' }] };
  }

  const lines: CompanionContent['lines'] = [
    { text: `Buy at ${docked.stationName}:`, color: '#22d3ee' },
  ];
  for (const m of matches) {
    const qty = Math.min(m.available, m.needToBuy);
    const fcNote = m.onFC > 0 ? ` (${m.onFC.toLocaleString()}t on FC)` : '';
    lines.push({ text: `  ${m.name}: ${qty.toLocaleString()}t${fcNote}`, color: '#e2e8f0' });
  }
  return { lines };
}

export function computeStatusContent(): CompanionContent {
  const store = useAppStore.getState();
  const project = getActiveProject(store);
  if (project) return computeNeedsContent();
  const projectCount = store.projects.filter((p) => p.status === 'active').length;
  return { lines: [{ text: `${projectCount} active project${projectCount !== 1 ? 's' : ''} | No hauling session active`, color: '#38bdf8' }] };
}

/** Send computed content to the in-game overlay */
export function sendContentToOverlay(content: CompanionContent): void {
  const yPositions = [Y_SCORE, Y_MARKET, Y_SCAN, Y_IMAGE];
  content.lines.forEach((line, i) => {
    sendOverlay({
      id: `edcolony_companion_${i}`,
      text: line.text,
      color: line.color,
      x: X_LEFT,
      y: yPositions[i] ?? Y_IMAGE,
      ttl: 15,
    });
  });
}

/** Post an event to the SSE broadcast endpoint */
export function postCompanionEvent(event: Record<string, unknown>): void {
  const token = (() => { try { return sessionStorage.getItem('colony-token'); } catch { return null; } })();
  const url = token ? `/api/events?token=${token}` : '/api/events';
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  }).catch(() => {});
}
