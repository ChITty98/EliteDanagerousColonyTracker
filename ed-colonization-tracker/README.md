# ED Colony Tracker

A comprehensive companion app for **Elite Dangerous** colonization gameplay. Track your colonies, scout expansion candidates, plan multi-hop routes, manage fleet carrier logistics, and monitor everything in real-time through an in-game overlay and iPad companion screen.

Built with React, TypeScript, and Node.js. Runs as a standalone Windows `.exe` — no install required.

---

## Features

### Dashboard
Your command center. See all 20+ colonized systems at a glance with tier-based cards (Outpost → Settlement → Colony → Hub), population badges, installation counts, and progress bars for active construction projects. Systems are color-coded by tier with glow effects. A "HERE" badge shows which system you're currently in.

### Colony Map
Interactive 2D galactic map (X/Z plane, top-down view) showing all your colonies positioned by real galactic coordinates. Pan, zoom, pinch-to-zoom on iPad. Color-coded by tier, with your ship shown as a pulsing cyan triangle that updates on each jump. Optional Sagittarius A* reference point. Click any system name to zoom in. Connection lines show nearest-neighbor distances between colonies.

### Architect's Domain
A showcase of everything remarkable across your territory. Highlights rare stars (neutron stars, black holes, Wolf-Rayet), special atmospheres (oxygen worlds, ammonia worlds), and notable stations (Coriolis, Orbis, Dodec Spaceport). Expandable drill-down sections for stars, landable bodies, other bodies, and installations — each sorted by rarity. Fully configurable from Settings: choose which types count as "highlights."

### Expansion Scouting
Find your next colony. Search nearby systems by radius, score them for colonization potential, and compare candidates side-by-side. Scoring evaluates landable body count, atmosphere diversity, star rarity, ring presence, agricultural potential, and more. Supports both Spansh API data and your own journal scans — whichever has better data wins.

### Chain Planner
Multi-hop route pathfinder for building colony chains. Set a start and target system, and the planner finds optimal routes where each hop is within 15 ly. Uses a two-phase approach: fast beam search to find candidate routes (no API calls), then detailed scoring of the ~20-30 best routes. Shows hop distances, body counts, and aggregate scores.

### Nearby Candidates
On each system detail page, see two lists: systems within 15 ly (single-hop colonization options) and the top 10 beyond 15 ly. Both include 8-point compass directional arrows showing where each candidate is relative to your current system.

### In-Game Overlay
Integrates with [EDMCModernOverlay](https://github.com/) for heads-up display while playing:
- **On jump**: Shows scouting score, colony ownership status, FSS completion
- **On dock**: Lists commodities needed for active construction projects
- **On scan**: Highlights qualifying landable bodies with atmosphere type, gravity, rings
- **On FSS complete**: Confirms all bodies found
- Score color-coded: gold (100+), green (60+), blue (<60)

### Companion Page (iPad Second Screen)
Designed for an iPad propped up next to your monitor:
- **Live event feed** via Server-Sent Events — see jumps, docks, scans, contributions in real-time
- **Remote control buttons** — trigger "Show Score", "Show Needs", "Show Haul", "Show Status" on the overlay without alt-tabbing
- **FC Free Cargo widget** — at-a-glance free space on your Fleet Carrier, computed live as `25,000 − Modules − Current Cargo`. Color-coded (green/yellow/red) so you know at a glance whether you have room for one more haul.
- Works from any device on your local network

### Fleet Carrier Management
Track cargo across your fleet carrier and squadron carriers. Auto-detects carrier callsign and market ID from journal events. Monitor commodity stock levels and plan deliveries. Set your installed Modules tonnage once in Settings and the app will keep your free space accurate as you load and unload.

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
Any device on your local network can access the app at `http://<your-pc>:5173?token=<auto-generated-token>`. Token is generated on first run and saved to `colony-token.txt`. Localhost connections bypass token auth.

iPad and iPhone get full read access to all data. Journal scanning and session management require Chrome on the host PC (File System Access API).

### External API Integrations
| API | Purpose | Proxy Route |
|-----|---------|-------------|
| [Spansh](https://spansh.co.uk) | System dumps, body data, nearby search | `/spansh-api/*` |
| [EDSM](https://www.edsm.net) | System coordinates, traffic data | `/edsm-api/*` |
| [Ardent Insight](https://ardent-insight.com) | Live commodity prices and stock | `/ardent-api/*` |

All API calls are proxied through the server to avoid CORS issues. The app follows a **journal-first philosophy** — every feature must work without external APIs. APIs supplement journal data, never replace it.

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
- Chrome browser (for File System Access API — Firefox won't work for journal scanning)
- Node.js v20 or newer (required if running via the .bat launcher; not needed for the standalone .exe)
- [EDMCModernOverlay](https://github.com/) (optional, for in-game overlay)

### Running the App

**Option 1: Standalone Executable (recommended)**
```bash
# Build the exe
npm install
npm run build:exe

# Run it
./ed-colony-tracker.exe
```
The build produces two artifacts: `ed-colony-tracker.exe` (standalone — bundles Node.js, no install needed) and `ed-colony-tracker.bat` (a fallback launcher that requires Node.js installed on the machine). Use the .exe when available.

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
2. Go to **Settings** → click **Select Journal Folder**
3. Navigate to `C:\Users\<You>\Saved Games\Frontier Developments\Elite Dangerous`
4. Grant read permission when prompted
5. Go to **Dashboard** → click **Import from Journal** to detect existing colonies
6. Start a play session and the journal watcher will track everything automatically

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
- **Data Management** — export/import JSON backups, reset

### Domain Highlights
Toggleable chips for each category:
- **Stars**: Black Hole, Neutron Star, Wolf-Rayet, White Dwarf, O-class, Carbon Star, B-class, A-class, F-class, G-class, K-class, M-class, Brown Dwarf
- **Atmospheres**: Oxygen, Nitrogen, Ammonia, Carbon Dioxide, Sulphur Dioxide, Water, Methane, Argon, Helium, Neon
- **Stations**: Dodec Spaceport, Coriolis Station, Orbis Station, Ocellus Station, Asteroid Base, Megaship, Planetary Port, Surface Station, and more

---

## Data Files

| File | Purpose | Auto-created |
|------|---------|-------------|
| `colony-data.json` | All app state (projects, systems, settings, sessions) | Yes |
| `colony-token.txt` | Auth token for network access | Yes |
| `colony-gallery.json` | Image metadata | Yes |
| `colony-images/` | Screenshot files | Yes |

All files live next to the executable. Back up `colony-data.json` to preserve your data.

---

## Project Structure

```
ed-colonization-tracker/
├── src/
│   ├── app/                    # App shell, routing, layout
│   ├── components/             # Shared UI components
│   ├── data/                   # Static datasets (commodities, station types, installations)
│   ├── features/
│   │   ├── carrier/            # Fleet carrier page
│   │   ├── companion/          # iPad companion page
│   │   ├── dashboard/          # Dashboard, tier utils, system cards
│   │   ├── domain/             # Architect's Domain page + helpers
│   │   ├── faq/                # FAQ & Help page
│   │   ├── journal-stats/      # Journal history scanner
│   │   ├── map/                # Colony map (SVG)
│   │   ├── planner/            # Chain route planner
│   │   ├── projects/           # Project CRUD pages
│   │   ├── scouting/           # Expansion scouting
│   │   ├── sessions/           # Play session tracking
│   │   ├── settings/           # Settings page
│   │   ├── sources/            # Commodity source finder
│   │   └── systems/            # System detail, bodies tab, nearby tab
│   ├── lib/                    # Core algorithms (pathfinder, scorer, utils)
│   ├── services/               # External integrations (journal, overlay, APIs)
│   ├── store/                  # Zustand store, types, gallery store
│   └── styles/                 # Global CSS
├── build-exe.mjs               # Standalone exe builder
├── server.mjs                  # Dev/production server
├── vite.config.ts              # Vite configuration
└── package.json
```

---

## Journal Events Processed

The app reads and processes these Elite Dangerous journal events:

**Navigation**: FSDJump, Location, SupercruiseEntry, Docked
**Exploration**: FSSDiscoveryScan, Scan, SAAScanComplete, FSSAllBodiesFound
**Colonization**: ColonisationSystemClaim, ColonisationBeaconPlaced, ColonisationConstructionDepot, ColonisationContribution
**Ship**: Loadout, ShipyardSwap, Cargo.json, Market.json
**Fleet Carrier**: CarrierJump, CarrierStats, CarrierDepositFuel

---

## Contributing

This is a personal project built with Claude Code. Feature requests and bug reports welcome via GitHub Issues.

## License

MIT
