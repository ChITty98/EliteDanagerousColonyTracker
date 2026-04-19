# ED Colony Tracker — Project Instructions

Read `PROJECT-HANDOFF.md` for architecture. This file is operating rules.

## Design philosophy — journal-first, always

**Every feature MUST work using only Elite Dangerous journal files.** Spansh (body/system data), Ardent Insight (market data), and EDMCModernOverlay (in-game overlay display) are optional enhancements — never requirements.

- If Spansh is unreachable, scoring still works from journal scan data.
- If Ardent is down, market sourcing still works from local `marketSnapshots` + journal-derived `visitedMarkets`.
- If the in-game overlay TCP socket fails, the Companion page still receives SSE events.
- The Sources page "Find Systems" search falls back to local journal data (`searchLocalJournal`) when Spansh is unavailable.
- The dock dossier, visit counts, travel-time matrix, and most-visited rankings are ALL journal-only — no network dependency.

When you add a new feature that consumes Spansh/Ardent, you MUST also wire a journal fallback or the feature violates this tenet. If the user targets a system the app can't reach Spansh for, they should still be able to see something useful from their own data.

Corollary — best-data-wins for scoring: when BOTH journal and Spansh data exist for the same system, Spansh usually wins (it's a richer multi-commander dataset). Journal wins when it has STRICTLY MORE scanned bodies than Spansh. This is a display/scoring preference, not a "throw out journal data" rule. Journal data is NEVER deleted when Spansh is preferred — it stays in `journalExplorationCache` as a fallback and a source of truth for offline use.

## Data on the user's device is their data

All persistent state lives in `colony-data.json` next to the exe. Gallery images in `colony-images/`. Never delete or replace the user's file wholesale unless they've explicitly asked. The `writeStateDebounced` size-check protection (refuse writes <30% of existing) exists for this reason — don't disable it.


## Build + exe

- **Always check `tasklist //FI "IMAGENAME eq ed-colony-tracker.exe"` before running `build-exe.mjs`.** If the exe is running, the SEA injection fails with EBUSY. Stage the edit and wait for the user to say "out of exe".
- **`server.mjs` and `build-exe.mjs` must stay in sync.** `build-exe.mjs` constructs the server CJS line-by-line as a string array. Every endpoint / helper added to `server.mjs` must be mirrored there with the same logic. Forgetting = dev works, built exe broken.
- The exe is a Node SEA wrapping `server-bundled.cjs`. Chrome auto-opens on launch (File System Access API requires Chrome).
- Signature corruption warning during build is normal.

## State persistence — sparse PATCH / per-key merge

- Client (Zustand persist) diffs state vs a baseline and sends **only changed top-level keys** to `PATCH /api/state`.
- Each key has a merge strategy declared in `MERGE_STRATEGIES` (store/index.ts): `map`, `arrayById`, `stringSet`, `numberSet`, `replace`.
- Diff payload shape: `key: { __upsert: {...}, __remove: [...], __idKey?: string, __add: [...] }`.
- Server (`mergeStatePatch` in server.mjs + build-exe.mjs) applies each op against existing state.
- **Do not regress to full-state PATCH.** Multiple tabs will clobber each other across ~20 persisted keys.
- Unknown shape in an incoming PATCH → server treats as wholesale replace (legacy fallback).

## commanderPosition — single source of truth

- ALL location-revealing events route through `syncCommanderPosition(source, name, addr, coords?)` in `journalWatcher.ts`.
- Tagged with `source: 'FSDJump' | 'Location' | 'CarrierJump' | 'Docked' | 'SupercruiseExit' | 'Journal Read' | 'Server'` and `updatedAt`.
- Broadcasts `commander_position` SSE event to every connected client.
- Read-only tabs (Companion on iPad) do NOT write commanderPosition to server directly; they receive SSE and mirror locally.
- Companion page's top banner shows "Current System · via <Source> · HH:MM:SS" so the user can see provenance.

## Station dossier

- Visit tracking keyed by **MarketID**, not stationName. Frontier reuses the same MarketID across `Construction Depot → Colonisation Ship → Completed Station` lifecycle. The stored name updates to the most recent non-ephemeral name.
- **`isEphemeralStation(name, type, marketId)` filters out**: Fleet Carriers, `Trailblazer *` ships, `$EXT_PANEL_ColonisationShip; *`, anything with "Colonisation Ship" or "Construction Site" in the name.
- Dock welcome overlay fires on **DockingGranted** (approach), NOT Docked. Docked still increments the dossier counter silently. Without DockingGranted the welcome never fires — that's intentional.
- `upsertKnownStations` must PRESERVE `firstDocked` / `lastDocked` / `dockedCount` / `factionHistory` / `stateHistory` / `influenceHistory` from existing when merging — the KB extractor doesn't populate these.

## Fleet carrier detection — watch the classifier

- **Do not use `isFleetCarrierMarketId` alone.** Player-colonized stations sit in the same `marketId >= 3700000000` range as fleet carriers. The pure-numeric check false-positives Ma Gateway and similar.
- Use `isFleetCarrier(stationType, marketId)` which first checks `stationType === 'FleetCarrier'` and falls back to MarketID only when type is unknown.
- Extends via `isEphemeralStation` for the broader filter.

## Journal event names (historical bugs to avoid)

- `ColonisationBeaconDeployed` — NOT `Placed`. Old code had the wrong name; events were silently missed.
- Live watcher starts at file tail; prior events (Loadout, FSDJump, etc.) aren't replayed. Read latest from full file on startup if a feature depends on current state.
- NotReadableError is a recurring File System Access API failure mode when Chrome loses permission mid-session. Downstream features miss events; compensate with full re-scans on Sync All triggers.

## Diagnostics — server terminal, not DevTools

- The user cannot practically open DevTools while playing. For runtime diagnostics, POST to `/api/log` with `{tag, message}`. Server echoes to exe terminal.
- Remove diagnostic logs after they've served their purpose. Don't leave them in hot paths.

## Overlay positions

`src/services/overlayService.ts` layout constants (don't overlap these):
- Y_SCORE=40, Y_MARKET=80, Y_SCAN=120, Y_IMAGE=160, Y_DISTANCE=200, Y_DOCK=240, Y_THREAT=280.
- Multi-line messages need consistent line spacing (see `sendContentToOverlay`). Previous bug: only 4 hardcoded Y slots, line 5+ stacked on line 4 → garbled text.

## UI scaffolding quirks

- **Sparse per-key merge won't save read-only tab edits if the tab's baseline is stale.** That's acceptable: last-write-wins at individual-record granularity, not full-state.
- **Zustand partialize** is the source of truth for what gets persisted. Adding a new state key → add to partialize AND declare merge strategy.
- Gallery store is SEPARATE from the main zustand store. It has its own persist adapter against `/api/gallery`, not `/api/state`.

## User interaction protocol

- User's shorthand: "out of exe" / "out" / "closed" → build now, no ack required.
- User rejects apologies. Acknowledge failure + propose fix only. Don't pad.
- No time estimates. Ever. Scope in files + logic.
- When user says "fix it right" — they want root cause, not a patch on top of a patch. Resist the urge to add a guard, filter, or display-layer fix when the source is actually broken.
- User's evidence (logs, screenshots, data from colony-data.json) is authoritative. If your mental model disagrees, your mental model is wrong.

## Conventions you will forget

- Spelling: Frontier uses **British** "colonisation" in event names (`ColonisationConstructionDepot`). Not "colonization".
- Token auth: `?token=...` from `colony-token.txt`. Every network client passes it via session storage.
- `settings.myFleetCarrier` is callsign. `settings.myFleetCarrierMarketId` is the numeric id. Both can exist; either is a valid "is this my FC" test.
- `MERGE_STRATEGIES` in `store/index.ts` must be kept in sync with `partialize`. If you persist a new key without declaring its merge strategy, it silently falls to `replace` — which is usually fine but loses per-key granularity.
