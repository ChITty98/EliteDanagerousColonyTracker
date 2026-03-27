# ED Colony Tracker — Release Notes

## v1.1.0 (2026-03-18)

### New Features

**Colony Chain Planner** (`/planner`)
- Multi-hop pathfinder for reaching distant target systems via 15ly colonization hops
- Route-first, score-later algorithm — finds candidate routes cheaply (position + body count only), then scores just the unique systems on viable paths
- Typically scores 10-30 systems instead of 1,000+ (previous beam search approach scored every candidate at every hop)
- Preview Route: fast greedy hop-by-hop preview (no scoring, instant results)
- Find & Score: full pathfinding with scoring of intermediate systems
- Hop distances displayed in chain visualization and expanded detail view
- Save scored routes to expansion scouting data with one click
- Journal-first: checks local data (knownSystems, journalExplorationCache, scoutedSystems) before Spansh API
- Connector system detection: systems with <3 qualifying bodies flagged as connectors

**Expansion Scouting — Nearby Candidates** (System Detail > Nearby Candidates tab)
- Split into two collapsible sections:
  - "Within 15ly — single hop": all candidates in direct colonization range
  - "Beyond 15ly — top 10 by score": candidates requiring chain planning
- Directional arrows on each system row (8-point compass: toward/away from galaxy center + above/below galactic plane)
- Collapsible headers with chevron toggles

**In-Game Overlay Integration**
- EDMCModernOverlay support via TCP socket (port 5010) through Node.js server
- FSDJump triggers: system scout score, body summary, market relevance for active projects
- Docked triggers: "Buy here" commodity list matching active project needs
- Scan event accumulation for scoring on FSSAllBodiesFound
- HTTP POST `/overlay` endpoint + `/overlay/status` for connection monitoring
- Overlay enable/disable toggle in Settings

**Ardent Insight API Integration** (`/sources`)
- Live commodity market data from EDDN via Ardent Insight API
- Find where to buy commodities with distance filtering
- 5-minute cache per query
- Server-side proxy (`/ardent-api`) to avoid CORS issues
- Complements local market snapshots from journal data

**Journal Exploration Cache**
- `journalExplorationCache` store slice — caches body scan data (Scan, FSSDiscoveryScan events) from journal files
- Enables journal-first scoring without Spansh API dependency
- `journalBodiesToSpanshFormat()` converts journal body data to scorer-compatible format

**Installation Type Dataset**
- Complete 55-type installation dataset (`installationTypes.ts`)
- Orbital and surface station types with tier classification
- T2/T3 point tracking per installation type
- Pad size, tier, and journal type mapping

### Improvements

**Scoring System**
- Score 0 now displays as "?" with tooltip "No body scan data — FSS this system to get a score" (both System Detail and Dashboard cards)
- "Rescore All" button on Dashboard now ALWAYS rescores ALL colonies (previously skipped systems with score 0 or existing scores)
- Best-data-wins scoring in pathfinder: journal data only used when it has strictly MORE bodies than Spansh (prevents partial journal scans from producing lower scores)
- Systems with FSSDiscoveryScan only (body count known but no individual Scan events) correctly shown as "?" not 0

**Dashboard**
- System advancement cards with tier progress visualization
- Session summary with recent contribution tracking
- Colony scoring treats score=0 as unscored in progress indicators

**Planner Efficiency**
- Replaced beam search (8 beams x 15 candidates x N hops = thousands scored) with route-first approach
- Phase 1: Find routes using beam search on positions only (no API calls for body data)
- Phase 2: Score only unique systems across found routes
- Phase 3: Assemble and rank by aggregate score
- Result: ~95% reduction in API calls for typical pathfinding operations

**Exe Build**
- Fixed banner box alignment — uses runtime `pad()` helper with fixed box width (W=42)
- Dynamically pads version string and URL lines regardless of length
- Cleaned up ANSI escape code repetition with variables

### Bug Fixes

- Fixed `stationDistOverrides is not defined` ReferenceError on system detail page (Rollup scope deconflicting bug — manual distance editing feature rolled back entirely)
- Fixed "Rescore All" button doing nothing (was filtering out systems with score 0)
- Fixed score 0 displaying as actual score instead of "?" (no body data)
- Fixed pathfinder being 100% Spansh-dependent (added journal-first local data sources)
- Fixed banner box right border misalignment in exe startup display
- Fixed pathfinder scoring thousands of unnecessary systems (route-first redesign)

### Technical Changes

- Store version bumped to 18 (migration for stationDistOverrides and journalExplorationCache)
- PathfinderProgress phase type changed from 'searching' to 'routing' for Phase 1
- `LocalSystemData` interface for passing journal data to pathfinder
- `findLocalNearbySystems()` helper checks knownSystems, journalExplorationCache, and scoutedSystems
- `scoreNode()` now gathers both journal and Spansh data, picks richer source
- `findCandidateRoutes()` extracted as Phase 1 of pathfinding (no scoring)
- Deduplicated routes by intermediate system id64 sequence
- NodeDetail component accepts `prevNode` for hop distance calculation

---

## v1.0.0 (Initial Release)

### Core Features

**Colonization Project Tracking**
- Automatic detection of colonization depots from journal files (ColonisationConstructionDepot events)
- Per-commodity progress tracking (18 colonization commodities across heavy/medium/light categories)
- Manual project creation for projects not yet detected in journals
- Project status lifecycle: Active -> Completed/Abandoned

**Knowledge Base**
- Automatic extraction of all visited systems and stations from journal files
- Station details: type, pad size, distance from star, economies, services
- Market snapshot caching from docked station data
- System coordinates from FSDJump events

**Expansion Scouting** (`/scouting`)
- 8-component scoring model (200pt scale) for evaluating colonization potential
- Qualifying body filters: landable, <2.5 Earth masses, excludes bare icy
- Star type classification with bonus values
- Economy diversity scoring
- Compact body notation strings
- Reference system selection from colonized systems
- Configurable search radius (15-50ly)
- Spansh API integration for body data with 1 req/sec rate limiting

**Fleet Carrier Management**
- Carrier cargo estimation from journal CargoTransfer events
- Commodity matching against active project needs
- Multi-carrier support (own + squadron callsigns)

**Session Tracking**
- Play session management per project
- Delivery rate calculation (tons/hour)
- Session duration tracking
- Start/end commodity snapshots for delta computation

**Journal Statistics** (`/journal-stats`)
- Full journal history scan across all log files
- Aggregate stats: systems visited, distance travelled, credits earned
- Top visited systems

**Commodity Sources** (`/sources`)
- Local market snapshot search
- Custom source management with priority and notes

**Settings & Configuration**
- Commander name, cargo capacity
- Journal folder selection via File System Access API
- Fleet carrier callsign management
- Theme support (dark mode)
- Data import/export for backup

**FAQ & Documentation**
- In-app FAQ covering all features
- Design philosophy documentation
- Troubleshooting guides

**Build & Distribution**
- Standalone Node.js SEA executable (no install required)
- .bat launcher fallback (requires Node.js)
- Auto-versioning with build timestamp
- Auto-opens browser on launch
- SPA routing with index.html fallback

---

## Architecture

- **Frontend**: React 19 + TypeScript + Tailwind CSS + React Router
- **State**: Zustand with localStorage persistence
- **Backend**: Node.js HTTP server (embedded in exe) with API proxies
- **APIs**: Spansh (systems/bodies), Ardent Insight (markets), EDMCModernOverlay (overlay)
- **Build**: Vite + custom SEA bundler (build-exe.mjs)
- **Philosophy**: Journal-first, API-augmented, standalone-first
