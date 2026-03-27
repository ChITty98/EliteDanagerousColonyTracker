# Claude Code Handoff — ED Colony App New Features
## Context
This document describes new features to add to the existing Elite Dangerous colony management app. Claude Code already has full context on what the app currently does. This document is additive only — do not modify or contradict existing functionality.

Hub system: **HIP 47126** (Inner Orion Spur, well trafficked, good Spansh/EDSM coverage)
Commander is not registered in EDSM so no commander attribution data is available.

---

## Feature 1: Colony Expansion Scouting Page

A new page in the app dedicated to helping the commander identify and evaluate candidate systems for their next colonisation target.

### 1.1 Known Systems List

Query Spansh for all known systems within colonisation range (15ly) of HIP 47126 and any other systems the commander has already colonised.

Display this as a list with the following framing:
> "X known systems found within colonisation range. Any system you encounter in-game that does not appear on this list is uncharted."

This inverts the unknown system problem — instead of trying to show what hasn't been visited, the app shows what has, and absence from the list is the signal to explore.

Per system show:
- System name
- Distance from hub (ly)
- Claimed / unclaimed status (from Spansh/Raven Colonial if available)
- Overall score (see scoring model below)
- The star bucket body string (see display section below)

### 1.2 Data Sources

- **Spansh** — primary source for system data, body data, distances, star types, body properties
- **EDSM** — secondary source for any data Spansh doesn't cover
- **Raven Colonial API** — claimed/unclaimed status, planned installations
- Spansh API endpoint pattern: `https://www.spansh.co.uk/api/system/{id64}`

Key Spansh body fields to use:
- `type` / `subtype` — star or planet, rocky/icy/HMC etc.
- `distanceToArrival` — distance from main star in ls
- `isLandable` — boolean
- `earthMasses` — used to infer buildable slot count
- `atmosphere` / `atmosphereType` — presence and type of atmosphere
- `rings` — array, presence means ringed body
- `volcanism` — feeds economy classification
- `reserveLevel` — pristine/major/common/low/depleted
- `orbitalPeriod` / `semiMajorAxis` — used for proximity clustering
- `parents` — used to determine which star a body orbits

---

### 1.3 Body Filter Pipeline

Apply these filters in order before any body enters the scoring or display pipeline. Bodies that fail any filter are silently excluded — no penalty, no display.

1. `isLandable === true`
2. `subtype` is NOT icy (exclude: "Icy body", "Rocky ice world")
3. `earthMasses < 2.5` (hard exclusion — bodies at or above 2.5 EM are excluded silently. No soft warning zone.)

Bodies that pass all three filters are **qualifying landable bodies** and enter the display and scoring pipeline.

---

### 1.4 Star Bucket Grouping

Group qualifying bodies by which star they orbit (using the `parents` field from Spansh).

- Each star gets its own bucket
- Buckets are separated by ` | ` in the display string
- Label each bucket with the star name and a type emoji:

| Star type | Emoji |
|-----------|-------|
| Main sequence (A, B, F, G, K, M) | ★ |
| Neutron star | 💫★ |
| Black hole | ⚫★ |
| White dwarf | 🤍★ |
| Brown dwarf | 🟤 |
| Blue-white supergiant | 🔵★ |

Example:
```
🔵★A: 🌫️🪨(1.2k) 🪨(3.8k) | 💫★B: 💍🌫️🪨(890ls) | 🟤ABCD1: 🪨(4.9k) 🪨(4.9k) 🪨(4.9k)
```

**Distance decay applies differently per bucket:**
- Bodies orbiting the **primary star** → distance decay applied to their score (see scoring)
- Bodies orbiting a **secondary star** → NO distance decay. The fleet carrier can jump directly to a secondary star bypassing supercruise. Score these bodies at full value regardless of their distance from the primary.

If a star bucket has no qualifying bodies, omit it from the display entirely.

---

### 1.5 Body Symbol String

Each qualifying body is represented as a symbol string in format:

```
[atmosphere][rings]🪨(distance)[economy]
```

**Prefixes (left to right):**
- `🌫️` — has atmosphere (any atmosphere type)
- `💍` — has rings on the body itself (NOT the parent body's rings — check the body's own `rings` array)

**Base symbol:**
- `🪨` — always shown for every qualifying landable body

**Distance:**
- Shown in shorthand: `890ls`, `1.2k`, `4.9k` etc.
- Use `ls` for under 1,000, `k` for thousands rounded to 1 decimal

**Economy suffix (only shown when NOT Refinery):**
- `🏖️` — Tourism
- `🌿` — Agriculture  
- `💻` — High Tech
- `🪖` — Military
- `🏭` — Industrial
- `⛏️` — Extraction
- No suffix = Refinery (assumed default, not displayed)

**Full example bodies:**
- `🪨(4.9k)` — plain rocky, Refinery, nothing special
- `🌫️🪨(1.2k)` — atmospheric rocky, Refinery
- `💍🌫️🪨(890ls)` — ringed, atmospheric, Refinery — jackpot body
- `🌫️🪨(2.1k)🌿` — atmospheric, Agriculture economy
- `⛏️🪨(967ls)` — HMC, Extraction economy, no atmosphere

**Ringed landable special callout:**
Ringed landable bodies are extremely rare. In addition to the 💍 prefix in the body string, add a prominent callout above the system entry:
> ⚠️ Ringed landable body detected

---

### 1.6 Economy Classification Rules

Apply these rules from Frontier's official documentation to classify each qualifying body's economy type. Rules may stack — if multiple apply, show the most interesting non-Refinery economy as the suffix (or implement stacking display if feasible).

**Base classification by body subtype:**
| Body type | Economy |
|-----------|---------|
| Rocky body | Refinery |
| High Metal Content | Extraction |
| Rocky ice | Industrial + Refinery |
| Icy body | Industrial | 
| Has rings (any body) | Extraction (additive) |
| Has organics | Agriculture + Terraforming |
| Has geologicals | Extraction + Industrial |

**Star type overrides (apply to installations on/orbiting that star type):**
| Star type | Economy override |
|-----------|----------------|
| Black hole, Neutron star, White dwarf | High Tech + Tourism |
| Brown dwarf, other star types | Military |
| Earth-like world | Agriculture + High Tech + Military + Tourism |
| Water world | Agriculture + Tourism |
| Ammonia world | High Tech + Tourism |
| Gas giant | High Tech + Industrial |

**Economy boosts (do not change classification, feed into scoring):**
- Extraction boosted by: major/pristine resources, volcanism
- Agriculture boosted by: orbiting ELW, terraformable body, organics present
- Agriculture decreased by: icy body, tidally locked
- High Tech boosted by: orbiting ammonia world, ELW, geologicals, organics
- Industrial/Refinery boosted by: major/pristine resources
- Tourism boosted by: black hole, neutron star, white dwarf, ammonia world, ELW, water world, geologicals, organics

**Display priority for suffix:** If a body qualifies for multiple economies, show the most strategically valuable non-Refinery one. Suggested priority: Tourism > High Tech > Agriculture > Industrial > Extraction > Military > Refinery (hidden).

---

### 1.7 Proximity Clustering

Detect qualifying bodies within 100ls of each other using `distanceToArrival` values within the same star bucket.

- If a qualifying body has at least one other qualifying body within 100ls → prefix with 💫
- This applies within the same star bucket only
- Feed into scoring as a bonus (see below)
- Visually implies bodies may be visible from each other's surface — a key aesthetic preference for the commander

---

### 1.8 Scoring Model

Score each candidate system out of **200**. Apply the following components:

#### Star Type (up to 60pts, stacks freely up to cap)
| Star type present | Points |
|-------------------|--------|
| Black hole | 20pts |
| Neutron star | 20pts |
| O-type star | 18pts |
| Wolf-Rayet star | 15pts ⚠️ flag as hazardous approach |
| White dwarf | 12pts |
| B-type star | 8pts |
| Carbon star | 6pts |
| A-type star | 4pts |
| F, G, K, M, Brown dwarf | 0pts |

Multiple exotic stars stack freely up to the 60pt cap. For example, a neutron star + white dwarf = 32pts.

Scores above 100 indicate exceptional systems.

#### Atmospheric Bodies (diminishing returns, no cap on count)
| Body count | Points per body |
|------------|----------------|
| 1st atmospheric body | 15pts |
| 2nd atmospheric body | 12pts |
| 3rd atmospheric body | 9pts |
| 4th+ atmospheric bodies | 5pts each |

Apply **distance decay multiplier** to each body's points (primary star bodies only):
| Distance from star | Multiplier |
|-------------------|-----------|
| Under 4,000ls | 100% |
| 4,000–10,000ls | 70% |
| 10,000–20,000ls | 40% |
| Over 20,000ls | 15% |

Bodies around secondary stars → always 100% multiplier regardless of distance from primary.

#### Rings (cap 30pts)
- Any qualifying landable body with rings on **the body itself** (not its parent) → 15pts flat
- Cap at 30pts total
- Ringed landables are extremely rare — treat as jackpot

#### Proximity Clusters (cap 20pts)
- Each qualifying body with a neighbour within 100ls → 3pts
- Cap at 20pts total
- Proximity is calculated within the same star bucket only
- Feeds scoring silently — NOT shown in the body symbol string

#### Economy Diversity (cap 15pts)
- Each unique non-Refinery economy present across all qualifying bodies → 5pts
- Cap at 3 unique economies (15pts max)

#### Body Count (cap 15pts)
- Each qualifying body (post-filter) → 2pts
- Cap at 5 bodies (10pts counted, 15pt cap exists for future tuning)

#### Total
Sum all components. Display score prominently per system entry.

---

### 1.9 Score Breakdown Display

Per system, show something like:
```
System score: 87
★ Neutron star: +20
🌫️ 2 atmospheric bodies: +25
💍 Ringed landable: +15
💫 Proximity cluster: +9
Economy diversity (Extraction, Tourism): +10
3 qualifying bodies: +6
Distance decay applied to 2 bodies
```

---

## Feature 2: Construction Timeline Visualisation

Add a timeline view to the existing construction/colony tracking section of the app.

### What to build:
- A visual timeline per installation showing delivery/construction events over time
- Events sourced from journal timestamps — every construction-related journal event has a timestamp
- Show gaps in delivery activity (periods of no deliveries)
- Show construction milestones (project started, % thresholds reached, completed)
- Makes it easy to see momentum, stalls, and which sessions were most productive

### Journal events to use:
- `ColonisationContribution` — with timestamp, materials delivered, quantities
- `ColonisationConstructionDepot` — depot status updates with timestamps
- `ColonisationSystemClaim` — project start timestamp
- Any completion events

### Display:
- X axis = time
- Y axis = cumulative progress or materials delivered
- Mark session boundaries where possible
- Simple bar or line chart per installation

---

## Feature 3: Journal Parser Gap Analysis

The existing journal parser is likely missing some colonisation-related events. As part of ongoing development, audit the parser against this full list of known relevant events and ensure all are handled:

**Colonisation events:**
- `ColonisationSystemClaim`
- `ColonisationBeaconPlaced`
- `ColonisationConstructionDepot`
- `ColonisationContribution`
- `ColonisationFactionContribution`

**Cargo/inventory:**
- `CargoTransfer`
- `Cargo` (snapshot)
- `MarketBuy` / `MarketSell`
- `MiningRefined`
- `EjectCargo`

**Fleet Carrier:**
- `CarrierJump`
- `CarrierStats`
- `CarrierDepositFuel`

**Exploration (for future scouting feature):**
- `FSSDiscoveryScan`
- `Scan` (detailed body scan)
- `SAAScanComplete` (DSS mapping)

For each event, verify: is it being captured? Are all relevant fields being extracted? Is completion detection working correctly?

Known issues to address:
- Completed installation projects being missed
- Some colony systems not being detected
- Installation name changes not reflected (in-game renames don't appear in logs — manual rename UI already exists, ensure it's robust)

---

## Commander Preferences (for scoring calibration)

These are the commander's stated aesthetic and practical preferences. Use these to validate that the scoring model produces sensible rankings:

**Strongly preferred:**
- Landable body with atmosphere
- Ringed landable (extremely rare, jackpot)
- Multiple landable atmosphere bodies in same system
- Black hole or neutron star in system
- Bodies close together / visible from each other's surface (<100ls)
- Moderately close to primary star (under 4,000ls sweet spot)

**Liked:**
- White dwarf
- Blue-white supergiant
- Scenic star types generally

**Neutral / not interesting:**
- Standard main sequence only
- Brown dwarf only

**Disliked:**
- Ice worlds (excluded silently from display and scoring)
- Bodies very far from any star (long supercruise)

**Practical workflow:**
- Commander typically runs 1-2 active builds at a time
- Fleet carrier parked near a body, loaded with materials, then trucked to build site
- FC can jump directly to secondary stars — distance from primary is irrelevant for secondary star body clusters
- Prefers landable bodies under 1.5 Earth masses (more buildable slots assumed)
- Bodies beyond ~20,000ls from primary star are low interest unless around a secondary star

---

## Notes for Implementation

- Spansh data quality for HIP 47126 area is good — well trafficked system
- Commander not registered in EDSM — do not rely on EDSM for commander attribution
- The 2.5 EM buildable threshold is inferred, not confirmed by Frontier — flag as estimated in UI
- Ringed landables are genuinely rare — the special callout is warranted, not noise
- Economy classification rules are from official Frontier documentation — implement verbatim
- Secondary star distance handling is critical to get right — a great body cluster at 200,000ls around a neutron star secondary should score highly, not be penalised
- **Rings check**: use the body's OWN `rings` array, not the parent body's rings. A moon of a ringed gas giant is NOT itself ringed unless it has its own ring data.
- **Proximity scoring**: calculated and fed into score silently — no 💫 emoji shown in the body string
- **Atmosphere filter**: there is NO atmosphere requirement for a body to qualify. Atmosphere only affects the 🌫️ display prefix and the atmospheric body scoring bonus. Plain rocky bodies with no atmosphere are valid qualifying bodies.
- **HMC bodies**: classified as Extraction economy, shown with ⛏️ suffix

### Calibration Reference (8 systems scored)

These systems were manually scored to validate the model. Implementation output should match these approximately:

| System | Stars | Atmos | Rings | Prox | Econ | Count | **Total** |
|--------|-------|-------|-------|------|------|-------|-----------|
| HIP 47126 | 52 | 0 | 0 | 10 | 10 | 15 | **87** |
| Antliae DL-Y d86 | 0 | 51 | 0 | 10 | 0 | 15 | **76** |
| HIP 52629 | 0 | 36 | 0 | 10 | 5 | 15 | **66** |
| Antliae IM-V b2-2 | 0 | 36 | 0 | 3 | 10 | 10 | **59** |
| HIP 51938 | 0 | 36 | 0 | 10 | 0 | 6 | **52** |
| HIP 54285 | 0 | 0 | 0 | 10 | 0 | 15 | **25** |
| Antliae Sector GW-W c1-17 | 0 | 0 | 0 | 6 | 5 | 8 | **19** |
| Antliae KM-V b2-4 | 0 | 0 | 0 | 0 | 0 | 0 | **0** |

**Sample display strings:**
- HIP 47126: `🔵★A: — | 💫★B: — | 🟤ABCD1: 🪨(4.9k) 🪨(4.9k) 🪨(4.9k) 🪨(4.9k) 🪨(4.9k) 🪨(4.9k) 🪨(4.9k)`
- HIP 52629: `G★A: 🪨(812ls) 🪨(811ls) 🪨(1.2k) 🪨(1.9k) 🪨(1.9k) 🪨(1.9k) 🪨(2.0k) 🌫️🪨(2.0k) 🪨(2.5k) 🌫️🪨(2.5k) 🌫️🪨(2.5k) 🪨(2.5k) 🪨(2.5k) 🪨(3.7k) 🪨(3.7k) 🪨(3.7k)`
- Antliae DL-Y d86: `F★: 🪨(2.3k) 🌫️🪨(2.3k) 🌫️🪨(2.3k) 🪨(2.3k) 🪨(2.3k) 🌫️🪨(2.9k) 🌫️🪨(2.9k) 🌫️🪨(2.9k) 🌫️🪨(2.9k) 🌫️🪨(2.9k)`
- Antliae IM-V b2-2: `M★A: ⛏️🪨(6ls) ⛏️🪨(6ls) 🌫️🪨(445ls) | M★BC: 🌫️🪨(4.7k) 🌫️🪨(4.9k)`
- HIP 51938: `G★: 🌫️🪨(2.5k) 🌫️🪨(2.5k) 🌫️🪨(2.5k)`
- Antliae Sector GW-W c1-17: `K★A: ⛏️🪨(21ls) ⛏️🪨(967ls) ⛏️🪨(966ls) | M★B: ⛏️🪨(31.9k)`
- Antliae KM-V b2-4: `M★: —`
