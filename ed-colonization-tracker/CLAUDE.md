# ED Colony Tracker — Project Instructions

Read `PROJECT-HANDOFF.md` for architecture. This file is operating rules + conventions that are NOT obvious from reading the code.

---

## Design philosophy — journal-first, ALWAYS

**Every feature MUST work using only Elite Dangerous journal files.** Spansh (body/system data), Ardent Insight (market data), and EDMCModernOverlay (in-game overlay display) are optional enhancements — never requirements.

- If Spansh is unreachable, scoring still works from journal scan data.
- If Ardent is down, market sourcing still works from local `marketSnapshots` + journal-derived `visitedMarkets`.
- If the in-game overlay TCP socket fails, the Companion page still receives SSE events.
- The Sources page "Find Systems" search falls back to local journal data (`searchLocalJournal`) when Spansh is unavailable.
- The dock dossier, visit counts, travel-time matrix, and most-visited rankings are ALL journal-only — no network dependency.

When you add a feature that consumes Spansh/Ardent, you MUST wire a journal fallback or the feature violates this tenet.

**Best-data-wins for scoring:** when BOTH journal and Spansh data exist for the same system, Spansh usually wins (richer multi-CMDR dataset). Journal wins when it has STRICTLY MORE scanned bodies than Spansh. This is a display/scoring preference. Journal data is NEVER deleted when Spansh is preferred — it stays in `journalExplorationCache`.

## Data on the user's device is their data

- All persistent state lives in `colony-data.json` next to the exe.
- Gallery images in `colony-images/`.
- Never delete or replace the user's file wholesale unless they've explicitly asked.
- `writeStateDebounced` has a size-check protection (refuses writes <30% of existing). DON'T disable it.
- Automatic backups on startup live in `backups/colony-data.*.json`. These are the user's safety net for any bad write.

---

## Build + exe

- **Always check `tasklist //FI "IMAGENAME eq ed-colony-tracker.exe"` before running `build-exe.mjs`.** If the exe is running, SEA injection fails with EBUSY. Stage the edit, wait for user to say "out of exe".
- **`server.mjs` and `build-exe.mjs` must stay in sync.** `build-exe.mjs` constructs the server CJS line-by-line as a string array. Every endpoint / helper added to `server.mjs` MUST be mirrored there with identical logic. Forgetting = dev works, built exe broken.
- The exe is a Node SEA wrapping `server-bundled.cjs`. Chrome auto-opens on launch (File System Access API requires Chrome).
- "Signature corruption" warning during `postject` is normal.
- EBUSY on `copyfile node.exe → ed-colony-tracker.exe` = exe still running. Always user action to close, never retry in a loop.

## State persistence — sparse PATCH / per-key merge (Option B)

- Client (Zustand persist) diffs state vs a baseline and sends **only changed top-level keys** to `PATCH /api/state`.
- Each key has a merge strategy declared in `MERGE_STRATEGIES` (`store/index.ts`): `map`, `arrayById`, `stringSet`, `numberSet`, `replace`.
- Diff payload shape per key:
  - map/arrayById: `{ __upsert: {[id]: value}, __remove: [id, ...], __idKey?: string }`
  - set: `{ __add: [...], __remove: [...] }`
  - replace: bare value
- Server's `mergeStatePatch` (in server.mjs + build-exe.mjs) applies each op against existing state.
- Unknown shape → server falls back to wholesale replace (legacy compat).
- **DO NOT regress to full-state PATCH.** Multiple tabs will clobber each other across ~20 persisted keys.
- **DO NOT reintroduce an `isWriterTab` gate.** Read-only tabs (iPad Companion, secondary browsers) SHOULD be able to edit the things they're responsible for (scoring, notes, image management). The sparse PATCH is the correct fix for cross-tab races, not a write-blocking gate.

Baseline tracking:
- `stateBaseline` captured on hydrate (`getItem`).
- Advanced after successful PATCH (`advanceBaseline`).
- Reset when SSE `state_updated` triggers `useAppStore.persist.rehydrate()`.

## commanderPosition — single source of truth

- ALL location-revealing events route through `syncCommanderPosition(source, systemName, systemAddress, coords?)` in `journalWatcher.ts`.
- Tagged with `source: 'FSDJump' | 'Location' | 'CarrierJump' | 'Docked' | 'SupercruiseExit' | 'Journal Read' | 'Server'` and `updatedAt`.
- Broadcasts `commander_position` SSE event to every connected client.
- Read-only tabs (Companion on iPad) receive SSE → mirror locally. They do NOT write commanderPosition via PATCH (their persist round-trip includes it but that's fine — sparse merge handles it).
- Companion page's top banner shows "📍 Current System · via `<Source>` · HH:MM:SS" for provenance.
- If coords are missing from the event (Docked/SupercruiseExit don't have StarPos), look them up in knownSystems by name, then by address.

## Station dossier

- Visit tracking keyed by **MarketID**, NOT stationName. Frontier reuses the same MarketID across the lifecycle: `Construction Depot → Colonisation Ship → Completed Station`. So "180 docks at Ma Gateway" includes docks when it was still `"Planetary Construction Site: Vidal Cultivations"` at marketId 4322327299.
- Stored `stationName` updates to the most recent non-ephemeral name (see `extractDockHistory` — skips names matching `$EXT_PANEL_ColonisationShip` / `Construction Site` / `Trailblazer`).
- User renames their stations. Always use the latest name from journal. Don't stick with the first.
- **`isEphemeralStation(name, type, marketId)` filters out**:
  - Fleet Carriers (`stationType === 'FleetCarrier'` OR FC-range MarketID ≥ 3700000000 when type unknown)
  - `Trailblazer *` ships (NPC colonization helpers)
  - `$EXT_PANEL_ColonisationShip; *` (temp colony ships)
  - Anything containing "Colonisation Ship" or "Construction Site" in name
- Dock welcome overlay fires on **DockingGranted** (approach), NOT Docked. Docked still increments the dossier counter silently. Without DockingGranted the welcome never fires — intentional.
- `upsertKnownStations` MUST preserve `firstDocked`, `lastDocked`, `dockedCount`, `factionHistory`, `stateHistory`, `influenceHistory` from existing entry when merging. The KB extractor doesn't populate these and would wipe them on every Docked event otherwise.
- `applyDockHistoryBackfill` trusts the JOURNAL count directly (not Math.max of existing vs journal). Journal is the authoritative source; any over-count from past bugs corrects downward.

## Fleet carrier detection

- **DO NOT use `isFleetCarrierMarketId` alone.** Player-colonized stations share the MarketID range (≥ 3700000000). Pure numeric check false-positives Ma Gateway and every other colonized station.
- Use `isFleetCarrier(stationType, marketId)`:
  1. `stationType === 'FleetCarrier'` → true
  2. `stationType` known and not FC → false (trust the type)
  3. fall back to MarketID range only when type is unknown

## Journal event names (historical bugs)

- `ColonisationBeaconDeployed` — NOT `Placed`. Old parser had wrong name; events were silently missed. Parser now handles both but journal only writes `Deployed`.
- Live watcher starts at file tail; prior events (Loadout, FSDJump, etc.) aren't replayed. For features that depend on CURRENT state (current ship, current system), read latest from full journal on watcher startup (`initWatcher` does this for Loadout/ShipyardSwap).
- `NotReadableError` is a recurring File System Access API failure mode when Chrome loses permission mid-session. Compensate with full re-scans on Sync All triggers. This goes away with server-side journal reading (see backlog).
- `Market.json` is written when the commodity market screen is OPENED (verified via web search). Watcher's 2s poll detects the mtime change. End-to-end latency from open → 2nd screen update is ~3-4 seconds.

## Market.json → carrierCargo auto-sync

- Live watcher's `pollCompanionFiles` detects Market.json mtime change.
- If marketId matches user's FC (`settings.myFleetCarrierMarketId` OR callsign-in-stationName match), extracts stock items with count>0, converts commodity names to IDs via `findCommodityByJournalName`.
- Writes via `store.setCarrierCargo(callsign, cargo)`. Persists via sparse PATCH. SSE broadcast to all clients.
- Also auto-persists a `marketSnapshot` for any non-FC / non-ephemeral station on Market.json change. Removes need for manual "Sync Market" button.

## Travel-time matrix

- `extractStationTravelTimes` in `journalReader.ts` scans all journals, pairs `Undocked`→`Docked` events, tags with active ship ID from Loadout/ShipyardSwap.
- **Only counts sourcing-relevant trips** — the dock window at the from-station must contain a `MarketBuy`, `CargoTransfer`, or `ColonisationContribution` event. Filters out mission runs, fuel stops, passenger pickups.
- Matrix key: `${fromMarketId}:${toMarketId}:${shipId}`. Strict per-ship. DO NOT pool across ships.
- Outlier filter: after collecting durations for a pair, trim anything > 2× median. AFK-away-mid-trip outliers are discarded.
- Stored in `stationTravelTimes` (map strategy in MERGE_STRATEGIES).
- `currentShip` populated by watcher on startup (backward scan for latest Loadout/ShipyardSwap in current journal file) AND by Sync All (full journal scan returns latestShip).
- Sources page lookup: `fromMarketId` = MOST RECENTLY docked station in current system (sort knownStations by `lastDocked` desc, pick first). NOT `find()`-first which returns oldest stale construction sites.

## Diagnostics — server terminal, not DevTools

- User can't practically open DevTools while playing. For runtime diagnostics, POST to `/api/log` with `{tag, message}`. Server echoes to the exe terminal.
- Remove diagnostic logs after they've served their purpose. Don't leave them in hot paths (e.g. `[RecordDock]` per-dock logs were removed; only warnings on real failures stay).

## Overlay positions

Layout constants in `overlayService.ts` (don't overlap):
- `Y_SCORE=40`, `Y_MARKET=80`, `Y_SCAN=120`, `Y_IMAGE=160`, `Y_DISTANCE=200`, `Y_DOCK=240`, `Y_THREAT=280`.
- Multi-line messages need consistent line spacing. Previous bug: `sendContentToOverlay` had only 4 hardcoded Y slots; line 5+ stacked on line 4 → garbled text ("SWATEER 2T2T31T"). Fix: uniform 40px line height up to 10 lines with deterministic IDs, unused slots cleared with blank TTL=1.

## NPC threat detection

- `ReceiveText` events where `Channel === 'npc'` are checked against:
  - `/^\$Pirate_/i` → isPirate
  - `/^\$InterdictorNPC_/i` or `/^\$NPC_.*Interdict/i` → isInterdictor
  - `/^\$.*_OnStartScanCargo|_Stop_|_Attack_/i` → isDemand
- Match → fires in-game overlay alert at `Y_THREAT` (10s TTL) AND Companion red banner (15s auto-dismiss).
- Message example: `$Pirate_OnDeclarePiracyAttack04;` ("I'm gonna boil you up!") matches.

## UI scaffolding quirks

- **Gallery store is SEPARATE from main zustand store.** Its own persist adapter against `/api/gallery` (not `/api/state`). Image deletes go through `DELETE /api/gallery/:filename`, don't touch colony-data.json.
- **Zustand partialize** is the source of truth for what gets persisted. Adding a new state key → add to partialize AND declare merge strategy in `MERGE_STRATEGIES`. Without the strategy declaration, falls back to `replace` — usually fine but loses per-key granularity.
- **System View page** actively follows `commanderPosition` when no `?system=X` URL param. URL-pinned view stays on the specified system regardless of actual position.
- **Dashboard Sync All** is the one place that does a full journal history scan. Extracts: dock history, travel-time matrix + latestShip, exploration data, knowledge base, body visits, fleet carriers.

## User interaction protocol

- **Shorthand: "out of exe" / "out" / "closed"** → build now, no ack required.
- **"approve" / "go" / "do it"** → execute the most recently proposed plan.
- **Single letters/numbers** → selecting from a numbered list you just gave.
- **NO time estimates. EVER.** Scope in files + logic changes.
- **NO apologies, no padding.** Failure → acknowledge + propose fix.
- **When user says "fix it right"** — root cause, not band-aid. Resist the instinct to add a guard, filter, or display-layer fix when the source is broken.
- **User's evidence (logs, screenshots, `colony-data.json`) is authoritative.** If your mental model disagrees, your mental model is wrong.
- **Don't speculate.** Read the code, grep for the pattern, open the data file. Then speak.
- **Verify built bundle contains your change** (`grep dist/assets/*.js` for unique string) when user reports "didn't work" — Chrome bundle caching is a recurring failure mode.

## Git discipline

- **Don't push internal dev notes / plans / handoffs to the public GitHub.** Product documentation (README, FAQ source, PROJECT-HANDOFF.md, CLAUDE.md) is acceptable.
- Handoff docs belong in the user's memory folder: `C:\Users\Michael\.claude\projects\J--Git-Custom-App-Project\memory\`.
- Sensitive files (backups/, app-icon.ico, personal screenshots) must stay in `.gitignore`.
- User previously had to force-push history to scrub committed dev artifacts. Don't repeat.

## Conventions you will forget

- **Spelling:** Frontier uses **British** "colonisation" in event names (`ColonisationConstructionDepot`). Not "colonization".
- **Token auth:** `?token=...` from `colony-token.txt`. Every network client passes it via session storage.
- **`settings.myFleetCarrier`** is callsign (XXX-XXX). **`settings.myFleetCarrierMarketId`** is the numeric id. Either is a valid "is this my FC" test; check both for robustness.
- **`MERGE_STRATEGIES` must stay in sync with `partialize`.** Adding a persisted key without declaring strategy falls silently to `replace`.
- **Use `isEphemeralStation` EVERYWHERE** that filters stations for "places I visit" meaning: dossier, travel-time matrix, most-visited stats, welcome overlay, Sources Browse panel, rank calculation.
- **Ship IDs are numeric** from journal (e.g. Panther Clipper user's `shipId=31`). `ShipType` is the string type name (`panthermkii`). Track both.
- **Chrome FSA permission can disappear mid-session.** Features that rely on it must tolerate it going away.
- **iPad/Safari doesn't support File System Access API at all.** 2nd screen devices are strictly read-only for journal data until server-side port lands.

## Critical known limitations

- FC cargo sync currently requires Chrome tab on PC with journal access to stay responsive. iPad shows stale data if the PC tab stalls. This is the motivating problem for the server-side journal reader port (see `HANDOFF_server_side_journal_reader.md` in memory).
- Travel-time matrix won't have entries for ship+station pairs the user hasn't flown in that ship. Column shows em-dash. Acceptable — shows coverage transparently.
- When user swaps ships mid-hauling, their historical trips for the previous ship stay under the previous ShipID. Feature correctly segments by current ship. Don't pool.
