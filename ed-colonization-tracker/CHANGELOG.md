# Changelog

All notable changes to ED Colony Architect (named ED Colony Tracker through v1.33.0).

## [1.43.0] — 2026-08-11

### Added
- **`Tubus?` hints at FSS time** — the only genus with a profile calibrated from the commander's own ledger (Rocky · CO₂ · 0.05–0.15 g · 160–190 K · no volcanism; three confirmed sites, edge-validated by the 156 K family and a 0.17 g near-miss). Shows on bio rows the moment the body resolves, before any probe is spent; explicitly an estimate — the DSS genus list replaces it. Dry-run: fires on all four moons of the confirmed Tubus system, stays silent on five of six too-cold siblings, and honestly flags the one borderline 160 K body.
- **Concha joins the 💰 set** (five genera: Tubus, Aleoida, Stratum, Cactoida, Concha) — Renibus ~4.5M base sold that night, Biconcavis jackpot-class. Tussock deliberately unhinted and unflagged: 1M filler that co-resides with Tubus anyway.

## [1.42.0] — 2026-08-11

### Added
- **Genus-aware bio targets.** DSS-mapping a bio body reveals its actual genus list (SAASignalsFound — fact, not prediction), and the checklist now shows it: `💰 6 e · Tubus/Tussock · bio 0/3`. High-value genera get the 💰 flag and sort to the TOP of the card, ahead of distance — judged on BASE species values from the calibrated model (Tubus 7.8–11.9M, Aleoida 3.4–12.9M, Stratum to 19M, Cactoida to 16.2M); **first-logged ×5 is treated as upside, never assumed**. Genera you've already begun scanning seed from the organics ledger without a fresh DSS.

## [1.41.1] — 2026-08-11

### Added
- **Exobio progress on bio targets** ("i may forget how many remain"): bio rows show `bio 2/3` — species analysed vs signals present — fed live by ScanOrganic Analyse events and seeded from the organics ledger, so species done on EARLIER visits still count. A bio body auto-checks when every signal is analysed. Bio listing threshold lowered to ≥2 signals.

### Fixed
- **Checklist now works in systems you've already FSS'd, and after mid-session relaunches.** It only learned your location from a live FSDJump — boot the app while already in a system and it never knew where you were; and the game never re-emits Scan events for resolved bodies ("I can't do it again"), so an explored system stayed blank. The checklist now seeds from your last known position at server start and PRELOADS the system's bodies from the exploration cache — including epic criteria from the stored score. Location events (relog) seed the same way. Verified against the live case: UN-T d3-895 seeds honk + 32 scans + 6 targets incl. the 24° twin pair. One honest limit: bodies you DSS'd on a PREVIOUS visit show unchecked (that visit's events aren't in the cache) — tap to skip them.

## [1.41.0] — 2026-08-11

### Added
- **🧭 Exploration checklist** — a self-checking card on the 2nd Screen for the current system. Targets build themselves as scans resolve: map-worthy bodies (★★★ ELW/water/ammonia, ★★ terraformables), landables with ≥3 bio signals, and ✨ epic-view bodies once the system scores. Rows tick automatically from the journal — DSS completion checks map targets, flying to the body (ApproachBody) checks epic ones; header shows honk / FSS n-of-N / all-found. Tap a row to mark it skipped. Resets on jump; hidden until the system has something to say.
- **40k Ls travel rule** ("unless it's super valuable, I don't want to go out beyond 40k Ls"): ★★ and bio targets beyond 40,000 Ls are dropped with an honest "N far targets skipped" line; ★★★ and epic bodies are always listed, amber-flagged ⚠ with the distance shown — a far first-discovery water world is your call, not silently hidden.

### Notes
- Per-visit and in-memory: a server restart mid-system forgets skips (never scans — those re-accumulate from the journal). Bio targets appear as bodies resolve, not at the honk.

## [1.40.1] — 2026-08-11

### Fixed
- **Hi-res screenshots no longer balloon the gallery.** ALT+F10 captures run ~500 MB each; the auto-attach copied them faithfully (one session quietly added 1.5 GB). Shots over 100 MB are now skipped with a visible note in the console and the 2nd-screen feed — the original stays in Pictures for manual attach. Plain F10 (~32 MB) attaches as before.

## [1.40.0] — 2026-08-11

### Added
- **Delete photos from the wall.** The lightbox gains 🗑️ Delete photo (with confirm) — removes the image from the gallery and, if it was the last one, clears the card back to "no photo yet". Fixes duplicates from double-uploads.

### Changed
- **2nd Screen decluttered — running alerts are never below the fold.** The Live Feed now sits in its own right-hand column on wide screens (iPad landscape), pinned and full-height; on narrow screens it renders directly under the status banners in a capped scroll box, ABOVE the buttons. The 📸 Record card collapses to a single row (tap to open, auto-collapses after save, ✓-line stays visible in the strip) and its recent-sightings list is gone — the Sights wall owns browsing, linked via "wall ↗". The FC free-cargo panel collapses to a one-line strip (🚚 callsign · colored tonnage), tap to expand, remembered per device — your iPad can stay minimized for a whole tour while the PC stays expanded.

## [1.39.0] — 2026-08-11

### Fixed
- **Journal-scanned systems were invisible to radius searches.** The live scoring path wrote every journal-scored system with null coordinates (the entire UN-T campaign — 32 systems — could not be measured against any "within N ly" search, so Expansion merges reported "+1 from your journal" where dozens existed). Coordinates now come from the commander's jump position at scan time, and a one-time backfill repaired 49 cache + 281 scouted entries from jump history.

### Added
- **Edit sights from the wall.** Each card gains ✏️ Edit: toggle tag chips (same shared list as the record card), rewrite or clear the note, Save/Cancel — plus 🗑️ Delete with a confirm. Deleting a sighting never touches photos: they belong to the location's gallery and stay there. Edits and deletes go through dedicated endpoints (sightings stays append-only against state PATCHes, so stale tabs still can't wipe it) and broadcast live to every open screen.

## [1.38.1] — 2026-08-11

### Fixed
- **All of a sight's photos are reachable now.** Cards with more than one photo show a thumbnail strip under the cover, and the lightbox pages through every photo with ‹ › and a counter — previously only the newest photo was viewable even when the card said 📷 2.

## [1.38.0] — 2026-08-11

### Added
- **Add photos to any sight, any time.** Every card on the Sights wall gains an Add-photo button (multi-select), uploading into that sighting's gallery key from whatever device you're on. The 2nd-screen card's Add-photo now takes multiple files too. Both run through one shared upload helper so they can't behave differently.

## [1.37.1] — 2026-08-11

### Added
- **🗽 Landmark** sighting tag — for famous in-game places (Jaques Station, megaships, tourist beacons). Station sights record at system level and F10 shots attach the same as anywhere else.

## [1.37.0] — 2026-08-11

### Added
- **📸 Sights page** — the postcard wall. Every recorded sighting as a card, newest first: photo (F10 auto-attached or device-uploaded, click for full size), body + system, tag chips, your note, links to the system page and System View. Filter by tag — "show me every Brain Trees sight" is one click. Reads the same data as the 2nd-screen card and the per-system galleries, so all three always agree. Nav entry between System View and Projects.

### Fixed
- The "✓ Recorded" line on the 2nd-screen card now updates live when an F10 shot attaches seconds after Save (it previously showed the stale count from the moment of the button press — verified against the first real F10 attach, which landed 8 seconds after the sighting and was invisible on the card).
- F10 attach window tightened to ±3 minutes (was 10) — the real flow is Record and F10 within seconds of each other; a long window let unrelated same-system shots glom on.

## [1.36.0] — 2026-08-11

### Added
- **Sightings — the postcard button.** A "📸 Record this spot" card on the 2nd Screen: one tap records where you are RIGHT NOW (system + body snapshotted server-side from the journal — the iPad needs to know nothing), with quick tag chips drawn from the field-tested taste model: ✨ Close bodies · 💍 Rings · 🏜️ Terrain · 🌈 Pretty sky · 🧬 Life · 🌳 Brain Trees · 🌋 Geology · 🏠 Home candidate · ⭐ Just cool, plus an optional note. Works for ANY system, colonized or not. Recent sightings list on the same card.
- **F10 auto-attach.** The in-game screenshot key (F10 — not Steam F12, which leaves no journal trace) writes a Screenshot journal event carrying the filename, system and body. The app now catches it live, copies the shot into the gallery, and attaches it to a matching sighting from the same system within ±3 minutes — in either order (Record then F10, or F10 then Record). BMPs are stored as-is (browsers render them; ~10–30 MB each, so the gallery grows faster if used heavily). Non-default screenshot folders are logged, not guessed.
- **Photos land in the normal gallery keys** (system:x / system:x:body:y), so sighting shots also appear on that system's detail page automatically. An Add-photo button on the card uploads from the 2nd-screen device itself (iOS camera/library) into the same key.
- New `sightings` state key (append-only protected), `GET/POST /api/sightings`, `sighting_recorded` / `screenshot_saved` SSE events with feed icons + summaries, and BMP serving support.

## [1.35.0] — 2026-08-10

### Added
- **"Map this" callouts** — the app now tells you when a body is worth spending probes on, for CREDITS (a separate question from colony value, which is what the score measures). Fires on the in-game overlay and in the 2nd Screen feed the moment the body is scanned. Two tiers: ★★★ for Earth-like, water and ammonia worlds — rare and worth several times an ordinary body, so they always pop; ★★ (quieter, shorter dwell) for anything else with a terraform state, mostly terraformable HMC, which is the biggest multiplier available on an otherwise plain rock. Everything else stays silent. Each callout states what it found and whether it is a **first discovery** or **already mapped** (the latter kills the first-mapper bonus and may change your mind). Toggle in Settings → In-Game Overlay.
- Measured against 1,644 real planet scans before shipping: ★★★ fires on 2.4%, ★★ on 4.0% — median 2 callouts per system that has any, worst case 8.

### Notes
- The callouts deliberately report QUALITIES, not credit figures. The real payout follows roughly `k + mass * k / 66.25` with a per-class `k`, and those per-class constants are not verified here — so any number the app printed would be invented. Terraformable was previously treated as noise because it is irrelevant to colonization value; for credits it is the single biggest multiplier, which is why it earns its own tier.

## [1.34.0] — 2026-08-10

### Removed
- **The v1.33.0 data migration and self-update swap are withdrawn.** Data stays beside the .exe, exactly as it always has. A review found defects severe enough that the feature could not ship: the migration treated any folder containing the auto-generated `colony-token.txt` as a completed install, so a single launch from the wrong directory would permanently and silently convince the app it had already migrated — orphaning the real 27 MB of history forever. It also could not distinguish an interrupted copy from a finished one (no atomic rename, no completion sentinel), and the 30%-shrink guard that normally protects the state file compared against the truncated copy. Separately, a commander who placed the new .exe anywhere other than their existing folder would get a silently empty app — precisely the failure the feature existed to prevent. The Windows PID-wait in the swap helper was never verified either.
- Removed with it: `server/update/dataDir.js`, `POST /api/update/download`, `POST /api/update/apply`, the swap helper, and the download/install UI.

### Added
- **Update notice** (the safe half, kept). The server asks GitHub for the latest release on boot and every six hours — read-only, best-effort, silent on failure — and a dismissible banner reports "v1.35.0 is available — you're on v1.34.0" with a direct download link, the release notes, and a reminder to replace the .exe in its current folder. Dismissal is per-version. Settings gains a version block with last-checked and a manual **Check now**.
- **`tools/release.mjs`** — publishes a release in one command: tags from package.json, uses that version's CHANGELOG section as the body, uploads the exe and a `SHA256SUMS.txt` so downloads can be verified by hand. Talks to the GitHub REST API directly (no `gh` required). Auth via `GITHUB_TOKEN` or a gitignored `.release-token`; `--dry-run` supported; refuses to overwrite an existing release.

### Changed
- **Renamed: ED Colony Tracker → ED Colony Architect.** Colonization is still the spine of the app — it plans claim chains, scores 2.4M systems for colony value and watches the frontier — but "tracker" undersold that; Architect is what the game calls the role. The executable is now `ed-colony-architect.exe` and the package is `ed-colony-architect`. With the data migration gone this is a pure cosmetic change: no file moves anywhere.

### Notes
- If self-update is revisited, it needs an atomic copy with a completion sentinel, install detection based on real payload rather than file presence, and a PID-wait tested on non-English Windows — and it must not be bundled with a data move.
- The GitHub repo has not been renamed yet; the update check points at the existing repo name.

## [1.33.0] — 2026-08-10

### Changed
- **Your data no longer lives next to the .exe.** It moves to `%LOCALAPPDATA%\ED Colony Tracker` (`~/.local/share/ed-colony-tracker` elsewhere), which is the root fix for update pain: the exe becomes disposable, so a new build can be dropped anywhere without the app coming up empty. Migration runs automatically on first boot of this version and is **copy-only** — the originals stay put with a `DATA-MOVED.txt` note beside them, and any failure aborts back to the old location rather than risk a half-move. The boot banner now prints the data folder. Dev runs (`node server.mjs`) still use the repo folder, and `ED_COLONY_DATA_DIR` overrides everything for portable installs.

### Added
- **Update notice** — the server checks GitHub Releases on boot and every six hours (best-effort; failures are silent). A banner shows "v1.34.0 is available — you're on v1.33.0" with a link to the release notes, dismissible per version so ignoring one release doesn't silence the next. Settings gains a version block with last-checked time and a manual **Check now**.
- **One-click self-update** — Update now downloads the release exe with live progress, verifies size and SHA-256 against the published checksums, then Restart & install hands off to a helper script that waits for the app to exit, swaps the binary and relaunches. The previous exe is always kept as `.bak`, so a failed swap is undone by renaming one file, and every step is logged to `apply-update.log` in the data folder.
- **`tools/release.mjs`** — one command publishes a release: tags the version from package.json, uses that version's CHANGELOG section as the release body, and uploads the exe plus `SHA256SUMS.txt` for the updater to verify. Talks to the GitHub REST API directly (no `gh` needed). Auth via `GITHUB_TOKEN` or a gitignored `.release-token`; supports `--dry-run` and refuses to overwrite an existing release.

### Notes
- Self-update is Windows-only for now, and only from the packaged .exe (dev runs show the notice but not the button).
- Everyone needs **one** manual update to reach this version — after that, updates are in-app.
- The exe is unsigned, so Windows SmartScreen behaviour on a freshly downloaded build is unverified until it's tried in the wild.

## [1.32.0] — 2026-08-10

### Added
- **Exobiology ledger** — `ScanOrganic` was parsed by nobody; all 214 scans in the journal history were invisible. New `organicScans` store key records, per body: genera, species, species completed through the Analyse stage, scan count and last-scanned date. Backfilled by Sync All, updated live, and shown in System Detail → Bodies as "🧬 Catalogued: …(N species analysed)". Verified against the real history: 26 bodies, 49 species analysed, 15 genera — **Brain Trees on four bodies**, two of them the d9-52 ring-band moons.
- **👣 Landed filter** in Expansion — narrows the list to systems with a recorded surface set-down. Pairs with 🌋 Geo only to answer "which mining venues have I already stood on".

### Fixed
- **Landings now record live.** `bodyVisits` was written only by the Sync All full-history scan — no server-side writer existed, so a landing mid-session stayed invisible until the next full journal scan. A Touchdown handler now updates the ledger as you set down (ship-recall landings still excluded) and broadcasts a `body_landed` event.
- **Five orphaned landings recovered.** Pre-2019 Touchdown events predate the `Body`/`StarSystem`/`SystemAddress` fields, so every one collapsed into a single junk `undefined|undefined` ledger entry. They're now attributed to the most recent ApproachBody before each landing: the ledger goes 196 → 201 real bodies with zero unnamed entries.

## [1.31.0] — 2026-08-05

### Fixed
- **Geo/bio signals were being dropped server-side since the journal cutover.** The parser collected FSSBodySignals and nothing consumed it — the only attach logic lived in the retired client watcher, so every body scanned since then entered the exploration cache geo-blind (all 16 home systems read zero geo). Now attached in BOTH server paths: the live scan buffer (new FSSBodySignals handler) and the Sync All full-history extractor (which also preserves signal counts when a later re-scan replaces a body record). **Run Sync All once to backfill geo across your whole journal history.**
- Both journal→Spansh converters (client + server) now carry bio/geo counts into the scorer's body shape — journal-scored systems keep the geo-based Extraction-economy credit and geo survives into cached bodies.

### Added
- **Geo lens** (Frontier's Rhino makes geological sites surface-mining venues): the scorer persists `geoCount`/`geoSiteTotal` per system (census only — zero points), the Expansion body table gains a 🌋 signals column, and a **🌋 Geo only** filter shows just the systems with geological signals. Persisted counts populate as systems are (re)scored.

## [1.30.1] — 2026-08-05

### Fixed
- **Boxel scout no longer drowns dense boxels in id64 drip-lookups.** The name search stopped at 12 pages (1,200 results) — sized for sparse home boxels, not Colonia-core d-boxels (PX-T d3: 1,866 members). Every un-fetched member was misfiled as a "gap" and cost one polite dump lookup to reclassify — the swelling ⚫ bucket. Ceiling now 40 pages with the same 2-empty-pages early stop: sparse boxels still scan in a handful of requests, dense ones enumerate fully up front and the resolution drip collapses to the true unknowns.
- **0-body systems are targets again.** A dump hit with ZERO recorded bodies (position known — someone jumped through — but never FSS'd) was filed under ⚫ "in Spansh — not targets." Those are exactly as virgin as true gaps; they now join the green target list as dashed ⚬ chips ("position known, never scanned"), and the green header counts them.

## [1.30.0] — 2026-08-05

### Changed
- **Scoring formula v2** — built from the Colonia field tour's verdicts ("a lot of the same" is real): atmosphere clones stop stacking. The FIRST body of each distinct atmosphere class earns the full ladder (15/12/9/5 by class order); every further body of an already-seen class earns a flat +3. Classes fold hot/thin/-rich variants together (Thin CO₂ = CO₂). A **diversity bonus** (+5 per distinct class beyond the first, cap +20) pays systems with genuinely different airs. **✨ Epic view now scores** — +10 per met criterion (tight binary / big-sky parent / ring-edge moon / twin worlds), cap +30: "epic is probably the reason I'd make a system home." Icy half-scoring, oxygen/exotic bonuses, and every other component are unchanged. Monoculture families (5× water, 7× ammonia) drop; diverse and epic systems climb.
- Score compare table and expanded breakdown show the new **Diversity** (+distinct classes) and **Epic view** point rows.

### Added
- **Offline background rescore tooling** — `tools/rescore-scouted.mjs` reprices every scouted system in colony-data.json with zero UI clicking and zero Spansh calls (backup written to backups/ first): exact rescore where full bodies exist locally (cachedBodies, journal scans), slim-schema repatch from the local region .jsonl files otherwise, and an honest count of entries left at v1 when no body data exists anywhere on disk. `tools/rescore-regions.mjs` now applies the same full v2 repatch to region files. Scores stamp `scoreVersion`; the UI stamps it on every fresh scout too.
- **Approximation honesty**: slim region records carry no orbit-geometry parents, so epic points there are derived from each record's STORED epic reasons, credited only where the stored numbers prove out against the current calibrated bars (old-format span-only ring flags are NOT credited). Full-precision epic returns whenever a system is next scored from complete bodies.

## [1.29.0] — 2026-08-05

### Added
- **⛓️ Chain Watch** — the colonization frontier as a browsable ledger. Watches colonization events GALAXY-WIDE off the existing EDDN socket (the 200-ly gate stays radar-only), assembles anchors into connected CHAINS (links ≤16 ly), and reports each as NAMED systems with coordinates — turning edastro's anonymous green tendrils into places you can aim the Expansion search at. Per chain: start → tip, extent, ±100 ly reach band, growth status (active = growth ≤14 d, "N updated this week"), sectors/regions traversed, distance from you and from your holdings, expandable anchor list (click → System View). Region-whitelisted (default: Inner Orion Spur + the Colonia region, resolved from live data — not hardcoded), sector text filter, growing-only toggle.
- **Cold-start seed** — one bounded Spansh pull of is_being_colonised systems per region (newest-updated first, ≤2,000 each, truncation stated in the UI, shared politeness clock with every other Spansh consumer). EDDN keeps the ledger live thereafter; a slow drip resolves regions for live-found anchors. Persistent in chain-watch.json.
- **Co-pilot chain beat** — arbiter-gated, 30-min cooldown, fires only when a genuinely NEW anchor appears; all three personas got awareness-only lines ("I report doors, not destinations").
- **Anti-invention discipline as code**: anchors only from real events/records, growth only from observed additions, unresolved regions labeled unresolved, no recommendations anywhere.

## [1.28.11] — 2026-08-04

### Fixed
- **Chain Planner preview no longer fakes arrival.** The greedy preview ran Max Hops + 2 and then just stopped — labeling whatever system it died at with the target's green "T" row ("doesn't get me to my target!"). It now runs exactly Max Hops, states "DID NOT REACH TARGET" with the shortfall and the roughly-needed hop count, and marks the stall row ⚠. Ranking also flipped to hop-efficiency-first (a 14.9 ly stride beats a body-rich 4.3 ly shuffle — every claim is a full port build); body count only breaks ties.
- **Scouting no longer stalls when you watch the pop-out map.** The scout runner's rate-limit waits used Window timers, which Chrome clamps to ~one fire per MINUTE once the Expansion tab has been hidden ~5 minutes — so scoring "paused after a few" the moment attention moved to the popped-out map. The waits now run through a tiny dedicated-worker timer, which background throttling exempts; hidden-tab runs proceed at full pace.

### Added
- **Colonia almanac in the Wiki** — generated from the July-2026 dump's 500 ly Colonia region (G:/Spansh/region-colonia-500-fresh.jsonl): 1,041,191 systems with just **72 populated (0.007%)**, atmosphere rarity with the regional flip (**ammonia is common out there — 14,966**; the jewels are Oxygen 181, Hot Silicate Vapour 4), and a dramatic-skies census — 17,136 bodies in 9,166 systems, incl. **66 orbiting INSIDE rings and 22 TRIPLEs** (in-ring CO₂/ammonia twin worlds with bio signals), with a top-finds table.
- **Scout map filters** — the legend is now clickable: toggle any score tier, an **✨ epic-only** mode, and **◈ hide pre-scouted** (spotlight only what this run found). "Scoring now" pulses always show. **Low tiers (<60) start hidden by default** — "low scoring is not exciting." Works in the inline map and the pop-out (the pop-out snapshot carries the pre-run set).
- Wiki also gains the mass-code "Where to hunt" table (rendered live from the dataset) and the scope/epic-calibration note.

## [1.28.10] — 2026-08-04

### Fixed
- **Boxel scout stops calling same-name systems "renames."** In dense core boxels the name-search hits result caps, so the id64 double-check finds systems Spansh knows under their exact expected name — they were landing in "already mapped (other name)" as absurd self-renames ("e1-0 → e1-0"). They now get their own honest bucket: "in Spansh (missed by the name search — not targets)." True renames keep the other-name bucket.

### Changed
- **Region labels use the official galactic regions** (Codex names, stored per system from Spansh at scoring time): the home turf is correctly **Inner Orion Spur** — not "Bubble," which is ~250 ly across while Col 173 sits 960 ly out — and Colonia is **Inner Scutum-Centaurus Arm**. Entries scored before regions were stored fall back to their dominant procedural sector (Wregoe / Eol Prou) until rescored.
- **Scout map pops out** — ↗ next to the 🗺 Map toggle opens the map in its own tab (/scout-map) for a second monitor: the search snapshot rides localStorage, and scores stream in LIVE through the synced store, so blips keep lighting up in the popped-out window as any device lands them. Clicking a blip there opens its System View. A legend now explains every dot ("what does the coloring mean?" — answered on the map itself).
- **Scout map enlarged** (~72vh) and gained a **side elevation panel**: same horizontal axis, vertical = ly above/below the reference plane, auto-scaled with gridlines — instantly shows whether a find sits above or below your target. Same tier colors, pulses, ✨ halos, and click-to-row.

## [1.28.9] — 2026-08-04

### Fixed
- **Journal Stats no longer demands a rescan per visit.** The page was fully client-side: Chrome folder picker, full re-read of all 555 log files, results held only in component state — lost the moment you navigated away. The scan now lives on the SERVER with a persistent incremental cache (journal-stats.json): the page renders instantly from cache, only NEW journal bytes are ever read (the active file resumes from its exact byte offset), and it auto-catches-up in the background when new files exist. First scan is the only long one. Works from the iPads now too.
- **Bodies filter reflects the measured yield buckets** — 41+ / 21–40 / >20 / 10–20 / 1–9, matching the score distribution in the commander's own 4,090 scored systems (41+ ≈53% score ≥60; 21–40 ≈26%; 10–20 ≈7% but holds d9-52 and HIP 47126; 1–9 ≈0.4%).
- **Expansion results survive clicking a system.** System links (name → dossier, ☄️ → System View) now open in a NEW TAB with the auth token riding along — an accidental click no longer throws away an entire Spansh search ("i have to hit spansh again - so bad").

## [1.28.8] — 2026-08-04

### Changed
- **The radar's compass anchor is now ✦ SAG A*** — the direction to Sagittarius A* on the rim, in both 2D and 3D (it orbits correctly when you drag). The old "N" marker is gone: a compass letter is Sol-neighborhood convention, and this close to the core it means nothing — the core itself is the landmark.

## [1.28.7] — 2026-08-04

### Fixed
- **System View actually loads again.** Root cause: the page's whole data pipeline — including the Spansh fallback — was gated behind the *client-side* journal folder handle, which has been permanently null since the server-side watcher cutover. It now pulls the server's exploration data (`/api/exploration`) plus an unconditional Spansh fetch on every system change, so it works parked, from links, after restarts, and on iPads. The dead "Select Journal Folder & Start Watcher" prompts are gone.
- **TARS speaks again.** Live co-pilot generation was dying with "Claude CLI exited null" — the multi-kilobyte persona system prompt was being concatenated raw onto a cmd.exe command line (newlines end a cmd command), the mangled invocation hung, and the 60 s timeout killed it. The system prompt now travels via `--system-prompt-file` (the user prompt already went via stdin for the same reason). And if live generation still fails for any reason, the canned pool now speaks as a last resort instead of dead air. Bonus guard found while probing: the CLI reports auth failures as a success-shaped JSON payload — without a new is_error check, TARS would have eventually spoken "Failed to authenticate. API Error: 401…" out loud as dialogue.
- **Layer-count width is reserved** on the radar toggles, so the screen no longer jumps when a count crosses into two digits.

### Added
- **📡 Radar 3D view** — a 2D/3D toggle beside the range control (persisted). 3D tilts the disc 62°: rings become ellipses, the vertical axis becomes *real* height (blips float on stems above/below the plane with shadows on the disc), and you **drag to orbit** — the N marker rides the rim so bearings stay honest. All layers, labels, tap-cards, zoom, and counts work identically. Pure SVG math, no dependencies.
- **🚦 Traffic button on the Companion page** — tap from the iPad to push the current system's traffic report (EDSM arrivals + unique-heard count) to the in-game overlay on demand.

## [1.28.6] — 2026-07-24

### Fixed
- **✨ Epic view actually means something again.** The old bars (parent ≥20° of sky, ring span ≥40°) flagged essentially every close moon of every ringed giant — an entire Expansion results page wearing the badge. Recalibrated against the commander's own benchmark sights: parent-overhead now needs **45°**, and "skims rings" now requires orbiting **within 5% of the ring edge** (the d9-52 2 a benchmark sits at 1.01×; moons orbiting *inside* rings — HIP 52629 2 a, ratio 0.35 — get called out as such). New **twin worlds** criterion for the sight the detector couldn't even see: sibling bodies ≥20° in each other's sky (HIP 47126 ABCD 1 a/b: 24.7°, co-orbiting 4,194 km apart). Validation on the scouted shortlist: 17/29 flagged → **6/29**, with both benchmark systems keeping the badge *for the right reason*. Rescore All re-flags existing entries.
- **ACTIVE NEARBY no longer resets on every jump** — recentering cleared the whole uploader map; with positions stored per uploader (v1.28.4) the count re-filters spatially, so the clear only zeroed your density stat mid-flight.
- **High-score layer honesty** — score-0 partial captures (drive-by scans with no star data) are unscoreable, not zero-rated, and never enter the layer at any threshold. When the layer is empty because your scouted turf is far away, it now says so: "nearest scouted system is ~22.1 kly away — score this region via Expansion."

## [1.28.5] — 2026-07-24

### Added
- **Arrival traffic report** — "how many people have been in the system I'm jumping into recently," from both honest sources: EDSM's passage log (visits by EDSM-feeding players — ~466 arrivals today into Einheriar at time of writing) and our own count of distinct anonymized uploaders heard in that system over 24 h (true unique people, but only what this exe personally heard while running). Surfaces as an in-game overlay line on every hyperspace arrival (🚦, below the distance row) and a CENTER TRAFFIC panel on the radar readout.
- The EDSM cache is warmed at StartJump — the fetch happens during the FSD charge, so the arrival overlay reads it synchronously. Exactly one EDSM request per jump (10-min per-system cache, failures cached, 6 s timeout, no polling). Zero new Spansh calls.

## [1.28.4] — 2026-07-24

### Changed
- **ACTIVE NEARBY follows the zoom.** The server now keeps an anonymous last-known position per uploader (positions only — IDs never leave the server) and the stat counts commanders within the selected range: zoom to 25 ly and it reads "~4 cmdrs ≤25 ly" instead of the fixed 200 ly figure. The "that I've heard of" hedge stays.

### Fixed
- **Score box can actually be edited now.** The threshold input force-parsed an empty field to 0 and wrote it straight back, so the 0 could never be deleted (worst on iPad). It now tolerates a blank field while typing, commits valid numbers live, and restores the last committed value on blur. Numeric keypad on iPad via inputMode.
- Stale uploader entries are purged from the density map, so it no longer grows unbounded across a long session.

## [1.28.3] — 2026-07-24

### Added
- **Radar zoom** — 25/50/100/200 ly range buttons in the topbar (persisted). Ring labels, blip scatter, and vertical-stem exaggeration all rescale, so the clump at the center of the 200 ly view spreads across the full scope. Nothing hides silently: an "N ON SCOPE · +M BEYOND range" counter tracks what the zoom excludes.
- **Touch-first identification — hover doesn't exist on the iPad.** Signal blips (builds, atmo leads, high-score sites, conflicts) carry always-on name labels; traffic and power get labels too at ≤50 ly zoom. Tapping ANY blip — including anonymous traffic pings, which previously had no identification at all — pins an info card: system, body, atmosphere, score, distance, elevation, age, NEW-TO-YOU. Tap elsewhere to dismiss.
- **Per-layer counts** on every layer toggle ("TRAFFIC 14"), and the atmosphere feed cap raised to 12 so every blip on scope also appears in the readout list.
- **Fullscreen toggle** (⛶ FULL) — overlays the radar over the whole viewport above the app nav, with a best-effort Fullscreen API request so iPad Safari can hide its own chrome. Esc or ✕ exits.

### Fixed
- **Header no longer clips on iPad** — the topbar row is auto-height, so controls wrap into visible rows instead of being cut mid-character by the fixed 48 px row.
- **LINK DOWN honesty** — when the server (the exe) stops answering polls for ~20 s, the status badge flips to LINK DOWN instead of continuing to claim EDDN LIVE with stale data.

## [1.28.2] — 2026-07-24

### Fixed
- **Radar is now actually in the left nav** (🛰️, under Expansion). The 1.28.0 build registered the `/radar` route but the menu entry never landed — the only 📡 in the nav was Companion, so the radar was reachable only by typing the URL.

## [1.28.1] — 2026-07-24

### Changed
- **Radar prospects are now colonization-only.** Systems with confirmed population can never surface as NEW TO YOU leads, atmosphere pings, or high-score prospects — "anything with population already would not be colonizable." Population knowledge is fed from live EDDN jump traffic, the 7-day Spansh lookback, your known-systems data, and your own colonised-system flags; populated systems still count toward traffic and commander density, they just stop pretending to be claims. (First casualty: Luchtaine — pop 318,022, three stations — which the radar had proudly tagged NEW TO YOU.) Unknown population stays eligible: a frontier scan can't prove a negative, so only *confirmed* population excludes.

## [1.28.0] — 2026-07-24

### Added
- **📡 Proximity Activity Radar** — a starship sensor console at `/radar`: commander activity within **200 ly of your position**, live from the **EDDN firehose** blended with a **7-day lookback**, re-centering on every jump. Amber-phosphor scope, 50/100/150/200 ly rings, radar sweep, and the **required vertical axis**: blips float above/below a plane-shadow dot on leader-line stems (stem length = ly off the galactic plane, exact offset in every tooltip).
  - **Live prospecting — the core value.** When any commander within 200 ly charts a body matching your rating criteria, it pings **as it happens** — tagged **NEW TO YOU** when it's not in your scouted/known data. First light showed the point: sulphur-dioxide and ammonia bodies surfacing **12–21 seconds** after being scanned by strangers. Layer 3a (composite score ≥ adjustable threshold, default 70 — live slider) and layer 3b (interesting atmospheres regardless of score) both evaluate through the **canonical scorer** — the radar and the Spansh search rate systems identically, with your 2,895 scouted systems populating the lookback layer instantly.
  - **Colonization activity is the headline** — rival builds/claims within range render as ember-orange pinging blips and a dedicated feed.
  - **Conflicts, power & population** — live faction-state arrays plus 7-day Spansh context; separately toggleable like every layer.
  - **🔭 Boxel watch** — the existing gap-check run against your current boxel as a **text notice** ("N expected systems undiscovered — d5-13, d5-14"); never blips, since undiscovered systems have no coordinates by definition.
  - **Honesty, load-bearing:** EDDN is anonymized — activity and counts only, never identities; density is uploaderID-deduped and phrased "~N that I've heard of" (only tool-running commanders are audible); your own EDMC uploads are fingerprint-filtered out so the radar doesn't detect you; empty scope reads "quiet", never invents.
  - **Engineering note:** EDDN speaks ZeroMQ, and neither native bindings (can't embed in the single-exe build) nor the pure-JS alternative (WebSocket-only) could ride along — so the app now carries a **minimal hand-rolled ZMTP 3.0 client** over a raw TCP socket, spike-proven against the live firehose before a line of the feature was built. Zero new dependencies.
  - **Co-pilot on the scope** — rival builds, fresh site leads and frontier quiet as arbiter-paced character beats across all three personas, every line keeping the "…that I've heard of" hedge.

## [1.27.0] — 2026-07-23

### Fixed
- **Earned credits now line up with the asteroid they came from.** Prospecting the next rock while collectors finish the current one used to hand accounting over instantly, so the trailing refines landed on the wrong rock (and fast prospector runs produced phantom 1-tonne rocks). The literal fix — wait until Remaining ticks off 100% — is unobservable (the journal only writes Remaining on a re-prospect), so the closest observable rule ships instead: the newly-prospected rock **waits in a pending slot** while refines keep crediting the rock they came from, and takes over at the first 30-second refine gap (pipeline drained; median inter-tonne cadence is 11s) or a 120s hard cap when two streams genuinely overlap. Catch cards now fire at the drain with the rock's full total; a third prospect before the drain forces the boundary immediately.

## [1.26.1] — 2026-07-23

### Changed
- **Live pricing anchored to carrier range.** The live basis is now the best non-FC sell **within 500 ly of your position** — one carrier jump, matching how the ore actually travels — instead of galaxy-wide (which surfaced a 5,496 ly LTD buyer nobody was hauling to). Anchored to your current system, re-anchors as you move. Demand floor is 10,000 — under that, a top price is treated as illegitimate (small listings collapse after a few loads, and the buyer must absorb carrier-scale tonnage).
- **Nearest-at-best tie-break.** Price caps make exact top-price ties common, so at equal pay the closest station wins. Immediate effect from HIP 52629: Bromellite's 116,750 found at **123 ly** and LTD's 384,562 at **151 ly** — both closer than hand-picked Inara references, and the Painite pick (266,412 @ 238 ly) beats a 235k/321 ly reference on both axes. Picker tooltips name the paying station.

## [1.26.0] — 2026-07-23

### Changed
- **Market pricing now means "the highest non-FC payout, wherever it is."** The value ladder becomes mission rate → **live galaxy best sell** (Ardent/EDDN, Fleet Carriers excluded, demand ≥ 500) → visited-market average as the offline fallback. The old visited-average basis answered "what would a random station I frequent pay" — but the commander hauls to the best buyer, and the mismatch was ~3×: Bromellite 36k visited-avg vs **116,750** galaxy best, LTD 143k vs **384,562** (both verified to the credit against Inara). Prices cache hourly per commodity, warm automatically from prospects and the picker, and the picker tooltip names the paying station.

## [1.25.0] — 2026-07-23

### Added
- **◉ Hotspot ground truth.** The journal records no position inside a ring, so the commander now supplies it: an **IN HOTSPOT** toggle on the hero stamps every rock logged while it's on (auto-clears on ring change or jump — hotspot is positional), and any past session can be marked from the rate table's new ◉ column. Marks live in a sidecar (`mining-annotations.json`) so the append-only log is never rewritten, pre-seeded with the two known labels: Col 285 DG-S sessions = Bromellite hotspot, HIP 52629 A 9 B = not. Flagged rocks show ◉ in the Asteroids list; sessions report their hotspot share. First measured payoff already in: hotspots raise target density **23% → 79%** while extraction efficiency stays identical — density, not richness.
- **Rock board goes apples-to-apples.** The backdrop now filters to the current ring's **class** when known — icy asteroids measure ~2× the content of metallic ones in this log, so pooled comparison made every icy prospect look far-right regardless of merit. The header names the population ("vs your 117 icy rocks"); classes with under 12 rocks fall back to pooled, labeled. Historical rows get their class resolved from the ring index at read time.
- **Ring context survives login.** Logging in already inside a ring writes no `SupercruiseExit`, so whole sessions logged ring-less (and hotspot marks had nothing to key on) — the `Location` event carries the body and now seeds ring context the same way.

### Fixed
- **Co-pilot no longer chatters outside the game.** The launcher/main menu still writes journal lines, and each one ticked the idle-beat machinery — invisible until the portrait pop-up surfaced every line everywhere. A commander-presence gate (`LoadGame` → present; `Shutdown` or main-menu music → absent; seeded from the journal tail at boot) now mutes all beats when nobody is in the cockpit. The Cockpit Ask/News buttons bypass it deliberately — pressing a button is presence.

## [1.24.2] — 2026-07-22

### Changed
- **Asteroid feed trimmed to the last 5.** The prospected-rocks section (renamed **Asteroids**) shows the five most recent by default — the live loop, not a wall of history — with a one-click "Show all N" expander.

## [1.24.1] — 2026-07-22

### Changed
- **Rock log takes the prime slot.** The running prospected-rocks feed now sits directly under the rock board — hero, board, feed, in that order. The "Needs a DSS scan" list (good info, wrong prime real estate) folds into a collapsed expander at the bottom of the page with its count on the summary line; the arrival alert is unchanged.

## [1.24.0] — 2026-07-22

### Added
- **Mining HUD.** The Mining page got a cockpit identity: a chamfered hero band that glows while mining is live, with an animated pouring session-credits counter, a pace bar showing live t/hr against *your own best in this ring* (best-anywhere when the ring's unmeasured), the current ring with class icon, and the 🔥 streak counter. Idle, it goes quiet.
- **The rock board, standing.** The catch card's measuring-board histogram promoted to a permanent instrument: your whole logged rock-value distribution with **every prospect pinged onto it the moment you scan it** — cyan for target-bearing, green for above this ring's worth-it bar, grey for junk — so a rock is read against the population *before* lasers commit, not after.
- **🎙️ Co-pilot in the ring.** Big catches (top 5%+), personal-best rocks, streak milestones, 5M session steps, stalls and Pristine ring arrivals are now character beats: Wash whoops like a fishing buddy, TARS goes proud-teacher, K2 concedes under protest. ~150 hand-written lines across six beats and all three personas — canned-only (no generation latency mid-mining), paced by the same arbiter as everything else, and the stall lines obey the no-invented-causes law.
- **Co-pilot pop-up.** Since the Cockpit page is never the one on screen while mining, every co-pilot line now pops bottom-left on *any* tab: mood-matched portrait (TARS goes hyped for catches, proud for records — the art packs already installed) + speech bubble. Own Settings toggle, default on, suppressed on the Cockpit page itself.
- **🏆 Trophy wall.** Records priced on refined tonnage at today's rates — biggest rock (3.81M · 28t), best session, best rate, longest streak, lifetime tonnes, rings worked — plus 19 badges with static thresholds. Nine unlock from your history (First Whopper through Overdrive), marked quietly with no boot-spam; ten are genuinely ahead of you. New unlocks pop the card + overlay.
- **🔥 Target streak.** Target-bearing rocks (≥3%) you mine extend it; one you skip breaks it; junk rocks never touch it. Survives across sessions (it measures discipline, not uptime), shows on the hero and the ticker from 3 up, celebrates 5/10/25/50 and new bests, feeds the co-pilot, and its record lives on the wall.
- **Ring-finder podium.** Top 3 results as scored cards (#1 · BEST BET); the full table folds behind an expander.
- **Charts over tables.** Value-per-ring and t/hr-per-ring render as direct-labeled bars; the raw tables stay one click away.

### Fixed
- **Trophy records were briefly priced on prospect estimates**, letting a 2-tonne rock claim its full 3.9M estimate and inflating the best-session record. Records now price refined tonnage only — the estimate basis belongs to the board, the got basis to the shelf.

## [1.23.0] — 2026-07-22

### Added
- **Prices on the target picker.** Every material chip on the Mining page now shows its current Cr/t — mission rate while one is live (flagged ⚑, tinted), otherwise the average across your own visited markets — so "what would Void Opals even pay?" is answered where you pick targets (~166k, for the record). Tooltip states the basis; picker sorts laser-proven first, then by value, so the rich stuff surfaces. Materials with no observed price say so rather than showing a number from nowhere.

## [1.22.0] — 2026-07-22

### Added
- **🔭 DSS-gap tracking — "there are scans you should do."** The ring index now keeps every planetary ring you've *seen* in a body scan, not just the ones you've DSS-mapped, which makes seen-but-never-deep-scanned computable. Measured at ship time: 111 mapped vs ~480 seen-unmapped, **63 of them in your own colony systems** — almost all Pristine, including 5 in the active build system.
  - **Arrival alert:** entering one of your systems that has unmapped rings pops the overlay and the in-app card — `🔭 6 rings here need a DSS scan — A 2 A, A 2 B…`. Once per system per run, arrival only, and scoped to *your* systems deliberately: 480 unmapped rings galaxy-wide would fire on every jump and train you to ignore it.
  - **"Needs a DSS scan" panel** on the Mining page: your colony gaps with ring type, reserve and depth, plus a toggle to widen to everywhere you've scanned.
  - Honest limits stated in the UI: belts are excluded (they can't be DSS-mapped — none of your 111 maps is a belt), and a system whose bodies you never scanned can hide rings the journal simply doesn't know about.
- **Ring-class icons.** Everywhere a ring type appears — rock log, ring finder, credits-by-location, extraction-rate table, current-ring banner, DSS panel — it now reads ❄️ Icy / ⛰️ Rocky / 🧲 Metal Rich / ⚙️ Metallic instead of bare text. (The real rock emoji is deliberately avoided: Windows 10 never got Emoji 13, so it renders as a box.)

## [1.21.0] — 2026-07-22

### Added
- **🏆 The catch card — a trophy shot for every rock you finish.** When a rock is done, it's weighed against every rock you've ever mined and presented as a catch, not a receipt: tier banner, tonnage and credits side by side, what came out of it, and a **measuring board** — your whole logged distribution drawn as a histogram with a marker showing where this one landed. Seeing a rock sit out on the tail is what makes it read as a whopper; a number on its own doesn't.
  - Tiers from your own percentiles (346 rocks): **IN THE HOLD** → **GOOD ONE** (top 50%) → **✨ TROPHY** (top 10%) → **💎 WHOPPER** (top 5%) → **🔥 MONSTER** (top 1%) → **🏆 PERSONAL BEST**. Higher tiers hold on screen longer.
  - **Fires on every rock that produced tonnes**, not just standouts. Deciding to spend time lasering a rock is itself the filter — anything that gets that far was already worth your attention. Prospected-and-skipped rocks never reach it.
  - **Ranked on tonnage AND credits**, tiering by whichever percentile is higher and saying which earned it. A fat cheap haul and a lean rich one are different achievements: 26t of water worth 14k still lands MONSTER *by size*, while 8t of Bromellite worth 1.1M lands WHOPPER *by value*.
  - Ranking prices every rock, past and present, at today's rates including live mission prices — comparing a mission rock at 136k/t against history priced at 37k/t would crown a record on nearly every rock and make the tiers worthless within an hour.

## [1.20.0] — 2026-07-22

### Added
- **⛏️ Mining credits ticker.** A live HUD in the corner of the app while you're mining: every refined tonne throws a floating `+136k` that drifts up and fades, and the session total *rolls* upward rather than snapping. Colour and size scale with the tonne's value, mission tonnes are tagged, and it retires itself when mining stops. This replaces routing per-tonne credits through the popup card — tonnes arrive every ~11s while a card lingers 20s, so the card system could only ever show them by staying permanently on screen (which is why they were previously gated to ≥150k and mostly invisible). A dedicated ticker takes every tonne with no compromise.
- **Personal records.** The rock log is uncapped, so a personal best is a real bar — 346 rocks deep. Finish a rock and it's ranked against every rock you've ever mined: `🏆 NEW BEST ROCK — 3.9M from 27t (beat 3.82M)`, `💎 2nd best rock ever`, or a quiet `✔ Rock done — 6t · 817k` for the ordinary ones. Ranking values every rock — historical and current — at today's rates including live mission prices, so the comparison is like-for-like; ranking a mission rock at 136k/t against history priced at 37k/t would have declared a new record on nearly every rock.
- **Rotating overlay copy.** The EDMC overlay renders text and colour and nothing else, so variety is the only lever it has. Per-tonne lines now cycle phrasing by value tier instead of repeating one template every 11 seconds.

### Fixed
- **The session milestone could never fire.** It was set at 50M, but the best *day* on record is 27.92M — so the 🏆 was unreachable dead code. Now 5M, which lands several times in a good session.

## [1.19.0] — 2026-07-22

### Added
- **Mining alerts now pop in the app, not just the in-game overlay.** Target rocks, standout rocks, big refined tonnes, session milestones, collection stalls, hold warnings, going-cold and ring-arrival all raise the same corner card the target/threat popups use, on whatever tab is open. Routine refined tonnes are deliberately **not** broadcast — they fire roughly every 11 seconds while the card lingers 20, so only notable ones (≥150k, or a milestone) earn a card; the running total stays on the overlay and the Mining page header.

### Fixed
- **Collection warnings no longer invent causes.** The cause ladder read Status.json flags at a single instant and asserted them as sustained reasons. It was wrong twice on real hardware in one session: it reported *"hostiles on you"* with no hostiles anywhere (`IsInDanger` is a generic danger/damage state, seemingly set by something as ordinary as nudging a limpet), and *"cargo scoop is retracted"* with the scoop deployed — captured flag transitions show that bit genuinely toggling mid-mining (set at 06:14:36, clear at 06:14:44, set again at 06:14:48) and a 5-second poll lands in the gaps. Flag-derived causes are gone entirely. The warning now states only what's independently checkable — seconds since the last tonne, limpets aboard, time since the last collector launch.
- **Collection warnings only fire on a rock that was actually delivering.** `HardpointsDeployed` was useless as an "actively mining" gate because miners leave hardpoints out permanently, so it was true nearly all session. The warning now requires the open rock to have already produced a tonne, which rules out flying between rocks, prospecting and combat at the root rather than filtering symptoms. Threshold raised 60s → 90s: 15% of measured inter-tonne gaps exceeded 60s (p90 68s, max 352s), so the old value sat inside the normal range.
- **Ring finder was silently dropping every Spansh result.** Spansh's `ring_signals` filter is **AND** across entries, and the finder sent all targets in one query. With live missions for Bromellite *and* Osmium — and Osmium not being a ring-hotspot commodity at all — `[Bromellite, Osmium]` returned **0** where `[Bromellite]` returns 10,000 including a Pristine ring **12 ly** out. Because the journal index ORs, some results still appeared and the failure looked like thin coverage. Spansh is now queried once per target and merged, matching the journal's OR semantics.
- **A rock's most valuable material could be invisible.** Rock-list chips were styled by target membership only, so on a 2.1M Cr asteroid the Low Temperature Diamonds component — worth **1,017,016 Cr** on its own — rendered identically to a 526 Cr Water chip. Chips now show their own credit value and are emphasised by it, independent of whether anything has declared them a target.
- **The rock you're currently shooting appears immediately.** The log only writes a rock once the next prospect supersedes it, so the current one didn't show until you moved on, and then only at the next poll. The in-flight rock is now rendered at the top of the list.

## [1.18.0] — 2026-07-22

### Added / Changed
- **The "worth it" line is now measured, not invented.** It was a hardcoded 60,000 Cr. Measuring the logged rock population showed a fixed threshold can't work: **median rock value spans 24× across rings** — ~402k in HIP 43296 5 A Ring against ~17k in HIP 52629 A 9 B Ring. One global line marks every rock in the first ring worth mining and every rock in the second a skip, carrying no information in either. The threshold is now the **median rock of the ring you're actually in**, drawn from your own log, falling back to your galaxy-wide median and only then to a constant. A second tier at the ring's 75th percentile calls out a **GOOD ONE**, and a skip says what it's comparing against (`below 468k ring median`) rather than asserting a verdict.
- **❄ Going-cold warning.** When the last 10 prospected rocks come in at less than half the ring's own median, the overlay suggests relocating — `Last 10 rocks median ~65k vs ~468k for this ring — try moving`. This answers the "am I working this area effectively" question as far as the data honestly permits: `ProspectedAsteroid` has no coordinates, so *where* you are in the ring is unknowable, but whether the rocks in front of you are poorer than the ring's norm is not. The window resets on entering a new ring.
- **💠 Ring hotspot readout on arrival.** Dropping into a ring reports its mapped hotspots, or tells you there are none recorded and to run a DSS pass — the case that applies to HIP 52629 A 9 B Ring, where 250t was mined with no signal data on file.
- **Per-ring quality columns** — **Avg/rock** and **Worth it %**. The percentage is measured against your galaxy-wide median rock, not each ring's own (which is a tautology returning ~50% everywhere — the first implementation did exactly that and was replaced). It surfaces real differences: Polahukuna A 1 A at 68% versus HIP 52629 A 9 B at 23%, where that icy ring has the *highest* average per rock but the lowest hit rate — mostly junk with occasional large Bromellite strikes.
- **One valuation, everywhere.** The page's "worth it %" and the overlay's worth-it/skip call now run through the same rock-valuation function, so they cannot disagree about an identical rock.

## [1.17.0] — 2026-07-21

### Added
- **⛏️ Mining page + mining-assist overlay.** A full mining workflow driven by measured data rather than estimates.
  - **Is this rock worth it?** The prospect overlay now shows an expected **credit total** for the rock, not a material list the HUD already gives you. Proportion → tonnes uses a **per-material yield table measured from your own history** (bootstrap 0.163 t per 1% from 322 samples, then re-derived per material as you mine — Bromellite measures ~0.52, so a flat constant under-called it 3×). Content level is deliberately ignored: measured Low 0.216 / Medium 0.213 / High 0.211, i.e. no effect.
  - **Mission-aware pricing.** While a mining mission is live, its Cr/t overrides market pricing. Verified live: Bromellite paying 136,198 Cr/t against a 36,693 market average (3.7×), Osmium 196,362 vs 61,622 (3.2×). Pricing mining off market data alone is simply wrong whenever a mission is running.
  - **Targets & ignore list.** Targets alert on prospect *regardless of value* (a mission commodity matters even when it prices low) and **auto-populate from your accepted mining missions**. Ignored materials drop out of a rock's total but stay visible, so a low number is explained. Both editable from the rock components themselves, and stored as per-element merge sets so two devices can't clobber each other.
  - **Where to mine.** Set a target, get ranked rings by hotspot count, **reserve level** (Pristine → Depleted), distance in ly and **depth in Ls** (a ring 70 ly out at 13,460 Ls is not the same trip as one at 1,500 Ls), ring class, and co-located targets. Two sources: your own DSS-mapped rings, plus galaxy-wide discovery via the Spansh `bodies/search` API. Rings you've actually mined are ranked on **measured t/hr**, which outranks every inferred signal.
  - **Collection warnings that name a cause.** Gated on hardpoints-deployed, so no more false alarms while flying between rocks. Cause ladder from Status.json flags: cargo scoop retracted → overheating → hostiles → out of limpets → no collector launched recently → drifted. The stall threshold moved **12s → 60s**; the old value fired below the *median* 11s gap between refined tonnes, i.e. during entirely normal mining.
  - **Hold warning on effective ore space** (`capacity − cargo + limpets aboard`). Limpets occupy cargo but each launch returns a tonne, so warning on raw free space would send you to a station early.
  - **Prospected-rock log** (`mining-log.jsonl`) — append-only and uncapped, kept out of `colony-data.json` (already ~21 MB and hydrated to every device). Rocks are identified by a material-proportion fingerprint, so re-prospecting the same asteroid updates one record instead of double-counting. **Seeded from your journal history on first run** so the yield table and rate figures work immediately.
  - **Credits banked as they refine.** Every refined tonne pops a running tally — `💎 Osmium +196k (mission) · rock 333k · session 622k / 5t` — with the marker escalating by value (✅ / 💰 / 💎) and a 🏆 milestone every 50M. Each tonne is priced at the moment it lands in the hold, so a tonne pulled under a live 136k/t mission is recorded at what it was actually worth even after that mission expires.
  - **Credits by rock and by location.** The rock log records what each asteroid actually earned (alongside its pre-mining estimate, so the two can be compared), and totals roll up per ring and per system. Two separate columns, never conflated: **Earned** (real, priced at refine time) and **@ today** (the same tonnage re-valued at current prices — useful for comparing rings, but not what you were paid).
  - **Extraction rate by ring over time**, and a worst-case mission completion estimate. The estimate is explicitly labelled worst case: `CargoDepot` does not fire for mining missions, so wing-mates' tonnage is invisible and the figure assumes you mine every tonne yourself.

### Notes
- The target picker's material list is **derived from evidence** — the union of what you've prospected, refined, cored, or hotspot-mapped (33 materials) — so it extends itself and classifies nothing by assumption. Materials never seen in a laser prospect are marked "hotspot only".
- Hotspot `Count` is displayed as-is. The journal records no hotspot positions, so overlap isn't knowable and no yield multiplier is inferred from it.
- No core-mining alerts: with no seismic charge launcher fitted and zero `AsteroidCracked` events on record, a motherlode callout would be an alert for a mechanic the ship can't perform. Cores are still logged.

## [1.16.0] — 2026-06-25

### Added / Changed
- **Commodity build-recommender overhaul (Raven Colonial data).** The "what should I build to *produce* commodity X?" feature got three upgrades:
  - **Every commodity is now covered.** Its commodity→economy table was missing 17 — including **Medical Diagnostic Equipment** (now mapped to High-Tech), plus the colonisation-construction goods (Steel, CMM Composite, Building Fabricators, Surface Stabilisers, Structural Regulators, etc.). Completed using the table's own category→economy pattern.
  - **Body-aware — it now tells you *which body*.** For each recommendation it computes the production buff a body gives the target economy (Raven Colonial's ±0.4 model — e.g. High-Tech +0.4 on Earth-like/Water/Ammonia worlds and on bodies with bio or geo signals), ranks buffed bodies first, and shows why (✨ +0.4 on [body] · bio signals). Applies to both colony-port paths and supporting hubs, so Medical Diagnostic Equipment now points at the best High-Tech host body in your system, not just the build type.
  - **Accurate build tonnage.** Installations with no itemised requirement list now show Raven Colonial's authoritative total haul instead of a vague tier-typical range.
- **Offline Raven data.** Build requirements per installation (`src/data/ravenBuildTypes.json`, 60 installations) and body/system economy buffs (`ravenBodyBuffs.json`) are bundled offline — no live API calls at runtime.
- **Docs.** New FAQ category **Commodity Production** (how the recommender works, body buffs, data sources) and a **Colony economy production buffs** reference table in the Wiki. Raven Colonial credit updated for the expanded offline data.

## [1.15.0] — 2026-06-24

### Added
- **🧠 Brain Tree flags on bodies.** Mark which bodies host Brain Trees (renewable raw-material farms — Grade 1–4 raws incl. Yttrium/Polonium — and Guardian-linked organic structures). They leave no trace in Spansh or journal scan data unless you codex-scan them, so this captures what you've *seen*. Three states:
  - **Candidate** (auto, derived): any landable body with volcanism and a 200–496 K surface temperature shows a faint 🧠 hint — it *could* host brain trees (necessary-not-sufficient; ejecta-crater/Guardian proximity isn't in the data, so expect false positives).
  - **Scanned** (auto): scanning a Brain Tree in-game fires a `CodexEntry`, which the server now captures and resolves to the exact body (by BodyID) to auto-confirm the flag.
  - **Marked** (manual): toggle 🧠 on any landable body in the System → Bodies tab for ones you've seen but not scanned (e.g. Col 173 AX-J d9-52 · 2A).
  - A global **"Brain Tree sites"** panel on the Scouting page rolls up every confirmed site across colonies *and* scouted systems. State persists per body (`bodyFlags`), syncs across devices, and a scan never downgrades a manual mark.

### Changed
- **Carrier-dock facts overhauled — far more variety, no more repeats.** The "did you know" pool grew from 13 to ~35 facts (added lifetime mining / exploration / bounty / trade / exobiology profits, biggest single trade, most-hauled commodity, your biggest colony by builds, materials traded, passengers ferried, ships owned, farthest-from-start, plus a few cheeky ones), and the picker is now a **shuffle-bag** — every fact shows once before any repeat. So re-docking the carrier mid-haul stops cycling the same few lines (which it did before: a weak last-only guard plus 3× hauling weighting kept surfacing "Best hauling session").
- **Squadron Season comparison + lots more facts.** A new **Squadron Season** card on the Architect's Domain page puts your colonisation contribution (from your journal) head-to-head against a squadron-mate's — entered manually, since ED doesn't journal other members' figures. A Sync-All journal scan now persists your **squadron name/rank** (`SquadronStartup`) and **per-ship playtime** (`journalScan`), powering new dock facts — *"Flying with FFR RED PEREGRINES," "Your workhorse: Panther Clipper Mk II (357 h)," "Top squadron colonisation contribution: 271,537," "6.45B CR deposited to the squadron bank"* — alongside domain superlatives (most populated colony, empire span, cargo ordered, temperature range, ice-ball %). The dock-fact pool went from 13 → ~47.

---

## [1.14.1] — 2026-06-17

### Fixed
- **Carrier/ship stock now counts against colony needs for goods the construction depot names differently than the market.** Elite reports a few commodities by a different internal symbol in the `ColonisationConstructionDepot` event than in the commodity market — **Land Enrichment Systems** (`terrainenrichmentsystems` vs `landenrichmentsystems`), **H.E. Suits** (`hazardousenvironmentsuits` vs `hesuits`), **Microbial Furnaces** (`heliostaticfurnaces` vs `microbialfurnaces`). The project parser matched only the depot symbol, so the Projects tab's "need to buy" ignored stock held under the market symbol (e.g. showed "need 272" with 412 on the carrier). The depot parser (client + server) now falls back to the localised display name, which resolves to the canonical market ID, and a one-time backfill repairs commodity IDs on existing projects (also cleaning up old vowel-mangled slugs from a past bug). Mirrors the existing carrier-cargo backfill.
- **Carrier-dock fact labels corrected.** The session/project-derived "did you know" lines used misleading nouns: "biggest single haul" was actually a whole hauling *session* total (e.g. 16,876 t over ~3 hours — impossible as one ship load), "across N runs" were N *sessions*, and "N colony builds" were completed *construction projects*. Relabeled to **"Best hauling session: X delivered"**, **"X delivered over N hauling sessions"**, and **"N construction projects completed (M in progress)"**. No fabricated colony count — the app's colonisation records are incomplete. The Frontier-`Statistics` facts were already accurate.

---

## [1.14.0] — 2026-06-17

### Added
- **Carrier-dock "did you know" overlay.** Docking at your own fleet carrier now pops a random milestone line on the in-game overlay — weighted toward hauling/colonisation (tonnes delivered to your colonies, biggest single haul, colony builds completed, lifetime tonnage traded, carrier export volume) with career facts mixed in (jumps, bodies mapped, first footfalls, days played, net worth). A no-repeat guard avoids showing the same line twice in a row.
- **Persisted journal stats.** The game's `Statistics` event (lifetime totals) is now captured server-side and persisted to `colony-data.json` as `journalStats`, so the facts are always available without a manual journal scan and survive restarts. It's a replace-strategy, server-sole-writer slice (mirrors `materialInventory`), updated only when the snapshot actually changes.

---

## [1.13.4] — 2026-06-16

### Changed
- **Richer in-game target overlay.** Selecting an FSD target now draws the *same* colonization model the in-app pop-up uses — friendly star name, mass-code outlook + odds (`interesting %`, `O₂ ×`), `✓ Visited`/`Unvisited`, Spansh classification (`✓ Spansh (N)` / `⚠ partial N/M` / `✗ unclassified`), and score — instead of the thinner server-built line. The overlay is now pushed client-side (`sendTargetOverlay`), so the in-game line and the pop-up can't drift, and **"New" now reads "Unvisited"** to match. Removed the obsolete server-side quick overlay so there's exactly one target overlay.

---

## [1.13.3] — 2026-06-16

### Added
- **"⚠ Partial only" filter (Expansion tab).** A checkbox in the results filter bar collapses the list to just the systems with a known body total but unrecorded bodies (records < total) — the ones with possible gems hiding in the unscanned bodies.

---

## [1.13.2] — 2026-06-16

### Fixed
- **"No body data" group no longer hides systems Spansh actually has data for.** The Expansion-tab split keyed on Spansh's `body_count`, which comes back null for ~1/3 of systems even when they have bodies (e.g. `Wregoe VZ-B b54-4` with 8 bodies) — those were wrongly dumped into "no body data." Both groups now split on the reliably-populated `bodies[]` array length, so a system with recorded bodies always lands in the scored list (where partial scans get the ⚠ banner).

---

## [1.13.1] — 2026-06-16

### Added
- **Quick-select "📍 Current" option (Expansion tab).** The Reference-System Quick-select now has a `📍 Current: <system>` entry at the top that sets your commander's current system as the reference in one click. The dropdown also shows even before you have any colonies, so the option is always available.

---

## [1.13.0] — 2026-06-11

### Added
- **Headline event pop-ups on any tab.** The bottom-right pop-up (previously target-only) now also surfaces the key live events without a trip to the Companion tab: **first footfalls, jump scores, NPC threats, and notable dock summaries** (first visits / milestones / faction or state changes — routine re-docks are skipped). Each pops a compact icon + summary card; a selected target keeps its rich outlook/Spansh card. The pop-up and the Companion feed now share one set of formatters (`src/lib/companionEvents.ts`) so they can't drift. Toggle in Settings → "Event pop-ups".
- **Target info as an in-game overlay.** Selecting an FSD target now also draws a line on the ED overlay: `🎯 system · star type · New/✓Visited · ✓ Spansh (N) / ⚠ partial / ✗ unclassified · Score N` — so you can vet a target without leaving the galaxy map. Gated on the existing overlay-enabled setting; the in-app pop-up still works independently.

---

## [1.12.1] — 2026-06-11

### Fixed
- **Epic-view detection now works correctly for live-scanned systems — names the body, fires big-sky/tight-binary, and stops false ring-edge flags.** Several linked gaps in the server-side scoring path:
  - The live scan accumulator dropped each body's **`radius`/`semiMajorAxis`**, and the server's copy of `journalBodiesToSpanshFormat` (drifted from the client's) dropped them *again* on the way to the scorer — so a live-scored system could only ever fire the *ring-edge* reason, never *big-sky parent* or *tight binary*. That's why Col 173 AX-J d9-86 saved a bare `ring-edge moon` with no body. Both now keep the geometry, so all three triggers fire and reasons name the body (e.g. `7 a — parent fills 22° of sky`).
  - **Ring-edge no longer false-positives on far moons.** It flagged *any* landable moon of a ringed parent, so a distant one like d9-107 `3c` (orbiting ~4.6 Ls out, rings a thin thread) got tagged as if it skimmed them. It now requires the rings to actually fill the moon's sky (apparent span ≥ 40°), using the ring **outer radius** — which the journal scan previously discarded and is now captured and plumbed through both converters. A genuine shepherd moon (d9-52 `2a/2b`) still qualifies.
  - The live scorer never wrote scanned bodies into **`journalExplorationCache`**, so a later **Rescore** of a journal-only system had no body data and silently no-op'd. It now persists them.
  - Systems scored *before* this fix (e.g. d9-86) need a quick re-honk to pick it all up; everything scanned from here on is complete and correct.
- **Boxel scout: 0-body dual-names are no longer mis-flagged as "unclassified."** A gap whose canonical system exists in Spansh but has 0 recorded bodies (e.g. `d9-111` → Synuefe NE-E d13-111) landed in the green "unclassified — go FSS" bucket instead of grey "already mapped," because the id64 lookup required ≥1 body. Any named Spansh system now counts as already-mapped regardless of body count.

---

## [1.12.0] — 2026-06-11

### Added
- **Boxel scout de-aliases gaps by id64.** A "gap" in the name sequence can actually be an existing system under a different canonical name — a catalog star (e.g. `Col 173 Sector AX-J d9-0` IS `HD 80881`, a 25-body system mapped since 2020) or an overlapping-region procedural name (`d9-39` → `Synuefe NE-E d13-29`). The scout now derives the boxel's exact linear id64 model (`id64(N) = base + N·step`) from the known systems, computes each gap's predicted id64, and resolves it — splitting gaps into **🟢 unclassified** (no Spansh data — the real targets), **🔵 visited by you** (gap id64 matched against your `scoutedSystems`/journal cache), and **⚪ already mapped** (exists under another name — shows the canonical name + body count). Verified on Col 173 AX-J d9: the predicted `d9-0` id64 equals HD 80881's real id64, exactly. Resolution is cached and rate-limited (only the non-visited gaps are looked up).
- **Global target pop-up.** Selecting an FSD target in the galaxy map pops a non-blocking bottom-right card with the target's info on **any tab** — friendly star type, mass-code colonization outlook + name-derived odds, visited status, and the **Spansh classification (✓ in Spansh with body count / ⚠ partial scan / ✗ not in Spansh — unclassified)** — so you no longer have to sit on the Companion tab to read a target. Toggle in Settings → "Target pop-up".

### Changed
- **Epic-view marker names the body.** Instead of a vague `ring-edge moon` or `parent fills 25° of sky`, the badge now says *which* body to go stand on — e.g. `2 a — skims rings of 2`, `2 a — parent fills 25° of sky`, `tight binary 0.07 AU (A, B)`. Existing scouted systems need one **Rescore All** to backfill the names; new scans get them automatically.

---

## [1.11.3] — 2026-06-11

### Changed
- **App version is now always visible in the sidebar.** It was already rendered at the bottom of the left nav, but styled tiny + grey and — with 17 nav items and no scroll region — pushed below the fold on shorter windows. The sidebar is now pinned to the viewport (`h-screen sticky top-0`) with the nav-item list scrolling independently (`overflow-y-auto`), so the footer stays locked to the bottom-left, and the version reads clearly as **`Version v1.11.3`** (brighter mono). Makes it obvious at a glance which build you're running.

---

## [1.11.2] — 2026-06-11

### Fixed
- **Boxel scout no longer silently hides on a capitalized mass code.** The mass code is lowercase in-game (`Wregoe OD-Z c27-37`), and `parseBoxel`/`parseMassCode` only matched `[a-h]` — so a reference typed as `Wregoe OD-Z C27-37` (capital **C**) parsed as null and the **Scan boxel for gaps** panel vanished with no explanation, looking identical to a true named system. Both parsers are now **case-insensitive** and normalize the mass code to lowercase (only the mass code — the region/LL-L casing is preserved). `enumerateBoxel`'s Spansh-match regex is likewise case-insensitive and the gap chips render in Spansh's canonical casing, so the displayed names are always correct regardless of how the reference was typed.
- **Named-system reference now explains itself.** When the Reference System is a catalog name (HIP, Sol, …) with no boxel, the Expansion tab shows a one-line note — *"Boxel scout unavailable — `<name>` is a named system, not a procedural one. Enter a name like `Col 173 Sector AX-J d9-52`…"* — instead of rendering nothing (which previously read as a bug).

---

## [1.11.1] — 2026-06-11

### Fixed
- **Boxel scout is now gentle on Spansh.** v1.11.0 paginated a fixed 40 pages per scan because Spansh's name filter is loose (it returns thousands of fuzzy token-matches, capped at ~8,000). Since the boxel's own systems are relevance-sorted to the front, `enumerateBoxel` now stops as soon as two pages in a row add no new boxel matches — **~4 requests instead of ~80** (verified live on `AX-J d9`: 4 pages, still the full 105 systems and the exact 13 gaps). Capped at 12 pages (a boxel tops out around system-index ~180 in these regions, so that's ample).

---

## [1.11.0] — 2026-06-11

### Added
- **Boxel sequence-gap scout (Expansion tab).** A reference system → **Scan boxel for gaps** enumerates that system's *boxel* live from Spansh (by name, **independent of the LY range control** — the boxel is a named cube, not a radius) and lists the **sequence gaps**: indices that exist by the contiguous numbering but Spansh has no system for — i.e. likely unscanned, probable first-footfall. The boxel is labelled with its **mass-code fruitfulness** (the baked colonization prior: expected bodies, interesting-atmosphere odds, avg score) and your **realized track record** (how many of its known systems you've scored, and the best score). For `Col 173 Sector AX-J d9` it reproduces the 13 gaps (`d9-0, 19, 39, 54, …`) exactly, matching the offline analysis.
  - New `parseBoxel` (`starNaming`) splits a name into boxel + index; `enumerateBoxel` (`spanshApi`) pages the Spansh name search and client-filters to the exact boxel (Spansh's name filter is loose). Covered by `tests/boxel.test.mjs`.

---

## [1.10.1] — 2026-06-11

### Fixed
- **Completeness now populates from the Expansion tab and Dashboard rescores, too.** v1.10.0 fixed the live-jump and target paths but missed the two *manual* scoring paths: `ScoutingPage` (scan / Rescore All) and `DashboardPage` (colony rescore) were still storing only the record count. Both now capture the Spansh dump's true `bodyCount` (`totalBodyCount`) and set `fssAllBodiesFound` from records-vs-total — so re-scoring a partial Spansh system in the Expansion tab correctly flags it `⚠ Partial scan: N of M`. (Existing scouted entries need one Rescore All to backfill the field.)

---

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
