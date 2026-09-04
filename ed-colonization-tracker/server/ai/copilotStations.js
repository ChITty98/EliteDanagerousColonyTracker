// server/ai/copilotStations.js
//
// Station ARCHITECTURE as a personality axis — the co-pilot reacting to the kind of place you are
// flying into, independent of its economy, its market, or whether you are hauling anything.
//
// Fires on DockingGranted rather than Docked, for three reasons:
//   - the event carries StationType directly, so it works the first time you ever visit somewhere
//   - it lands ~25-40s BEFORE you dock (measured), while the station is filling the canopy, which
//     is when a remark about its shape actually means something
//   - the Docked tick is crowded (dock-flavor, affinity-economy, affinity-service, haul actions all
//     compete there); DockingGranted is nearly empty, so this does not have to win an argument
// It also satisfies the spec's dockability rule for free: a Relay or Satellite has no pads, never
// grants docking, and so can never be described as somewhere you docked.
//
// LITERAL LINES, not live intents. Every other affinity beat pays for generation, which means it is
// silent whenever the `claude` CLI is unavailable. Architecture flavour is fixed knowledge — a
// Coriolis is the same shape every time — so it is written out and broadcast free.
//
// THE TWO VOCABULARIES: the journal writes `Coriolis` / `Orbis` / `Ocellus`, while stations the
// commander BUILT carry Raven ids like `dodec_starport` / `asteroid_starport` / `civilian_outpost`.
// Both must normalise to the same key or your own colonies are the ones that get ignored — the same
// split that made self-built stations invisible to the Domain highlights.

/** Journal StationType and Raven build ids → one canonical architecture key. */
const TYPE_ALIASES = {
  // --- orbital, journal vocabulary ---
  coriolis: 'coriolis',
  orbis: 'orbis',
  ocellus: 'ocellus',
  bernal: 'ocellus',            // the Ocellus predecessor; same sphere to the eye
  asteroidbase: 'asteroid',
  dodec: 'dodec',               // journal spelling; the Raven build id is dodec_starport below
  megaship: 'megaship',
  outpost: 'outpost',
  // --- planetary, journal vocabulary ---
  craterport: 'planetary-port',
  crateroutpost: 'surface-outpost',
  surfacestation: 'planetary-port',
  onfootsettlement: 'settlement',
  // --- construction ---
  spaceconstructiondepot: 'construction',
  planetaryconstructiondepot: 'construction',
  // --- Raven build ids (stations the commander built) ---
  dodec_starport: 'dodec',
  asteroid_starport: 'asteroid',
  large_planetary_port: 'planetary-port',
  civilian_surface_outpost: 'surface-outpost',
  civilian_outpost: 'outpost',
  commercial_outpost: 'outpost',
  industrial_outpost: 'outpost',
  military_outpost: 'outpost',
  scientific_outpost: 'outpost',
  agriculture_settlement_large: 'settlement',
  industrial_settlement_large: 'settlement',
  industrial_settlement_small: 'settlement',
};

/**
 * Three genuinely different readings of the same building, not one fact reworded:
 *   Wren  — what it is like to be a person in there (comfort, food, the walk to the bar)
 *   Tycho — the engineering, teacher mode: why it is shaped that way
 *   K2    — defensibility: approaches, chokepoints, how it would hold
 */
const STATION_TYPES = {
  coriolis: {
    label: 'Coriolis',
    wash: [
      "Coriolis. Spinning box, mail slot, everything bolted to the inside of a cube. They don't build them like this any more and I'm a little sad about that.",
      "Old-school Coriolis coming up. Cramped, loud, smells like every other Coriolis in the galaxy. I find that weirdly comforting.",
    ],
    tars: [
      "Coriolis-class. Rotating cube, gravity from spin, the whole interior surface usable. Centuries old and still the most efficient thing anyone has bolted together.",
      "A Coriolis. Same design since the twenty-ninth century, because it works — the rotation does all the labour and nothing needs power to hold you down.",
    ],
    k2: [
      "Coriolis. One entry slot, one axis of approach. A single chokepoint is the most defensible thing humans have ever accidentally built.",
      "Coriolis station. Everything must come through the slot. I approve of the architecture. I rarely say that.",
    ],
  },
  orbis: {
    label: 'Orbis',
    wash: [
      "Orbis. Big one. Whatever you want in there is a twenty-minute walk from wherever you land, guaranteed.",
      "An Orbis — the grand ones. Feels less like a station and more like a city that got tired of a planet.",
    ],
    tars: [
      "Orbis-class. The Coriolis successor: outer ring for habitation, far greater volume, better mass distribution. Newer, and it shows.",
      "Orbis. The ring is the point — a larger radius means gentler rotation for the same gravity, which is why nobody feels sick here.",
    ],
    k2: [
      "Orbis. Larger, which means more to cover and more ways in. Impressive. Less defensible than the Coriolis behind us.",
      "An Orbis station. Extensive, well-lit, and structurally optimistic about being left alone.",
    ],
  },
  ocellus: {
    label: 'Ocellus',
    wash: [
      "Ocellus. It's a sphere. There's no horizon anywhere inside it and I have never once got used to that.",
      "One of the round ones. Everything curves up and away from you. Lovely engineering, mildly upsetting to stand in.",
    ],
    tars: [
      "Ocellus-class. A sphere encloses the most volume for the least hull — the most materially efficient station anyone builds. Elegant, if you like that sort of thing. I do.",
      "Ocellus. Geodesic sphere, minimal surface area, maximum interior. Whoever signed this off understood their geometry.",
    ],
    k2: [
      "Ocellus. Enclosed, few approaches, no exposed flank. Difficult to assault. I like it here.",
      "A sphere. Structurally the hardest shape to breach. Someone was thinking about more than aesthetics.",
    ],
  },
  dodec: {
    label: 'Dodecahedral starport',
    wash: [
      "Twelve-sided starport. Somebody in a design meeting really wanted to show off, and honestly? Fair.",
      "A dodec. Twelve flat faces, because a sphere apparently wasn't enough of a statement.",
    ],
    tars: [
      "Dodecahedral starport — twelve pentagonal faces. Flat panels are far easier to fabricate than curved hull, so it is a sphere you can actually build. Clever compromise.",
      "A dodec. Newer construction pattern. It approximates the Ocellus sphere using panels a yard can actually produce.",
    ],
    k2: [
      "Dodecahedral. Twelve faces, twelve firing arcs, no blind side. Whoever specified this expected trouble.",
      "A dodec starport. Flat faces mount weapons better than curved ones. I doubt that was an accident.",
    ],
  },
  asteroid: {
    label: 'Asteroid base',
    wash: [
      "They hollowed out a rock and called it a station. Every time. Still can't decide if that's brilliant or deeply concerning.",
      "Asteroid base. We are about to park inside a rock. I want that on the record.",
    ],
    tars: [
      "Asteroid base. Kilometres of stone between the interior and hard radiation — the best shielding available, and it was already here. Excellent reuse.",
      "Hollowed asteroid. The rock does the shielding and the structural work at once. Nothing else comes close on cost.",
    ],
    k2: [
      "Asteroid base. Solid rock hull. That is better armour than anything a shipyard could bolt on.",
      "A rock with docking bays. Structurally, the safest place in this system.",
    ],
  },
  megaship: {
    label: 'Megaship',
    wash: [
      "Megaship. It's a station, except it moves, which is the part I try not to think about while docking.",
      "One of the big mobile ones. Docking with something that has its own opinions about where it's going.",
    ],
    tars: [
      "Megaship. Capital infrastructure under its own power — it can relocate to where the demand is. Stations cannot.",
      "A megaship. Mobile logistics: the market comes to the frontier rather than the other way round.",
    ],
    k2: [
      "Megaship. Mobile, therefore hard to plan an attack against. Sound thinking.",
      "It moves. A target that relocates is a target you cannot besiege. Approved.",
    ],
  },
  outpost: {
    label: 'Outpost',
    wash: [
      "Outpost. No bar, no lounge, nowhere to sit that isn't a crate. Let's be quick.",
      "It's an outpost, so temper your expectations — a couple of pads and a vending machine with opinions.",
    ],
    tars: [
      "Outpost. Medium pads only, minimal services, built cheap and fast. It exists to be a foothold, not a home.",
      "An outpost. No rotation, so no gravity — everything inside is bolted down for a reason.",
    ],
    k2: [
      "Outpost. Open frame, no real defences, exposed on every side. I would not want to hold this.",
      "An outpost. Minimal structure, minimal security. We should not linger.",
    ],
  },
  'planetary-port': {
    label: 'Planetary port',
    wash: [
      "Actual ground under us for once. Real gravity, real weather, and the coffee is usually better down here.",
      "Planetary port. I do like landing on something that was already holding itself up.",
    ],
    tars: [
      "Planetary port. Full-size pads and surface industry — no rotation needed, the planet supplies the gravity for free.",
      "Surface port. Everything heavy is cheaper to build down here; the only expensive part is leaving.",
    ],
    k2: [
      "Planetary port. We are in a gravity well with limited escape vectors. Tactically, that is a commitment.",
      "Surface facility. Fixed position, known coordinates, no evasion. Adequate, not ideal.",
    ],
  },
  'surface-outpost': {
    label: 'Surface outpost',
    wash: [
      "Small surface outpost. A shed with landing lights, basically. Charming in a bleak sort of way.",
      "Crater outpost. Someone put this here on purpose, which is the part that gets me.",
    ],
    tars: [
      "Surface outpost. Small pads, thin services, dropped here because something nearby was worth extracting.",
      "A crater outpost — minimal footprint, built around whatever the survey found underneath it.",
    ],
    k2: [
      "Surface outpost. Isolated, thinly staffed, no meaningful security. Convenient for us, and for anyone else.",
      "A crater outpost. Nobody is coming to help anyone here quickly.",
    ],
  },
  settlement: {
    label: 'Settlement',
    wash: [
      "Settlement. People actually live here — kids, laundry, someone's garden under a dome. I like these.",
      "A proper settlement. Feels less like infrastructure and more like somewhere with a name people chose.",
    ],
    tars: [
      "Planetary settlement. Purpose-built around one industry, with the habitation grown around it afterwards.",
      "A settlement. Small, specialised, and entirely dependent on whatever it was founded to do.",
    ],
    k2: [
      "Settlement. Civilians, thin perimeter, minimal response capability. Note the exits.",
      "A settlement. Soft target. That is an observation, not a suggestion.",
    ],
  },
  construction: {
    label: 'Construction site',
    wash: [
      "Construction site. It's not a station yet — it's a promise with scaffolding. Mind the gap on the way in.",
      "Still being built. Half a station and a lot of optimism.",
    ],
    tars: [
      "Construction site. Not yet a station — the docking structure goes up first so it can be supplied while it grows.",
      "A build in progress. Everything here arrived on a ship like ours, which is worth a moment's thought.",
    ],
    k2: [
      "Construction site. Incomplete, undefended, and entirely dependent on deliveries. Vulnerable in every sense.",
      "Unfinished. No defences worth the name. It survives because nobody has bothered it yet.",
    ],
  },
};

/** DockingGranted also fires at every fleet carrier — architecture flavour there would be noise. */
const SKIP_TYPES = new Set(['fleetcarrier']);

// Gated per TYPE, not per station: a Coriolis remark should be occasional across 761 Coriolis
// dockings, not a greeting each time. The arbiter throttles further on top of this.
const TYPE_COOLDOWN_MS = 12 * 60 * 60_000;
const lastSpoken = new Map();

/** Normalise either vocabulary to a canonical architecture key. */
export function normaliseStationType(raw) {
  if (!raw) return null;
  const k = String(raw).trim().toLowerCase().replace(/[\s-]+/g, '_');
  return TYPE_ALIASES[k] || TYPE_ALIASES[k.replace(/_/g, '')] || null;
}

/** Deterministic pick so a given station always draws the same variant — no Math.random in a tick. */
function pickLine(lines, seed) {
  if (!lines || !lines.length) return null;
  let h = 0;
  for (let i = 0; i < String(seed).length; i++) h = (h * 31 + String(seed).charCodeAt(i)) >>> 0;
  return lines[h % lines.length];
}

/**
 * A literal architecture line for the station we have just been cleared to dock at,
 * or null when there is nothing new to say.
 */
export function detectStationTypeBeat(ev, persona) {
  if (!ev || ev.event !== 'DockingGranted' || !persona) return null;

  const rawType = String(ev.StationType || '').toLowerCase();
  if (SKIP_TYPES.has(rawType)) return null;

  const key = normaliseStationType(ev.StationType);
  if (!key) return null;

  const entry = STATION_TYPES[key];
  const lines = entry && entry[persona];
  if (!lines || !lines.length) return null;

  const now = Date.now();
  const last = lastSpoken.get(key);
  if (last && now - last < TYPE_COOLDOWN_MS) return null;
  lastSpoken.set(key, now);

  const line = pickLine(lines, ev.StationName || key);
  if (!line) return null;

  return {
    key: 'station-type',
    priority: 44,          // below the useful dock beats; this is flavour on an otherwise empty tick
    interrupt: false,
    live: false,
    mood: 'calm',
    character: true,
    line,                  // literal — broadcast free via emitLiteral, no CLI required
    inputs: { station: ev.StationName || null, stationType: entry.label },
  };
}

/** Test seam — the cooldown is module state and would otherwise leak between cases. */
export function _resetStationCooldowns() {
  lastSpoken.clear();
}
