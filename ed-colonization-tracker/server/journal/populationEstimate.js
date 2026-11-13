/**
 * Population estimate per facility (1.60.20; the measured-additions model since 1.60.27).
 *
 * The game never publishes a head-count per station; it publishes one figure per system. The
 * commander's own journals (5,312 readings, 48 observed completions, analysed 2026-10-03) showed
 * what each kind of facility ADDS to a system when it opens — the gain in the two weeks after the
 * completion above the growth the system already had. Those measured additions are the weights:
 * their sum is the system's baseline, and the system's current population is shared among the
 * facilities in proportion to each one's part of that baseline (the commander's rule, 2026-10-05).
 * A remembered floor keeps any figure from going down (populationFloors.js, 1.60.26).
 *
 * One implementation for the server-side dock banner and the browser (src/lib shim). Pure: no
 * state, no I/O. The caller assembles the facility list.
 */

/**
 * What each kind of facility adds to a system's population when it opens — the weights of the split.
 * value = the figure used; low/high = the measurements' spread; days = the window measured; n = how
 * many completions were measured; basis = the events behind it. Journal-measured unless the basis
 * says otherwise. Change a value here and every estimate in the app follows.
 */
export const POPULATION_ADDITIONS = Object.freeze({
  planetary_port: { value: 58_400_000, low: 58_000_000, high: 58_800_000, days: 12, n: 2,
    basis: 'Chitty City (HIP 52629, 2025-09-11): +58.8M by day 12 from 1.24M. Sky Cairn (AX-J d9-52, 2026-07-08): +58.0M by day 12 from 16.95M.' },
  dodec: { value: 26_500_000, low: 25_000_000, high: 28_000_000, days: 14, n: 1,
    basis: 'Volpe Radiante Horizon (HIP 47126, 2026-05-12): +25M to +28M in 14 days above the 0.9M/day the system already had. Polyakov Gateway (2025-12-07) showed +39M but opened beside four T1 facilities.' },
  orbis: { value: 16_600_000, low: null, high: null, days: null, n: 0,
    basis: 'Unmeasured. The Dodec figure scaled by Raven Colonial pop 5 against 8.' },
  ocellus: { value: 16_600_000, low: null, high: null, days: null, n: 0,
    basis: 'Unmeasured. The Dodec figure scaled by Raven Colonial pop 5 against 8.' },
  surface_outpost: { value: 11_000_000, low: 9_100_000, high: 12_900_000, days: 14, n: 2,
    basis: 'Surface outposts of any economy — civilian, industrial, scientific — carry the same figure (the commander\'s rule). Measured at the civilian ones: Deshpande Plant (AX-J d9-52, 2026-04-28) +9.1M in 14 days, +10.7M by day 16, from 45k; Kewell Range (2026-09-16) +12.9M in 14 days at 157M, with Skov Prospecting opening the same day.' },
  outpost_mil: { value: 55_000, low: 45_543, high: 59_151, days: 14, n: 3,
    basis: 'Military outposts opening a colony, two weeks in: Lonchakov Depot (AX-J d9-62) about 58K, Antonov Legacy (AX-J d9-34) 59,151 at day 10, Chiang Bastion (AX-J d9-52) 45,543 at day 7 before Deshpande opened. They read 10,007 and 10,068 the day they opened, twice a plain outpost\'s first tick; by two weeks the difference is inside the spread. Scientific outposts are given the same figure.' },
  coriolis: { value: 440_000, low: null, high: null, days: 14, n: 1,
    basis: 'HIP 52629 under its first name, Sassoon Vision: 259,189 on 2025-05-16, 446,262 on 2025-05-24 at 23,365 a day, then 5,400 to 7,600 a day all summer — the end of the opening burst, the shape Deshpande Plant and Sky Cairn showed. The opening itself fell in the 29 March to 16 May 2025 journal gap, about two weeks before the 24 May reading. Asteroid bases are given the same figure.' },
  unit: { value: 55_000, low: 37_871, high: 59_151, days: 14, n: 4,
    basis: 'Commercial, civilian, industrial and extraction outposts opening a colony, two weeks in: Siegel Vista (UW-Q b35-1) 48,482 at day 10, Chebyshev Horizons (OC-V b2-1) 37,871 at day 7, Oefelein Beacon (YI-V c17-34) about 83K, with Lonchakov Depot and Antonov Legacy at 58K to 59K. They read 4,835 to 5,286 the day they opened. Beside other facilities their opening is invisible (Thagard\'s Progress, Rankin Legacy). Settlements are given the same figure by analogy — none has ever opened a colony, and beside others their opening measured nothing.' },
  unknown: { value: 55_000, low: null, high: null, days: null, n: 0,
    basis: 'Type not on record — treated as a small facility.' },
  none: { value: 0, low: 0, high: 0, days: 14, n: 8,
    basis: 'Installations (security, relay, space farm, mining, government, comms, medical), hubs (Kamov Hub measured within 0.2M of nothing), construction depots, carriers and megaships: nothing measurable at eight completions.' },
});

/** The addition entry for any station-type string (journal, app id, FSS or Spansh vocabulary). */
export function populationAdditionFor(stationType) {
  return POPULATION_ADDITIONS[populationClass(stationType).cls];
}

/** Lower-case, strip spaces/underscores/hyphens/apostrophes so every vocabulary compares alike. */
function norm(t) {
  return String(t || '').toLowerCase().replace(/[\s_\-'’.]/g, '');
}

/**
 * Classify a station type from any of the four vocabularies the app meets: the journal's
 * StationType ("CraterPort"), the app's installation ids ("large_planetary_port"), the FSS
 * SignalType ("StationONeilOrbis") and Spansh's strings ("Planetary Port").
 * Returns { cls, units } — units is the share weight in the small-facility pool (0 for ports and
 * for anything that carries no population).
 */
export function populationClass(stationType) {
  const t = norm(stationType);
  if (!t || t === 'unknown') return { cls: 'unknown', units: 1 };
  if (t.includes('carrier') || t.includes('squadron') || t.includes('drakeclass')) return { cls: 'none', units: 0 };
  if (t.includes('megaship')) return { cls: 'none', units: 0 };
  if (t.includes('construction') || t.includes('colonisationship') || t.includes('colonizationship')) return { cls: 'none', units: 0 };
  if (t.includes('installation') || t.includes('spacefarm') || t.includes('piratebase') || t.includes('satellite')) return { cls: 'none', units: 0 };
  if (t.includes('planetaryport') || t.includes('craterport')) return { cls: 'planetary_port', units: 0 };
  if (t.includes('dodec')) return { cls: 'dodec', units: 0 };
  if (t.includes('orbis') || t.includes('oneil')) return { cls: 'orbis', units: 0 };
  if (t.includes('ocellus') || t.includes('bernal')) return { cls: 'ocellus', units: 0 };
  if (t.includes('coriolis') || t.includes('asteroid')) return { cls: 'coriolis', units: 1 };
  if (t === 'militaryoutpost' || t === 'scientificoutpost') return { cls: 'outpost_mil', units: 1 };
  // Every surface outpost — civilian, industrial, scientific; journal CraterOutpost / PlanetaryOutpost, Spansh "Planetary Outpost".
  if (t.includes('surfaceoutpost') || t.includes('crateroutpost') || t.includes('planetaryoutpost')) return { cls: 'surface_outpost', units: 1 };
  // Hubs carry no population (the commander's rule; Kamov Hub's completion measured within 0.2M of nothing).
  if (t.includes('hub')) return { cls: 'none', units: 0 };
  // "SurfaceStation" is what the journal writes for a colony's small surface primary (Ieyasu's
  // Progress: 230k people after 168 days) — a unit, never a port.
  if (t.includes('outpost') || t.includes('settlement') || t.includes('hub') || t.includes('surfacestation')) return { cls: 'unit', units: 1 };
  return { cls: 'unknown', units: 1 };
}

/**
 * How far a facility is into its opening burst, 0..1 (1.60.29). Its measured addition arrives over
 * the class's measured window — `days` in POPULATION_ADDITIONS: 12 for planetary ports (Sky Cairn
 * opened 8 July 2026, read +98K two days later and then climbed 5–6.5M a day to +58M by day 12),
 * 14 for everything else — so a port that opened this morning carries none of its 58M yet and all
 * of it from day 12 on. No opening date, an unparseable one, or a class without a measured window
 * counts as fully grown.
 * @param cls      the population class
 * @param openedAt ISO opening date — the project's completion, or the first dock at the finished station
 * @param now      the moment to measure against (ms)
 */
export function rampFraction(cls, openedAt, now = Date.now()) {
  const entry = POPULATION_ADDITIONS[cls] || POPULATION_ADDITIONS.unknown;
  if (!openedAt || !(entry.days > 0)) return 1;
  const t = Date.parse(openedAt);
  if (Number.isNaN(t)) return 1;
  const age = (now - t) / 86400000;
  if (age >= entry.days) return 1;
  return Math.max(0, age / entry.days);
}

/**
 * Split a system's population across its facilities in proportion to their measured additions.
 * @param systemPopulation the system's current total (journal reading, manual entry or Spansh, whichever is newest)
 * @param facilities [{ key, stationType, openedAt? }] — one entry per facility; `key` identifies it in the result;
 *   `openedAt` (ISO) ramps a newly opened facility's weight in over its class's measured window (1.60.29)
 * @param now the moment ages are measured against (ms; default Date.now())
 * @returns { population, counted, baseline, byKey }
 *   baseline = the sum of the facilities' additions; byKey[key] = { estimate, share, cls, addition, basis } —
 *   estimate/share are null when the facility carries no population or the system total is unknown.
 */
export function estimateFacilityPopulations(systemPopulation, facilities, now = Date.now()) {
  const P = Number(systemPopulation) > 0 ? Math.round(Number(systemPopulation)) : 0;
  const rows = (facilities || []).map((f) => {
    const { cls, units } = populationClass(f.stationType);
    const addition = (POPULATION_ADDITIONS[cls] || POPULATION_ADDITIONS.unknown).value;
    const openedAt = f.openedAt || null;
    // a facility still inside its opening window carries only the part of its addition it has grown into (1.60.29)
    const ramp = cls === 'none' ? 1 : rampFraction(cls, openedAt, now);
    return { key: f.key, cls, units, addition, openedAt, ramp, weight: Math.round(addition * ramp) };
  });
  const counted = rows.filter((r) => r.cls !== 'none');
  const baseline = counted.reduce((a, r) => a + r.weight, 0);
  const byKey = {};
  for (const r of rows) {
    let estimate = null;
    let basis = 'carries no population';
    if (r.cls !== 'none') {
      estimate = P > 0 && baseline > 0 ? Math.round(P * r.weight / baseline) : null;
      basis = `adds ${formatEstimatedPopulation(r.addition)} of the ${formatEstimatedPopulation(baseline)} baseline`
        + (r.cls === 'unknown' ? ', type unknown' : '')
        + (POPULATION_ADDITIONS[r.cls] && POPULATION_ADDITIONS[r.cls].n === 0 && r.cls !== 'unknown' ? ', unmeasured' : '')
        + (r.ramp < 1 ? `, opened ${agoLabel(r.openedAt, now) || 'recently'} (${Math.round(r.ramp * 100)}% grown)` : '');
    }
    byKey[r.key] = { estimate, share: estimate != null && P > 0 ? estimate / P : null, cls: r.cls, units: r.units, addition: r.addition, weight: r.weight, ramp: r.ramp, openedAt: r.openedAt, basis };
  }
  return { population: P, counted: counted.length, baseline, totalWeight: baseline, byKey };
}

/** 18.3B · 173M · 1.9M · 457K · 950 — one decimal only where the whole figure would mislead. */
export function formatEstimatedPopulation(n) {
  if (n == null || !(n >= 0)) return '—';
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 10e6) return `${Math.round(n / 1e6)}M`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return String(Math.round(n));
}

/**
 * The dock-banner line — the location's figure and nothing else, phrased as a place rather than a
 * statistic: "👥 Population ~3.8M (est.)". The share, the system total and the facility count
 * live in the system page's tooltip (1.60.22). A facility still inside its opening window says so —
 * "👥 Population ~0 (est.) · opened earlier today" (1.60.29).
 * @param now the moment ages are measured against (ms)
 */
export function describeFacilityEstimate(est, now = Date.now()) {
  if (!est || est.estimate == null) return null;
  const opened = est.ramp != null && est.ramp < 1 && est.openedAt ? agoLabel(est.openedAt, now) : null;
  return `\u{1F465} Population ~${formatEstimatedPopulation(est.estimate)} (est.)${opened ? ` \u00B7 opened ${opened}` : ''}`;
}

/**
 * The system population to split: the journal's latest reading, unless the commander's manual
 * override is NEWER than that reading. The browser store refreshes an override when a newer reading
 * lands, but the server's copy can lag — a 14 September override of 154.7M sat beside a 3 October
 * reading of 196M and the 1.60.20 overlay split the stale figure. Undated values lose to dated ones.
 * @param known    knownSystems entry: { population, lastSeen }
 * @param override populationOverrides entry: { population, updatedAt }
 */
export function effectiveSystemPopulation(known, override) {
  const journal = known && typeof known.population === 'number' && known.population > 0 ? known.population : 0;
  const manual = override && typeof override.population === 'number' && override.population > 0 ? override.population : 0;
  if (!manual) return journal;
  if (!journal) return manual;
  const tj = known.lastSeen ? Date.parse(known.lastSeen) : NaN;
  const to = override.updatedAt ? Date.parse(override.updatedAt) : NaN;
  if (Number.isNaN(to)) return journal;
  if (Number.isNaN(tj)) return manual;
  return to > tj ? manual : journal;
}

/** "3 days ago", "yesterday", "earlier today", "2 weeks ago", "5 months ago", "over a year ago". */
export function agoLabel(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const days = Math.floor(Math.max(0, now - t) / 86400000);
  if (days === 0) return 'earlier today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return 'over a year ago';
}

/**
 * The dock banner's trend line — how the system's population has moved since the commander last
 * docked at this station: "📈 The system has grown by 2.3M since your last visit (3 days ago)".
 * The station's own figure is the subject of slot 9; the system is the subject here because a small
 * facility's estimate never moves while the system's total does. Null when there is no previous
 * figure, no current reading, or no movement.
 * @param previous { population, at } stored on the station dossier at the last Docked
 * @param current  the system's population now
 */
export function describePopulationTrend(previous, current, now = Date.now()) {
  if (!previous || !(previous.population > 0) || !previous.at) return null;
  if (!(current > 0) || current === previous.population) return null;
  const ago = agoLabel(previous.at, now);
  if (!ago) return null;
  const delta = current - previous.population;
  const verb = delta > 0 ? '\u{1F4C8} The system has grown by' : '\u{1F4C9} The system has shrunk by';
  return `${verb} ${formatEstimatedPopulation(Math.abs(delta))} since your last visit (${ago})`;
}

/** State key for a facility's floor: "<system lower>|<facility key>". */
export function floorKey(systemName, facilityKey) {
  return `${String(systemName || '').toLowerCase()}|${facilityKey}`;
}

/**
 * "A facility's population never goes down" (1.60.26): apply the remembered floors to a split, so that the
 * estimates still add up to the system's reading (1.60.39).
 *
 * A facility whose share of what is left falls below its floor is held at the floor; the facilities not held share
 * what is left of the reading by weight; repeat until nothing new is held. `held` marks the ones a floor carries
 * (with `split` keeping the plain share of the whole reading for the tooltip); `raised` lists the floors to write
 * because an estimate climbed past them — floors only ever rise. Until 1.60.39 each estimate was max(split, floor)
 * over a split of the WHOLE reading, so a port opening beside held facilities took a full share on top of them: the
 * home system's estimates came to 328.3M against a 303.1M reading, shares adding to 108%. If the floors alone exceed
 * the reading (the population fell), they are scaled down to fit and nothing is raised. Mutates `result`.
 */
export function applyPopulationFloors(result, systemName, floors, now) {
  const at = now || new Date().toISOString();
  const raised = {};
  const P = result && result.population > 0 ? result.population : 0;
  const entries = Object.entries((result && result.byKey) || {}).filter(([, est]) => est && est.estimate != null);
  if (!entries.length) return { result, raised };
  const floorOf = (key) => {
    const f = floors && floors[floorKey(systemName, key)];
    return f && typeof f.population === 'number' && f.population > 0 ? f : null;
  };
  const held = new Set();
  let shares = new Map();
  for (let pass = 0; pass <= entries.length; pass++) {
    const heldSum = entries.reduce((a, [k]) => a + (held.has(k) ? floorOf(k).population : 0), 0);
    const rest = entries.filter(([k]) => !held.has(k));
    const W = rest.reduce((a, [, est]) => a + (est.weight || 0), 0);
    const R = P - heldSum;
    shares = new Map(rest.map(([k, est]) => [k, R > 0 && W > 0 ? Math.round(R * (est.weight || 0) / W) : 0]));
    const newly = rest.filter(([k]) => { const f = floorOf(k); return f && f.population > shares.get(k); });
    if (!newly.length) break;
    for (const [k] of newly) held.add(k);
  }
  const heldSum = entries.reduce((a, [k]) => a + (held.has(k) ? floorOf(k).population : 0), 0);
  const over = heldSum > P;
  for (const [k, est] of entries) {
    const f = floorOf(k);
    if (held.has(k)) {
      const v = over && heldSum > 0 ? Math.round(f.population * P / heldSum) : f.population;
      est.split = est.estimate;
      est.estimate = v;
      est.share = P > 0 ? v / P : null;
      est.held = { population: f.population, at: f.at || null };
    } else {
      const v = over ? 0 : (shares.has(k) ? shares.get(k) : est.estimate);
      est.estimate = v;
      est.share = P > 0 ? v / P : null;
      // a facility still at zero is not a floor; floors that do not fit the reading are never raised
      if (!over && v > 0 && (!f || v > f.population)) raised[floorKey(systemName, k)] = { population: v, at };
    }
  }
  return { result, raised };
}
