/**
 * The server's sparse state merge and its append-only key list (moved out of server.mjs in 1.60.28
 * so tests can import them — tests/state-patch.test.mjs). Incoming values are marker objects:
 *   { __upsert: {...}, __remove: [...], __idKey?: string } — map / array-by-id
 *   { __add: [...], __remove: [...] }                       — primitive set
 * Anything else is a wholesale replace, except `settings`, which shallow-merges.
 * A remove-only op follows the shape the key already holds: an object is a map, an array a set.
 */

// Append-only state keys: sparse PATCHes from clients can ONLY upsert/add,
// never remove. Protects hard-won data (market captures requiring a flight to
// the station, dock dossier built up over months, scouted system info, etc.)
// from being silently wiped by stale-baseline diffs sent by misbehaving tabs.
//
// Removes here only happen via dedicated server-side endpoints if at all.
export const APPEND_ONLY_KEYS = new Set([
  'marketSnapshots',          // require player flight + dock to capture
  'knownStations',            // dock dossier accumulating over time
  'knownSystems',             // system info from FSS/Spansh
  'systemAddressMap',         // name ↔ address mapping
  'bodyVisits',               // landings — exploration history
  'organicScans',             // exobiology catalogued per body — journal-derived
  'sightings',                // player-recorded "worth remembering" spots (postcard ledger)
  'bodyNotes',                // player-authored notes
  'fleetCarriers',            // FC dossier
  'fleetCarrierSpaceUsage',   // FC space tracking
  'visitedMarkets',           // journal extraction (expensive scan)
  'journalExplorationCache',  // exploration data per system
  'scoutedSystems',           // scouted system summaries
  'stationTravelTimes',       // travel-time matrix (per-ship-per-station)
  'scoutedConflicts',         // War & Peace scout reports — refresh by re-scout, not delete
  'stationBodyOverrides',     // user-set body for stations without marketId
  'materialInventory',        // ship engineering mats — derived from journals, hard to re-acquire
  'journalScan',              // squadron name/rank + ship usage (expensive journal scan)
  'dismissedTasks',           // "I am never doing that" — permanent by design, no un-dismiss path
  // Same shape: nothing in the UI un-hides an installation, so a __remove here is never intent —
  // it is a stale tab diffing an empty store against a baseline that had entries. The client's
  // mass-wipe guard skips keys with fewer than 6 entries as noise, so small hide lists were being
  // silently emptied on every race; every backup since 5 Aug had this at zero.
  'hiddenInstallations',
  'populationOverrides',      // user-edited system populations
  'systemFactions',           // the System Factions panel per system, with history — journal-derived, server-written
  'shipInventory',            // the ship stable: one record per ship from its Loadout (1.60.33)
  'shipCraft',                // the last SRV / fighter / vessel launched from each ship (1.60.33)
  'facilityPopulationFloor',  // "a facility's population never goes down" — server-written, only ever rises
  'stationDistOverrides',     // user-edited station distances
]);

// Maps whose records carry their own timestamp. A client upsert OLDER than the record the server holds is
// a stale copy from a device that missed the newer one, never a correction — on 2026-10-25 a tab that had
// loaded the state before the 23 Oct market reads at Thagard's Progress and Rankin Legacy pushed its copies
// back (23 Sep and 9 Oct) over the fresh snapshots, and the needs table sourced from a month-old market.
// Such upserts are dropped and logged with the sender; equal or newer stamps apply; server patches
// ({ trusted: true }) are never filtered.
export const FRESHNESS_STAMPS = Object.freeze({
  marketSnapshots: 'updatedAt',
  knownSystems: 'lastSeen',
  systemFactions: 'updatedAt',
});

function stampOf(rec, field) {
  const v = rec && typeof rec === 'object' ? rec[field] : null;
  if (typeof v !== 'string' || !v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/** True when the incoming record carries an older stamp than the stored one (both must have one). */
export function isStaleUpsert(key, incoming, existing) {
  const field = FRESHNESS_STAMPS[key];
  if (!field) return false;
  const a = stampOf(incoming, field), b = stampOf(existing, field);
  return a != null && b != null && a < b;
}

// Sparse per-key merge. Incoming values can be marker objects with:
//   { __upsert: {...}, __remove: [...], __idKey?: string } — map / array-by-id
//   { __add: [...], __remove: [...] }                       — primitive set
// Any other value is treated as a wholesale replace.
export function mergeStatePatch(existing, incoming, opts = {}) {
  const out = { ...existing };
  for (const key of Object.keys(incoming)) {
    const val = incoming[key];
    if (val && typeof val === 'object' && !Array.isArray(val) && ('__upsert' in val || '__remove' in val || '__add' in val)) {
      const hasUpsert = val.__upsert && typeof val.__upsert === 'object';
      const hasIdKey = typeof val.__idKey === 'string';
      let removeList = Array.isArray(val.__remove) ? val.__remove : [];
      const addList = Array.isArray(val.__add) ? val.__add : [];
      // What the key already holds decides a remove-only op's branch (1.60.28): a map stays a map.
      const existingIsMap = !!existing[key] && typeof existing[key] === 'object' && !Array.isArray(existing[key]);
      // Block client-initiated removes for append-only keys. Logs the attempt
      // so we can see when a misbehaving tab tried to wipe data.
      // Server-internal patches (the watcher, Sync All) pass { trusted: true } and may remove — the
      // watcher deletes a manual population the journal has overtaken (1.60.25).
      if (removeList.length > 0 && APPEND_ONLY_KEYS.has(key) && !(opts && opts.trusted)) {
        console.warn(`[State] BLOCKED ${removeList.length} __remove op(s) on append-only key '${key}': ${removeList.slice(0, 5).join(', ')}${removeList.length > 5 ? '...' : ''}`);
        removeList = [];
      }
      if (hasIdKey) {
        // Array-by-id — convert existing to map, apply ops, convert back
        const idKey = val.__idKey;
        const curArr = Array.isArray(existing[key]) ? existing[key] : [];
        const map = {};
        for (const item of curArr) {
          if (item && item[idKey] != null) map[String(item[idKey])] = item;
        }
        if (hasUpsert) {
          for (const id of Object.keys(val.__upsert)) map[id] = val.__upsert[id];
        }
        for (const id of removeList) delete map[String(id)];
        out[key] = Object.values(map);
      } else if (addList.length > 0 || (removeList.length > 0 && !hasUpsert && !existingIsMap)) {
        // Primitive set. Before 1.60.28 a remove-only op on a MAP landed here, read the object as []
        // and wrote back an empty array — the first manual-population cleanup (1.60.25, remove-only)
        // emptied all 557 manual populations, the 18 the rule keeps included.
        const curArr = Array.isArray(existing[key]) ? existing[key] : [];
        const removeSet = new Set(removeList);
        const next = curArr.filter((x) => !removeSet.has(x));
        for (const x of addList) if (!next.includes(x)) next.push(x);
        out[key] = next;
      } else {
        // Map (Record<id, value>)
        const cur = (existing[key] && typeof existing[key] === 'object' && !Array.isArray(existing[key])) ? existing[key] : {};
        const merged = { ...cur };
        if (hasUpsert) {
          const dropped = [];
          for (const k of Object.keys(val.__upsert)) {
            const rec = val.__upsert[k];
            if (!(opts && opts.trusted) && isStaleUpsert(key, rec, merged[k])) { dropped.push(k); continue; }
            merged[k] = rec;
          }
          if (dropped.length > 0) {
            const field = FRESHNESS_STAMPS[key];
            const label = (k) => { const inc = val.__upsert[k] || {}; const ex = merged[k] || {}; return `${inc.stationName || inc.systemName || k} (${String(inc[field] || '').slice(0, 10)} < ${String(ex[field] || '').slice(0, 10)})`; };
            console.warn(`[State] Dropped ${dropped.length} stale upsert(s) on '${key}'${opts && opts.source ? ` from ${opts.source}` : ''}: ${dropped.slice(0, 5).map(label).join(', ')}${dropped.length > 5 ? '...' : ''}`);
          }
        }
        for (const k of removeList) delete merged[k];
        out[key] = merged;
      }
    } else if (key === 'settings' && val && typeof val === 'object' && !Array.isArray(val)) {
      // settings is an ACCUMULATING flat object — a partial or stale client sync must NEVER drop
      // keys the server already holds. A wholesale replace here wiped copilotPersonality on a
      // build (the fresh client came up without it and a Sound-toggle sync replaced the lot).
      // Shallow-merge: existing keys survive, incoming keys overlay.
      const curS = (existing.settings && typeof existing.settings === 'object' && !Array.isArray(existing.settings)) ? existing.settings : {};
      out[key] = { ...curS, ...val };
    } else {
      // Wholesale replace (scalar, object, or legacy-format full value)
      out[key] = val;
    }
  }
  return out;
}

