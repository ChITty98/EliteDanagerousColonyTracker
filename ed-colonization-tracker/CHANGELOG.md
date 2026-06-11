# Changelog

All notable changes to ED Colony Tracker.

## [1.10.0] — 2026-06-11

### Fixed
- **"In Spansh" no longer means "fully scanned."** The app was marking *every* Spansh-scored system `fssAllBodiesFound: true` and ignoring the dump's true body count — so a system with only 3 of 13 bodies recorded (e.g. Col 173 AX-J d9-53) scored on those 3 and read as "known," when the gems could be in the 10 unrecorded bodies. The Spansh dump's real `bodyCount` is now captured (`totalBodyCount`), `fssAllBodiesFound` reflects records-vs-total, and scoring on a partial scan is treated as provisional.

### Added
- **Scan-completeness flags.** The **target alert** shows `⚠ Spansh partial: 3 of 13 bodies — score provisional` (amber) instead of a green "In Spansh," fetching the dump so it works for any targeted system. The **Expansion list** shows a matching `⚠ Partial scan: N of M bodies` banner so a provisional low score isn't silently dismissed. New `src/lib/scanCompleteness.ts` (+ tests) derives records-vs-true-total from a scouted record.
- `SpanshDumpSystem.bodyCount` added to the type; scoring paths (client `overlayService` + server `overlay.js`) and the `target_selected` event carry the true total + scanned count.

---

## [1.9.0] — 2026-06-11

### Added
- **Target alert now shows name-derived odds.** Below the colonization verdict, the banner reports — for the targeted system's (mass code × primary class) signature, measured across ~1.4M systems — the chance of a non-icy **interesting atmosphere** body, of a **ringed brown dwarf**, and of an **oxygen** world (as a multiple of the galaxy baseline). This is the honest "extrapolate value from the name" model: the signature *tilts* the odds (a code-d F/G/A system runs ~13–17% interesting-body, ~5% ringed-BD, ~2× baseline oxygen), but the rare jackpots stay a confirm-on-arrival roll — the name can't call them.
  - The baked lookup (`tools/analyze-masscode-colonization.mjs` → `src/data/massCodeColonization.ts`) now carries `pInteresting` / `pRingedBD` / `pOxygen` per bucket plus a `COLONIZATION_BASELINE`; `colonizationOutlook()` surfaces them with an oxygen lift-vs-baseline.

---

## [1.8.1] — 2026-06-11

### Fixed
- **Epic-view ring-edge detection now recognizes ringed brown dwarfs / stars as valid parents, not just planets.** A landable moon skimming the ring edge of a ringed brown dwarf — e.g. Col 173 AX-J d9-52's oxygen world `2a`, which orbits ~8,500 km outside the outer ring of its ringed Y brown-dwarf parent — now flags as epic. (Confirmed via the commander's own journal: ED tags body 2 `StarType=Y`, a brown-dwarf *star*, so the prior planet-only check missed it.)
- **Big-sky apparent-size now handles star/brown-dwarf parents**, deriving the parent radius from `solarRadius` when the km `radius` field is absent (Spansh stores star radius in solar radii, which is why brown-dwarf radius was dropping out).

---

## [1.8.0] — 2026-06-10

### Added
- **Epic-view flag on scouted systems.** A ✨ violet callout in the Expansion list marks systems with spectacular *surface geometry* — independent of the colonization score, and unrelated to first footfall. `detectEpicView()` (in the canonical scorer) flags three things, computed from the body data at scoring time:
  - **Tight binary** — two non-brown-dwarf stars ≤ 0.1 AU apart (a real double sun).
  - **Big-sky parent** — a landable moon whose parent subtends ≥ 20° overhead (artifact-guarded against the impossible "moon inside parent" geometry).
  - **Ring-edge moon** — a landable moon of a ringed parent, so the rings sprawl across the sky.
  - The callout lists *why* (e.g. "tight binary 0.026 AU · parent fills 25° of sky · ring-edge moon"). Stored as `score.epicView {isEpic, reasons[]}` alongside the existing flags. **Existing scouted systems light up after a Rescore All.** This supersedes the parked close-binary +10 scoring idea (it's a flag, not points — the colonization score stays about colonization).

### Changed
- `journalBodiesToSpanshFormat` now carries `radius` + `semiMajorAxis` (converting journal metres to the scorer's Spansh units) so epic-view detection works for journal-scored systems, not just Spansh ones.

---

## [1.7.0] — 2026-06-10

### Added
- **Companion target alert now reads the system from its name.** When you target a system (FSDTarget), the banner shows the primary star's friendly name (e.g. "Red Dwarf (M)"), the **mass code** (the a–h letter in the procedural name — a total-system-mass proxy), and a **colonization outlook** — *worthwhile / decent / marginal / skip* — with expected body count and interesting-atmosphere count. Crucially this works for systems **not in Spansh** (the pool you target when hunting unscanned systems): the estimate comes from the name's mass code plus the FSDTarget primary class via a baked lookup, not a Spansh query.
  - Backed by analysis of ~1.4M Spansh systems (`tools/analyze-masscode-colonization.mjs` → `src/data/massCodeColonization.ts`): body count, landables, and non-icy atmospheres all climb mass code a→d, peak at d, and fall at e (hot massive primaries). Sweet spot = **code c–d with an F/G/K/A primary**; a brown-dwarf primary at code a is a likely lone iceball ("skip").
- **`starCount`** added to the canonical score breakdown (`scoreSystem`) — the "multiple stars" count, shown in the alert for systems you've already scored. Covered by `tests/scorer.test.mjs`.

---

## [1.6.1] — 2026-06-09

### Fixed
- **TypeScript checking was silently broken project-wide.** `startSession`/`stopSession` referenced `useAppStore.getState()` inside the store's own initializer (TS7022), which collapsed every store selector to `any` — `tsc -b` had been failing with 655 errors while `build:exe` (which skips tsc) kept shipping. Root cause fixed (the creator now uses its own `get()` parameter), plus ~47 latent errors the `any` blanket hid. Two were real runtime bugs: the `Market.json` reader checked `item.Stock` (always undefined — zero-stock items were treated as purchasable) and the Chain Planner read `kb.name` (not a `KnownSystem` field) instead of `kb.systemName`.
- `hasOxygenAtmosphere` flag is now consistent with the oxygen bonus: icy oxygen bodies no longer set it.
- Dead code removed: `scanForTimeline` (referenced identifiers that don't exist — would have crashed if ever called), the unmounted Settings `NetworkAccessSection`, and assorted unused locals. The parked browser journal-polling pipeline (`initWatcher`/`pollJournal`) is kept intentionally as the documented server-watcher rollback path.

### Changed
- **Scorer single-sourced.** `server/journal/scorer.js` is now the canonical implementation; `src/lib/scoutingScorer.ts` is a typed re-export shim (`scorer.d.ts` carries the types) and the region tools import the shared atmosphere table / decay tiers / icy set instead of carrying private copies. Scoring changes are now made once, not three times.
- `tools/rescore-regions.mjs` matches the canonical body filter exactly (bodies with missing mass data are excluded, as the app does — previously they were counted), subtracts prior exotic points for true idempotency, and refuses to replace a region file that shrinks >30% on rewrite.
- `tools/colonize-rank.mjs`: anchor resolution is case-insensitive (Spansh names are mixed-case — `c1-3` vs the in-game `C1-3`), the Void Cross flag is wired into the output (was computed but never displayed), and the icy filter uses the canonical set.
- **Version single-sourced from package.json.** The sidebar footer (`__APP_VERSION__` via Vite define) and the server banner (esbuild define in `build-exe.mjs`) both derive from it — `build-exe.mjs` was injecting a hardcoded `v1.2.0`.

### Added
- **Test suite (vitest, `npm test`)**: scorer fixtures (caps, icy exclusions, decay tiers, exotic-atmosphere ladder, body filters, exact body-string output, shim identity), a `MERGE_STRATEGIES`↔`partialize` symmetry check (guards the recurring cross-tab clobber bug class), and a server↔client commodity-dictionary parity check.

---

## [1.6.0] — 2026-06-08

### Changed
- **Colonization scoring now rewards rare non-icy atmospheres.** New "Exotic Atmosphere" component on the scout score for landable bodies carrying scarce atmospheres on rocky/HMC (non-icy) surfaces: Neon / Silicate Vapour +25, Argon-rich +12, Water / Methane-rich +8, Methane / Argon +4 per body. Distance decay applies (full ≤4,000 ls, tapering beyond); icy bodies score nothing here. Capped at 50.
- **Oxygen bonus reworked to non-icy only and bumped.** Was +10 first / +5 each, counting icy oxygen too (cap 20). Now +15 per oxygen atmosphere on non-icy bodies, distance-decayed, cap 45. Since ~71% of oxygen landables sit on icy surfaces, icy-oxygen worlds no longer earn the oxygen bonus — the score now tracks the rocky/HMC oxygen worlds you can actually build on.
- Theoretical max score moves ~160 → ~230. Change mirrored across the client scorer (`src/lib/scoutingScorer.ts`) and the indexer scorer (`server/journal/scorer.js`).

### Updated
- FAQ scoring table documents the new Exotic Atmosphere row and the non-icy oxygen rework.
- Galaxy Wiki atmosphere-rarity section notes the scout-score bonus tiers, and its counts were recomputed for the merged Col 173 (700 ly) + Praea Euq (500 ly) dataset (415,267 landable-atmo bodies, up from 390,103).
- New tool `tools/rescore-regions.mjs` re-applies the bonus to existing region indexes without a full galaxy re-extraction.

---

## [1.5.1] — 2026-05-05

### Fixed
- **Live journal watcher was clobbering user-set body / bodyType / stationType.** v1.4.4 patched the sync-all path's `Object.assign({}, prior, st)` clobber, but missed the *exact same bug pattern* in `server/journal/processors.js` `processKBEvents` (line 304) — the live event handler that fires on every Docked / Location / FSDJump / FSS / Touchdown / SupercruiseEntry. Even when the user wasn't docking at the affected station, ambient journal events triggered the kb extractor and Object.assign overwrote the user's manual settings with `undefined` from the journal extract. Now mirrors the v1.4.4 sync-all preservation: `body`, `bodyType`, `stationType` from prior always win when set.
- **Client `upsertKnownStation` / `upsertKnownStations` were dropping `bodyType`.** The spread pattern `{...station, body, stationType}` preserved body and stationType but let `station.bodyType` (often undefined from the kb extractor) clobber prior. Added bodyType to the explicit preservation list.
- **`populationOverrides` and `stationDistOverrides` were vulnerable to cross-tab clobber.** Both are user-authored maps but were not in `MERGE_STRATEGIES` (defaulted to `replace` strategy → cross-tab race could wipe entire map) and not in `APPEND_ONLY_KEYS` (no protection against stale `__remove` ops). Now both are `kind: 'map'` (sparse merge) and append-only protected — same family as `stationBodyOverrides` was hardened in v1.4.4.
- **SSE bus never recovered when EventSource entered CLOSED state.** Browser auto-reconnect runs while readyState=CONNECTING, but if the connection dies hard (auth failure, server gone for too long, certain network conditions) readyState transitions to CLOSED and the browser stops retrying. The bus had no detection or recovery — page sat there with a dead handle showing stale data forever (events not arriving after FSDJump etc.). `onerror` now checks `readyState === EventSource.CLOSED`, tears down the dead handle, and schedules `ensureOpen()` 3s later. Self-heals once the server is reachable again.
- **CompanionPage "Disconnected" badge stuck `false` even when SSE was healthy.** Initial state was `useState(false)` and only flipped true on receiving an `__open` event. If the bus already opened before CompanionPage mounted (because the store's state-sync listener subscribed first and triggered `ensureOpen`), the `__open` event already fired and was missed. Badge seeded from `sseBusStatus().connected` on mount.

### Recovery
- One-shot recovery script `scripts/recover-body-types.mjs` — restored 24 body assignments and 19 refined station types from the April 15 backup that had been silently wiped by the live-path clobber pattern over the preceding weeks. Pre-recovery snapshot saved alongside the data file.

---

## [1.5.0] — 2026-05-04

### Added
- **Materials tab (new feature)** — full ship-engineering materials inventory + trade planner + engineering capacity calculator. ED doesn't write a live snapshot file for ship materials (Raw / Manufactured / Encoded), so state is derived server-side from journal events: latest `Materials` snapshot + forward-applied `MaterialCollected` / `MaterialDiscarded` / `EngineerCraft` / `Synthesis` / `TechnologyBroker` / `MaterialTrade` / `MissionCompleted` / `EngineerContribution` / `ScientificResearch` deltas. Sync All populates the inventory; live deltas update via the journal watcher and broadcast `materials_updated` SSE.
  - **Inventory tab**: per-category sections (Raw / Manufactured / Encoded), grouped by trader line, with grade × cap progress bars and ★ for capped materials.
  - **Trade Planner tab**: pick a target material → ranked sources (within-line first using the standard 1:6 up / 3:1 down ladder, cross-line below using the wiki's "Conversion to another category" table, 6× penalty per grade). Shows total yield given current stock.
  - **Engineering Capacity tab**: pick a blueprint, set ships / G5 rolls per ship / unlock rolls per stage. Shows max rolls per grade with bottleneck material highlighted, plus full material budget vs current stock with red gaps for shortages.
  - Initial blueprint catalog: **Dirty Drive Tuning** (Thrusters, +speed) and **Increased Range FSD** (FSD, +jump distance). Recipes flagged `verified: false` until spot-checked in-game.
- New module `server/journal/materials.js` with `extractMaterialInventory(journalDir)` (one-shot scan) and `applyMaterialDeltaEvent(ev, inventory)` (live patch).
- New data file `src/data/engineeringMaterials.ts` — 109-material universe with line, grade, cap, plus the `CROSS_LINE_TRADE` lookup table and `tradeYieldPerSource()` helper.
- New data file `src/data/blueprints.ts` — extensible blueprint catalog with `computeGradeCapacity()` for inventory-aware roll planning.
- `materialInventory` added to `MERGE_STRATEGIES` (replace), `partialize`, and `APPEND_ONLY_KEYS` — server is sole writer, snapshots are complete, hard to re-acquire.

---

## [1.4.4] — 2026-05-04

### Fixed
- **Manual station body settings wiped by Sync All** — user-set bodies on installations (via Set Body in System Detail) were being silently lost on every Sync All. Root cause: server-side `knownStations` merge in `server.mjs` did `Object.assign({}, prior, st)` where `st` is the freshly-extracted journal station record. Per JS spec, `Object.assign` with an explicitly-`undefined` property still overwrites — so when the journal Docked event for a station didn't carry a `Body` field, the user's manual body was wiped. Server merge is now symmetric with the client-side merge logic: user-set `body` and `bodyType` always win across journal sync. (If the journal ever has *better* body info, clear your setting and re-sync to pick it up.) Also: `stationBodyOverrides` (the fallback storage for stations without marketIds) is now in `MERGE_STRATEGIES` as a `map` (sparse merge instead of `replace`) and in `APPEND_ONLY_KEYS` (protect from stale `__remove` ops) — same hardening as `bodyNotes` and other user-authored fields.
- **Journal History merged renamed stations into one entry** — when a station got renamed in-game (e.g. Rao Refinery → Kalian Port — same `MarketID`, new name), the lifetime stats page was showing two separate entries with split dock counts. `scanJournalHistory` now keys station tracking by `MarketID` instead of `${system}:${stationName}`, picks the most-recent name as the display name, and shows previous names in the sub-line as `· formerly Rao Refinery`. Pre-Odyssey Docked events without a MarketID are skipped from the new keying (acceptable — they were rare and ambiguous anyway).

---

## [1.4.3] — 2026-05-03

### Fixed
- **Show Needs panel listed a commodity that wasn't in the project** — Companion page's Show Needs displayed `Need: Titanium 157 | Agri-Medicines 115` for an Orbital Construction Site project, but Agri-Medicines was nowhere in the project detail's commodity table. Root cause: `Agri-Medicines` was missing from both the client (`src/data/commodities.ts`) and server (`server/journal/commodities.js`) commodity dictionaries. The detail page filters commodities by category-match against the dict and silently hides anything unmatched, so it disappeared from the UI. `computeNeedsContent` iterates `project.commodities` directly with no dict lookup, so it correctly showed the still-needed quantity. Show Needs was right; the detail page was the liar. Added `agrimedicines` to both dicts as a `medium` commodity (consumer/medical item, observed in the wild at ~hundreds of tons per build slot).

---

## [1.4.2] — 2026-05-03

### Fixed
- **Settings page crash for new users** — `(settings.squadronCarrierCallsigns ?? []).join(', ')`. Brand-new users whose persisted state landed with partial settings (no `squadronCarrierCallsigns` key) were getting `Cannot read properties of undefined (reading 'join')`. Defensive fallback at the usage site.

### Changed
- **SSE pipeline consolidation** — both the store's `state_updated` listener and the Companion page's event listener now share a single `EventSource('/api/events')` via the new `src/services/sseBus.ts` pub/sub module. Previously each opened its own connection, with the store's gated behind `checkServerStorage()` + a 1-second `setTimeout` that occasionally failed to start on iPad — leading to the "target alerts work but project tallies don't auto-update" asymmetry. With one shared connection, both pipelines either both work or both fail, and a synthetic `__open` event triggers a forced state rehydrate after every (re)connect to catch up missed events transparently.

---

## [1.4.1] — 2026-04-27

### Added
- **README** — War & Peace section with Scout button workflow.
- **FAQ** — new "War & Peace" category (4 entries: tab purpose, data freshness, Scout button workflow, multi-conflict CZ list reconciliation).
- **FAQ — Projects & Data** — entry on the Sources page economy filter (chips below search box, cross-referencing knownStations dossier).
- **FAQ — Projects & Data** — entry on travel times (last-10-trip trimmed average, fallback chain via FC / via last dock).
- **FAQ — Fleet Carrier** — entry on the visibility-requires-sell-order rule, plus the high-price (999,999,999 cr) trick to make commodities visible to the project tracker without risking other commanders buying them on a public-access FC.
- **FAQ — Station Dossier** — dock-info banner additions (economy line, noteworthy services with Material Trader Raw/Manufactured/Encoded heuristic, "Established by you on …" line for stations completed via colonization projects).

---

## [1.4.0] — 2026-04-27

### Added
- **War & Peace tab** (new feature) — find systems in conflict (War / Civil War / Election) within radius of a reference system. Filters by state, system allegiance, combatant allegiance, min population. Server proxies Spansh's systems-search API; results cached per BGS tick (Thursday 07:00 UTC). Reference defaults to commander's current system.
- **Scout button** on each War & Peace row — fetches Spansh + EDSM in parallel for the system, builds a synthesized scout report (conflict pairs with allegiance tags, combat anchors with refuel/repair/rearm icons, full-service stations sorted by distance, notes when multiple simultaneous conflicts are present). Persisted in `scoutedConflicts[systemAddress]` until next BGS tick.
- **Sources page economy filter** — multi-select chip row beneath the search box. Cross-references `knownStations[].economies[]` so users can find e.g. all known Industrial surface settlements they've docked at.
- **Sources page travel time** in Browse Market Data system mode — pulls from `stationTravelTimes` keyed by current ship's shipId, with current-dock → FC → last-dock fallback chain. Format: `3:49 via FC`.
- **Dock-info banner** (overlay) — fires on Docked event, supplements the existing welcome stack with: economy line (top 1-2 economies with mixed/single indicator), noteworthy services line (Cartographics, Factors, Tech Broker, Material Trader with Raw/Manufactured/Encoded type derived from system economy heuristic, Black Market), and an "Established by you on YYYY-MM-DD" line for stations completed via colonization projects.
- **Server-side append-only guard** — `marketSnapshots`, `knownStations`, `knownSystems`, `systemAddressMap`, `bodyVisits`, `bodyNotes`, `fleetCarriers`, `fleetCarrierSpaceUsage`, `visitedMarkets`, `journalExplorationCache`, `scoutedSystems`, `stationTravelTimes`, `scoutedConflicts` are now protected from client-side `__remove` PATCH operations. Logs `[State] BLOCKED N __remove ops on append-only key 'X'` when a misbehaving tab tries to wipe data via stale-baseline diff.
- **30-second SSE watchdog** — when no SSE traffic (heartbeat or event) has been received in 45s, force a full state rehydrate. Catches silent SSE death on iOS without needing user interaction.
- **SSE reconnect → forced rehydrate** — `EventSource.onerror → wasErrored=true → next onopen runs forceStateRehydrate('sse-reconnect')` so missed events during the disconnect window are caught up immediately.
- **27 colonization commodities mirrored to server-side dictionary** (`server/journal/commodities.js`) — they were added to the client-side dict in v1.3.0 but missed on the server, causing FC market reads to store raw `$xxx_name;` IDs instead of canonical IDs.
- **Carrier-cargo backfill** — `pollCompanionFiles` walks all carrierCargo entries on each tick and rewrites broken `$xxx_name;` commodityIds to canonical form using the now-complete dictionary. Logs once per tick where corrections occurred.

### Fixed
- **`fleetCarriers` partialize bug** — was in `MERGE_STRATEGIES` but missing from `partialize`. Every Sync All triggered a `BLOCKED 9 __remove ops on fleetCarriers` because the client serialized state without fleetCarriers, then `computeStateDiff` thought baseline-but-not-current meant "remove all FCs". Now persisted.
- **Spansh `reference_system` case sensitivity** — Spansh's name search is case-insensitive but `reference_system` is case-sensitive (`aleumoxii` → 400). Server proxy now resolves to canonical case via name lookup before querying.
- **Cavallo Nero / Chiang Bastion misclassified as fleet carriers** — `isFleetCarrierMarketId` used a `marketId >= 3,700,000,000` threshold guess that false-positived every player-built station with a high marketId. Replaced with a runtime FC registry seeded from `knownStations` (10 confirmed FCs) and updated on every Docked-as-FC event. Threshold guess removed.
- **`applyStatePatch` write race** — was reading existing state from disk before merging the patch, which meant two patches landing within the 500ms write debounce stomped each other's `pendingState`. Now reads `pendingState ?? readStateFile()`. This was the cause of Cavallo Nero's 141-item snapshot getting overwritten by the inferior 2-item Sync All snapshot.
- **Cancel pending `setItem` on rehydrate** — the 300ms-debounced setItem could fire AFTER a server-initiated rehydrate, computing a diff against the new baseline using the OLD store state and emitting `__remove` for everything the rehydrate just brought down. Rehydrate now cancels any pending setItem timer.
- **Sync All currentMarket arm overwriting comprehensive snapshots** — old code had its own restrictive filter (sell-side only, dictionary-gated). Now delegates to `pollCompanionFiles` so all snapshot creation goes through one path.
- **Sources / Browse Market Data**: distance rounded (no decimals), stock displays as `309K` / `1.2M`, dropped ` cr` from prices and ` ls` from arrival distances, travel time as `3:49 via FC` on a single nowrap line, removed the cluttered `visited` tag text + checkmark (pinned still shows ⭐).
- **War & Peace radius input** — backspace works (was snapping back to 100 when cleared). Distance display rounded to integer ly. Reference field no longer auto-resets to current system after the user clears it.
- **Companion FC banner "as of Invalid Date"** — `carrierCargo` entries written by `pollCompanionFiles` were missing the `updatedAt` field. Added; CompanionPage falls back to `latestTransfer` for legacy entries.
- **Snapshot `stationType` was always empty** — `pollCompanionFiles` hardcoded `stationType: ''` even though `Market.json` carries the actual type. Now uses the real value.
- **`visitedMarkets` → `marketSnapshots` migration on Sync All** — eliminates the render-time merge fragility where a snapshot getting filtered by `isEphemeralStation` would unexpectedly fall back to the inferior journal-only data.

### Changed
- **Single source of truth at render time**: SourcesPage now reads only from `marketSnapshots`. Migration backfills journal-derived stubs on Sync All.
- **Material Trader heuristic in dock banner**: type derived from system primary economy (Industrial → Manufactured, Extraction/Refinery → Raw, High Tech/Military → Encoded). Vista Genomics dropped from noteworthy services list (too common).

---

## [1.3.2] — 2026-04-26

### Changed
- **Fleet Carrier page copy** — every label now makes it explicit that the page tracks **sell orders set in the in-game Commodities Market**, not raw FC inventory. Subtitle, count badge, empty state, and section headers (`Relevant Sell Orders` / `Other Sell Orders`) updated. Cargo physically on the carrier without an active sell order won't appear here, and the UI now says so.

### Added (diagnostics)
- **Server-side SSE logging** in `broadcastEvent` and the `/api/events` connect/disconnect handlers. Every non-heartbeat broadcast prints `[SSE] broadcast <type> source=<src> → N client(s)` to the exe terminal; connect/disconnect prints client count too. Lets us see in real time whether events are reaching iPad/PC tabs.
- **Client-side SSE echo** — store SSE listener POSTs every received event to `/api/log` so it surfaces in the exe terminal as `[StoreSSE] received <type> source=<src>`. Used for diagnosing the "FC tab not auto-updating" report.

---

## [1.3.1] — 2026-04-23

### Fixed
- **Fleet Carriers tab not auto-updating** — the page copied `carrierCargo` into local React state on mount and only repopulated it on Refresh click. Now it's derived from the zustand store via `useMemo`, so any server-side write (journal Cargo.json tick, `/api/refresh-companion-files`, docked-at-FC auto-read) propagates through SSE → store → UI with no manual tap. iPad finally behaves.
- **Projects tab not auto-updating from journal depot events** — `state_updated` SSEs from the server-side watcher were being swallowed by the 2-second `PATCH_IGNORE_WINDOW` intended for the client's own patches. Now the window is bypassed for server-initiated sources (`watcher`, `sync-all`, `refresh-companion-files`, `sync-market`).
- **Stale state served during the 500 ms debounce window** — `GET /api/state` read straight from disk while writes were pending, so SSE-triggered rehydrates on other clients could pull pre-patch data. Now returns `pendingState` when available and falls through to disk only when flushed.
- **Garbled commodity IDs from broken regex** — `resourceToCommodity` used the character class `[$;_name]` which removed literal `n`/`a`/`m`/`e` letters along with the delimiters ("Evacuation Shelter" → `vcutioshltr`). Fixed to `/^\$|_name;?$/gi` in both `server/journal/extractor.js` and `src/services/journalReader.ts`.
- **ProjectDetailPage dropping commodities with garbled stored IDs** — pre-fix data still lives in saved projects. Display now falls back to matching by display name when the stored `commodityId` isn't in the dictionary.

### Added
- **27 more colonization commodities** in `src/data/commodities.ts`: Building Fabricators, Surface Stabilisers, Structural Regulators, Robotics, Mineral Extractors, Crop Harvesters, Auto-Fabricators, Geological Equipment, Emergency Power Cells, Evacuation Shelter, Survival Equipment, Land Enrichment Systems, H.E. Suits, Combat Stabilisers, Micro Controllers, Battle Weapons, Military Grade Fabrics, Advanced Catalysers, Microbial Furnaces, Resonating Separators, Thermal Cooling Units, Basic Medicines, Bioreducing Lichen, Muon Imager, Biowaste, Grain, Pesticides.
- **Depot event diagnostics** in the exe terminal — `processDepotEvents` now prints one of `[Depot] Updated N project(s)…`, `[Depot] Skipped N: …`, or `[Depot] N depot event(s) but no projects exist — ignored` so future auto-update regressions are diagnosable without DevTools.

---

## [1.3.0] — 2026-04-22

### Fixed
- **Market.json capture:** station snapshots were silently dropped when the station sold only non-colonization commodities (e.g. Chiang Bastion's military market with Hydrogen Fuel / Scrap / Weapons) or had 0 matches after the dictionary lookup. Now captures every item Market.json lists, falls back to raw Spansh names when not in the dictionary, and always saves the snapshot so station metadata is preserved even for zero-commodity cases.

### Added
- **POST /api/sync-market** endpoint — routes through the same `pollCompanionFiles` used by the 5 s watcher, so the Sync button behavior is identical to automatic capture.
- **Sync Market button** now prefers the server endpoint, falls back to client-side File System Access API for browser-only mode.
- **In-game overlay messages** on successful saves:
  - "Market captured: {Station} — N items"
  - "FC cargo updated: {Callsign} — N items"
- **Wiki page** (`/wiki`) with reference tables for the 700 ly scouting bubble around Col 173 Sector AX-J d9-52:
  - Atmosphere rarity including vs excluding icy bodies (18 atmo types)
  - Dramatic-sky geometries (ring edge, inside rings, binary pairs, big sibling)
  - Notable individual systems (Carbon star HIP 52656, Hot Silicate Vapour landables)
  - Star & ring rarity stats + rare body type counts
- **FSSDiscoveryScan** (honk) now updates `commanderPosition` — fills the gap when you haven't jumped/docked recently.
- Market snapshots now include optional `sellPrice`, `demand`, `category` fields on the `PersistedMarketCommodity` type, enabling future "where to sell" features without another schema change.

### Changed
- Sources page filters snapshot commodities to sell-side (`stock > 0 && buyPrice > 0`) at render time, so buy-side data captured by the new storage path doesn't pollute the "find where to buy" view.

---

## [1.2.0] — 2026-04-20

### Added
- **Server-side journal reader port** — journal watcher, parser, extractors, and overlay all moved from browser File System Access API into the Node/SEA server. iPad and Surface now get full functionality hands-off; no more "only Chrome on the gaming PC can read journals" limitation.
- **Sparse PATCH persistence** — client now diffs state vs baseline and PATCHes per-key with merge strategies (map / arrayById / set / replace). Eliminates cross-tab clobber races when multiple devices edit state simultaneously.
- **Unified commanderPosition** — `syncCommanderPosition(source, name, addr, coords?)` is the sole entry point for location updates. Tagged with source + updatedAt + broadcast via SSE `commander_position` event. Companion page shows `via <Source>` badge.
- **Sync All** button on the Dashboard — no longer gated behind Chrome-only File System Access API detection.
- **Fleet Carrier refresh** button on FleetCarrierPage now works from iPad (uses server `POST /api/refresh-companion-files`).
- **Dock dossier preservation** — three-way merge (prior + kb.stations + dockHistory) prevents bare `__upsert` wipes on Location events.
- **Permanently-ephemeral station filter** — FC + Trailblazer only. Construction-site docks are now tallied against the eventual MarketID, so post-build station visit counts are correct.

### Fixed
- `commanderPosition` getting stuck on a stale system after jumping elsewhere (sync-all wasn't calling `fetchLatestPositionFromJournal`).
- FC titanium / carrier cargo not propagating from `Market.json` to `carrierCargo` during sync-all.
- Sources page showing raw commodity IDs like `insulatingmembrane` instead of display names (`COMMODITY_BY_ID[id]` bracket-access on a Map was always undefined; fixed to `.get(id)`).
- Dock welcome overlay showing wrong visit count ("2nd visit" instead of actual 208) when `processKBEvents` fired without preserving existing dossier.
- Travel time on Sources page falling back incorrectly when current station had no trip data — now falls back to Fleet Carrier, then last-docked station, with "via FC" / "via last dock" badges.
