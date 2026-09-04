# ED Colony Architect

A comprehensive companion app for **Elite Dangerous** colonization gameplay. Track your colonies, scout expansion candidates, plan multi-hop routes, manage fleet carrier logistics, and monitor everything in real-time through an in-game overlay and iPad companion screen.

Built with React, TypeScript, and Node.js. Runs as a standalone Windows `.exe` — no install required.

**Current release: 1.57.0** — see [ed-colonization-tracker/CHANGELOG.md](ed-colonization-tracker/CHANGELOG.md) for what changed and when. The app follows a journal-first rule: everything below works from the game's own journal files; external services only add to it.

---

## Features

### Dashboard
Your command center. See all your colonized systems at a glance with tier-based cards (Outpost → Settlement → Colony → Hub), population badges, installation counts, and progress bars for active construction projects. Systems are color-coded by tier with glow effects. A "HERE" badge shows which system you're currently in.

### System View (Orrery)
A prospecting tool for evaluating systems. Displays the full system hierarchy as an interactive tree — stars on the left, planets branching right, moons dropping below. Bodies are color-coded by type (icy=cyan, HMC=brown, rocky=grey, gas giant=amber). Landable bodies get cyan rings matching the in-game UI. Atmospheric landables glow with their atmosphere color. Multi-star systems show bracket connectors for shared barycenters (e.g., BC planets bracket between stars B and C). Features:
- **Live scanning**: bodies appear in real-time as you FSS scan
- **Auto data source**: defaults to whichever has more bodies (journal or Spansh), with manual toggle
- **Bio signals**: 🧬 indicator shows biological signal count from FSSBodySignals
- **Dark zone**: 🌑 icon flags bodies below 10% Earth illumination (too far from dim stars)
- **Temperature**: displayed as Kelvin with game-accurate labels (Normal/Cold/Hot/Dangerous)
- **Pressure**: converted to atmospheres, hidden below 0.01 atm
- **Uniform/Relative sizing**: toggle between equal-size bodies and mass-based scaling
- **URL access**: open any system via `/orrery?system=SystemName` — linked from Expansion page and system detail
- **Multi-device**: works on iPad/Surface with refresh button and 3-second position polling

### Colony Map
Interactive 2D galactic map (X/Z plane, top-down view) showing all your colonies positioned by real galactic coordinates. Pan, zoom, pinch-to-zoom on iPad. Color-coded by tier, with your ship shown as a pulsing cyan triangle that updates on each jump. Optional Sagittarius A* reference point. Connection lines show nearest-neighbor distances between colonies.

### Architect's Domain
A showcase of everything remarkable across your territory. Highlights rare stars (neutron stars, black holes, Wolf-Rayet), special atmospheres (oxygen worlds, ammonia worlds), and notable stations (Coriolis, Orbis, Dodec Spaceport). Expandable drill-down sections for stars, landable bodies, other bodies, and installations — each sorted by rarity. Fully configurable from Settings: choose which types count as "highlights."

**Domain Records**: Trophy cards showing your territory's extremes — largest star, thickest atmosphere, highest/lowest gravity, hottest/coldest surface, tightest orbit, largest ring — plus Most Mining Signals, Richest Signals (each signal counted as its three best commodities), Highest Ground Reached and Most Hotspots. Facts about the ground you hold, never about what you chose to pull. **Notable Surface** lists brain trees on domain bodies from your flags and from groves pinned on the Surface Mining page.

### Expansion Scouting
Find your next colony. Search nearby systems by radius, score them for colonization potential, and compare candidates side-by-side. Scoring evaluates landable body count, atmosphere diversity, star rarity, ring presence, agricultural potential, and more. Supports both Spansh API data and your own journal scans — whichever has better data wins.

### Chain Planner
Multi-hop route pathfinder for building colony chains. Set a start and target system, and the planner finds optimal routes where each hop is within 15 ly. Uses a two-phase approach: fast beam search to find candidate routes (no API calls), then detailed scoring of the ~20-30 best routes. Shows hop distances, body counts, and aggregate scores.

### Nearby Candidates
On each system detail page, see two lists: systems within 15 ly (single-hop colonization options) and the top 10 beyond 15 ly. Both include 8-point compass directional arrows showing where each candidate is relative to your current system.

### In-Game Overlay
Integrates with [EDMCModernOverlay](https://github.com/SweetJonnySauce/EDMCModernOverlay) for heads-up display while playing:
- **On jump**: Shows scouting score, colony ownership status, FSS completion
- **On dock**: Lists commodities needed for active construction projects
- **On scan**: Highlights qualifying landable bodies with atmosphere type, gravity, rings
- **On FSS complete**: Confirms all bodies found
- Score color-coded: gold (100+), green (60+), blue (<60)

### Companion Page (iPad Second Screen)
Designed for an iPad propped up next to your monitor:
- **Live event feed** via Server-Sent Events — see jumps, docks, scans, contributions in real-time
- **Remote control buttons** — trigger "Show Score", "Show Needs", "Show Haul", "Show Status" on the overlay without alt-tabbing
- Works from any device on your local network

### War & Peace (BGS conflicts)
Find systems near you with active conflicts — War, Civil War, or Election — filtered by distance, state and allegiance, with a deeper Spansh + EDSM scout per system: live conflict pairs, combat anchors and full-service stations. Cached per BGS tick.

### Fleet Carrier Management
Carrier cargo is tracked transactionally: every transfer while docked at your carrier, your own buys and sells against its market, and tritium to the tank, replayed from the journals since the carrier was bought. That is exact for ore and anything without a trade order; sell orders are reconciled from the carrier's market read, the game's CarrierStats total is the check, and the remainder is shown as "not itemised". A baseline typed from the carrier's inventory screen anchors what the journal cannot count. Squadron carriers show their sell orders.

### Asteroid Mining
A mining assist for ring mining, built only from measured data. Every prospected rock gets an expected credit total: proportion → tonnes through a per-material yield table calibrated from your own log, tonnes → credits at the best live non-carrier buyer within 500 ly or your own visited-market average. "Worth it" is the median rock of the ring you are in, from your own history. Target hits fire regardless of value, stalls are reported as facts, hold warnings use effective ore space, hotspots are attributed from the nav lock, and trophies and streaks accumulate per session.

### Surface Mining
The Rhino's page: bodies → signals → deposits. Nav-lock a "Planetary Mining Location Signal (N)" before you drop and the visit is filed under it; a login on the surface starts a new visit. A live hero, a compass to any deposit or back to the ship, a signal map from the breadcrumb track, F10 screenshots as deposit markers, tags from orbit, landing and driving ratings, rigs per deposit (a full rig is 12 t since the 4 September 2026 patch), brain-tree groves, and "Where to go back" ranked by credits per hour of being there. One price rules the page: your best market in the last 30 days within 10,000 ly, else the game's own galactic average.

### Sell Cargo
Your ship's hold and your carrier's cargo priced three ways — here, local within a range you pick, and galaxy within one carrier jump or the overall top of book — with tonnes × price on every line, a sell-everything total per column, any of 335 commodities searchable, a "trade nearby" board of lowest buy → highest sell pairs, and a year of price history per commodity. Community Goal markets are tagged as such.

### Co-pilot
A voiced co-pilot with three personas — Wren, Tycho and K2 — reacting to jumps, docks, scans, hauling, mining, threats and GalNet news, from a curated canned corpus or live generation through the local Claude command line with a breaker back to canned. Humour and honesty are dials in Settings.

### Proximity Radar, Chain Watch and Threats
The radar listens to the EDDN firehose for what tool-running commanders are doing within 200 ly; Chain Watch turns colonisation events into named chains near your regions; Threats watches 50 ly around systems you have flagged. One switch in Settings turns the feed off, because it is about 1.8 GB a day inbound.

### Rewards, Materials, Sights and Wiki
**Rewards** states facts about mission and reward options, never a verdict. **Materials** shows your engineering material inventory from the journal, trader yields and blueprint capacity. **Sights** is the postcard ledger of places you have been. The **Wiki** holds the author's scouting reference and the journal facts behind surface mining and selling.

### Sessions
Start/stop play sessions tied to specific colonization projects. Tracks commodities hauled, jumps made, stations docked. Session summary popup shows contribution totals when you return.

### Sources Page
Find where to buy commodities. Integrates with the Ardent Insight API for live market data across the galaxy. Shows prices, stock levels, and distance from your current location.

### Journal Stats
Scan your full journal history for exploration data, visit counts, and system knowledge. Rebuilds the knowledge base from all journal files — useful after a fresh install or data reset.

### System Detail Pages
Deep-dive into any system with three tabs:
- **Installations** — all stations, their types, landing pads, economies, services
- **Bodies** — full body tree with star/planet hierarchy, atmosphere classification, gravity, rings, volcanism. Supports journal scans and Spansh data. "Prime" indicators for high-value colonization targets.
- **Nearby Candidates** — expansion scouting from this system

---

## Architecture

### Tech Stack
| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript 5.9, Tailwind CSS 4 |
| State | Zustand 5 with persist middleware |
| Routing | React Router 7 |
| Build | Vite 7 |
| Server | Node.js HTTP (embedded in exe) |
| Packaging | Node.js SEA (Single Executable Application) |

### Server-Side Storage
All app data persists in `colony-data.json` next to the executable. No database required. The server exposes REST endpoints that the frontend uses via Zustand's storage adapter:

- `GET /api/state` — fetch full app state
- `PATCH /api/state` — merge state updates (debounced 500ms)
- `GET /api/events` — SSE stream for real-time push to all connected browsers
- `POST /api/events` — broadcast events from journal watcher
- `POST /overlay` — forward messages to EDMCModernOverlay (TCP port 5010)

### Multi-Device Access
Any device on your local network can access the app at `http://<your-pc>:5173?token=<auto-generated-token>`. Token is generated on first run and saved to `colony-token.txt`. Localhost connections bypass token auth. Bookmark the URL on each device for easy access.

iPad, Surface, and phone get full functionality — the server process owns journal access, so no browser on the host PC is required and any browser works. Real-time state sync via SSE — when you score colonies or sync journal on the PC, other devices update automatically. The System View (Orrery) on remote devices polls for commander position every 3 seconds and receives body scan updates via inline SSE data.

### Data Protection
- **Automatic backups**: `colony-data.json` is copied to `backups/` on every exe startup (keeps last 5)
- **Size-check guard**: refuses to write state smaller than 30% of existing file (prevents empty state overwrite)
- **Hydration guard**: won't PATCH to server until initial state load completes
- **Always-merge upserts**: `knownSystems` merges fields from all sources — coordinates, population, economy never get clobbered by partial updates

### FC Jump Countdown
Tracks `CarrierJumpRequest` journal events with departure time. Broadcasts to companion page and overlay. Clears on `CarrierJumpCancelled` or `CarrierJump` completion.

### External Services
| Service | Used for | How often | Without it |
|---------|----------|-----------|------------|
| [Spansh](https://spansh.co.uk) | Scouting, threats, chain watch seed, radar lookback, War & Peace | User-driven at 1.1 s spacing; chain seed once; lookback at most every 5 min; War & Peace cached until the weekly tick | Scouting, threats and lookback stop |
| [EDSM](https://www.edsm.net) | Arrival traffic, factions, colony watch | Once per jump (10 min cache); at most 5 calls per dock | Arrival overlays lose the traffic line |
| [Ardent Insight](https://ardent-insight.com) | Live commodity buyers and prices (EDDN-fed) | Hourly per commodity, cached; Sell page lookups cached an hour; a daily history sample | Prices fall back to your own markets, then the galactic average |
| EDDN firehose (`eddn.edcd.io:9500`) | Proximity radar and chain watch | Always on while enabled — about 1.8 GB a day inbound | Radar and chain watch dormant. Switch in Settings |
| GalNet CMS | Co-pilot news beat | Every 30 min | No news lines |
| BGS tick service | Tick awareness | Every 15 min | Tick features dormant |
| GitHub Releases | Update banner | On boot and every 6 h | No update banner |
| Local `claude` command | Co-pilot live lines | One at a time, 20 s timeout, breaker | Canned lines |

Browser-side calls are proxied through the server (`/spansh-api/*`, `/edsm-api/*`, `/ardent-api/*`) to avoid CORS. Nothing the journals feed needs the network; every external call fails quiet with a fallback.

### Gallery
Screenshots stored server-side in `colony-images/` folder. Upload from any device including iOS camera. Images associated with systems and displayed on system detail pages, dashboard cards, and Architect's Domain.

---

## Scoring Algorithm

Systems are scored for colonization potential based on:

| Factor | Weight | Description |
|--------|--------|-------------|
| Qualifying bodies | Foundation | Landable, <2.5 Earth masses, non-icy (unless atmospheric) |
| Star rarity | High | Black Hole (20pts), Neutron (20), O-class (18), Wolf-Rayet (15), White Dwarf (12) |
| Atmosphere diversity | Medium | Unique atmosphere types across bodies |
| Agricultural worlds | Medium | Bodies suitable for agriculture |
| Ring presence | Low | Bodies with ring systems |
| Pristine reserves | Low | Unspoiled resource deposits |

**Data source priority**: Journal data wins when it has strictly more bodies than Spansh. On tie or Spansh has more, Spansh wins. This ensures the most complete picture.

---

## Tier System

Colonized systems are classified by their installation count:

| Tier | Label | Installations | Card Style |
|------|-------|--------------|------------|
| 1 | Outpost | 1-2 | Slate border |
| 2 | Settlement | 3-4 | Emerald border + glow |
| 3 | Colony | 5-7 | Violet border + glow |
| 4 | Hub | 8+ | Gold border + glow |

Tier is determined by T2/T3 installation points when available, falling back to raw installation count.

---

## Getting Started

### Prerequisites
- Windows 10/11
- Elite Dangerous (for journal data)
- [Node.js](https://nodejs.org/en/download) v20 or newer — needed to build from source or to use the `.bat` launcher; the standalone `.exe` bundles its own and needs nothing installed
- A modern browser — Chrome, Edge, Firefox, Safari all work; the server owns journal access
- [EDMCModernOverlay](https://github.com/SweetJonnySauce/EDMCModernOverlay) (optional, for in-game overlay)

### Running the App

**Option 1: Standalone Executable (recommended)**
```bash
# Build the exe
npm install
npm run build:exe

# Run it
./ed-colony-architect.exe
```
The exe bundles everything — Node.js runtime, server, and built frontend, with the app icon and version info. No dependencies needed at runtime.

**Option 2: Development Mode**
```bash
npm install
npm run dev        # Vite dev server with HMR
# In another terminal:
node server.mjs    # API server for storage + proxies
```

**Option 3: Production Server**
```bash
npm install
npm run build
npm start          # Serves built files + API
```

### First Launch
1. The app opens Chrome automatically at `http://localhost:5173`
2. The journal folder is auto-detected (`C:\Users\<You>\Saved Games\Frontier Developments\Elite Dangerous`); set an override in **Settings** only if yours lives elsewhere
3. Go to **Dashboard** → click **Sync All from Journal** to detect existing colonies and build the knowledge base
4. Play. The server-side journal reader tracks everything from then on; the mining and carrier ledgers backfill themselves from your journal history on first run

### Network Access (iPad/Phone)
The console shows a URL like:
```
Network: http://192.168.1.100:5173?token=abc123...
```
Open this on any device on the same network. Bookmark it on your iPad for quick access.

---

## Configuration

### Settings Page
- **Commander Name** — your CMDR name
- **Ship Cargo Capacity** — auto-detected from Loadout events, manual override available
- **Home System** — reference point for distance calculations
- **Fleet Carrier** — callsign (XXX-XXX format), auto-detected market ID
- **Squadron Carriers** — track multiple fleet carriers
- **Domain Highlights** — configure which star types, atmosphere types, and station types appear as showpieces
- **Overlay** — enable/disable, connection status, test button
- **Co-pilot** — persona (Wren, Tycho, K2), humour and honesty dials, voice
- **Proximity radar** — the EDDN feed on or off (default on); a flip takes effect within a minute
- **Journal folder** — auto-detected; an override field for a non-standard location
- **Data Management** — export/import JSON backups, reset

### Domain Highlights
Toggleable chips for each category:
- **Stars**: Black Hole, Neutron Star, Wolf-Rayet, White Dwarf, O-class, Carbon Star, B-class, A-class, F-class, G-class, K-class, M-class, Brown Dwarf
- **Atmospheres**: Oxygen, Nitrogen, Ammonia, Carbon Dioxide, Sulphur Dioxide, Water, Methane, Argon, Helium, Neon
- **Stations**: Dodec Spaceport, Coriolis Station, Orbis Station, Ocellus Station, Asteroid Base, Megaship, Planetary Port, Surface Station, and more

---

## Data Files

| File | Purpose |
|------|---------|
| `colony-data.json` | All app state (projects, systems, settings, sessions, market snapshots, carrier record) |
| `colony-token.txt` | Auth token for network access |
| `colony-gallery.json`, `colony-images/` | Screenshot metadata and files |
| `backups/` | Timestamped recovery snapshots of the state file |
| `mining-log.jsonl` | Append-only rock log for asteroid mining |
| `mining-rings.json`, `mining-trophies.json`, `mining-annotations.json` | Ring and hotspot index from your scans, trophies and streaks, your notes |
| `surface-mining-log.jsonl`, `surface-mining-annotations.json`, `surface-track.jsonl` | Surface mining ledger, your tags and ratings, the breadcrumb track |
| `market-means.json` | The game's galactic averages, from every market you open |
| `market-history.jsonl` | A year of price history: market reads, daily Ardent samples, your own sales |
| `carrier-ledger.jsonl` | The carrier cargo transaction ledger |
| `journal-stats.json` | Lifetime statistics from the journal |
| `chain-watch.json` | The chain-watch frontier ledger |
| `copilot-memory.json`, `copilot-captures.jsonl`, `copilot-characters/` | Co-pilot memory, captured lines and ratings, persona portraits |

All files are created automatically, live next to the executable, and are ignored by git. Back up `colony-data.json` and the `.jsonl` ledgers to preserve your data.

---

## Project Structure

```
ed-colonization-tracker/
├── src/
│   ├── app/                    # App shell, routing, layout
│   ├── components/             # Shared UI components
│   ├── data/                   # Static datasets (commodities, station types, installations)
│   ├── features/
│   │   ├── carrier/            # Fleet carrier page (transaction ledger, baselines)
│   │   ├── chains/             # Chain Watch
│   │   ├── companion/          # iPad companion page
│   │   ├── copilot/            # Co-pilot page and persona picker
│   │   ├── dashboard/          # Dashboard, tier utils, system cards
│   │   ├── domain/             # Architect's Domain page + helpers
│   │   ├── faq/, wiki/         # FAQ & Help, the reference wiki
│   │   ├── journal-stats/      # Journal history scanner
│   │   ├── map/, system-view/  # Colony map (SVG), orrery
│   │   ├── materials/          # Engineering materials
│   │   ├── mining/             # Asteroid mining page and HUD
│   │   ├── planner/            # Chain route planner
│   │   ├── projects/           # Project CRUD pages
│   │   ├── radar/, threats/    # Proximity radar, threat watch
│   │   ├── rewards/            # Reward decision support
│   │   ├── scouting/           # Expansion scouting, scout map
│   │   ├── sell/               # Sell Cargo
│   │   ├── sessions/           # Play session tracking
│   │   ├── settings/           # Settings page
│   │   ├── sights/             # Postcard ledger
│   │   ├── sources/            # Commodity source finder
│   │   ├── surface-mining/     # Surface (Rhino) mining page
│   │   ├── systems/            # System detail, bodies tab, nearby tab
│   │   └── war-peace/          # BGS conflicts
│   ├── lib/                    # Core algorithms (pathfinder, scorer, utils)
│   ├── services/               # External integrations (journal, overlay, APIs)
│   ├── store/                  # Zustand store, types, gallery store
│   └── styles/                 # Global CSS
├── server/
│   ├── ai/                     # Co-pilot: personas, beats, arbiter, voice, canned corpus
│   ├── chains/                 # Chain watch and threat watch
│   ├── journal/                # Journal reader, processors, mining, surface mining, ledgers, prices
│   ├── radar/                  # EDDN listener (hand-rolled ZMTP), radar state
│   └── update/                 # Self-update check
├── tests/                      # Vitest suites (run with `npm test`)
├── scripts/, tools/            # Generators (price mirror) and repair tools
├── build-exe.mjs               # Standalone exe builder (esbuild bundle → Node SEA → icon)
├── server.mjs                  # Dev/production server
├── vite.config.ts              # Vite configuration
└── package.json
```

---

## Journal Events Processed

The app reads and processes these Elite Dangerous journal events:

**Navigation**: FSDJump, Location, SupercruiseEntry, SupercruiseExit, Docked, Undocked, Status.json (position, heading, altitude, nav lock)
**Exploration**: FSSDiscoveryScan, Scan, SAAScanComplete, SAASignalsFound, FSSAllBodiesFound, CodexEntry, Screenshot
**Colonization**: ColonisationSystemClaim, ColonisationBeaconDeployed, ColonisationConstructionDepot, ColonisationContribution
**Ship**: Loadout, ShipyardSwap, Cargo.json, Market.json (including MeanPrice), MarketBuy, MarketSell
**Mining**: ProspectedAsteroid, MiningRefined, LaunchSRV, DockSRV, Cargo (Vessel SRV), CargoTransfer
**Fleet Carrier**: CarrierBuy, CarrierJump, CarrierJumpRequest, CarrierStats, CarrierDepositFuel, CarrierTradeOrder, CargoTransfer
**Materials**: Materials, MaterialCollected

---

## Contributing

This is a personal project built with Claude Code. Feature requests and bug reports welcome via GitHub Issues.

## License

MIT
