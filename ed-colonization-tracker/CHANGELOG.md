# Changelog

All notable changes to ED Colony Architect (named ED Colony Tracker through v1.33.0).

## [1.63.0] — 2026-11-12

### Added — Materials page: Colony Bodies
- **Search your colony bodies for a raw material.** A fourth tab on the Materials page. With nothing picked it lists every raw material with grade, held, room, how many of your colony bodies carry it, and the richest of them. Pick a material (or click its row) and it lists every colony body that carries it, highest share first: body, system, share, gravity, class and atmosphere, distance from the star, your sites at that body, and where the figure came from.
- **Your scans first.** The app already keeps every landable body's surface mix from your own scans, across every journal on disk. Today that is 227 bodies in your 28 colony systems. Spansh's cached figure stands in only where you have no scan (36 bodies in Wregoe MF-T a113-0, Wregoe DH-Y b55-4 and Antliae Sector DL-Y d86) and is labelled. No lookup is made, so the tab works offline. A landable body with no figure from either is counted under the table, never shown as zero.
- **Icy bodies are listed, never leading.** They sort after the others and are dimmed (111 of the 263 today), with a checkbox to hide them. The richest body named for a material is the richest that is not icy, when there is one.
- The share is the material's part of the body's surface mix. It is not a drop rate. Colony systems are the ones with a project or marked as colonised, the same list the Surface Mining page calls My systems. Its own Materials table is unchanged.

## [1.62.7] — 2026-11-12

### Changed — approach overlay
- **CURL ROUTE ADVISED is retired.** You never curl by design, and both approaches flown on 1.62.5 heard the call and landed. Replayed over the file it showed on 74 of 300 Panther port approaches, and 65 of those landed, at the site's usual time. The countdown that raised it now says DECREASE SPEED for as long as it lasts: it still reaches 9 of the 10 thrown-out Panther runs, 12 to 15 s before the ship left supercruise. A red-zone entry is said once, as ENTRY TOO SHARP in the three seconds after the line. One thrown-out run (15 Sep, Kewell Range) had the curl call 20 s ahead from the angle alone; it now gets DECREASE SPEED 13 s ahead.
- **How the crossing went, at the pad.** Under the sector lines the overlay says where you crossed the line against the target as it stood: `Crossed 0.86 Mm · 0:05 · target 1.15 Mm · 0:07 · ENTRY HOT`. Green when the entry was on track, yellow when it was hot, sharp or early. The same pair is kept on the run and shown in a new *crossed the line* column on the Approach page.
- **A site that is not on file shows its body's target on the first approach.** The app only learns where a new site's pad is a few seconds before the glide, so no run can open before the line. The body's target is known, so it shows on its own while you come down, above the line, toward a destination on that body that is not on file. It needs three qualifying crossings on the body. Not seen in flight yet: the destination's body id is taken from a live capture of a mining site (3 Sep) and matches the id your ports are filed under.

### Fixed
- **Approaches flown with the exe closed no longer appear as empty runs.** The journal catch-up added in 1.62.4 replayed them through the approach recorder at the next start, and the recorder wrote runs with no fixes: three at Russo Expedition from the evening of 11 Nov. The recorder now ignores a replay, a run that closes without a single fix is not written, and the three already in approach-runs.jsonl are left out on load. The file itself is not touched.
- **Airless worlds are airless to the co-pilot.** Bodies 1 a and 1 c are scanned with atmosphere type "None", and the co-pilot was told they have "a none atmosphere — it tints the sky" at Deshpande Plant and Kewell Range, on every line that used the body's facts. It is now told there is no atmosphere, and no air, wind, haze or weather to speak of.

## [1.62.6] — 2026-11-12

### Fixed
- **Every site on a body you have landed on has an entry target.** 1.62.5 gave a site its target only once three of its own crossings counted (on track by the angle, 0:07 or over at the line, landed). Six of the fifteen sites had none, Russo Expedition among them: on the first approach flown on that build the overlay showed nothing for the first twenty seconds, then the old verdict words. A site short of three now borrows every such crossing on the same body, each judged at its own site, and shows the target from its first fix: Russo Expedition and Hawkins Foods `1.15 Mm · 0:07` (7 crossings on 2 f), Galitzki's Habitat and Ngidi Biological Enterprise 1.10 (40 on 2 b), Kabbah's Castings 0.80 (5 on 1 b), Skov Prospecting Complex 0.80 (9 on 1 c). The line sits at one height for a body (678 to 730 km up at the five sites on 2 b), and the three sites there with targets of their own read 1.10, 1.10 and 1.00 against the body's 1.10. A site takes over at three crossings of its own; the nine that already had one keep the same figure. The Approach page's card says which of the two it is showing, and shows a target at a site with no clean run of its own.
- **Still without a target:** a body with fewer than three such crossings in total, and the first approach to a site that is not on file yet — the app learns where that pad is a few seconds before the glide, so that run has nothing before the line.

## [1.62.5] — 2026-11-10

### Changed — the approach coach, from a replay of every run on file
All 329 recorded approaches were replayed through the recorder, in the order flown: 300 Panther port approaches, 10 of them thrown out.
- **The entry as a target: the Mm and the countdown.** Before the line the overlay now shows one thing where the site has it: the range to cross the line at and the countdown to show there — `0.85 Mm · 0:07` at Deshpande Plant. The range is the middle of your own crossings at that site that were on track by the angle and at 0:07 or over, and landed. Three are needed; 109 such crossings are on file across all sites and none was thrown out. Ivaschenko Holdings 0.75 · Kewell Range 0.80 · Carrizo Synthetics Silo 0.80 · Deshpande Plant 0.85 · Forward Vista 1.00 · Atmo Sky Cairn Asc 1.05 · Core Boson Complex 1.10 · Richardson Survey 1.10 · Giudice Forge 1.15 Mm, each at 0:07. The Approach page's card shows the same target with its count; it used to copy your fastest run's own crossing, which was at 0:06 at Deshpande Plant, Core Boson Complex, Kewell Range and Richardson Survey.
- **The verdict on the entry comes at the crossing.** ENTRY HOT, ENTRY SHARP, ENTRY TOO EARLY or ON TRACK shows for the three seconds after the line, read from the crossing itself. A read before the line was late: the countdown is still falling there (a median 2.4 s over the last three seconds, on 198 of 241 runs), and it missed 61 of 101 hot crossings. A site without three crossings for a target keeps the verdict words before the line.
- **ENTRY HOT.** The countdown at the line now counts toward the verdict on the entry, beside the angle. Crossed at 0:06 or under: 6 of 92 thrown out. At 0:07 or over: 3 of 188, and those three were sharp by the angle. Hot or sharp, 9 of 141; neither, 1 of 159. The crossing's own countdown is read on the first fix after the line.
- **A hot entry switches the speed words on**, as a sharp one always has. Four of the ten thrown-out runs crossed on track by the angle and heard nothing on the way down. Replayed, DECREASE SPEED / CURL ROUTE ADVISED now reach 9 of the 10, 11 to 20 s before the ship left supercruise (it was 5). The price: on runs flown as they were, the curl call shows on 74 of the 300 instead of 37.
- **DROPPING SHORT.** New word in orbital cruise: on a descent from the line, between 200 km and 40 km up, while the pad is less than 35° below the ship. It clears when the pad is 38° down. The pad was under 35° in that band on 120 of 290 Panther descents; the 104 still short at 40 km began the glide a median 38 km out and landed 8 s over the site's usual line-to-pad time, the 16 that recovered first landed 5 s under it, and the 170 never short 3 s under it. It ranks under the speed words and over INCREASE SPEED. A hop between two ports on one body never hears it.
- **A broken glide is judged against the site.** Glides end 3.0–4.7 km up depending on the site, so one fixed 5 km flagged good glides — three of the nine runs at Carrizo Synthetics Silo, where they usually end 4.7 km up. A glide is now broken when its flag clears more than 5 km above where glides usually end at that site (3 km until a site has three glide ends on file). Of the 21 runs flagged, 12 now count (they ended 5.2–7.4 km up) and 9 stay broken (10–30 km up after 3–8 s of glide). The flag is read again on every load; approach-runs.jsonl is not rewritten. No site's shortest run changes. Two best sectors do (Atmo Sky Cairn Asc S1 25 → 21 s, Richardson Survey S2 8 → 7 s), and the glide corridor on the slope widens at five sites (Core Boson Complex 20–80° → 9–80°, from the 23 Sep glide flown level at 7.4 km).

### Fixed
- **The approach recorder keeps up again.** On every fix it rebuilt the whole reference for the site, and with 87 runs on file at Core Boson Complex one rebuild took about a second (0.6 s at Deshpande Plant) — longer than the gap between fixes. Fixes per second there fell from 0.86 in September to 0.45 on 6 October, with gaps of 2–5 s on some runs since, so every overlay word arrived late and the exe did little else during a descent. The reference is now kept until a run is added, and its envelope is built in one pass. All 46 site summaries come out identical, in 0.09 s instead of 12.4 s.

### Corrected — two figures from the 10 Nov analysis
- **"The entry angle does not predict a throw-out" was measured on a stand-in** (the angle down to the pad at the line, 6 of 123 against 4 of 166). On the overlay's own verdict, replayed, sharp entries were thrown out 5 of 51 and everything else 5 of 249. The sharp words stay; ENTRY HOT is added to them, not swapped in.
- **The countdown figure left out three September throw-outs** whose line mark carried no countdown (5 of 81 against 1 of 172). Read from the first fix after the line, they crossed at 0:07, 0:10 and 0:05: 6 of 92 against 3 of 188.

## [1.62.4] — 2026-11-04

### Fixed
- **Events written while the exe was closed are no longer skipped.** The journal reader started at the end of the current journal on every start, so a dock, jump or market visit made while the exe was down was never processed live — only a Sync All found it. Your 2 Nov dock at Atmo Sky Cairn Asc, made in the minutes between closing one build and starting the next, is how it showed: the station stayed with Pro-JDP League on the Factions page though the game had reported the Order of Copernicus. The reader now writes where it stopped (`journal-position.json` beside the exe) after every tick, and the next start carries on from there — the rest of that journal, then any newer ones — with overlay banners and live pushes muted for the old events. Docks de-duplicate by timestamp, the co-pilot and screenshot reader already ignore anything older than two minutes, and the surface-mining ledger is left to its own backfill. The first start after this update has no saved position and behaves as before; a Sync All still fixes anything older.

## [1.62.3] — 2026-11-02

### Fixed — a paid line is never thrown away
- **Every screenshot line is spoken.** Four of the six vistas you shot on 2 Nov were read, paid for, and then silenced by checks added in 1.62.1–1.62.2: a distance printed on the HUD (8.07 km, 9.85 km, 5.30 Ls), the humour dial, and "too long (50 words)" for the magenta gas giant. All of those checks are gone. The rules now live only in the prompt; the one post-processing left fixes text instead of dropping it: your commander name and "CMDR" become "Commander", a carrier callsign becomes the carrier's name (or goes), a ship called "she" on a vista becomes "it", stray markdown is stripped — and the photo records what was changed. Gone too: the "newer shot taken" and "over two minutes old" silences; two shots eight seconds apart get two lines. A station screen whose representative is already known tells the model so, and whatever it says instead is spoken. The only hold left is your own rule: not a word in combat.
- **Same rule for every live line.** The 1.62.0 near-copy backstop could drop a paid line it judged too close to the last one for that moment (it dropped none on 2 Nov, but it could). It now only notes a near-copy in the exe window; the line is spoken. The no-call gate — the same facts within three hours buy no line at all — stays, since it saves rather than wastes.
- **A gallery edit in the browser no longer wipes the server's photos and reads.** The browser saves the whole gallery on every caption edit, upload or reorder, and the server replaced its file with that copy — so one save threw away every F10 shot adopted since that tab loaded, and every co-pilot read on photos the tab already knew. Screenshot_0046 (the second Thagard's station screen, 2 Nov) was adopted, read and paid for, then gone that way. A save now merges: the browser's captions and order stand, the server keeps its urls, deposit flags, descriptions and lines, and photos the browser never saw stay. Removing a photo is explicit (the delete button). The browser also refetches the gallery when the server announces a new shot or a finished read.

## [1.62.2] — 2026-11-02

### Fixed
- **The co-pilot talks about your shots again.** Your Deshpande approach (Screenshot_0044) and the Old Tin-Can (Screenshot_0045) were read and described, but the line was thrown away by its number check, which only trusted numbers from your journal. Re-reading 0045 showed what Tycho had said — "9.85 kilometres to the Old Tin-Can, and from here the whole carrier fits under one targeting reticle… Humour's at 90, so I'm legally obliged to call it the world's largest hood ornament" — dropped for "9.85" (on screen) and "90" (your humour dial, which his prompt invites him to quote). Numbers printed on the shot (as read into its description) and Tycho's own dials now count.
- **Your carrier by name, never a misread callsign.** The 0045 description called the Old Tin-Can "KBR-M2X" (it is K8R-M2X). The shot's context now names your carrier, callsigns are stripped from stored descriptions, and a line with a callsign isn't spoken.
- **No speeds or angles in screenshot lines** — your overlay rule, now checked for these too.
- **Why a shot stayed quiet is kept on the photo** (no line from the model, a newer shot, a known representative, or which check dropped the line), so a silent shot can be explained from your data instead of the exe window.

## [1.62.1] — 2026-11-02

### Fixed
- **The co-pilot reads shots taken near a planet.** 1.62.0 skipped any F10 the surface-mining log had a marker for — and that log writes a marker for every shot that carries coordinates, docked at a surface outpost included — so your station screen at Thagard's Progress was never read; only shots in space were. It also matched by file name, which the game reuses (two Screenshot_0041s: a 3 Sep deposit and the 2 Nov station screen). A shot is now skipped only when it is a deposit record by the surface page's own measure: taken under 200 m while surface mining is under way (in the SRV, a collection open or a tonne refined in the last 20 minutes). Station screens, flyovers and ground-level vistas when you're not mining are read.
- **"Also delete the original" can no longer delete the wrong screenshot.** On the Surface Mining page, deleting a deposit photo with that box ticked removed whatever file in Pictures had the photo's name. With names reused, deleting the 3 Sep Screenshot_0040 or Screenshot_0041 deposit photo would have deleted your newer Thagard's station screens instead. The original is now deleted only when a marker names that file at the photo's time and the file on disk dates from that marker; otherwise it is left alone, and the page says so.

## [1.62.0] — 2026-10-30

### Added — the co-pilot looks at your screenshots (Anthropic API)
- **Every F10 is read once.** With the co-pilot on the Anthropic API, each screenshot gets a short factual description and Sights tags, kept on the photo and shown under it in the gallery viewer. One call per shot, counted on its own *Screenshots* row in the API tally; *Co-pilot looks at your screenshots* in Settings turns it off.
- **Station representatives are kept.** A shot of the station services screen ("Connected to …") stores the representative — title, name, greeting — and what the screen says about the owner on that station's record, shown on its system page under the faction. Kept only when the screen names the station you are docked at. Station opinions and docking lines can use the name.
- **It sometimes says something about the shot.** Only for the last shot of a burst, within two minutes, in the game and out of combat: a vista gets a line, a station screen only when its representative is new to the app, any other screen only when something on it is worth a remark.
- **Never kept or said:** your commander name (or anything after "CMDR"), your credits, other players or squadrons — the prompt forbids them and the app drops any that slip into the description or the station fields. Shots that record a surface-mining deposit, and old shots adopted at start-up, are never read. A scaled copy of the shot (1,568 px on the long edge) is what goes to Anthropic; the original in Pictures is only read.

### Fixed — repetition you were paying for
- **The same news no longer buys a new line.** From 29 Oct, 13 of 32 paid lines were near-copies of an earlier line for the same moment (supercruise assist 6 of 9, the carrier docking request 4 of 5). Each moment now remembers the facts it was given for three hours, and the same facts again means no call — a free canned line where the persona has one, otherwise quiet. Supercruise assist speaks for a new destination; the carrier speaks when its free space moves a band (tens of loads of the ship you're flying while there's room, every load near the end); docking at the carrier no longer repeats the free space the docking request just gave.
- **It sees what it said last time.** The don't-repeat list was the last 8 lines of anything, and on a haul loop the previous supercruise line had scrolled out of it by the next leg (12 of the 13 copies). Each moment's own last three lines now go in the prompt, and a line that still comes out a near-copy (30% shared words, or the same opening and 20%) is not spoken — the exe window logs it. The Cockpit buttons always answer.
- **No more words handed to it.** The supercruise instruction carried "I've got the ship, sit back, I'll fly us in", and all nine of those lines were variations on it; the rules gave "it handles like a brick" as an example. Both are gone, and the supercruise line now knows where the leg is heading.

### Fixed — from your ratings
- **The carrier's free space counts loads of the ship you're flying.** The co-pilot read the 1,304 t in Settings (the Panther's hold) while you flew the Type-8 (384 t, from the journal), so 16,709 t free came out as "twelve Type-8 loads" — it was 43. The same figure drove its "one hold-load from finished" advice. It now uses the flown ship's capacity; your Settings value is unchanged for the planning pages.
- **Tycho quotes his real humour dial.** A canned line said "My humor setting is at forty percent" with yours at 90; it now says whatever the dial says.
- **No knocking the ship's handling.** "A Type-8 that steers like a filing cabinet" was the model's own invention; the rules now forbid claims about how a ship handles. Your Type-8 is nimble.

## [1.61.4] — 2026-10-30

### Fixed — from your co-pilot ratings
- **It calls you "Commander", never your gamer tag.** The prompt handed the model your commander name, and the voice reads it badly; it now says to address you as Commander and never by name.
- **An oxygen world is an oxygen world.** A 0.14% trace of sulphur dioxide on AX-J d9-52 2 b (99.86% oxygen) made the prompt call the air "sulphurous and acrid", so Tycho described "thin sulphurous air". The atmosphere is now described by its type only, and "sulphurous" only when sulphur dioxide is the type.
- **Your own construction site is yours, even on the first docking.** Station opinions on a first visit couldn't see which system the station was in (the fact sheet read the wrong field), so Forward Vista came out as "verdict pending" with no idea you were building it. The system is now read correctly, and a construction site in one of your own colony systems counts as your build from the first clearance, before the app has made its project.
- **No "the station is rotating" at a surface pad.** Docking lines that only make sense in an orbital station are no longer picked when you dock on a planet.
- **Removed Tycho's "the ship cannot do ninety percent of light speed" line** — the game has faster-than-light travel.

## [1.61.3] — 2026-10-29

### Added
- **A tally of your Anthropic API use, on the Cockpit and in Settings.** This month's spend against your cap (with a bar that turns amber at 80% and red at the cap), the number of calls, today's spend, the average cost of a call, the split between ordinary lines and station opinions, failed and refused calls, the tokens (fresh input, cache reads, cache writes, and output including the model's thinking), the last call (when, what for, what it cost, how long it took) and earlier months. Every figure comes from the API's own usage counts in `copilot-spend.json`. Hidden on the Cockpit for anyone not using the API; the Cockpit's session line now says *billed to your API credits* when the API is on, instead of *Max-sub equiv, not billed*.

## [1.61.2] — 2026-10-28

### Added
- **Materials: where to trade each material.** The page now says which trader deals a material and where the nearest one is — the thing it never told you (Electrochemical Arrays: a **Manufactured material trader**, found at Industrial stations). A card at the top lists the three kinds of trader — Raw (Extraction or Refinery stations), Manufactured (Industrial), Encoded (High Tech or Military) — with the nearest station of each from where you are, its distance and how far it sits from the arrival star, and the next two. Each Inventory section and the Trade Planner's target say the same for their materials; every ingredient on the Engineering tab is tagged with its trader; Guardian and Thargoid materials are marked as not sold at traders. The trader kind is always known offline; the stations come from Spansh's station search (cached six hours), or from the stations you have docked at when Spansh can't be reached.

## [1.61.1] — 2026-10-28

### Fixed
- **Commander's Log: a night spent fighting a war read "quiet".** Conflict-zone kills are paid in combat bonds, not bounties, and the log never read them. It now does: each sitting with bonds gets a **war night** entry (notable, ⚔️, searchable as *war*, *combat*, *conflict zone*, *bonds*) saying where, who you fought for and against, how many conflict zones you fought in by intensity (a drop that scored no kill is not counted — dropping in and leaving is not fighting there), the kills, the bonds earned and what you redeemed — e.g. "War at Col 173 Sector AX-J d9-52 for The 9th Legion against HIP 104349 Ring: 3 conflict zones (2 low, 1 medium), 17 kills, 858k cr in bonds · 2.2M cr redeemed". The sitting's own line shows the kills too. The journal never says who won a zone, so the log never claims it.
- **Commander's Log: hauling and trading evenings read "quiet" too.** Each sitting's line now also says the tonnes delivered to builds, moved to your carrier, bought, and sold with the profit (mined goods count in full) — e.g. "2,322 t delivered to builds · 3,071 t bought · 1,342 t sold, +60.1M cr". Buying from or selling to your own carrier is a stock move between your own holds, so it is left out of bought, sold and profit.

## [1.61.0] — 2026-10-28

### Added
- **The co-pilot can run on your Anthropic API credits.** Settings → *Live lines written by*: **Claude CLI on this PC** (your Max login, as before) or **Anthropic API** (your credits). The key is one line in `anthropic-key.txt` beside the exe — read by the server only, never stored in `colony-data.json` (which syncs to every device), never logged; Settings only shows whether it was found. Every call is priced from the API's own usage counts into `copilot-spend.json` against a monthly cap (default $100) — once reached, canned lines only. Model: Opus 5.5 (default), Sonnet 5.5 or Haiku 5.5. No key, or the CLI picked, and nothing changes.
- **Station opinions (API only).** When docking is granted, the active persona gives its own take on the station, built from a fact sheet of what the app actually holds: the station type and how many pads fit your ship, distance from the star, services, the economy mix, population, security, allegiance, the owner's government, state, influence and your standing, wars with their stakes and days won, the world it sits on or over, the system's stars, your history there (built it, own colony, a grudge, times it turned you away), other pilots docking there in the last 30 minutes, and the market (prices against the galactic mean, the persona's own kind of goods, slaves, what your builds still need). **Checked before it is said:** every cited fact exists, every number comes from a cited fact, the verdict follows from how those facts pull that persona, a change of mind cites what changed, never "she/her", never a co-pilot's name, Wren never leads with a number, no echo of a recent line's opening or wording — one rewrite, then silence. **Remembered** per persona per station in `copilot-memory.json` (copied once to `copilot-memory.before-opinions.json` first): next visit it sees its old take and what changed; a station where nothing changed stays quiet (a fresh take after three weeks and five more visits); a 👎 drops the take. Other dock-time remarks hold off for 15 minutes after a take. Mid-haul: a first take only, one short sentence.
- **War table kept from the journal.** System faction readings now keep the Conflicts table — each side's stake and days won (filled on the next jump in or Sync All).
- **Turn-away counter.** Docking denials per station, counted from now on and back-filled once from every journal on disk (in the background at startup).
- **Nearby right now.** From EDDN, per station, for the last 30 minutes: other pilots cleared to dock, docked and turned away, and market uploads. Memory only, counts only, your own uploads excluded.

### Changed
- **Economy reactions follow the station's economy mix,** as the persona spec asks, not just its label: a Colony station with a strong Agriculture side now gets Wren's reaction. The journal's economy proportions are weights, so they are compared with the main economy and never quoted as percentages. A station whose main economy is Damaged, Rescue, Repair, Prison or Terraforming gets no economy remark.
- **The ship is never "she".** 150 canned lines, 9 surface-mining lines and every prompt and scenario text now say "the ship", "it" or its name; the persona rules and the line generator forbid "she/her" for a ship or fleet carrier. Wren is unchanged.

## [1.60.40] — 2026-10-27

### Added
- **Ship Stable lifetime: combat, more distance, and what each ship earned.** Click a ship: **Combat** — ship kills (bounties) and combat-zone bonds while it was the ship, the bounty and bond claims, player kills, and its three commonest victims; kills in an SRV or on foot are left out, and a fighter you fly yourself counts for the ship that carries it. **Flying** adds the distance ridden on your carrier while docked aboard, systems visited, and the farthest point from Sol. **Work** adds **Earned**: trade profit (mined goods count in full), community-goal sales and rewards, missions, exploration and combat claims, with the split on hover — community-goal deliveries go through the market, so they are told apart from ordinary trade by the game's own goal list.

## [1.60.39] — 2026-10-26

### Fixed
- **A system's facility populations add up to its population again.** "A facility's population never goes down" was applied as max(share, floor) over a split of the whole reading, so a port opening beside facilities held at their floors took a full share on top of them: at home the estimates came to 328.3M against the journal's 303.1M and the shares to 108%. Now a facility whose share falls below its floor is held there, and the rest share what is left of the reading. At home Sky Cairn, Deshpande, Kewell and the small sites keep their 7 October figures and Core Boson Complex carries what the system has grown since it opened. The overlay, the system page and the Installations page use the same split.
- **A renamed station's project follows the new name.** A dock at a finished station that the game has renamed now renames its completed project too, keeping the old name in its history; a name you typed yourself is left alone. Approaching a settlement or planetary port is enough: the journal's approach line names it by market id, and a known station takes the new name from it.
- **Hibberd Astrophysics Laboratory** (formerly Ngidi Biological Enterprise), still typed as its construction depot, is now a Large Bio Settlement under its new name, and **Richardson Survey**, stored as an orbital scientific outpost though the game docks it as a surface outpost, is a Scientific Surface Outpost — it now carries the surface-outpost weight in the split. Core Boson Complex's floor, raised by the overshoot on 25 October, was reset once so the corrected split could stand.

## [1.60.38] — 2026-10-26

### Added
- **Ship Stable: engineering at a glance.** Each ship row shows its core modules — thrusters, FSD, power plant, distributor, shields, life support, sensors — lit with the grade when engineered (✦ marks an experimental), dim when stock, struck through when not fitted, followed by the engineered optional modules grouped ("5× cargo rack G5"). Hover a chip for the blueprint. A new "engineered" filter.
- **Ship Stable: lifetime per ship.** Click a ship: jumps, light-years, longest jump and neutron boosts; tonnes bought, delivered to colony depots and refined; bodies scanned and first discovered (each body once per ship); and the engineering crafts made on it, by engineer, with first and last dates. Every event in the journals is credited to the ship being flown at the time. The server reads the journals on demand and keeps each file's totals, so after the first visit only the active journal is read again; nothing is added to the stored state.

### Fixed
- **The Commander's Log put a night's missions in the wrong place.** A sitting's missions line named the sitting's first jump, so 55 missions handed in across nine systems on 25 October read "Missions at Col 173 Sector UW-Q b35-1", where one was. The line now names where they were handed in, busiest first ("Missions: 55 in 9 systems, AX-J d9-52 20, AX-J d9-34 9, VW-Q b35-0 8 and 6 more: …"), links to the busiest, and shows every system on hover. The log is rebuilt from the journals, so past nights read correctly too.

## [1.60.37] — 2026-10-26

### Fixed
- **1.60.36 opened as a fresh, empty app after a restart.** The 1.60.36 change that stopped the double fetch also made every push and every reconnect call the store's rehydrate the moment it arrived. The store library cancels a hydration that a newer one overtakes, so with pushes every few seconds each 30 MB load was thrown away before it applied and the pages never filled; the wipe guards kept the server's data intact throughout. Hydrations now run one at a time, a request made during one runs once more afterwards, and the first load is never cancelled.

## [1.60.36] — 2026-10-26

### Fixed
- **Your data shows up faster, on every device.** The state every browser holds was 30 MB, fetched twice on every change (the push handler fetched it, then the rehydrate fetched it again) and never compressed. Now: one fetch per change, gzip on the wire when the browser accepts it, and Sync All collapses the FSS signal list to one row per system and signal with the latest sighting — 107,627 rows (16 MB) become about 7,700 — since the pages only ask which station signals a system has. Run Sync All once after this build to shrink the file.
- **A quieter console.** The overlay says once that it is disconnected (and once when it reconnects) instead of a line for every dropped banner line; the approach recorder's once-a-second samples no longer log a broadcast line each; the live-price ladder summarises its first pass after boot in one line and logs only price changes after that.

### Added
- **Factions page: a Holds column**, every station in the system under the faction your last dock there reported, with type, pads and the dock date; stations never docked at are listed as "owner not on file".

## [1.60.35] — 2026-10-26

### Changed
- **Factions is its own page.** The faction guide moves off the system page to `/factions`: pick a system (your colonies, where you are, or any system with a jump-in reading), star factions there, and open each faction's block for its sell / buy / loops / mining / evidence detail. Blocks start collapsed to one line.
- **The system page shows factions below the installations**, as a compact table with the stars and a link to the guide, instead of four full blocks ahead of the system's own content.

## [1.60.34] — 2026-10-26

### Fixed
- **System pages hung in 1.60.33 ("Page Unresponsive").** Two causes. The Factions panel's star and the faction guide each selected the starred list from the store with a fallback that built a new empty array on every render, which the store reads as a change and re-renders without end; both now select the stored entry itself. And the guide looked up the best known price by scanning every snapshot row for every sell line, four regexes a comparison; it now builds one index per guide. A full guide for the home system builds in milliseconds.

## [1.60.33] — 2026-10-25

### Added
- **Ship Stable** (`/ships`): every ship the journal has described, from its Loadout — where it is and what a transfer costs (the last fleet list read at a shipyard), pad size, jump range unladen and laden, cargo, speed and boost, shields, the craft it carries (SRV bays and whether the Rhino fits, fighter hangar, vessel bay) with the last craft that launched from it, and rebuy. The ship being flown is pinned; filters for medium-pad ships, Rhino bays and fighters. Speed and boost come from the thruster mass curve with the ship's own engineering, checked against the Type-8's in-game 538 boost; jump range from the FSD model, which reproduces the journal's own figure for every ship on file (the Guardian booster included); shields from the generator curve and boosters, which give back the shipyard screen's figures for the Corsair (296), the Kestrel (556), the Type-11 (486) and the Mandalay (283). Speed, boost and laden jump were checked the same way on the Corsair, Kestrel, Panther, Caspian, Type-11 and Mandalay. Hull figures are Frontier's as published by coriolis-data, except where the shipyard screen disagreed (Caspian 825 t and Mandalay 190 t of hull, as the screen shows); the Lynx Highliner's base figures are back-solved from its screen, and the Anaconda Mk II shows n/a until its figures are read. Each row says which Loadout it is computed from, since a refit only shows once the ship is boarded again. Sync All backfills the stable from every journal; the live watcher keeps it current.

## [1.60.32] — 2026-10-25

### Added
- **Star a faction, and the project pages in that system buy from it first.** On a system page's Factions panel each row has a ★. With a star set, a needs-table row picks an in-system station of a starred faction that stocks the item — even when it cannot cover the whole need — and shows the plain pick beneath it as the fallback. Every source line now names the station's faction and the number of loads for the current ship's hold. No star: nothing changes.
- **Faction guide** under the Factions panel: one block per faction with its influence and last change, a "locked" badge while it is in a conflict, its stations and pads with the age of each market read, **sell here** (what its markets pay for, anything you hold on the ship or carrier first, beside the best price you know anywhere), **buy here** (how much of the system's active projects it can supply, and what it cannot), **loops** (the best buy-elsewhere-sell-here pairs in the system, sized to the hold, dated by the staler snapshot), what **your rigs have mined** on the system's bodies that it buys, and every **mined-goods sale** you made to it with the faction's reading before and after — the evidence for whether mined sales move influence. All from your own journal reads; nothing external.

## [1.60.31] — 2026-10-25

### Fixed
- **A device with an old copy of the state can no longer put a month-old market snapshot back over a fresh one.** The Thagard's Progress and Rankin Legacy markets were read on 23 October and the snapshots saved, but on 25 October a tab that had loaded the state before those reads pushed its 23 September and 9 October copies back, and the needs table sourced from a month-old market. The server now drops a client upsert on a dated map (market snapshots, known systems, system factions) whose stamp is older than the stored record's and logs the sender; the browser leaves such records out of its PATCH and reports it to the exe terminal. Server patches and equal-or-newer records are unaffected.

## [1.60.30] — 2026-10-07

### Added
- **"Last here" on arrival.** The distance line on every jump now ends with when you were last in the system and which visit this is — "Last here 2 Sep (4 weeks ago) · 77th visit" — or "✨ First time in this system". It reads the system record as it stood before the jump. The station welcome gets the same under its visit line: "📅 last docked 2 Sep (4 weeks ago) · 2y of history".

### Fixed
- **A construction project no longer keeps a "Depot 3964283138" name.** Two causes, both seen at Plait Reach on 7 October and at Kewell Range on 14 September: the watcher starts at the end of the journal, so a dock made while the exe was down was never seen and the first depot event had no station to name the project after; and once Sync All filled the system and station in, nothing rebuilt the placeholder name. The watcher now seeds the current dock from the active journal file at boot, and every path that completes a project's identity — the live depot tick, Sync All on the server, Sync All in the browser — rebuilds a placeholder name. A name you typed is never touched.
- **An installation's finished name comes from its construction site.** A completed project took its finished name only from a dock at the finished station, which an installation never gets, so "Dock to Register" could never clear and the Installations page showed "type?" beside a construction-site name. "Orbital Construction Site: Plait Reach" now completes as "Plait Reach", on the server and in the browser's Sync All.
- **Visit counts survived only until the next jump.** A live jump replaced the system record with that batch's own count — HIP 47126 read visit 1 with 77 arrivals on file — and dropped the fields a jump event does not carry. The live write now merges: counts accumulate, body count and the rest survive. Sync All still recounts from the full journal.

## [1.60.29] — 2026-10-07

### Changed
- **A new facility grows into its population.** The split gave a port a fully grown port's weight the moment it existed: Core Boson Complex read 84M at the first dock after completion, on 7 October, while the system's own reading stood at 201M, up 1.7M on the day — the burst had not begun. The commander's measurements say what a port actually does: Sky Cairn opened 8 July, read +98K two days later and then climbed 5–6.5M a day to +58M by day 12. A facility with a known opening date now carries its measured addition in proportion to its age over the class's measured window (12 days for planetary ports, 14 for the rest), so a port that opened this morning weighs nothing yet and the figures beside it do not move; the banner reads "👥 Population ~0 (est.) · opened earlier today" and climbs with the system's readings. Facilities whose opening date the app never recorded keep full weight, as before. A figure still at zero is never written as a floor. The Installations page marks a ramping site "growing", and every tooltip carries the age and the fraction.
- **Installations page: the Haul column is gone.**

### Fixed
- **A finished station completes its project at the dock.** A project was marked complete only by a depot reading carrying the game's complete flag, which reaches only whoever is docked at the depot as it crosses 100%: Core Boson Complex crossed it between the last depot reading (99.5%) and the next dock, at the port itself, typed CraterPort, and stayed "active" with a construction-depot type in the dossier. A dock at an active project's market id as a non-depot station now completes it at that time with the dock's name and type, and a live dock's type replaces a construction-depot type (a type the commander set still wins). The CBC record is completed in the data as of that dock and its 84.4M floor removed.
- **A remove-only state op on a map key emptied the whole map.** `mergeStatePatch` sent every `{ __remove }` op without an `__upsert` down the primitive-set branch, which read the map as an empty list and wrote back an empty array. The 1.60.25 manual-population cleanups (the watcher's and Sync All's) are written remove-only, so the first one that fired — the home-system login reading of 5 October (199M) overtaking the stale 154M entry — emptied all 557 manual populations, the 18 the rule keeps included. Threats "unflag" (`watchedSystems`, also a map) carried the same latent wipe. The branch now follows what the key already holds; the merge and the append-only list moved to `server/journal/statePatch.js` with tests.

## [1.60.28] — 2026-10-05

### Added
- **Installations page.** Every site across the colonies in one table (nav: Installations, after Architect's Domain): site and body, system, type, estimated population with its share of the system — the measured-additions split with the 1.60.26 floors, the same split the system page and the dock banner use — the market's economies as the journal last recorded them at dock (pick one in the filter to list only the sites carrying it, ranked by its strength), Raven Colonial's tech / wealth / development effects and typical haul for the type, the commander's own bill where a project recorded one, opening date (project completion, else first dock), last dock and dock count. Search, filters by system, kind (ports / outposts / settlements / installations & hubs) and "with a market", every column sortable, a summary strip (sites, colonies, population sum, counts by kind). Rows come from the dock dossier, completed projects, manual installations and FSS signals; carriers, construction sites and colonisation ships never count, shed names dedupe renames, and a completed project that never recorded what was built shows "type?" instead of a guessed port. The journal writes every orbital outpost as "Outpost" (many as "SurfaceStation"): those are named by their market's economy — Military → military outpost, High Tech → scientific, Industrial → industrial, Colony → civilian, anything else commercial — and marked "(by economy)" until the type is pinned on the system page. New `src/lib/installationRows.ts` (the rows, pure) and `src/lib/ravenTypes.ts` (any station-type string the app meets → Raven's build entry — the mapping the ranking work of 2026-10-05 did by hand), both tested.

### Changed
- **The dock banner's population line reads "👥 Population ~27M (est.)"** instead of "Home to ~27M people (est.)".

## [1.60.27] — 2026-10-05

### Changed
- **The split's weights are the measured additions.** The commander's rule: add up what each installation adds to a system's population when it opens — the figures measured from the journals in 1.60.20's analysis — and that sum is the system's baseline; the system's current population is shared in proportion to each installation's part of it. The additions, now a table in `server/journal/populationEstimate.js` with value, spread, window, number of measurements and the events behind each: planetary port 58.4M (Chitty City +58.8M, Sky Cairn +58.0M, both by day 12), Dodec 26.5M (Volpe Radiante Horizon +25M to +28M in 14 days), surface outposts of any economy 11M (the commander's rule; measured at the civilian ones, Deshpande Plant +9.1M in 14 days and Kewell Range +12.9M), Orbis and Ocellus 16.6M (unmeasured, the Dodec scaled by Raven's pop 5 against 8, and labelled so), Coriolis and asteroid bases 0.44M (HIP 52629 under its first name, Sassoon Vision: 446,262 when its opening burst ended on 24 May 2025 — the opening itself fell in the 29 March to 16 May 2025 journal gap), outposts 55K (the commander's primary outposts two weeks after opening: 38K to 59K; they read 4,835 to 5,286 the day they opened, military ones 10,007 and 10,068), settlements 55K (by analogy; none has opened a colony and beside others their opening measured nothing), hubs and installations 0 (the commander's rule; nothing measurable at eight completions, Kamov Hub among them). Every entry is on the same two-week horizon. The generic journal "Outpost" with a military economy counts as a military outpost. The Raven-derived weights of 1.60.20 (58 / 27 / 17 / 2 / 1) are gone, the tooltip reads "adds 11M of the 81M baseline", and the 1.60.26 floors still keep every figure from going down. Home system at 196M: Sky Cairn 142M, Deshpande Plant and Kewell Range 27M each, the outposts and settlements 133K each, the two hubs nothing. HIP 52629 at 372M: Chitty City 368M, Kalian Port 2.8M.

## [1.60.26] — 2026-10-05

### Changed
- **A facility's population never goes down.** The proportional split re-divides the system total whenever the facility mix changes, so the day a second planetary port opens every other figure would fall — Deshpande Plant 5.6M to 3.1M at the same 196M — and climb back only once the system had grown past 358M. The app now remembers the highest figure each facility has shown and holds it until the split climbs past it again. Floors are written only by the server: at every jump or login reading for a colony, at every dock, and by Sync All; the system page and the dock banner display the higher of split and floor, and the page's tooltip says when a floor is carrying a figure and what the current share would give. Colonies only. The sum of the figures can exceed the system total while floors are holding; that is the rule's price and it is accepted.

## [1.60.25] — 2026-10-05

### Changed
- **The population split is purely proportional.** 1.60.20 pinned every outpost, settlement and hub at 1.9M a unit and handed the ports the rest, on the strength of one observation: the home system's seven-day stall at 16,953,270 with nine units and no port. That was a cap on a port-less mix, not a rule for a system with ports, and the game never allocates people to a station in the first place. Each facility's figure is now its weight over the system's total weight times the system's population — planetary port 58, Dodec 27, Orbis and Ocellus 17, civilian surface outpost 2, other outposts, settlements and hubs 1, installations 0 — so every facility rides the system's growth: Deshpande Plant reads 5.6M of 196M today and climbs with the system. The day a new port opens, the small facilities' figures dip until the port's burst lifts the total; that is the split sharing, not people leaving. The tooltip basis reads "weight 2 of 70".

### Fixed
- **Nearly every system wore a "manual" population nobody typed, and a real one never let go.** Sync All's auto-update created a population override for every system with a journal reading, copying the journal's own value and date: 549 of the 557 overrides on file were such copies, so the "(manual · date)" label meant nothing, and the live watcher never touched overrides at all — the home system showed a September 155M through three weeks of jumping in and out while the journal held 196M. A manual population is now only a figure the commander typed that is newer than anything the game has reported: every jump or login reading that is at or past an override deletes it (the watcher's patch path is trusted to remove, where browser tabs stay blocked), Sync All deletes the overtaken ones and never creates any, and the browser-side mirror deletes instead of overwriting. The five Wregoe colonies typed in March, where the journal still holds zero, keep theirs.

## [1.60.24] — 2026-10-04

### Added
- **The journal's System Factions panel, kept.** Every FSDJump, Location and CarrierJump carries the panel the right-hand status screen shows — each faction's influence, state (active, pending, recovering), government, allegiance, happiness and the commander's reputation with it, plus who controls the system; the app kept population and economy from that event and dropped the rest. One entry per system now holds the latest reading and a bounded history of earlier readings kept only when something moved, written live by the watcher and backfilled from every journal on disk by Sync All. The dock banner gains slot 11, under the trend line: `🏴 HIP 104349 Ring runs this place · 33.6% ▲ · Friendly` (with the faction's state when it has one), from the freshest reading so it can never assert a state the journal has stopped writing. The system page shows the panel above the installations: influence with its trend arrow (hover for the earlier reading), states, standing, government and allegiance, who controls the system, and the date of the reading. Not in the journal, so not shown: the panel's economy and security bars.

## [1.60.23] — 2026-10-04

### Added
- **The dock banner says how the place has moved since you were last here.** Slot 10, under the population line: `📈 The system has grown by 2.3M since your last visit (3 days ago)` (📉 when it has shrunk). Each Docked stores the system's population on the station's dossier record; the next DockingGranted compares with it and the Docked that follows refreshes the line before storing today's figure. The system is the subject because a small facility's estimate never moves while the system's total does; the line stays blank with no previous figure, no reading, or no movement. The companion offer — the station's age phrased as a place — was dropped: the banner already carries "📅 5 months of history" and "🛠 You established this…", and a third line on the same fact is clutter.

### Fixed
- **Deshpande Plant wore a June War for three months.** The game omits `FactionState` when a faction is in no state; the dock dossier (server merge and its client mirror alike) treated the missing field as "keep what I had", so the War the journal last wrote on 26 June stayed on the record through every dock since while the system faction list said None. A Docked event always names the faction, so a named faction with no state now clears the state and logs the change in the state history; only an event with no faction block at all, such as an FSS sighting, carries the record forward. Each station heals on its next dock.

## [1.60.22] — 2026-10-04

### Changed
- **The population line is part of the dock banner now, and says only the estimate.** It fired on the Docked event — touchdown — and sat in the scan slot at the top of the screen, while the welcome, economy, services and established lines all fire at DockingGranted and stack at the bottom; at the moment the banner was being read, nothing had fired yet, and when it did it was somewhere else (Deshpande Plant, 2026-10-05). It is slot 9 of that stack now, directly under "You established this…", fires at DockingGranted from the station's dossier record (the event carries no system), refreshes at Docked with the live event, blanks when nothing applies, and reads `👥 Home to ~3.8M people (est.)` — the location's figure alone, phrased as a place. The share of the system, the system total and the facility count stay in the system page's tooltip.

## [1.60.21] — 2026-10-04

### Fixed
- **The population line split a stale total and arrived late.** The home system carried a manual population override from 14 September (154.7M) beside the journal's 3 October reading (196M); the browser refreshes such an override when a newer reading lands, the server's copy does not, and the 1.60.20 overlay took the override unconditionally — "2% of 155M" at Deshpande Plant. Overlay and system page now share one rule: the journal reading unless the override is newer than it. The line also waited for Spansh behind the app's one-request-per-second clock, about five seconds after docking, and lasted ten. It now goes up at once from the app's own records, is re-sent under the same id only if Spansh changes the text, and stays for fifteen seconds. When a system has no population reading the exe console says so instead of staying silent.

## [1.60.20] — 2026-10-03

### Added
- **Estimated population per station.** The game publishes one population figure per system and nothing per station. The commander's own journals (5,312 readings, 48 observed completions) showed that a completion does not add a fixed head-count either — it changes the system's daily growth for about two weeks and the total then compounds toward a cap set by the facility mix. The app now splits the system total proportionally by that measured mix: installations, depots, carriers and megaships carry nothing; every other dockable is a unit worth up to 1.9M (the 16,953,270 cap the home system sat at for seven days with nine units and no T3 port), a civilian surface outpost counting double; the remainder goes to T3 ports by weight — planetary port 58 (the +58M burst seen at both Chitty City and Sky Cairn), Dodec 27, Orbis and Ocellus 17 (Raven Colonial's pop 5 scaled, not measured). Docking at a station puts one line in the overlay — `ATMO SKY CAIRN ASC — est. population 173M (88% of 196M · 11 facilities)` — and the system page's installations table gains a sortable "Est. pop" column whose tooltip states the basis. The facility count is the quality signal: the inventory is the union of the stations docked at, completed projects, FSS station signals and Spansh's station list (orbital under the system, surface nested under its bodies), so a colony carries the full list and a bubble system whatever Spansh has. One implementation (`server/journal/populationEstimate.js`) serves the overlay and the page.

## [1.60.19] — 2026-09-25

### Fixed
- **The Sell page sent the commander 804 ly to a buyer paying 44k.** On 7 September the game paid a flat 1,038,104 for every surface commodity at demand 999,999 for a day, and every station whose market was uploaded that afternoon still carries it in Ardent because nobody has docked there since. Ardent's top-100 buyer list for Thortveitite, Periclase Dunite and Iridium was 100 of those rows, and the plan applied a thirty-day freshness rule to the commander's own records and none at all to Ardent's. Now every buyer query asks Ardent for rows no older than seven days (honoured on the buyer lists), rows older than that are cut on our side too (the per-system listing ignores the parameter), and a demand of 999,999 on a market the journal does not list as a community goal is treated as the placeholder it is — on a listed goal market it stays, as real. The daily price sampler follows the same rule, and a sampled top at that demand no longer draws the history's galaxy line. Refresh now means a fresh pull: no cached plan, no cached Ardent answer. A price older than three days shows its age in amber.

## [1.60.18] — 2026-09-22

### Fixed
- **The needs table named sources that could not cover the need, and none at all for others.** Thagard's Progress was offered for 684 t of Evacuation Shelter with 39 t on file, Rankin Legacy for 2,634 t of Structural Regulators with 27, while Medical Diagnostic Equipment showed no source with 1,262 t on file at Oefelein Beacon 14 ly away. The scoring gave 50,000 points for being in the project's own system, at most 10,000 for stock, and took 100 per light-year — against a floor of −1, so every out-of-system station beyond about ten light-years was silently rejected and a token in-system stock always won. The hint now ranks on sufficiency first: a station whose stock covers what is still needed outranks any that cannot, whatever the system; among those, the project's own system, then nearest, then large pads; among the short ones, the largest stock. No floor, no cap. A short hint reads its stock against the need ("39 of 684 t"), the in-system partial is shown under an out-of-system pick, and a snapshot older than a week says so.
- **Live market snapshots wore the medium-pad badge whatever the station.** The watcher wrote pad size and the planetary flag as false for every snapshot it took, so a Dodec such as Cavallo Nero Corona carried an "M" on the needs table. Both now come from the station type Market.json names, as Sync All's reader already did; stored snapshots are repaired once at start, and Dodec joins the large-pad list under the name the journal actually writes.

## [1.60.17] — 2026-09-22

### Fixed
- **Pre-line guidance came too late to use, and "request docking" too early.** Replaying the day's runs against the recorder's own rule, the entry verdict was on the HUD for one to four seconds: the idle watch looked every 2 s and opened a run only after three closing fixes — 4 s into a gravity well that lasts five to eight at cruise speed — and judged the entry only inside the last five seconds. Now the watch looks every second, a run opens on two closing fixes, and the entry is read from the first fix that can be projected — an early read, marked "(early)", until the projection firms inside five seconds, when the last word before the line stands for the descent as before. A run opened by position below the line — a hop between two ports on one body never crosses a line — is orbital cruise from its first sample and gets the cruise words; it used to sit in "Gravity well" the whole way down (Kabbah's Castings from Carrizo: 36 s of nothing). And "request docking" now waits for the 7.5 km the game takes the request at, with a count-in ("request docking in 4 km") through normal flight and inside 12.5 km of the glide; it used to sit on the HUD from the glide's end, 32 s early when the glide ended at 19 km.

## [1.60.16] — 2026-09-21

### Fixed
- **A construction site renamed in-game kept its old name in the app.** Espinoza Obligation became Core Boson Complex Cbc while still under construction — same market id — and the app held the old name in the station record and the project. The dock handler refused any construction-site name as a new name, a guard written so a construction placeholder can never overwrite a finished station's name, which also blocked a rename from one construction name to another; and the depot handler only ever filled blank names. Now a construction-site name replaces a construction-site name (a finished station's name stays protected), the old name goes into the station's name history, and the project follows: its station name, and its display name only while it is still the auto-built "System - Station" — a name you typed is never touched. Sync All's project pass and the browser-side dock history follow the same rule.

## [1.60.15] — 2026-09-21

### Fixed
- **246 t of Microbial Furnaces in the hold, and the hauling tab counted none of it.** The game's own symbol for the commodity is `heliostaticfurnaces`; the dictionaries carried `$microbialfurnaces_name;`, a name the game has never written — not once across every 2025 and 2026 journal. Cargo.json is resolved by symbol, so the hold came through under the raw name and never met the project's need, which is resolved by display name. H.E. Suits (`hazardousenvironmentsuits`), Land Enrichment Systems (`terrainenrichmentsystems`) and Muon Imager (`mutomimager`) had the same defect. The four symbols are corrected in both dictionaries, so the hold, purchase history, carrier transfers and market rows all resolve to the right id; hauling sessions recorded under the raw keys are repaired once at start; and Ardent lookups now send the game's symbol — Ardent answers `heliostaticfurnaces` and rejects `microbialfurnaces` — which brings back nearby-source results and price samples for those four.

## [1.60.14] — 2026-09-18

### Fixed
- **The surface page asked for a DSS the journal no longer needs.** Since the journals of 6 September 2026 the FSS writes a body's Planetary Mining Location count the moment the body is resolved (FSSBodySignals — 119 bodies in this commander's journals against 29 with a DSS), and the page threw every one of those away, listing the body under Needs a DSS until it was mapped or the count was typed from the system map. The FSS count now lands in the signal record like the DSS one: a DSS outranks the FSS, the FSS outranks a typed count, and Sync All's backfill replays the FSS history too. The section reads Needs a scan, and an FSS-sourced count is marked. Spotted in Fumlop's RhinoSpotter, which reads the same event.

## [1.60.13] — 2026-09-18

### Fixed
- **A scanned system stayed unclassified, and Rescore did nothing.** Col 173 Sector YI-V c17-36: ten bodies scanned, no score, and Spansh had quietly become a requirement in three places. The live recorder was armed only by a hyperspace jump, so a relog into a system (a `Location` event — also the first thing the watcher sees after the exe restarts) left every scan on the floor. When it was armed, it took Spansh over the journal whenever Spansh held anything at all: one star on file outranked ten bodies just scanned, and the journal scans were kept only when Spansh had nothing. And the Rescore button read the journals through the browser's folder permission, which the exe flow never grants, so the read failed silently and every Rescore was Spansh-only. Now a `Location` arms the recorder (a relog into the same system keeps its buffer); Spansh scores a system only when it holds strictly more scan records than the journal, and the journal scans — this session's merged with the cache — are kept either way, so the system reads as so-many-of-so-many rather than "scan total unknown"; Rescore, Rescore All and Scan Journals ask the server to re-read the journals (one system's files, or all of them). A live rescore also keeps a record's favourite flag, notes, region and coordinates instead of dropping them.

## [1.60.12] — 2026-09-16

### Fixed
- **A project's source hint named a station that no longer sells the commodity.** Deshpande Plant was offered for Robotics at 1,653 cr and Bioreducing Lichen at 864 cr — the prices paid there in June and July — while its market today shows stock 0 and tens of thousands of tonnes of demand for both. The needs table's fallback to purchase history is gone: a source is a market whose latest snapshot shows stock and a buy price, and a commodity no snapshot covers shows no source rather than a guess. Markets change; where you bought something once says nothing about today.

## [1.60.11] — 2026-09-15

### Changed
- **ENTRY SHARP between the on-track band and the red zone.** A 76 s landing from a 0.65 Mm crossing that needed 57° showed the 50° line was not the limit; the limit is the ladder's red zone at 60°, past which no run has landed direct and the one that needed it curled. The verdict at the first fix now reads ON TRACK to 49°, ENTRY SHARP from 50 to 59° (landable with the speed managed), ENTRY TOO SHARP from 60°. The geometry curl fires at 60°, still only above 200 km.
- **Speed words only below 150 km.** Every throw-out collapsed there — 13:27 from 122 km, 04:44 from 113 km, 11:16 from 84 km — and a 0:05 above it has never hurt a run, including one that rode 0:05 from 550 to 218 km and landed. DECREASE SPEED and the countdown curl now apply only below 150 km, and only after a sharp entry.

## [1.60.10] — 2026-09-15

### Fixed
- **CURL ROUTE ADVISED all the way down a controlled run.** The geometry curl measured the angle to the fastest run's glide point at every altitude, and once that point is 23 km out that angle climbs on every descent as the point is approached — 50° at 238 km, 83° at 30 km on a 78 s run. It is now judged only above 200 km, where it separated the throw-outs from the landings at the line.
- **Speed words on an on-track entry.** Every throw-out on file crossed the line sharp, and no run that crossed on track has ever been thrown out — three of them held 0:05 into the last 40 km at Deshpande Plant, one of them the 72 s record. DECREASE SPEED and the countdown curl now apply only after ENTRY TOO SHARP. On an on-track or early entry the red zone is the commander's and the overlay stays ON TRACK.

### Changed
- **Sectors re-cut to the four things you manage.** S1 the line to the glide (angle and speed), S2 the glide, S3 the glide's end to the hand-off (alignment), S4 the hand-off to the pad (the computer). The old S1, the line to 100 km, rewarded a sharp entry with a short sector and a long one after it. S3 and S4 are judged within the hull.

## [1.60.9] — 2026-09-15

### Added
- **Sectors, as a lap is split.** S1 the line to 100 km (the entry: long when early, short when sharp), S2 100 km to the glide (speed to the floor), S3 the glide (where the floor was met), S4 the glide's end to the pad (alignment, the hand-off, the computer). Coloured as in F1: purple for the best that sector has been at the target, green for faster than your shortest run's, yellow for slower; S4 is judged within the hull. At the pad the overlay shows the four sectors under the total for twenty seconds; on the page the run panel carries them with the delta to the shortest, and the runs table has a sectors column so every run can be compared.

## [1.60.8] — 2026-09-15

### Changed
- **Six words and nothing else on the overlay.** Before the line, a verdict on the entry as soon as the line is within a straight projection's reach: ON TRACK, ENTRY TOO SHARP (the crossing would need 50° or more to your fastest run's glide point — every such entry on file ended in a curl or a throw-out, and the verdict came 19 to 27 s before the end), or ENTRY TOO EARLY (under 30°: far out and low, the safest and slowest line). In orbital cruise, from the countdown you already watch: DECREASE SPEED at 0:05, or 0:06 and falling; CURL ROUTE ADVISED when it has dropped twice in a row to 0:05 or under, sat there two seconds below 150 km, or the pitch to the glide point has reached 50°; INCREASE SPEED when the geometry is easy, you are above 40 km and the countdown runs four seconds or more above your fastest run's at that altitude; ON TRACK otherwise. The pitch number and the range live on the page's line, not the HUD.
- **Runs record from the first fix.** The watch that opens a run from position waited for three closing fixes and threw them away; at 137 km/s that was half a megametre. Those fixes are now the run's first samples, so runs, the verdict and your fast line start about 1.7 Mm out.
- **The entry line carries the 1.0 Mm checkpoint**: "Enter orbital cruise at about 0.86 Mm showing 0:06 · at 1.0 Mm, 640 km up", the altimeter reading your fastest run had when its range read 1.0 Mm.

## [1.60.7] — 2026-09-15

### Changed
- **The overlay is a pitch and a word.** In the gravity well the ladder pitch that crosses the orbital-cruise line where your fastest run crossed it; in orbital cruise the pitch to that run's glide point; and one word from the countdown you already watch. SLOW when it reads 0:05, or 0:06 and falling, or 0:06 after crossing the line inside the fastest run's crossing — every run that crossed inside and stayed at 0:06 was thrown out, and the ones that went to 0:08 within three seconds were not. LEVEL a second later if the countdown has not risen: the throttle is not winning, and a lower nose is the other lever. Speeds, steepen, maintain, level off and the projections are gone. Replayed on the twenty runs on file the words never show on a clean run under 100 s; on the 13:27 throw-out SLOW comes at 1.11 Mm and LEVEL at 0.93 Mm, both before the line and 19 s before the drop.
- **The page says one thing about the entry.** "Enter orbital cruise at 0.86 Mm showing 0:06", the shortest run's own crossing, in the numbers the HUD shows: range through space and the countdown. The ground distance the recorder measures was 0.59 Mm for the same moment, which is why the earlier line never matched what you saw. The entries table, the glide and hand-off columns are gone. The boundaries table shows each run's crossing the same way, against the fastest, and the HUD strip carries the countdown.
- **Pitch is read the way the ladder reads it.** The recorder measures the slope over the ground below the ship; at 600 km up that is about 7° steeper than the ladder. Angles are corrected before they are shown.

## [1.60.6] — 2026-09-15

### Changed
- **The speed to hold is on the HUD.** The throttle is yours until the glide, and both runs thrown out of orbital cruise were carrying twice the shortest run's speed for their altitude below 100 km while the overlay said level off for a different reason. Now, whenever you are over the shortest run's speed at your altitude, the overlay carries it: "slow down · 38 km/s", or "level off · 38 km/s" when you are more than half again over it or low on the line as well. The number is the highest speed that run flew at or below your height, so it never rises on the way down. Replayed on the 11:16 run at Kewell Range the first warning comes 2 s after entering orbital cruise and the number stays up for the last 15 s, falling from 33 to 3 km/s while the ship went from 33 to 8.

### Fixed
- **The page measured a Panther run against a Type-8.** The ship picker's default, the hull you are in, never reached the server, so the page pooled every hull and took the Type-8's 1:10 as the reference for Panther runs; the overlay had it right all along. The page now asks for the current hull by name.
- **A dropped run read "54 s ahead".** The seconds it lasted were being set against a finished run. Dropped and broken runs now say so on the HUD line and in the header, and carry no figure against the shortest.
- **"Begin the glide -2105 m–56 km out."** The glide window is half the spread of your glide starts, now 12 to 69 km at Kewell Range; the near edge is clamped at the target.

## [1.60.5] — 2026-09-15

### Fixed
- **Orbital cruise said steepen to a ship that was too fast, and to one that was low and slow.** The word in orbital cruise came from a straight-line projection to the glide floor, and its sign was inverted: meeting the floor far out is the case for level off, and it said steepen. The projection is wrong even with the sign right, because an orbital-cruise descent flattens as it goes — on the Type-8's clean run it put the floor 298 km out at entry, and the ship glided at 27 km. It is gone. The word now comes from the line (higher than the shortest run at this distance: steepen; lower: level off; within 2 km or 5%: maintain), and a speed gate outranks it: more than half again the shortest run's speed at the same altitude is level off, and steepen is never said while over that speed at all. Replayed against the run thrown out of orbital cruise at Deshpande Plant (04:44), the word turns to level off at 220 km up, nine seconds before the ship left supercruise.

### Changed
- **The cruise recommendation is the pairing you fly by.** "Enter orbital cruise at 0.48 Mm showing 0:08" — the shortest run's own entry in the HUD's unit, with the countdown it showed there (straight-line range over the closing rate along it). No blend, no altitude, no angles, no hold instruction. Under it, every entry on file as a row — distance, countdown, run time, ship — dropped runs included, so the entry that was too close sits next to the ones that worked.

## [1.60.4] — 2026-09-14

### Added
- **The ship on every run, and references per ship.** A Type-8 docks nothing like a Panther Clipper. Each run records the hull it was flown in; the shortest run, the live ahead-or-behind, the S marker and the hand-off recommendation come from runs in the ship you are flying, and fall back to another hull only until one exists — labelled "vs shortest (Panther Clipper Mk II)" when they do. Orbital cruise and the glide stay pooled across hulls: they are the game's physics. The Approach page gains a ship filter, defaulting to the ship you are in, and a ship column.

### Fixed
- **Coming in too fast now ends the run.** Thrown out of supercruise before any glide, the recorder kept coaching an approach that was over. If no glide begins within five seconds of leaving supercruise above glide height, the run closes as "dropped — too fast", is listed that way, stays out of every reference, and the overlay says so once and goes quiet.
- **The glide is not a decision.** It begins when the ship descends through the body's orbital-cruise floor, at the same altitude every time on a given body; what the pilot sets is where the descent meets that floor. "Glide now" is gone. In the gravity well and in orbital cruise the overlay is one word — steepen, maintain, level off — from where the descent will meet the orbital-cruise floor against the shortest run, or from the line when no projection is possible; the projection itself stays on the page.
- **One instruction on the overlay.** The left side carried every figure at once. The overlay now shows the phase and the single thing to do: "glide now" over "high — steepen" over "glide window in 6 km" over "holding 9 s, shortest 8"; in the gravity well the entry projection; in docking the hand-off prompt or the computer's clock. Everything else stays on the page. A seconds-to-target beyond two minutes is hidden — it was a near-zero closing speed after a drop.

## [1.60.3] — 2026-09-14

### Fixed
- **Distances are always to the run's final target.** A six-day-old surface nav lock on a Thortveitite deposit was taken as the target when an approach to Deshpande Plant opened, so the first fifteen seconds measured 1,700 km to the far side of the moon; when ApproachSettlement named the port, only samples with no distance were filled in. Those seconds became a 1,742 km "orbital cruise entry" and a 126 km/s speed in the recommendation. Every sample is now re-measured whenever the target is set, runs on file are re-measured on read, a nav lock counts only if set in the last 12 hours, and the watch that opens a run from a position fix requires three fixes in a row closing on the target and descending — a takeoff never qualifies, which is what was sending coach lines on the climb-out. Targets with no runs no longer appear in the picker. Before ApproachBody a run opened on a fix is labelled gravity well, not orbital cruise.

### Changed
- **The cruise recommendation is orbital cruise itself.** Where to enter it (distance out, at the body's own orbital-cruise altitude), the seconds-to-target to hold through it — distance over closing speed, the countdown you watch — and the line to the glide in degrees, with the run-up from the first fix as a footnote. Speed figures are gone: the glide's speed is the game's, and in orbital cruise the speed has to fall with the distance, so a single number was never the instruction. In the gravity well the coach projects where the descent you are flying meets the orbital-cruise altitude — "orbital cruise in ~20 s at ~510 km out (shortest entered 478 km) — on it" — and says level off or steepen.
- **The overlay carries advice only.** Distance, altitude and your own angle are on the HUD in front of you; the line now reads phase and coaching: "holding 9 s to target, shortest held 8 s · 40 km high — steepen · line here 24°", and in the glide just ahead or behind.

## [1.60.2] — 2026-09-14

### Added
- **The line, not just the speed.** Holding 0:07 fixes how fast you close for the distance and says nothing about the angle; the coach now holds you against your shortest run's altitude at your distance — "on the line", "40 km high — steepen", "30 km low — level off", with your descent angle now against the line's angle there — from the first position fix to the glide. The Orbital cruise recommendation states the descent angles too: to the gate, then to the glide.
- **Recording starts at the first position fix.** The game gives a position inside a body's gravity well well before orbital cruise; when the ship is in supercruise with a fix, heading for a port on file or a surface nav lock, the run opens there, as a gravity-well phase ahead of orbital cruise. The clock still starts at 100 km. A run that loses its fix before orbital cruise is dropped as a fly-by.
- **Cruise recommendation.** The Recommendation card gains an Orbital cruise column: where to enter orbital cruise (distance out and altitude, with the range across your runs), the closing speed to be crossing 100 km at, and the speed to hold from the gate to the glide window — all from your clean runs, weighted to the shortest. The coach says the same live: "cross 100 km at ~34 km/s, now 29" during the run-up, then "hold ~2.6 km/s to the glide window, now 3.1" until the glide begins. Speeds are closing speed toward the target from the one-second samples; the throttle itself is never written by the game. Runs already on file get their cruise figures on read.

## [1.60.1] — 2026-09-14

### Changed
- **The clock starts 100 km out.** Orbital cruise began 485 km from the pad on one run and 783 km on the next, so time since ApproachBody rewarded the approach angle, and the coach called a run "behind" that finished shorter. Run time, the shortest run, the live ahead-or-behind and the boundary table now all count from crossing 100 km; the run-up before it is shown as a muted segment and never counted. Runs already on file are recomputed on read. The phase strip carries no text in the bars: a line under each lists the phases with their seconds, the comparison row reads "previous shortest" when this run is the new one, and the to-scale spacer no longer shows. The map from above widens to 75 or 100 km only when a glide began beyond 50.
- **Approach page, after the first real run.** Orbital cruise began 490 km out at 430 km up and the glide was a flat line in the middle of the chart: both axes are now logarithmic, so the last few kilometres get the room whatever the body. The phase labels are gone; the colour is the phase and the numbers are in the hover and the boundary table. The map from above always shows the last 50 km. Runs are dated 9/14 22:13, the shortest run carries an orange S and the reference a grey R, explained in the map's legend. The page no longer blinks when a run closes: the live run stays until the stored one has loaded. The in-game coach line is re-sent every tick and held until Docked, instead of expiring between samples under the docking computer.

## [1.60.0] — 2026-09-14

### Added
- **Approach page.** Every descent from orbital cruise to a pad or a surface-mining site is recorded once a second and measured against your shortest run at that target. A run opens on ApproachBody; ApproachSettlement names the port and its coordinates, which the station dossier keeps; the Glide Mode status flag brackets the glide; DockingRequested and DockingGranted, then the "DockingComputer" music track for the hand-off to the docking computer and any retake; Docked or Touchdown closes it. The page shows the live figures — phase, distance, altitude, slope, closing speed, seconds-to-target at that speed, ahead or behind your shortest run — the altitude-against-distance slope with its axes stretched near the target, your shortest run as a ghost line with the envelope of your clean runs, every run at the target from above with click-to-focus, the phase lengths to scale, the boundary table against the shortest run, and a recommendation: where to begin the glide and what seconds-to-target to hold, where to hand off to the docking computer, and whether retaking control has ever paid. A one-line coach goes to the in-game overlay during the approach. Runs live in `approach-runs.jsonl` next to the exe. A glide that ends above 5 km counts as broken and stays out of the reference; the corridor is nominal (15–55°) until three clean glides set your own.

## [1.59.1] — 2026-09-13

### Fixed
- **The carrier ledger no longer resurrects goods you moved off.** A market snapshot states the stock as of its own time; the reconcile compared it to the balance now. Sync All re-read the 03:29 snapshot at 03:31, after 428 t of Steel, 14 t of Structural Regulators, 6 t of Semiconductors and 2 t of Fruit and Vegetables had gone to the ship at 03:30, and put them all back — 450 t the ledger itself listed as unaccounted. The reconcile now compares against the balance as of the snapshot, and a snapshot older than the item's current anchor is ignored. The six phantom lines were removed from the ledger file; its itemised total now equals the game's carrier total.
- **The hold is live on the project page.** The server already broadcast Cargo.json every 5 seconds; nothing in the browser took it, so "in ship" showed the hold as of the last Sync All or Refresh click, and stale cargo doubled up with the carrier. The store now takes the broadcast, and an "as of" time appears when the read is older than five minutes.
- **A construction project no longer loses its name.** The watcher starts at the end of the journal on boot, so a depot event seen without its Docked event created "Depot 4389829123 ()" for the Planetary Construction Site Kewell Range at Col 173 Sector AX-J d9-52, and nothing ever filled the blanks. Project identity now comes from one lookup — the Docked event in the batch, the persisted current dock, or the station dossier — at creation, on every later depot tick, and during Sync All.
- **Source suggestions measure from where you are when a project has no system on file.** With no coordinates the distance penalty was 0 for every station, so the biggest stockpiles in the bubble won: a depot at d9-52 was pointed at Chitty City, 802 ly away. The picker now falls back to the commander's position.

### Changed
- **Scan totals come from the radius search, not from refetching.** The search the Expansion page already runs carries the FSS honk for many systems; records scored before the app kept the total take it from there on load, in one store write. Near home that is 864 of the 1,644 records without one, and 169 false zeros become "N of M" partials with no fetch at all.
- **Rescore stale only fetches what a fetch can teach.** Spansh holds more bodies than the record saw (the search row says so), the record still has no scan total after the backfill, or an epic flag predates the 1.58.8/1.58.9 rules — the only records those rules can change. Near home that is about 160 systems instead of 1,872. Scout All rechecks an unclassified row only when its search row shows bodies now; the row says "Spansh holds N bodies now — Scout".

## [1.59.0] — 2026-09-13

### Fixed
- **A system Spansh only knows the position of is unclassified, never a 0.** The Expansion pool scored whatever the dump returned, including nothing: 44 systems near home carried a score of 0 for having no body records at all, and sat at the bottom of the list as duds. A live check of 24 zero-score records without a scan total on file found 10 partial scans (Wregoe PD-Z c27-0: the arrival star on file, 19 in the honk) and one system that had grown from 1 body to 12. How much of a system a score saw is now judged in one shared place (`server/journal/scanCompleteness.js`): none, partial, unknown, complete. No-data records show ⚬ and "no body data on file — unclassified" in the pool, seed as unscouted so Scout All rechecks them, plot as unscored on the map, and no longer count as visited for the boxel scout. Rows with bodies on file but no scan total say so ("12 on file, scan total unknown"), in amber when the score is 0.
- **Body counts are stars and planets.** Spansh lists barycentres as body records; the honk never counts them, so "6 of 21 scanned" at Wregoe PD-Z c27-10 was really 4 of 21. Every path that stores a record count now counts only stars and planets: Expansion scoring, the server's target and FSS scoring, the target card.
- **The target card learns the honk.** 1,645 of the 1,872 Spansh-sourced records near home were scored in March–June, before the app kept the FSS total, so their target cards said "In Spansh" with no warning. Targeting such a system now fetches the dump, shows "N of M" or "N on file, scan total unknown", and writes the learned total back to the record. A dump that comes back 404 reads "Not in Spansh — unclassified" instead of "unknown". The Companion and the in-game target line say the same; the arrival overlay says "2 of 28 bodies scanned" instead of "FSS scan incomplete".

### Added
- **Rescore stale** on the Expansion page, beside Scout All: re-fetches every scouted system in the current list whose record has no scan total on file or was scored by an older formula, one Spansh fetch each, abortable, and resumable because refreshed systems drop out of the set. Batch runs parse the journal folder once instead of once per system. The score formula version is now 3, so everything scored before this build (including before the 1.58.8 and 1.58.9 epic rules) is in the set.
- **Unclassified** filter chip and count in the pool header: no body data on file, or a 0 with no scan total.
- **The boxel scout lists position-only entries.** Systems Spansh knows by name with no bodies on file are listed as ⚬ targets (20 of the 106 AX-J d9 entries); known entries are counted by the bodies on file rather than Spansh's body_count, which is null for many systems that have bodies.

### Changed
- The regional indexer keeps the FSS honk as `honkBodyCount` next to the record count, and the import derives completeness from it and stamps the formula version, instead of asserting that every imported system was complete. Takes effect on the next rebuild; slim files built before this read as scan total unknown.

## [1.58.9] — 2026-09-13

### Changed
- **A ring-edge sight needs a bright ring.** Wregoe JX-A c27-7 7 a had the geometry (1.02 of the ring edge, an 89° band) and was a letdown: "a very dim ring". That ring carries 2.9e-6 megatonnes per square metre; the gold-standard band at AX-J d9-52 2 carries 9.2e-6 and nothing else on file is under 6.1e-6. The ring the moon skims must now read at least 5e-6, a bar to nudge after the next ring sight. Journal scans now carry ring inner radius and mass into the scorer (they kept only the outer edge before), so systems you scanned yourself are judged the same way; older cached scans without a mass read as unknown and pass. Existing flags persist until a Rescore All.

## [1.58.8] — 2026-09-13

### Changed
- **Twin worlds need a surface to stand on.** The epic-view twin criterion counted any two sibling planets looming in each other's sky, landable or not; Wregoe JX-A c27-7 6 b and 6 c, co-orbiting rocky worlds under thick carbon dioxide, were flagged though neither can be landed on. A pair now needs at least one landable member, the same rule the big-sky and ring-edge criteria already apply, and the landable one is named first in the reason: it is the one you stand on. Existing scouted systems keep their stored flag until a Rescore All on the Scouting page.

## [1.58.7] — 2026-09-13

### Added
- **Surface Mining — the ship is tracked, not pinned.** The map used to draw "the ship" at the touchdown point for the whole visit. It now draws where the ship is as far as the app can tell: solid when a hard fact placed it (deploy, boarding, a cargo transfer, an unmanned touchdown), dashed with a `?` when a recall is assumed to have brought it (a scanner burst seen from the Rhino, then the Rhino's position 35 s on — every recall on file had the transfer or boarding 33–49 s after the burst, at that spot), grey and labelled *departed* once it has left. Two rules the commander supplied drive the leaving: the ship departs for orbit past **2 km** from you (the track sample that crosses the line marks it), and a burst arriving with the ship already within 1 km is a dismiss, not a recall. A 2 km ring sits around the ship, and the hero shows your distance to it, amber from 1.6 km, red past 2 km.
- **Rig rings.** Rigs never appear in the journal, so they are assumed at the deposits worked this visit since you last boarded (the three most recent, one per deposit). Each carries a **4.5 km** ring, the distance at which a deployed rig self-destructs, and the hero shows the distance to the farthest one, amber from 4 km, red past 4.5 km. Boarding the ship counts as recovering them.

## [1.58.6] — 2026-09-11

### Changed
- **A buyer needs a pad you can use.** The live price ladder and the daily Ardent sample now require a large pad outright; the Sell page's Local, Galaxy and Sell at… columns require the pad the hull you are in needs (from the journal's ship type; an unlisted hull such as the Caspian Explorer needs large). A listing with no pad size counts as large only for station kinds that always carry one (Coriolis, Orbis, Ocellus, Dodec, asteroid bases, planetary ports); an outpost never does. Around HIP 52629, 99 of the 301 non-carrier Monazite buyers at 700k+ were medium-pad only.
- **Demand cover is four times the load.** Inara's bulk-sales-tax warning: a mined commodity's price falls once the cargo passes about a quarter of demand. The Sell page's demand floor and the *demand short* flag now use four times the load, labelled as a rule of thumb (`DEMAND_COVER` in `sellPlan.js`).
- **Surface prices consult the Ardent ladder.** The Surface page priced every chip at your own best read (30 days) else the galactic mean, which put Monazite at 195k to 234k while 41 large-pad buyers within 500 ly pay 700k+ into 4,000 t or more of demand. The summary now carries the galaxy's best real buyer (large pad, real demand, no depots or carriers) as a middle tier: own read, else the ladder, else the mean. Monazite, Serendibite, Jadeite and Alexandrite join the daily sample.

## [1.58.5] — 2026-09-11

### Changed
- **Construction depots, on-foot settlements and stronghold carriers are no longer buyers.** Ardent carries every market the game uploads, and those kinds list every commodity at the price cap with 999,999 demand: within 500 ly of HIP 52629 every construction depot (49 orbital, 13 planetary), 22 of 23 on-foot settlements and all 4 stronghold carriers "paid" 1,038,104 for Thortveitite, against 15% of Coriolis stations and 29% of outposts. One predicate (`isNonBuyerMarket`, beside the fleet-carrier rule) now drops them from the live price ladder, the daily Ardent sample, your own market reads and best-market figure, the mining price map and the Sell page's Local, Galaxy and Sell at… columns. A delivery dock at a construction site never writes a market read either.

## [1.58.4] — 2026-09-08

### Added
- **Surface Mining — Best signals by expected value.** One list across every body in scope, ranked by the same four-rig score the body cards use (richest first, at most three rigs on one commodity, priced at your best market this month, else galactic average). Body, signal, the rigs that make the score, what has already been pulled, landing and driving ratings; tap a row to open that body and signal. An *unworked only* switch turns it into a where-to-go-next list. Where to go back stays the measured credits-per-hour list. Until now the only ranking by expected value lived inside each body card.

### Changed
- **Chip names are one spelling.** A commodity typed into a signal's chips lands in the price table's spelling ("periclase dunite", "Bastnäsite", "water" → Periclase Dunite, Bastnasite, Water), and the ledger reader canonicalises every sight and unsight record it reads, so the variants already on file merge without a rewrite. Four typed variants had been sitting beside the canonical chips as separate commodities.
- **The Map's Galaxy layer is gone.** The drawn spirals wound the wrong way — the region map's arm-named regions wind counter-clockwise going outward with the core up, the spirals wound clockwise — and 1.58.3's region fills were wedges, not arms. The disc, bar and arms added little; the 42 regions and the landmarks stay.

### Fixed
- **System View "Photographed here" showed F10 deposit stamps as portraits of a body.** The tiles took the first image under every body key regardless of the utility flag every other view honours. Utility shots are skipped, and a body with nothing else has no tile.

## [1.58.3] — 2026-09-07

### Changed
- **Map: the galactic arms are the game's own.** The four drawn spirals (a 12° pitch and a hand-picked phase) contradicted the in-game colonisation map. The arms are now the eleven arm-named regions of the vendored community region grid, filled as coarse block runs (about 395 ly) under the region borders, so they sit where the game puts them by construction (`scripts/gen-galactic-regions.mjs` emits `GALACTIC_ARM_SHAPES`; the spiral memo is gone).
- **Map: the Populated layer is seeded from the galaxy dump, gated to the bubbles.** `scripts/extract-populated-galaxy.mjs` pulls every populated system out of the Spansh galaxy dump in one pass (141,542 systems, 41 MB); `scripts/gen-populated-systems.mjs` now reads that file by default and keeps only the two bubbles — 11,148 systems from the July 2026 dump, up from 6,458. The regional dumps cannot feed the layer: their 700 ly sphere is centred on AX-J d9-52, 103 ly from HIP 47126, and misses 3,243 populated systems on the Sol side of the bubble, Omega Carinae and Epsilon Centauri among them. Nothing outside the bubbles is written. The FAQ and both READMEs say so.
## [1.58.2] — 2026-09-07

### Docs
- Both READMEs describe the Map (regions, landmarks, the Populated layer), the Commander's Log, the surface-mining route and Covered layers, the Sell page's fast paint and Sell at… verdicts, the co-pilot's surface beats and combat silence, the JPEG gallery, and the new `populated-systems.json` data file. FAQ gains eleven entries (Sell at…, the own-system fix, community goals from the journal, the fast paint, Covered, the system row, queued refinery output, the co-pilot on the surface, the Populated layer, region sources, gallery JPEGs). The Wiki's selling and surface-mining references carry the 7 September findings: Ardent's nearby lists exclude the origin system, goal markets from the journal, the recall tell, the hovering ship, queued refinery output, scanner reach and site radius.

## [1.58.1] — 2026-09-07

### Changed
- **Community goals come from the journal.** A goal market is one the latest `CommunityGoal` event lists with an expiry still ahead (`server/journal/communityGoals.js`), never a station whose demand happens to read 999,999 — big stations post millions of demand for ordinary goods, and that tag had spread across half the Sell page. Every valuation that reads "your best market" or "the galaxy's best buyer" — surface rig values, asteroid rock values, the live price ladder, the daily history sample — now skips goal markets, so a goal's 8× never prices a deposit or a rock. The Sell page still lists the goal market as the buyer it is, tagged.
- **Sell at… says it plainly.** One comparison, the share of the best buyer known: green sell here at 85% or better, amber close call, red take it elsewhere under 70%. A summary line above the table names the three groups. The ×mean figure stays as a fact under each price and colours nothing.
- **Surface Mining: a system row under My systems.** One chip per colony with surface data, with its count of bodies carrying signals; pick one and the whole page narrows to it. Remembered per browser.

### Fixed
- **The system you are in was missing from the Sell page's Local and Galaxy columns.** Ardent's nearby listings never include the origin system (1,000 rows at 50 ly, none at distance zero), so a buyer 0 ly away could only land in a hidden slot — Grandidierite read 640k in Lembava while The Gatehouse, in the same system, paid 781k. The system's own listing now joins the within-range candidates, galaxy-list buyers inside the range are merged in by market id, and the page shows the better of the two galaxy slots.
- The docked station's own price cell never carried the goal flag.
## [1.58.0] — 2026-09-07

### Added
- **Commander's Log.** A deterministic timeline of the whole journal history: builds with station photos and a searchable *builds* tag, Dodecs and large ports weighted by your Domain Highlights, loop hauls ("around X, out to Y"), missions, exobiology and bio sales, community goals joined and delivered, vehicle firsts (SRVs and the fighter), surface presence on relog, and a searchable station list. Station renames resolve by market id, so Cavallo Nero Corona, Kalian Port and Fokker Mine are one station each. Installations fold FSS signals against the rename history at startup.
- **Map.** Renamed from Colony Map. Journey z-flip fixed; Colonies, Targets, Galaxy, Landmarks and **Regions** toggles, the regions being the 42 real borders from the klightspeed community map (MIT, vendored). Arm names dropped; landmarks only from real coordinates.
- **Map — Populated layer.** Every populated system across 700 ly of HIP 47126 and 500 ly of Praea Euq AT-U d2-47, seeded from your Spansh regional dump (`scripts/gen-populated-systems.mjs`, about 6,450 systems) and kept current from the journal stream: every FSDJump, Location or CarrierJump with a population, from EDDN or your own journal, upserts `populated-systems.json` (its own file, never colony-data.json). Three population bands, one path each. The store adopts a reseed written while the exe runs.
- **Surface mining.** Rig cap (4 rigs, 3 per commodity, richest first) shared by the page and the Domain; a time-costed route planner over the ground you actually drove; the recall spot gated by share; the map hoisted to a *Working now* panel while you are on a signal; driving-scale labels in your own words; a **Covered** layer shading the 2 km the Rhino's scanner sweeps either side of the drive, this visit brighter than earlier evenings; breadcrumbs every 5 s or 15 m while driving, and every drive sample within a site's 5 km radius kept regardless of age. Tritium and Water in the commodity pickers, which also learn every name the ledger has seen.
- **Co-pilot.** Surface beats: arrival by driving band, the hold filling (near or far, never promising to move the ship), the ship going up on its own, the seven-minute nudge for the most valuable logged commodity; a **recall** line off the one tell the game leaks (the SAASignalsFound burst when her AI takes over — a Liftoff inside 5 s means she is leaving, nothing means she is coming, about 30 s out); on-foot lines keyed by the body's scanned temperature; **silence during combat music**. Strict wording: no numbers, no invented terrain, never "you rated", never a promise to land.
- **Sell Cargo — Sell at…** Type a system and see everything you hold priced at its best station: price against the galactic mean, demand against your tonnes, the value, and what the best buyer elsewhere pays. "I'm going to LFT 65 for the Rhodplumsite — what else should ride along?"

### Changed
- **Sell Cargo is fast.** One nearby Ardent call per commodity instead of two (the range buttons no longer refetch), three fetch lanes instead of one queue, the assembled plan cached ten minutes, and a fast first paint from your own markets and Ardent's cache with the rest filling in behind (`sell_plan_updated` over SSE). Measured before: 251 s cold.
- **Gallery images are JPEG.** Every F10 BMP in the gallery is re-encoded at quality 90 (31.6 MB → about 1.2 MB): on arrival, at startup for what is already on disk, and on demand (`POST /api/gallery/convert`). Old `.bmp` URLs keep resolving. Originals in Pictures untouched. Reverses the v1.36 "postcards stay BMP" decision.
- **Carrier ledger.** Eight commodities whose game id is a different word from their display name now reconcile; Tritium deposits are no longer subtracted twice; a one-pass reconcile screen on the Fleet Carrier page.

### Fixed
- Surface: an approach glide under 5 km was drawn, routed and paced as a drive; queued refinery bins that drop in a second after a transfer credited a deposit at the ship instead of the rig they came from (read-time repair, history included); "you" plotted on the signal map from the ship, zooming the site away; hidden installations never persisted.
- Commander's Log: Aleumoxii "first discovery" that was only a first visit (`WasMapped` guard).
## [1.57.0] — 2026-09-04

### Added
- **Sell Cargo — a page for the other half of mining.** Your ship's hold (Cargo.json) and your carrier's goods at the top; below them one row per commodity with three prices, each with a place: **here** (the station you're docked at, from its snapshot), **local** (the best of your own markets and Ardent's buyers within 20/50/100/500 ly) and **galaxy** (Ardent within one carrier jump, or the overall top of book when it beats that, with its distance). Tonnes × price on every cell and a *sell everything* total per column. A buyer whose demand can't take your load is skipped. Your own records beat Ardent when newer and add the stations nobody uploads — marked *only in your records*. Search any of 335 commodities to price one you don't hold, with a tonnage of your choosing.
- **Trade nearby.** Lowest buy with stock for a load → highest sell with demand for it, within the same range, from Ardent's per-system boards for the populated systems you know plus your own records, ranked by profit per load of the ship you're in. Freshness on both legs, because a stale leg is how arbitrage goes wrong.
- **Price history, from today.** Nobody keeps one — Ardent has no time series and its summary report is 16 months stale and blind to the 2026 commodities — so the app now records every market you open (movers and first-of-day only), a daily galaxy-wide sample from Ardent's live buyers for the surface commodities and anything you hold or searched, and your own sales from the last year of journals. Sparkline under each commodity; tap the name for the 12-month chart. A year of retention, pruned on load. Ask "is 240k an aberration?" again in a few weeks.
- **The exe has an icon.** The build sets the app icon and Windows version info (file description, product name, version from package.json) on the Node binary before the app is injected — it wore Node's icon and said "Node.js" in Task Manager until now.
- **Docs refreshed.** Both READMEs describe every page as of 1.57.0, list every data file the exe writes, and carry the external-services table with cadences and fallbacks; the FAQ gained Asteroid Mining, Materials and Architect's Domain entries; the wiki's stale dictated-prices and 9/9 lines are gone, the co-pilot cast is Wren, Tycho and K2, and the scouting reference now says whose home colony it is about. From GitHub feedback: the EDMCModernOverlay links now point at the overlay's repository instead of the GitHub front page, and Node.js is a named, linked prerequisite for building or using the `.bat` launcher. `RELEASE-NOTES.md`, frozen at v1.1.0, now just points at this changelog.
- **A signal is worth its best three.** "Rank by expected value" and the Domain page's Richest Signals now sum a signal's three highest-priced expected commodities, not all six — the Rhino's refinery holds three.
- **Community goals on the Sell page.** A buyer showing demand of 999,999 is a Community Goal market (Metz Enterprise in Ega, September 2026, paying 8× the galactic average for the surface commodities); it is tagged *community goal · limited time* rather than treated as a normal buyer.
- **Radar switch.** The proximity radar's EDDN firehose is the exe's one greedy feed — measured at 23 messages and 21.6 KB a second, about 1.8 GB a day inbound, running whether or not the Radar page is opened. Settings → *Proximity radar* (default on) now gates it and the chain watch; a flip takes effect within a minute, and the log reports the hourly volume.
- **Carrier cargo, transactionally.** The journal records every move you make at your own carrier — transfers while docked at it, your buys and sells against its market, tritium to the tank — so a replay from CarrierBuy is exact for anything nobody else can touch: mined ore, goods without an order (verified on the commander's carrier: Rhodplumsite 159 = 203 mined − 44 on the ship). It is blind to visitors trading against your orders, so the carrier's own market read is the truth for sell orders (each correction is a *reconcile* line) and CarrierStats, written at every dock and jump, is the total. The Fleet Carrier page shows tonnes aboard per the game, tonnes itemised, and the remainder as *not itemised* instead of hiding it; recent transactions listed; the Sell page's carrier card uses the same figures. `carrier-ledger.jsonl` beside the exe. This replaces "only goods with a sell order are visible." Anything that was ever on a sell order and has not been anchored by a market read is named, not counted — a visitor could have taken any of it — and a **baseline** typed from the carrier's inventory screen (or *none*) anchors it as a dated transaction.
- **Notable Surface sees the groves.** The Domain page's brain-tree panel read only the flag set by hand on the System Bodies tab, so a grove pinned from the Surface Mining page (2 b, tonight) never appeared. It now unions the surface ledger's groves — pins and Codex sites — with grove counts and harvested units. And a **Most Hotspots** record card, from your own DSS scans, next to Most Mining Signals.
- **A login on the surface is a visit boundary.** Logging out on a body and back in writes no supercruise drop, so 1 b's Signal 7 — worked across two evenings, 230 t, the most valuable visit on file — read as one 20-hour visit at 2.5 M/h and sat eighth on *Where to go back*. The journal's Location event at login now becomes a resumed drop inheriting the signal, live and from the backfill, so each evening keeps its own clock and the card shows the visits.
- **A full rig is 12 t** since Frontier's patch of 4 September 2026 (02:00 Central); collections before it still divide by 9. The number is fixed in the app now — the `full rig =` control is gone, because Frontier sets it, not the commander.
- The 2026 commodities are unknown to Ardent's summaries but present in its live listings; today's top buyers of Thortveitite, Periclase Dunite and Iridium pay 1.5–3.7× Atmo Sky Cairn's 240k. **Colonia is ignored** — anything beyond 10,000 ly of you is not your galaxy, for the top of book and for the history sample alike (and from Colonia, the bubble is what gets ignored).

## [1.56.0] — 2026-09-03

### Added
- **Surface Mining — a page for the Rhino, to the standard of the asteroid page.** Its own ledger (`surface-mining-log.jsonl`), separate from the rock log, because surface mining has no rock: it is a fixed deposit at a latitude and longitude, found under a *signal* — the game's "Planetary Mining Location Signal (N)" — and emptied in bursts. Bodies → signals → deposits, in the order you navigate. Live hero with this visit's tonnes, value and pace; the nav-locked signal from orbit with a one-line tagger; Needs a DSS grouped by system with planet class and ice greyed; Where to go back ranked by credits per hour per signal; measured yield charts; surface materials with grade and room.
- **The signal is the game's own index.** Nav-lock it before you drop and the visit is filed under Signal N via the Status.json token, exactly as ring hotspots are attributed. No lock: type the number (Enter = this visit is really Signal N; *moved here* = new visit from now). Drops the exe missed are restored from the journal at boot.
- **Signal counts you can see but the journal withholds.** Only a DSS writes the count (verified across 582 journal files: no other event ever carries it), so the Needs-a-DSS card takes the number from the system map; a DSS replaces it, an empty Enter clears it.
- **Tagging from orbit, built for the iPad.** Chips from what this body and this system have already shown; *edit* / *done* keep rows compact; six commodities per signal (the commander's observation); × retracts a mistaken tag append-only; pulled commodities count as expected and cannot be re-tagged. **Find** chips filter every signal by what it holds; **rank by expected value** orders them by one-deposit-of-each price.
- **F10 shots become deposits.** A surface screenshot is a marker until it is named — from the signal's own chips or typed — then a deposit, re-encoded from a 31 MB BMP to JPEG, hidden from the place galleries, removable once logged (original only if ticked).
- **Landing and driving ratings per signal**, 1 easy to 5 brutal. Landing is filed under the hull from the journal with its pad size; the Caspian Explorer and the Type-11 Prospector ask for a size once and remember it. Shown on rows and on the go-back cards.
- **Prices you dictate.** A server-side mirror of the price table (generated, drift-tested) feeds the overlay and the page from one place. Ruby 74,000 · Thortveitite 130,000 · Rhodplumsite 171,300 · Grandidierite 185,000 · Periclase Dunite 129,000 · Magnesite 31,985 · Deuterium 34,000 · Olivine 26,242 · Sapphire 81,044 · Helium 73,920 · Bastnasite 66,401.
- **Two overlay lines of its own.** Per tonne: `⛏ Thortveitite +1t @ 130k · 12t this collection · Signal 7`. When a collection ends: the visit total. The visit figure no longer rides every tonne, where a Deuterium tonne read as if it were worth 22 M.
- **A compass.** *Steer here* on a deposit, a signal's recall spot, or *back to the ship* sets one target; every Status tick gives distance, bearing and turn on the overlay, in the hero and on a big Companion card for the iPad. Within 50 m it says you're there and clears. Third-party apps track your coordinates the same way — from Status.json — but none can see what you target from the SRV (verified live: `Destination` stays null), so the target is yours to set.
- **Signal maps and recall spots.** Each signal panel draws local metres around the signal: deposits sized by tonnage and coloured by commodity, the ship's landing, your live position and heading, and your drive as a line (a breadcrumb track, recorded from this build on). The recall spot is the tonnage-weighted least-total-driving point among the signal's worked deposits — stated with its distance to each; terrain is the commander's call.
- **Trips and the hold.** A trip is one Rhino hold cycle, closed by a transfer to the ship or by boarding; the hero shows this trip and the hold out of 72, the visits table counts trips, and the overlay speaks at drop-off (`Dropped off 33t Bastnasite = 2.2M · visit 53t / ~3.5M`) instead of at every rig emptying. Trips are restored from the journal at boot. The hero stays ACTIVE through a drive to the ship.
- **Rigs per deposit** (1 by default, up to 4), on the row and on the go-back cards — with an *estimate* from the largest single collection (a full rig is 9 t, the HUD's 9/9; the figure is dated and editable, `full rig = 9 t`, for the day Frontier raises it). Confirm with one tap; a count you set is never overwritten. Per rig, every deposit yields the same ~8 t per collection; the two three-rig deposits were both tagged *density low* — spread out, not poor.
- **Odometer, climb, speed, highest ground.** The breadcrumb track now gives km driven, metres climbed, average moving speed and peak per visit, per signal and per body, and a *Driving rating vs the track* line so the 1–5 score can be checked against the numbers. Highest ground reached is jump-proof: on foot, landed, or an SRV point no higher than its neighbours. Also a Domain Record.
- **Pins and brain-tree groves.** `pin here` saves a named point at your position — the manual nav lock for things the game never writes. A grove is a site like a deposit, only its yield is materials: pinned by you or restored from codex entries, every pickup inside 300 m of it is a harvest, with units by grade and units per hour. Steerable, on the map.
- **Galactic averages from the game itself.** Market.json carries `MeanPrice` for every commodity — the number the in-game inventory shows — and now every market you open updates a small file beside the exe that the page, the overlay and the co-pilot read before the baked table. The typed-in-price era is over; the table was corrected to the game's exact means (Thortveitite and Periclase Dunite 129,763, LTDs 96,438, Ruby 73,655, Grandidierite 184,576 …).
- **One price, and it is what your best market pays.** Every chip, deposit and "Where to go back" figure is priced at the best sell among the markets you have opened in the last 30 days — any station, anywhere, never a carrier — and at the galactic average when nothing that fresh is on file. Atmo Sky Cairn pays 240,547 for Thortveitite and Periclase Dunite against a 129,763 average, which is why "skip Thortveitite" was the wrong call on the average alone. Hover a price for where it came from.
- **The map's ground is the body's colour**, sampled from a deposit photo's terrain.
- **Domain Records** gain Most Mining Signals and Richest Signals — about what the ground holds, not what the commander chose to pull.
- **A collection also ends on a move of 300 m**, so scooting between rigs no longer files the second rig's tonnes at the first.
- **FAQ and wiki** cover surface mining, the co-pilot cast, radar and threats, and reward info.

### Changed
- **Terminology: signals, not sites** — the game's word, everywhere the page speaks.
- **The asteroid module ignores refines made in the SRV** (Status bit 26). Its overlay, session tally, streaks and rock log never see surface tonnes again; the SRV's hold no longer reads as the ship's.
- **Co-pilot hauling talk is gated on the Start Session button**, never on a guess. Off-session, a dock is flavour. Lines are first person, always. Radar chatter is voiced only within 50 ly.
- **Commodity names lose their diacritics** (Bastnäsite → Bastnasite), and matching strips them on both sides, so any spelling the game or a finger produces still finds its price.
- Bodies list in natural order like the system map; the "everywhere" scope is gone.

### Fixed
- **Summary reads sliced live collections.** The page's poll ran the shutdown finaliser, cutting one rig emptying into 3 t / 6 t / 1 t records. Reads are read-only now, and sliced history is re-joined at read time.
- Two snapshot sources disagreed on the locked body ("1 a" vs "Body 14"), flipping the targeting strip and disabling Add after every tag on the iPad. One resolution, on a copy of the live lock.
- A site count typed once could not be corrected; a tag added by mistake could not be removed; a moved rig showed the previous signal after a restart. All three have explicit controls now.
- HIP 47126 population override re-stamped on every blur; five stale overrides dropped.

## [1.55.0] — 2026-08-28

### Added
- **"Notable Surface" on Architect's Domain** — things standing *on* your ground rather than orbiting it. Brain Trees today; Planetary Mining Deposits are the obvious second tenant once the Rhino lands, which is why it is a category and not a brain-tree panel. Sites outside your systems are counted rather than listed — this page is about your own ground, but silently dropping a confirmed find would be worse than mentioning it.
- **A "view" button on every route member in the planner.** A name and a score are not enough to judge a hop, and copying the name out to look it up elsewhere is not a workflow. Opens System View in a new tab, deliberately — an in-tab jump would throw away the route you just spent a search building.

### Changed
- **The installations table filters by landing pad, not by settlement.** Hiding a settlement answers nothing; the question actually being asked is "can I bring the big ship here". The Pad column now shows only the **largest pad** — `L`, `M` or `S` — because small-pad counts are irrelevant and the number of large pads changes no decision. A station with no recorded pads reads as no, since guessing yes on missing data would send you somewhere you cannot set down.
- **Last Visit is months, not a date.** "14 mo" says a station has gone cold; a date makes you do the arithmetic every time. Anything over a year is tinted, and the exact date stays in the tooltip.
- **Brain Trees are off the Expansion page.** That page is for finding *new* systems; a roll-up of confirmed sites you already hold sat oddly at the top of it.
- **The montage now sorts by importance, not by name.** Stars first — it is the first thing you see arriving — then oxygen worlds, then other atmospheric worlds, then significant builds. Airless rocks sort last, below even a minor outpost: a 0.024 M⊕ bare moon was leading the montage purely because "1" sorts before "2". Icy bodies are excluded from "of note" even when they carry an atmosphere.

## [1.54.0] — 2026-08-28

### Added
- **The montage is ordered by what matters, not by insertion.** Oxygen worlds lead — the rarest thing a system can hold — then the rest of the landscape, then the real ports, then everything else. A minor outpost was appearing ahead of a system's oxygen twins and its main port purely because of the order things happened to be stored in.
- **Body names lose the system prefix in the installations table.** It is the context of the entire page; repeating it on every row is noise. The full name stays in the tooltip.
- **"Photographed here" on a system page with no system shot of its own.** The pictures were already on file against individual bodies and stations, but the page only ever looked at the system-level key — so a system with a dozen body shots and no portrait of itself appeared to have no pictures at all. Now it shows them as a labelled montage. Systems that do have their own screenshot are untouched.

### Fixed
- **Hero images have never appeared on any dashboard card.** The lookup built its key from the raw system name while the gallery stores every key lowercased, so `system:HIP 47126` could never match `system:hip 47126`. Fixed — and where a system has no portrait of its own, the card now tiles up to four of the subjects photographed there instead of showing nothing.
- **Station distances lost their spurious decimals.** 2,025.523615 Ls rendered as `2025.5`; it now reads `2.0k`.
- **The station-category chips are gone from the system hero.** They counted how a station is *classified* — "3 Installations" on a system holding seventeen — which is meaningless and reads like an achievement figure. What you built and what is still going up is the whole story now.

## [1.53.0] — 2026-08-28

### Added
- **A system page now leads with what you built there.** It used to show a taxonomy of station categories — "3 Installations" — which names how a thing is classified, not that you raised it. HIP 47126 has 17 stations, but seven are construction depots and one is the colonisation ship; **nine are real**. That number is the headline now, with the categories kept underneath as detail.
- **Mission income per system**, beside population. A single system had quietly paid out 1.91 billion across 43 missions and nothing in the app said so. Attributed by where the mission was delivered, which for the mining and collection contracts that dominate here is the station it was accepted at.
- **"Plan route" on every flagged system**, handing the name straight to the planner as a prefilled target.
- **"Not on Spansh" badge** on flagged systems Spansh has never indexed. That is a fact worth seeing rather than hiding — it means nobody has reported the system, and it is why the check falls back to coordinates. A failed lookup shows nothing rather than claiming "not registered".

## [1.52.0] — 2026-08-28

### Added
- **"Worth doing here" on the 2nd screen** — what is left undone in the system you just jumped into, when it is one you hold. Rings you have seen but never deep-scanned, systems where the FSS sweep never finished, and systems you have never photographed. Silent everywhere else, so it only speaks on your own ground.
- **Ordered by distance from the arrival star.** The 43 Ls ring leads; the 300,000 Ls iceball sinks to the bottom on its own. Nothing is hidden for being far — it just stops competing for attention.
- **Dismissal is permanent, and there is no undo.** A task you are never going to do should never ask again, so dismissals are append-only server state that survives rescans, restarts and index rebuilds. Ids are derived from what a task *is* rather than where it sat in a list, because an id that drifts would silently un-dismiss the thing it named.
- Scoped to the current system on purpose: across the whole domain this list is sixty-odd entries, which is unreadable on a second screen and answers a question you were not asking.

## [1.51.0] — 2026-08-28

### Added
- **Lifetime mission earnings on the dashboard**, beside population and tonnage where the other activity figures live. The journal has always tracked the total and never showed it.

### Fixed
- **Threat checks now anchor on coordinates, so a system Spansh has never indexed can still be watched.** Col 173 Sector YI-V c17-29 — the highest-scoring system on the whole list at 117 — sat permanently "unknown" because Spansh's search has no record of the name, and the radius query needs a reference it can resolve. Your scouted records carry coordinates regardless, and with them that system turns out to have **four claims within 50 ly**, the nearest 23.4 ly out. It was never clear; it was unmeasurable.
- Flags made before a system was scouted, or typed in by hand, have their coordinates backfilled from the scouted pool at check time.
- Guarded against a Spansh quirk that would have been worse than an error: `reference_coords` as an array, and `reference_x/y/z`, both return **HTTP 200 with results silently anchored at Sol** — perfectly plausible data for entirely the wrong place. Only the object form is used.

## [1.50.0] — 2026-08-28

### Added
- **"What Your Ground Yields" on Architect's Domain** — the rings inside your own systems, ranked by hotspot count, with materials, reserve level and the ring's name. Scoped to your systems on purpose: hunting a ring to mine is what the ring finder on the mining page is for, and a richer ring two hundred light years away is not an answer to what your own ground holds. Ranks on total hotspots then variety, since a ring concentrating one material and a ring spreading five are worth different things.
- The footer states how many of your rings are mapped and how many were seen but never DSS-scanned — a thin sample is a fact about the survey, not about the ground.

## [1.49.1] — 2026-08-28

### Fixed
- **The stations you built were the only ones that could never be highlighted.** A station discovered through the journal carries a journal type and resolves to a "… Station" label; a station you *raised* is stored with its Raven build id and resolves to "… Starport", or "Large Planetary Port". The Domain highlight lists only ever held the first spelling — so Chitty City and Atmo Sky Cairn Asc, both Tier 3 Large Planetary Ports, were invisible on a page about your own territory, while stations you merely flew past showed up fine. Both vocabularies are now recognised, for Coriolis, Orbis, Ocellus, Asteroid and Planetary ports alike.
- Existing highlight settings are migrated rather than reset: the build-side spelling is added only where the discovered spelling was already switched on, so anything you deliberately turned off stays off.

## [1.49.0] — 2026-08-28

### Added
- **Colonization Threats — a new page that warns you before you lose ground, not after.** Flag the systems you actually intend to hold, from the Threats page or with the shield on Expansion, and the app watches **50 ly around each one**. Colonization spreads in claim hops of roughly 15 ly, so that radius is about three hops of warning — enough to see a chain bridging toward your ground while you can still take it. Watching the system itself would only ever report the loss.
- Each flag shows the nearest foreign claim, its distance, and how many hops away it is. Alerts fire on the 2nd screen when a claim first appears inside the radius, when it moves **closer**, or when the flagged system is itself taken — and stay silent when nothing changed.
- **Your own systems are excluded.** Spansh reports your active builds as being colonised too; unfiltered, the first thing this feature would have done is alarm you about your own construction.
- A failed lookup reports **unknown**, never "clear". A false all-clear is the one answer this must not give.
- **Mission earnings are now recorded per system.** The journal tracked a lifetime total and threw the location away, which hid the fact that a single system had paid out 1.91 billion across 43 missions. Ranked by credits, never by mission count — 364 missions in one system were worth a fiftieth of 43 in another.

### Fixed
- **Restarting while parked in a ring no longer orphans every rock after it.** The current ring was held only in memory, with no way to recover it until you flew out and came back, so a mid-session restart logged the rest of that ring's rocks with no location at all — 45 of them historically, including the single best rock in the log, which also silently detached it from its hotspot mark. The ring is now re-derived from the journals at startup.

### Changed
- **The squadron leaderboard is off Architect's Domain.** A comparison against someone else sat oddly on a page about your own territory.

## [1.48.0] — 2026-08-28

### Changed
- **Every rock is now valued at market, never at a mission rate.** A tonne pulled under a 136k/t contract used to be logged at 136k/t forever, while the same tonne mined a week later logged at ~36k — two currencies in one table, so the history could not be compared with itself. Mission pricing is out of every valuation: records, badges, catch tiers, the worth-it line, session credits and the rock log all price refined tonnage at today's market. Expect your all-time totals to drop sharply and the personal-best order to reshuffle; that is the correction landing, not a regression.
- Historical rows keep their original numbers on disk — the log is append-only — and are re-priced when read, so nothing is rewritten and nothing is lost.
- **Mission targeting is untouched.** Mission materials still light up as targets and the 3% floor still fires on exactly the rocks it did before. Only the price attached to them changed.
- **"Sessions" is now "Hauling".** The whole app is about colonization, so that word never told you which sessions these were — and now that mining has sessions of its own, the distinction matters.

## [1.47.0] — 2026-08-28

### Added
- **The tracker now knows which hotspot you are parked in.** Nav-lock a hotspot before you drop into the ring and every rock logged there is stamped with it — no more hand-annotating afterwards. `Status.json` names the lock outright (`Tritium Hotspot`), so the material is read rather than guessed, and locking anything else — a station, the carrier, nothing at all — correctly records "not a hotspot".
- The hotspot is **frozen on ring entry**, not on the first rock. By the time you prospect, you may well have re-locked the carrier to go unload, and that would have credited the whole patch to the wrong place.

### Changed
- Your own hotspot marks still win. The automatic capture only fills gaps, because dropping into a hotspot without nav-locking it is a perfectly normal thing to do and only you know that happened.

### Notes
- **No backfill, and there never can be.** The journal records nothing about what you target — a full 63-rock session's only destination events were the carrier at either end. The nav lock exists solely in `Status.json`, which is overwritten every few seconds and never archived, so it has to be caught live. Rocks logged before this build cannot be attributed retroactively.
- Refined material can never identify a hotspot on its own: a tritium hotspot still yields the ring's other minerals, which is precisely why the nav lock was needed.

## [1.46.0] — 2026-08-12

### Changed
- **Gold text for the biology worth landing for.** Focus genera now render in gold on the checklist, per-genus rather than colouring the whole row — so `Tubus/Tussock` shows the Tubus gold and the Tussock plain. Banked genera keep their struck-through ✓.
- **Focus set corrected against measured receipts: Tubus · Frutexa · Aleoida.** Frutexa was MISSING despite Flammasis paying 10.33M base / 51.6M first-logged — second only to Tubus Cavas. Stratum, Cactoida and Concha were REMOVED: they were flagged on their jackpot species (Tectonicas, Vermis, Biconcavis), but what actually turns up is Paleas 1.36M, Lapis 2.48M and Labiata 2.35M — filler tier. Flag a genus on what shows up, not its best case.

## [1.45.0] — 2026-08-12

### Added
- **Type the token into the app.** A network device with no token now gets a paste-it-once prompt instead of needing a ?token= URL. The token is verified against the server before being saved, so a typo says so rather than half-working, and you can bookmark the plain address from then on.
- **Fullscreen on the 2nd Screen** — same control the Radar page has: CSS overlay always works, the Fullscreen API hides browser chrome on top where supported. Pairs with an iPad home-screen shortcut for a dedicated cockpit display.

### Fixed
- **The token no longer evaporates when the tab closes.** It was stored only in sessionStorage, so an iPad home-screen shortcut lost authentication on every relaunch and had to be re-opened from a token URL. It now persists in localStorage as well (both are written, session read first), which is the actual reason bookmarking never stuck.

## [1.44.0] — 2026-08-12

### Added
- **The co-pilot knows when you are out in the Nomad.** The Nomad is an SRV (journal ), and the big ship auto-follows it — so while you are away the co-pilot is aboard the ship *station-keeping directly overhead with eyes on you*, not reading telemetry and not riding along. Every line reframes itself accordingly through an injected context fact; no new chatter, just the right vantage point. Three states tracked: driving the Nomad, on foot beside it, and on foot from a landed ship.
- **Welcome-back on Nomad docking** —  fires a warm return beat greeting something the co-pilot actually SAW from above (hand-written canned pools for all three personas; no regen).

### Fixed
- **An SRV is not a ship.**  reports  when you log in inside the Nomad, and the affinity tracker took it at face value — the co-pilot believed the Nomad was your hull and would pass ship judgement on it. SRV type ids are now rejected as hulls, and the real hull is remembered as the mothership.
- The single-seat cargo-hold gag is suppressed while you are away — its premise (crammed in *this* ship's hold) is wrong when you are the one on the surface.

## [1.43.0] — 2026-08-11

### Added
- **Per-genus done-marks on bio rows** — the genus list shows ✓/strikethrough on genera you've already banked a species from (live from Analyse events, seeded from the organics ledger), money genera sort FIRST in the list, and the 💰 flag now clears once every money genus on the body is done — "sample the top two and move on" reads directly off the card.
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
