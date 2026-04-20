/**
 * Port of the in-game !colony chat command handler from
 * src/services/overlayService.ts (browser) to plain ESM for the server-side
 * journal reader.
 *
 * Commands supported (all case-insensitive, prefix `!colony`):
 *   !colony                -> status (same as `!colony status`)
 *   !colony needs / need / buy  -> project commodity needs summary
 *   !colony score          -> scouting score for current system
 *   !colony haul / load    -> project needs + what to pull from FC
 *   !colony buy            -> market buy list for current station
 *   !colony status         -> overall status / active session
 *   !colony help / ?       -> list available commands
 *
 * Unlike the browser port, all state comes from colony-data.json via
 * deps.readState(); overlay messages go out via deps.sendOverlay(); SSE
 * broadcast is deps.broadcastEvent().
 */

// --- Layout constants (mirror overlayService.ts) ---
const X_LEFT = 40;
const Y_SCORE = 40;
const Y_MARKET = 80;
const Y_SCAN = 120;
const MAX_OVERLAY_ITEMS = 6;

/**
 * Format a list of commodity matches into a compact overlay-friendly string.
 * Shows up to MAX_OVERLAY_ITEMS, with "+N more" suffix if truncated.
 * @param {{name: string, count: number}[]} items
 */
function formatCommodityList(items) {
  const shown = items.slice(0, MAX_OVERLAY_ITEMS);
  const rest = items.length - shown.length;
  const parts = shown.map((i) => `${i.name} ${i.count.toLocaleString()}`);
  if (rest > 0) parts.push(`+${rest} more`);
  return parts.join(' | ');
}

function isEnabled(state) {
  const settings = (state && state.settings) || {};
  return settings.overlayEnabled !== false;
}

/** Resolve current system from persisted commanderPosition. */
function resolveCurrentSystem(state) {
  const pos = state && state.commanderPosition;
  if (pos && pos.systemAddress) {
    return { address: pos.systemAddress, name: pos.systemName || null };
  }
  return { address: null, name: null };
}

/**
 * Pick the most-recently-docked station in the current system from
 * knownStations. Returns null when nothing matches. Used as the server
 * equivalent of the browser's module-level lastDockedMarketId state.
 */
function resolveLastDocked(state) {
  const pos = state && state.commanderPosition;
  if (!pos) return { marketId: null, stationName: null, systemName: null };
  const knownStations = (state && state.knownStations) || {};
  let bestMid = null;
  let bestSt = null;
  let bestTs = '';
  for (const [mid, st] of Object.entries(knownStations)) {
    if (!st) continue;
    if (st.systemAddress !== pos.systemAddress) continue;
    const ts = typeof st.lastDocked === 'string' ? st.lastDocked : '';
    if (!bestSt || ts > bestTs) {
      bestSt = st;
      bestMid = Number(mid);
      bestTs = ts;
    }
  }
  if (!bestSt) return { marketId: null, stationName: null, systemName: pos.systemName || null };
  return {
    marketId: Number.isFinite(bestMid) ? bestMid : null,
    stationName: bestSt.stationName || null,
    systemName: bestSt.systemName || pos.systemName || null,
  };
}

function getActiveProject(state) {
  const activeSessionId = state && state.activeSessionId;
  if (!activeSessionId) return null;
  const sessions = (state && state.sessions) || [];
  const session = sessions.find((s) => s.id === activeSessionId);
  if (!session) return null;
  const projects = (state && state.projects) || [];
  const project = projects.find((p) => p.id === session.projectId);
  return project && project.status === 'active' ? project : null;
}

function buildSourceTag(scouted) {
  if (!scouted) return 'Unknown';
  const hasSpansh = (scouted.spanshBodyCount || 0) > 0;
  const hasJournal = !!scouted.fromJournal || !!scouted.fssAllBodiesFound || (scouted.journalBodyCount || 0) > 0;
  if (hasSpansh && hasJournal) return 'Spansh+Journal';
  if (hasSpansh) return 'Spansh';
  if (hasJournal) return 'Journal';
  return 'Unknown';
}

/**
 * Match project commodity needs against a fleet carrier's current cargo
 * and return suggested load quantities (min of FC stock and remaining need).
 * Sorted so items closest to fulfilling the requirement come first.
 */
function findCarrierLoadMatches(carrierItems, project) {
  /** @type {{name: string, loadQty: number, remaining: number}[]} */
  const matches = [];
  for (const pc of project.commodities) {
    const remaining = pc.requiredQuantity - pc.providedQuantity;
    if (remaining <= 0) continue;
    const fcItem = carrierItems.find(
      (c) => String(c.commodityId).toLowerCase() === String(pc.commodityId).toLowerCase()
    );
    if (fcItem && fcItem.count > 0) {
      matches.push({ name: pc.name, loadQty: Math.min(fcItem.count, remaining), remaining });
    }
  }
  return matches.sort((a, b) => a.remaining - b.remaining);
}

/**
 * Compose the project-needs summary overlay lines (total remaining / need-to-buy
 * plus a prioritized commodity list).
 */
function showProjectNeedsSummary(project, state, sendOverlay) {
  const settings = (state && state.settings) || {};
  const myFcCallsign = settings.myFleetCarrier;
  const carrierCargo = (state && state.carrierCargo) || {};
  const myFcCargo = myFcCallsign ? carrierCargo[myFcCallsign] : undefined;
  const myFcItems = (myFcCargo && myFcCargo.items) || [];
  const shipItems = (state && state.liveShipCargo && state.liveShipCargo.items) || [];

  let totalRemaining = 0;
  let totalNeedToBuy = 0;
  /** @type {{name: string, count: number}[]} */
  const needsList = [];

  for (const c of project.commodities) {
    const remaining = Math.max(0, c.requiredQuantity - c.providedQuantity);
    if (remaining <= 0) continue;
    totalRemaining += remaining;

    const fcStock = myFcItems.find((i) => String(i.commodityId).toLowerCase() === String(c.commodityId).toLowerCase())?.count || 0;
    const shipStock = shipItems.find((i) => String(i.commodityId).toLowerCase() === String(c.commodityId).toLowerCase())?.count || 0;
    const needToBuy = Math.max(0, remaining - fcStock - shipStock);
    totalNeedToBuy += needToBuy;
    if (needToBuy > 0) needsList.push({ name: c.name, count: needToBuy });
  }

  const totalRequired = project.commodities.reduce((s, c) => s + c.requiredQuantity, 0);
  const totalProvided = project.commodities.reduce((s, c) => s + c.providedQuantity, 0);
  const pct = totalRequired > 0 ? Math.round((totalProvided / totalRequired) * 100) : 0;

  sendOverlay({
    id: 'edcolony_needs_summary',
    text: `${project.name}: ${pct}% done | ${totalRemaining.toLocaleString()}t remaining | ${totalNeedToBuy.toLocaleString()}t to buy`,
    color: '#c084fc',
    x: X_LEFT,
    y: Y_SCORE,
    ttl: 15,
  });

  if (needsList.length > 0) {
    needsList.sort((a, b) => b.count - a.count);
    const list = formatCommodityList(needsList);
    sendOverlay({
      id: 'edcolony_needs_detail',
      text: `Need to buy: ${list}`,
      color: '#22d3ee',
      x: X_LEFT,
      y: Y_MARKET,
      ttl: 15,
    });
  }
}

// ========================================================================
// Companion content computation (parity with browser exports so any future
// SSE-driven UI can reuse these). Pure functions — return lines, no I/O.
// ========================================================================

/** @typedef {{lines: {text: string, color: string}[]}} CompanionContent */

/** @returns {CompanionContent} */
export function computeNeedsContent(state) {
  const project = getActiveProject(state);
  if (!project) return { lines: [{ text: 'No active hauling session', color: '#ef4444' }] };

  const settings = (state && state.settings) || {};
  const myFcCallsign = settings.myFleetCarrier;
  const carrierCargo = (state && state.carrierCargo) || {};
  const myFcCargo = myFcCallsign ? carrierCargo[myFcCallsign] : undefined;
  const myFcItems = (myFcCargo && myFcCargo.items) || [];
  const shipItems = (state && state.liveShipCargo && state.liveShipCargo.items) || [];

  let totalRemaining = 0;
  let totalNeedToBuy = 0;
  /** @type {{name: string, count: number}[]} */
  const needsList = [];
  for (const c of project.commodities) {
    const remaining = Math.max(0, c.requiredQuantity - c.providedQuantity);
    if (remaining <= 0) continue;
    totalRemaining += remaining;
    const fcStock = myFcItems.find((i) => String(i.commodityId).toLowerCase() === String(c.commodityId).toLowerCase())?.count || 0;
    const shipStock = shipItems.find((i) => String(i.commodityId).toLowerCase() === String(c.commodityId).toLowerCase())?.count || 0;
    const needToBuy = Math.max(0, remaining - fcStock - shipStock);
    totalNeedToBuy += needToBuy;
    if (needToBuy > 0) needsList.push({ name: c.name, count: needToBuy });
  }

  const totalRequired = project.commodities.reduce((s, c) => s + c.requiredQuantity, 0);
  const totalProvided = project.commodities.reduce((s, c) => s + c.providedQuantity, 0);
  const pct = totalRequired > 0 ? Math.round((totalProvided / totalRequired) * 100) : 0;

  const lines = [
    { text: `${project.name}: ${pct}% done | ${totalRemaining.toLocaleString()}t remaining | ${totalNeedToBuy.toLocaleString()}t to buy`, color: '#c084fc' },
  ];
  if (needsList.length > 0) {
    needsList.sort((a, b) => b.count - a.count);
    lines.push({ text: `Need: ${formatCommodityList(needsList)}`, color: '#22d3ee' });
  }
  return { lines };
}

/** @returns {CompanionContent} */
export function computeScoreContent(state) {
  const { address: curAddr, name: curName } = resolveCurrentSystem(state);
  if (!curAddr) return { lines: [{ text: 'No system jump detected yet', color: '#e2e8f0' }] };
  const scoutedSystems = (state && state.scoutedSystems) || {};
  const scouted = scoutedSystems[curAddr] || scoutedSystems[String(curAddr)];
  if (scouted && scouted.score && scouted.score.total > 0) {
    const source = buildSourceTag(scouted);
    const color = scouted.score.total >= 100 ? '#fcd34d' : scouted.score.total >= 60 ? '#4ade80' : '#38bdf8';
    return {
      lines: [{
        text: `${scouted.name} \u2014 Score: ${scouted.score.total} [${source}] | ${scouted.bodyString || ''}`,
        color,
      }],
    };
  }
  return { lines: [{ text: `${curName || 'Current system'} \u2014 Not scored yet`, color: '#e2e8f0' }] };
}

/** @returns {CompanionContent} */
export function computeHaulContent(state) {
  const needs = computeNeedsContent(state);
  const project = getActiveProject(state);
  if (!project) return needs;

  const settings = (state && state.settings) || {};
  const fcCallsign = settings.myFleetCarrier;
  const carrierCargo = (state && state.carrierCargo) || {};
  const cargo = fcCallsign ? carrierCargo[fcCallsign] : undefined;

  if (cargo && Array.isArray(cargo.items) && cargo.items.length > 0) {
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

/** @returns {CompanionContent} */
export function computeBuyHereContent(state) {
  const project = getActiveProject(state);
  if (!project) return { lines: [{ text: 'No active hauling session', color: '#ef4444' }] };

  const docked = resolveLastDocked(state);
  if (!docked.marketId || !docked.stationName) {
    return { lines: [{ text: 'Not docked at a station', color: '#ef4444' }] };
  }

  const settings = (state && state.settings) || {};
  if (settings.myFleetCarrierMarketId && settings.myFleetCarrierMarketId === docked.marketId) {
    return { lines: [{ text: 'Docked at your FC \u2014 use "Show Haul" for load list', color: '#38bdf8' }] };
  }

  const marketSnapshots = (state && state.marketSnapshots) || {};
  const snapshot = marketSnapshots[docked.marketId] || marketSnapshots[String(docked.marketId)];
  if (!snapshot) {
    return { lines: [{ text: `No market data for ${docked.stationName} \u2014 dock to read market`, color: '#fbbf24' }] };
  }

  const fcCallsign = settings.myFleetCarrier;
  const carrierCargo = (state && state.carrierCargo) || {};
  const fcCargo = fcCallsign ? carrierCargo[fcCallsign] : undefined;
  const fcItems = (fcCargo && fcCargo.items) || [];

  /** @type {{name: string, available: number, needToBuy: number, onFC: number, buyPrice: number}[]} */
  const matches = [];
  for (const c of project.commodities) {
    const remaining = c.requiredQuantity - c.providedQuantity;
    if (remaining <= 0) continue;
    const onFC = fcItems.find((i) => i.commodityId === c.commodityId)?.count || 0;
    const needToBuy = Math.max(0, remaining - onFC);
    if (needToBuy <= 0) continue;
    const item = (snapshot.commodities || []).find((m) => m.commodityId === c.commodityId);
    if (item && item.stock > 0 && item.buyPrice > 0) {
      matches.push({ name: c.name, available: item.stock, needToBuy, onFC, buyPrice: item.buyPrice });
    }
  }

  if (matches.length === 0) {
    return { lines: [{ text: `${docked.stationName}: nothing needed here (FC has the rest)`, color: '#94a3b8' }] };
  }

  const lines = [{ text: `Buy at ${docked.stationName}:`, color: '#22d3ee' }];
  for (const m of matches) {
    const qty = Math.min(m.available, m.needToBuy);
    const fcNote = m.onFC > 0 ? ` (${m.onFC.toLocaleString()}t on FC)` : '';
    lines.push({ text: `  ${m.name}: ${qty.toLocaleString()}t${fcNote}`, color: '#e2e8f0' });
  }
  return { lines };
}

/** @returns {CompanionContent} */
export function computeStatusContent(state) {
  const project = getActiveProject(state);
  if (project) return computeNeedsContent(state);
  const projects = (state && state.projects) || [];
  const projectCount = projects.filter((p) => p.status === 'active').length;
  return {
    lines: [{
      text: `${projectCount} active project${projectCount !== 1 ? 's' : ''} | No hauling session active`,
      color: '#38bdf8',
    }],
  };
}

/**
 * Render a CompanionContent object to the overlay as a stacked set of lines.
 * Clears stale slots left over from a previous, taller render.
 *
 * @param {CompanionContent} content
 * @param {(msg: object) => void} sendOverlay
 */
export function sendContentToOverlay(content, sendOverlay) {
  const LINE_HEIGHT = 40;
  const MAX_LINES = 10;
  for (let i = 0; i < MAX_LINES; i++) {
    const id = `edcolony_companion_${i}`;
    if (i < content.lines.length) {
      sendOverlay({
        id,
        text: content.lines[i].text,
        color: content.lines[i].color,
        x: X_LEFT,
        y: Y_SCORE + i * LINE_HEIGHT,
        ttl: 15,
      });
    } else {
      sendOverlay({ id, text: '', color: '#ffffff', x: X_LEFT, y: Y_SCORE + i * LINE_HEIGHT, ttl: 1 });
    }
  }
}

// ========================================================================
// Chat command dispatch
// ========================================================================

/**
 * Handle a single SendText event. Only `!colony` messages are processed;
 * other chat is ignored. Case-insensitive.
 *
 * @param {{Message?: string}} event
 * @param {{readState: () => object, sendOverlay: (msg: object) => void, broadcastEvent?: (evt: object) => void}} deps
 */
export function handleChatCommand(event, deps) {
  if (!event || typeof event.Message !== 'string') return;
  const state = deps.readState() || {};
  if (!isEnabled(state)) return;

  const msg = event.Message.trim().toLowerCase();
  if (!msg.startsWith('!colony')) return;
  console.log('[Chat] Processing !colony command:', msg);

  const cmd = msg.replace('!colony', '').trim();
  const sendOverlay = deps.sendOverlay;
  if (typeof sendOverlay !== 'function') return;

  if (cmd === 'needs' || cmd === 'need' || cmd === 'buy') {
    const activeProject = getActiveProject(state);
    if (!activeProject) {
      sendOverlay({
        id: 'edcolony_cmd',
        text: 'No active hauling session',
        color: '#ef4444',
        x: X_LEFT,
        y: Y_SCORE,
        ttl: 8,
      });
      return;
    }
    showProjectNeedsSummary(activeProject, state, sendOverlay);
    return;
  }

  if (cmd === 'score') {
    const { address: curAddr, name: curName } = resolveCurrentSystem(state);
    if (curAddr) {
      const scoutedSystems = state.scoutedSystems || {};
      const scouted = scoutedSystems[curAddr] || scoutedSystems[String(curAddr)];
      if (scouted && scouted.score && scouted.score.total > 0) {
        const source = buildSourceTag(scouted);
        const color = scouted.score.total >= 100 ? '#fcd34d' : scouted.score.total >= 60 ? '#4ade80' : '#38bdf8';
        sendOverlay({
          id: 'edcolony_cmd_score',
          text: `${scouted.name} \u2014 Score: ${scouted.score.total} [${source}] | ${scouted.bodyString || ''}`,
          color,
          x: X_LEFT,
          y: Y_SCORE,
          ttl: 12,
        });
      } else {
        sendOverlay({
          id: 'edcolony_cmd_score',
          text: `${curName || 'Current system'} \u2014 Not scored yet`,
          color: '#e2e8f0',
          x: X_LEFT,
          y: Y_SCORE,
          ttl: 8,
        });
      }
    } else {
      sendOverlay({
        id: 'edcolony_cmd_score',
        text: 'No system jump detected yet this session',
        color: '#e2e8f0',
        x: X_LEFT,
        y: Y_SCORE,
        ttl: 8,
      });
    }
    return;
  }

  if (cmd === 'status' || cmd === '') {
    const activeProject = getActiveProject(state);
    if (activeProject) {
      showProjectNeedsSummary(activeProject, state, sendOverlay);
    } else {
      const projects = state.projects || [];
      const projectCount = projects.filter((p) => p.status === 'active').length;
      sendOverlay({
        id: 'edcolony_cmd',
        text: `${projectCount} active project${projectCount !== 1 ? 's' : ''} | No hauling session active`,
        color: '#38bdf8',
        x: X_LEFT,
        y: Y_SCORE,
        ttl: 10,
      });
    }
    return;
  }

  if (cmd === 'haul' || cmd === 'load') {
    const activeProject = getActiveProject(state);
    if (!activeProject) {
      sendOverlay({
        id: 'edcolony_cmd',
        text: 'No active hauling session',
        color: '#ef4444',
        x: X_LEFT,
        y: Y_SCORE,
        ttl: 8,
      });
      return;
    }
    showProjectNeedsSummary(activeProject, state, sendOverlay);

    const settings = state.settings || {};
    const fcCallsign = settings.myFleetCarrier;
    const carrierCargo = state.carrierCargo || {};
    const cargo = fcCallsign ? carrierCargo[fcCallsign] : undefined;

    if (cargo && Array.isArray(cargo.items) && cargo.items.length > 0) {
      const matches = findCarrierLoadMatches(cargo.items, activeProject);
      if (matches.length > 0) {
        const list = formatCommodityList(matches.map((m) => ({ name: m.name, count: m.loadQty })));
        sendOverlay({
          id: 'edcolony_fc_load',
          text: `Load from FC: ${list}`,
          color: '#38bdf8',
          x: X_LEFT,
          y: Y_SCAN,
          ttl: 20,
        });
      } else {
        sendOverlay({
          id: 'edcolony_fc_load',
          text: 'No matching cargo on FC to load',
          color: '#e2e8f0',
          x: X_LEFT,
          y: Y_SCAN,
          ttl: 8,
        });
      }
    } else {
      sendOverlay({
        id: 'edcolony_fc_load',
        text: 'No FC cargo data \u2014 visit Carrier Management to sync',
        color: '#e2e8f0',
        x: X_LEFT,
        y: Y_SCAN,
        ttl: 8,
      });
    }
    return;
  }

  if (cmd === 'help' || cmd === '?') {
    sendOverlay({
      id: 'edcolony_cmd_help',
      text: '!colony needs | !colony haul | !colony score | !colony status | !colony help',
      color: '#38bdf8',
      x: X_LEFT,
      y: Y_SCORE,
      ttl: 12,
    });
  }
}

/**
 * Iterate parsed.sendTextEvents, dispatching each through handleChatCommand.
 * The parser lowercases nothing itself — we do it in handleChatCommand.
 *
 * @param {{sendTextEvents?: {Message?: string}[]}} parsed
 * @param {{readState: () => object, sendOverlay: (msg: object) => void, broadcastEvent?: (evt: object) => void}} deps
 */
export function processChatCommands(parsed, deps) {
  if (!parsed || !Array.isArray(parsed.sendTextEvents)) return;
  if (parsed.sendTextEvents.length === 0) return;
  for (const ev of parsed.sendTextEvents) {
    try {
      handleChatCommand(ev, deps);
    } catch (err) {
      console.error('[Chat] Error handling command:', err && err.message);
    }
  }
}
