/**
 * System scoring logic for the server.
 *
 * Port of src/lib/scoutingScorer.ts — pure logic, no I/O, no DOM.
 * TS types stripped; behavior unchanged. Exports match the browser module
 * so server-side consumers get the same scores and body strings the UI
 * would produce.
 */

// --- Body Filter Pipeline ---

// Bumped whenever the formula changes meaning — rescore tools stamp it into entries
// so v1-formula scores are distinguishable from v2 until re-priced.
export const SCORE_FORMULA_VERSION = 2;

export const ICY_SUBTYPES = new Set(['Icy body', 'Rocky ice world', 'Rocky Ice world']);

/** Check if a body has a real atmosphere (thin counts, but "No atmosphere"/"None"/empty don't) */
export function isColonisableAtmosphere(atmosphereType) {
  if (!atmosphereType) return false;
  const lower = atmosphereType.toLowerCase().trim();
  if (!lower) return false;
  // Filter out non-atmosphere values Spansh may return
  if (lower === 'no atmosphere' || lower === 'none' || lower === 'no' || lower === 'null') return false;
  return true;
}

export function filterQualifyingBodies(bodies) {
  const stars = bodies.filter((b) => b.type === 'Star');
  const mainStarId = stars.find((s) => s.mainStar)?.bodyId ?? stars[0]?.bodyId ?? 0;

  return bodies
    .filter((b) => {
      if (b.type !== 'Planet') return false;
      if (!b.isLandable) return false;
      // Exclude icy bodies UNLESS they have an atmosphere (atmospheric icy worlds are colonisable)
      if (ICY_SUBTYPES.has(b.subType) && !isColonisableAtmosphere(b.atmosphereType)) return false;
      if ((b.earthMasses ?? 999) >= 2.5) return false;
      return true;
    })
    .map((b) => {
      const parentStarId = findParentStarId(b, bodies);
      const isPrimary = isUnderPrimaryStar(b, bodies, mainStarId);
      return {
        body: b,
        parentStarId,
        isPrimaryStar: isPrimary,
        economy: classifyEconomy(b, parentStarId !== null ? bodies.find((s) => s.bodyId === parentStarId) : undefined),
        hasAtmosphere: isColonisableAtmosphere(b.atmosphereType),
        hasRings: Array.isArray(b.rings) && b.rings.length > 0,
        distanceLs: b.distanceToArrival,
      };
    });
}

// Walk the parents array to find the nearest Star ancestor
function findParentStarId(body, allBodies) {
  if (!body.parents) return null;
  for (const p of body.parents) {
    if ('Star' in p) return p.Star;
    // If Null (barycenter), keep walking up
    if ('Planet' in p) {
      const parent = allBodies.find((b) => b.bodyId === p.Planet);
      if (parent) return findParentStarId(parent, allBodies);
    }
  }
  return null;
}

// Check if body ultimately orbits the primary star or its barycenter
function isUnderPrimaryStar(body, allBodies, mainStarId) {
  if (!body.parents) return true; // no parent info → assume primary
  for (const p of body.parents) {
    if ('Star' in p) return p.Star === mainStarId;
    if ('Null' in p && p.Null === 0) return true; // root barycenter → primary
  }
  // Walk deeper: check if any ancestor is the main star
  const parentStarId = findParentStarId(body, allBodies);
  return parentStarId === mainStarId || parentStarId === null;
}

// --- Economy Classification ---

// Collect ALL applicable economies for a body, return highest priority one.
// Also used by diversity scoring which needs the full set.
function collectEconomies(body, parentStar) {
  const econs = new Set();

  // Body subtype base
  const sub = body.subType.toLowerCase();
  if (sub.includes('high metal content')) econs.add('Extraction');
  else if (sub.includes('rocky ice')) { econs.add('Industrial'); econs.add('Refinery'); }
  else econs.add('Refinery');

  // Star type modifiers (additive, not override)
  if (parentStar) {
    const st = parentStar.subType.toLowerCase();
    if (st.includes('neutron') || st.includes('black hole') || st.includes('white dwarf')) {
      econs.add('High Tech'); econs.add('Tourism');
    }
    if (st.includes('brown dwarf')) econs.add('Military');
  }

  // Rings
  if (Array.isArray(body.rings) && body.rings.length > 0) econs.add('Extraction');

  // Signals / volcanism
  const volc = (body.volcanismType ?? '').toLowerCase();
  const hasGeologicals = body.signals?.signals?.['$SAA_SignalType_Geological;'];
  const hasBiologicals = body.signals?.signals?.['$SAA_SignalType_Biological;'];
  if (hasBiologicals) econs.add('Agriculture');
  if (hasGeologicals || (volc && volc !== 'no volcanism')) econs.add('Extraction');

  return [...econs];
}

function classifyEconomy(body, parentStar) {
  const econs = collectEconomies(body, parentStar);
  // Return highest priority non-Refinery, or Refinery if nothing else
  return econs
    .sort((a, b) => (ECONOMY_PRIORITY[b] ?? 0) - (ECONOMY_PRIORITY[a] ?? 0))
    [0] ?? 'Refinery';
}

// Economy display priority
const ECONOMY_PRIORITY = {
  Tourism: 7,
  'High Tech': 6,
  Agriculture: 5,
  Industrial: 4,
  Extraction: 3,
  Military: 2,
  Refinery: 1,
};

const ECONOMY_EMOJI = {
  Tourism: '\u{1F3D6}\u{FE0F}', // 🏖️
  Agriculture: '\u{1F33F}', // 🌿
  'High Tech': '\u{1F4BB}', // 💻
  Military: '\u{1F6E1}\u{FE0F}', // 🛡️
  Industrial: '\u{1F3ED}', // 🏭
  Extraction: '\u26CF\u{FE0F}', // ⛏️
};

// --- Star Type Classification ---

const STAR_SCORE = [
  [/black hole/i, 20, false],
  [/neutron/i, 20, false],
  [/^O\b/i, 18, false],
  [/wolf.rayet/i, 15, true],
  [/white dwarf/i, 12, false],
  [/^B\b|blue.white super/i, 8, false],
  [/carbon/i, 6, false],
  [/^A\b|A \(/i, 4, false],
];

function starEmoji(subType) {
  const s = subType.toLowerCase();
  if (s.includes('neutron')) return '\u{1F4AB}\u2605'; // 💫★
  if (s.includes('black hole')) return '\u26AB\u2605'; // ⚫★
  if (s.includes('white dwarf')) return '\u{1F90D}\u2605'; // 🤍★
  if (s.includes('brown dwarf')) return '\u{1F7E4}'; // 🟤
  if (s.includes('blue-white super') || s.includes('blue white super'))
    return '\u{1F535}\u2605'; // 🔵★
  return '\u2605'; // ★
}

export function classifyStars(bodies) {
  return bodies
    .filter((b) => b.type === 'Star')
    .map((b) => {
      let points = 0;
      let hazardous = false;
      for (const [re, pts, haz] of STAR_SCORE) {
        if (re.test(b.subType)) {
          points = pts;
          hazardous = haz;
          break;
        }
      }
      // Extract short star label from name (e.g. "HIP 47126 A" → "A")
      return {
        bodyId: b.bodyId,
        name: b.name,
        subType: b.subType,
        isMainStar: !!b.mainStar,
        emoji: starEmoji(b.subType),
        scorePoints: points,
        isHazardous: hazardous,
      };
    });
}

// --- Distance formatting ---

function formatDistanceLs(ls) {
  if (ls < 1000) return `${Math.round(ls)}ls`;
  return `${(ls / 1000).toFixed(1)}k`;
}

// --- Distance decay multiplier (primary star bodies only) ---

export function distanceDecay(distanceLs) {
  if (distanceLs < 4000) return 1.0;
  if (distanceLs < 10000) return 0.7;
  if (distanceLs < 20000) return 0.4;
  return 0.15;
}

// Base bonus for rare ("exotic") non-icy atmospheres, before distance decay.
// Oxygen is scored separately (oxygenPoints). The common CO2/SO2/Ammonia/Nitrogen
// and the more-abundant "-rich" variants (Neon-rich etc.) are intentionally 0.
// Order matters: check "-rich" / "vapour" before the bare type.
export function exoticAtmoPoints(atmosphereType) {
  const a = (atmosphereType || '').toLowerCase();
  if (a.includes('silicate vapour')) return 25;
  if (a.includes('neon')) return a.includes('neon-rich') ? 0 : 25;
  if (a.includes('argon-rich')) return 12;
  if (a.includes('argon')) return 4;
  if (a.includes('methane-rich')) return 8;
  if (a.includes('methane')) return 4;
  if (a.includes('water-rich')) return 0;
  if (a.includes('water')) return 8;
  return 0;
}

// --- Body String Builder ---

// Glyph string for one qualifying body: atmosphere emoji + 💍 ring + ◉(dist) + economy emoji.
// Single source for buildBodyString and buildBodySegments.
function bodyGlyphString(qb) {
  let s = '';
  const atmoType = (qb.body.atmosphereType || '').toLowerCase();
  if (qb.hasAtmosphere && /oxygen/.test(atmoType)) s += '\u{1F7E2}'; // 🟢 oxygen
  else if (qb.hasAtmosphere && /nitrogen/.test(atmoType)) s += '\u{1F535}'; // 🔵 nitrogen
  else if (qb.hasAtmosphere && /ammonia/.test(atmoType)) s += '\u{1F7E1}'; // 🟡 ammonia
  else if (qb.hasAtmosphere && /helium/.test(atmoType)) s += '\u{1FA76}'; // 🩶 helium
  else if (qb.hasAtmosphere) s += '\u{1F32B}\u{FE0F}'; // 🌫️
  if (qb.hasRings) s += '\u{1F48D}'; // 💍
  s += '◉'; // ◉
  s += `(${formatDistanceLs(qb.distanceLs)})`;
  const econ = qb.economy;
  if (econ !== 'Refinery' && ECONOMY_EMOJI[econ]) s += ECONOMY_EMOJI[econ];
  return s;
}

export function buildBodyString(qualBodies, stars) {
  // Group bodies by parent star
  const buckets = new Map();
  for (const qb of qualBodies) {
    const list = buckets.get(qb.parentStarId) ?? [];
    list.push(qb);
    buckets.set(qb.parentStarId, list);
  }

  const parts = [];
  for (const star of stars) {
    const bodies = buckets.get(star.bodyId);
    if (!bodies || bodies.length === 0) {
      // Only show stars with no bodies if they're exotic (score > 0)
      if (star.scorePoints > 0) {
        const label = star.name.split(' ').pop() ?? star.name;
        parts.push(`${star.emoji}${label}: \u2014`);
      }
      continue;
    }
    const label = star.name.split(' ').pop() ?? star.name;
    const bodyStrs = bodies
      .sort((a, b) => a.distanceLs - b.distanceLs)
      .map((qb) => bodyGlyphString(qb));
    parts.push(`${star.emoji}${label}: ${bodyStrs.join(' ')}`);
  }

  // Handle bodies with no identified parent star
  const orphans = buckets.get(null);
  if (orphans && orphans.length > 0) {
    const bodyStrs = orphans
      .sort((a, b) => a.distanceLs - b.distanceLs)
      .map((qb) => bodyGlyphString(qb));
    parts.push(bodyStrs.join(' '));
  }

  return parts.join(' | ') || '\u2014';
}

// --- Body Segment Builder (structured, for tooltip rendering) ---

export function buildBodySegments(qualBodies, stars) {
  const segments = [];

  const buckets = new Map();
  for (const qb of qualBodies) {
    const list = buckets.get(qb.parentStarId) ?? [];
    list.push(qb);
    buckets.set(qb.parentStarId, list);
  }

  function bodyToSegment(qb) {
    const s = bodyGlyphString(qb);
    const atmoType = (qb.body.atmosphereType || '').toLowerCase();
    const isOxygen = qb.hasAtmosphere && /oxygen/.test(atmoType);
    const isNitrogen = qb.hasAtmosphere && /nitrogen/.test(atmoType);
    const isAmmonia = qb.hasAtmosphere && /ammonia/.test(atmoType);
    const isHelium = qb.hasAtmosphere && /helium/.test(atmoType);
    const econ = qb.economy;

    const shortName = qb.body.name.split(' ').pop() ?? qb.body.name;
    const features = [];
    if (isOxygen) features.push('Oxygen Atmosphere');
    else if (isNitrogen) features.push('Nitrogen Atmosphere');
    else if (isAmmonia) features.push('Ammonia Atmosphere');
    else if (isHelium) features.push('Helium Atmosphere');
    else if (qb.hasAtmosphere) features.push('Atmosphere');
    if (qb.hasRings) features.push('Rings');
    features.push(qb.body.subType);
    features.push(`Economy: ${econ}`);
    features.push(`${Math.round(qb.distanceLs)} ls`);

    return { text: s, tooltip: `${shortName}: ${features.join(', ')}` };
  }

  for (const star of stars) {
    const bodies = buckets.get(star.bodyId);
    if (!bodies || bodies.length === 0) {
      if (star.scorePoints > 0) {
        const label = star.name.split(' ').pop() ?? star.name;
        segments.push({ text: `${star.emoji}${label}: \u2014`, tooltip: `${star.subType} (no qualifying bodies)` });
      }
      continue;
    }
    const label = star.name.split(' ').pop() ?? star.name;
    segments.push({ text: `${star.emoji}${label}: `, tooltip: star.subType });
    for (const qb of bodies.sort((a, b) => a.distanceLs - b.distanceLs)) {
      segments.push(bodyToSegment(qb));
    }
    segments.push({ text: ' | ', tooltip: '' });
  }

  const orphans = buckets.get(null);
  if (orphans && orphans.length > 0) {
    for (const qb of orphans.sort((a, b) => a.distanceLs - b.distanceLs)) {
      segments.push(bodyToSegment(qb));
    }
  }

  // Remove trailing separator
  if (segments.length > 0 && segments[segments.length - 1].text === ' | ') {
    segments.pop();
  }

  return segments;
}

// --- Proximity Clustering ---

function countProximityClusters(qualBodies) {
  // Group by parent star bucket
  const buckets = new Map();
  for (const qb of qualBodies) {
    const list = buckets.get(qb.parentStarId) ?? [];
    list.push(qb);
    buckets.set(qb.parentStarId, list);
  }

  let count = 0;
  for (const bodies of buckets.values()) {
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        if (Math.abs(bodies[i].distanceLs - bodies[j].distanceLs) <= 100) {
          count++;
          break; // count body i once
        }
      }
    }
  }
  return count;
}

// --- Scoring Model ---

// --- Epic-view detection (geometry only — a display flag, NOT score points) ---
// Flags a system with a spectacular surface view: a tight binary, a moon with a
// huge parent overhead, or a ring-edge moon. Needs orbital fields in Spansh raw
// units: radius in km, semiMajorAxis in AU. The journal path
// (journalBodiesToSpanshFormat) converts its metres to match.
const AU_KM = 149597870.7;
const SUN_R_KM = 696340;
// Thresholds calibrated 2026-08-04 against the commander's benchmark sights (HIP 47126
// ABCD 1 a/b twins 24.7°; AX-J d9-52 2 a ring ratio 1.01; HIP 52629 2 a INSIDE its rings,
// ratio 0.35). The original bars (parent 20°, ring span 40°) flagged essentially every
// close moon of every ringed giant — "it's saying like all of them have epic views."
const BIG_SKY_MIN_DEG = 45;     // parent overhead — only the true monsters (47–50° exist, 21–37° is routine)
const RING_EDGE_MAX_RATIO = 1.05; // moon sma / ring outer radius — a real edge-skimmer (or inside the rings)
const RING_EDGE_MIN_DEG = 30;   // ...and the rings must still span a big chunk of sky
const TWIN_PAIR_MIN_DEG = 20;   // sibling worlds looming in each other's sky (benchmarks 24.7°/28.6°; routine pairs ≤14°)
function isBrownDwarfStar(b) {
  return b.type === 'Star' && /brown dwarf/i.test(b.subType || '');
}
// Body radius in km. Planets and journal-sourced bodies carry `radius` (km);
// Spansh STARS (incl. brown dwarfs) carry `solarRadius` (solar radii) instead.
function radiusKmOf(b) {
  if (typeof b.radius === 'number' && b.radius > 0) return b.radius;
  if (typeof b.solarRadius === 'number' && b.solarRadius > 0) return b.solarRadius * SUN_R_KM;
  return 0;
}
function apparentDeg(radiusKm, sepKm) {
  if (!(radiusKm > 0) || !(sepKm > 0)) return 0;
  return (2 * Math.atan(radiusKm / sepKm) * 180) / Math.PI;
}
function immediateParent(body, byId) {
  const p0 = body.parents && body.parents[0];
  if (!p0) return null;
  if ('Planet' in p0) return byId.get(p0.Planet) || null;
  if ('Star' in p0) return byId.get(p0.Star) || null;
  return null;
}

export function detectEpicView(bodies) {
  const reasons = [];
  const criteria = []; // distinct criterion kinds — each is worth points in v2 scoring
  if (!Array.isArray(bodies) || bodies.length === 0) return { isEpic: false, reasons };
  const byId = new Map(bodies.map((b) => [b.bodyId, b]));
  const realStars = bodies.filter((b) => b.type === 'Star' && !isBrownDwarfStar(b));

  // Short designator: strip the longest common name prefix (trimmed to a word
  // boundary) so "Col 173 Sector AX-J d9-52 2 a" → "2 a". Falls back to the full
  // name when there's no clean shared prefix (e.g. a single body).
  const names = bodies.map((b) => b.name).filter((n) => typeof n === 'string');
  let prefix = '';
  if (names.length >= 2) {
    prefix = names[0];
    for (const n of names) {
      let i = 0;
      while (i < prefix.length && i < n.length && prefix[i] === n[i]) i++;
      prefix = prefix.slice(0, i);
    }
    prefix = prefix.slice(0, prefix.lastIndexOf(' ') + 1);
  }
  const short = (b) => {
    const n = b && typeof b.name === 'string' ? b.name : '';
    if (!n) return String(b && b.name != null ? b.name : '');
    return prefix && n.startsWith(prefix) ? n.slice(prefix.length) : n;
  };

  // 1. Tight binary — two non-brown-dwarf stars within 0.1 AU.
  let tightestAu = Infinity;
  let tightestPair = null;
  for (const s of realStars) {
    const sma = s.semiMajorAxis; // AU
    if (typeof sma !== 'number' || sma <= 0) continue;
    const p0 = s.parents && s.parents[0];
    if (p0 && 'Star' in p0) {
      // orbits another star directly: separation = its own semi-major axis
      const parent = byId.get(p0.Star);
      if (parent && parent.type === 'Star' && !isBrownDwarfStar(parent) && sma < tightestAu) {
        tightestAu = sma;
        tightestPair = [s, parent];
      }
    }
  }
  // co-orbiting pairs sharing an immediate barycentre: separation = sum of smas
  const bary = new Map();
  for (const s of realStars) {
    const sma = s.semiMajorAxis;
    const p0 = s.parents && s.parents[0];
    if (p0 && 'Null' in p0 && typeof sma === 'number' && sma > 0) {
      const k = p0.Null;
      (bary.get(k) || bary.set(k, []).get(k)).push({ star: s, sma });
    }
  }
  for (const entries of bary.values()) {
    if (entries.length >= 2) {
      entries.sort((a, b) => a.sma - b.sma);
      const au = entries[0].sma + entries[1].sma;
      if (au < tightestAu) {
        tightestAu = au;
        tightestPair = [entries[0].star, entries[1].star];
      }
    }
  }
  if (tightestAu <= 0.1) {
    const pair = tightestPair ? ` (${short(tightestPair[0])}, ${short(tightestPair[1])})` : '';
    reasons.push(`tight binary ${tightestAu.toFixed(3)} AU${pair}`);
    criteria.push('binary');
  }

  // 2. Big-sky parent — landable moon whose parent subtends >= BIG_SKY_MIN_DEG overhead.
  // Parent may be a planet OR a star/brown dwarf (radius from solarRadius then).
  let biggestDeg = 0;
  let biggestBody = null;
  for (const b of bodies) {
    if (!b.isLandable || typeof b.semiMajorAxis !== 'number' || b.semiMajorAxis <= 0) continue;
    const parent = immediateParent(b, byId);
    if (!parent) continue;
    const parentRadiusKm = radiusKmOf(parent);
    if (!(parentRadiusKm > 0)) continue;
    const sepKm = b.semiMajorAxis * AU_KM;
    if (sepKm <= parentRadiusKm) continue; // artifact guard: impossible "moon inside parent"
    const deg = apparentDeg(parentRadiusKm, sepKm);
    if (deg > biggestDeg) { biggestDeg = deg; biggestBody = b; }
  }
  if (biggestDeg >= BIG_SKY_MIN_DEG) { reasons.push(`${short(biggestBody)} — parent fills ${Math.round(biggestDeg)}° of sky`); criteria.push('bigSky'); }

  // 3. Ring-edge moon — a landable moon orbiting AT the ring edge (or inside the rings):
  // sma within RING_EDGE_MAX_RATIO of the ring outer radius, with the rings still spanning
  // >= RING_EDGE_MIN_DEG of sky. Span alone is not enough — every close moon of a ringed
  // giant sees a 70–90° ring band (15 such bodies in the commander's own shortlist); the
  // benchmark skimmer (d9-52 2 a) orbits at 1.01× the ring edge.
  for (const b of bodies) {
    if (!b.isLandable || typeof b.semiMajorAxis !== 'number' || b.semiMajorAxis <= 0) continue;
    const parent = immediateParent(b, byId);
    if (!parent || !Array.isArray(parent.rings) || parent.rings.length === 0) continue;
    const ringOuterKm = parent.rings.reduce((m, r) => Math.max(m, typeof r.outerRadius === 'number' ? r.outerRadius / 1000 : 0), 0);
    if (!(ringOuterKm > 0)) continue; // no radius data — can't confirm proximity; don't false-positive
    const smaKm = b.semiMajorAxis * AU_KM;
    if (smaKm / ringOuterKm <= RING_EDGE_MAX_RATIO && apparentDeg(ringOuterKm, smaKm) >= RING_EDGE_MIN_DEG) {
      reasons.push(`${short(b)} — ${smaKm < ringOuterKm ? 'orbits INSIDE the rings of' : 'skims the ring edge of'} ${short(parent)}`);
      criteria.push('ringEdge');
      break;
    }
  }

  // 4. Twin pair — sibling worlds so close they loom huge in each other's sky. The
  // criterion the benchmarks actually were: HIP 47126 ABCD 1 a/b (24.7° mutual, co-orbiting
  // 4,194 km apart), HIP 52629 (28.6°). Ordinary adjacent moons sit <= ~14°, so the bar
  // has a natural gap under it. Metric matches the 2026-08-04 calibration exactly:
  // planets grouped by identical immediate parent, adjacent orbits closest = |sma diff|,
  // co-orbiting barycentre pairs = sma sum, angle from the larger body's radius.
  let twinDeg = 0;
  let twinPair = null;
  const sibs = new Map();
  for (const b of bodies) {
    if (b.type !== 'Planet' || !(radiusKmOf(b) > 0) || typeof b.semiMajorAxis !== 'number' || b.semiMajorAxis <= 0) continue;
    const p0 = b.parents && b.parents[0];
    if (!p0) continue;
    const k = JSON.stringify(p0);
    (sibs.get(k) || sibs.set(k, []).get(k)).push(b);
  }
  for (const g of sibs.values()) {
    if (g.length < 2) continue;
    g.sort((a, b) => a.semiMajorAxis - b.semiMajorAxis);
    for (let i = 0; i + 1 < g.length; i++) {
      const A = g[i], B = g[i + 1];
      const coOrbit = 'Null' in (A.parents[0] || {});
      const sepKm = (coOrbit ? A.semiMajorAxis + B.semiMajorAxis : B.semiMajorAxis - A.semiMajorAxis) * AU_KM;
      const d = Math.max(apparentDeg(radiusKmOf(A), sepKm), apparentDeg(radiusKmOf(B), sepKm));
      if (d > twinDeg) { twinDeg = d; twinPair = [A, B]; }
    }
  }
  if (twinDeg >= TWIN_PAIR_MIN_DEG && twinPair) {
    reasons.push(`${short(twinPair[0])} & ${short(twinPair[1])} — twin worlds, ${Math.round(twinDeg)}° in each other's sky`);
    criteria.push('twins');
  }

  return { isEpic: reasons.length > 0, reasons, criteria };
}

export function scoreSystem(bodies) {
  const stars = classifyStars(bodies);
  const qualBodies = filterQualifyingBodies(bodies);
  const epicView = detectEpicView(bodies);

  // --- Star Type (cap 60) ---
  let starPoints = 0;
  const starDetails = [];
  const hazardousStars = [];
  for (const star of stars) {
    if (star.scorePoints > 0) {
      starPoints += star.scorePoints;
      const shortType = star.subType.replace(/ Star$/, '').replace(/\(.*?\)/, '').trim();
      starDetails.push(`${star.emoji} ${shortType}: +${star.scorePoints}`);
      if (star.isHazardous) hazardousStars.push(star.name);
    }
  }
  starPoints = Math.min(starPoints, 60);

  // --- Atmospheric Bodies (diminishing returns, distance decay on primary) ---
  // Icy atmospheric bodies get half points; non-icy get full points
  let atmospherePoints = 0;
  let atmosphereCount = 0;
  const atmosBodies = qualBodies
    .filter((qb) => qb.hasAtmosphere)
    .sort((a, b) => {
      // Sort by effective value: secondary star bodies first (no decay), then by distance
      if (a.isPrimaryStar !== b.isPrimaryStar) return a.isPrimaryStar ? 1 : -1;
      return a.distanceLs - b.distanceLs;
    });
  // v2 (2026-08-05): per-CLASS ladder — the first body of each DISTINCT atmosphere class
  // earns the full ladder rate; further bodies of a class already seen earn a flat +3.
  // Field-calibrated on the commander's own inspections: clone families ("5 midget water
  // planets… meh") were stacking +5s forever and burying genuinely diverse systems.
  const seenAtmoClasses = new Set();
  const atmoClassOf = (t) => String(t || '').toLowerCase()
    .replace(/^hot /, '').replace(/^thin /, '').replace(/-rich/, '').trim();
  for (const qb of atmosBodies) {
    atmosphereCount++;
    const cls = atmoClassOf(qb.body.atmosphereType);
    const firstOfClass = !seenAtmoClasses.has(cls);
    if (firstOfClass) seenAtmoClasses.add(cls);
    const ladderIdx = seenAtmoClasses.size; // distinct classes seen so far
    const basePoints = firstOfClass
      ? (ladderIdx === 1 ? 15 : ladderIdx === 2 ? 12 : ladderIdx === 3 ? 9 : 5)
      : 3;
    const decay = qb.isPrimaryStar ? distanceDecay(qb.distanceLs) : 1.0;
    // Icy atmospheric worlds are less valuable than rocky/HMC ones
    const icyPenalty = ICY_SUBTYPES.has(qb.body.subType) ? 0.5 : 1.0;
    atmospherePoints += Math.round(basePoints * decay * icyPenalty);
  }

  // --- Diversity Bonus (cap 20) — distinct airs are the delight; clones are not ---
  const distinctAtmoClasses = seenAtmoClasses.size;
  const diversityPoints = Math.min(Math.max(0, distinctAtmoClasses - 1) * 5, 20);

  // --- Oxygen Atmosphere Bonus (non-icy only, distance-decayed, cap 45) ---
  let oxygenPoints = 0;
  let oxygenCount = 0;
  let hasNonIcyOxygen = false;
  for (const qb of qualBodies) {
    if (
      qb.hasAtmosphere &&
      /oxygen/i.test(qb.body.atmosphereType || '') &&
      !ICY_SUBTYPES.has(qb.body.subType)
    ) {
      oxygenCount++;
      hasNonIcyOxygen = true;
      const decay = qb.isPrimaryStar ? distanceDecay(qb.distanceLs) : 1.0;
      oxygenPoints += Math.round(15 * decay);
    }
  }
  oxygenPoints = Math.min(oxygenPoints, 45);

  // --- Exotic Atmosphere Bonus (rare non-icy atmospheres, distance-decayed, cap 50) ---
  // Neon/Silicate vapour +25, Argon-rich +12, Water/Methane-rich +8, Methane/Argon +4.
  // Icy bodies score nothing here. Oxygen handled above.
  let exoticPoints = 0;
  let exoticCount = 0;
  for (const qb of qualBodies) {
    if (!qb.hasAtmosphere || ICY_SUBTYPES.has(qb.body.subType)) continue;
    const base = exoticAtmoPoints(qb.body.atmosphereType);
    if (base <= 0) continue;
    exoticCount++;
    const decay = qb.isPrimaryStar ? distanceDecay(qb.distanceLs) : 1.0;
    exoticPoints += Math.round(base * decay);
  }
  exoticPoints = Math.min(exoticPoints, 50);

  // --- Rings (cap 30) ---
  let ringPoints = 0;
  let ringCount = 0;
  for (const qb of qualBodies) {
    if (qb.hasRings) {
      ringCount++;
      ringPoints += 15;
    }
  }
  ringPoints = Math.min(ringPoints, 30);

  // --- Proximity Clusters (cap 20) ---
  const proximityCount = countProximityClusters(qualBodies);
  const proximityPoints = Math.min(proximityCount * 3, 20);

  // --- Economy Diversity (cap 15) ---
  // Count ALL applicable non-Refinery economies across all bodies
  const uniqueEcons = new Set();
  for (const qb of qualBodies) {
    const allEcons = collectEconomies(
      qb.body,
      qb.parentStarId !== null ? bodies.find((s) => s.bodyId === qb.parentStarId) : undefined,
    );
    for (const e of allEcons) {
      if (e !== 'Refinery') uniqueEcons.add(e);
    }
  }
  const uniqueEconomies = [...uniqueEcons].sort(
    (a, b) => (ECONOMY_PRIORITY[b] ?? 0) - (ECONOMY_PRIORITY[a] ?? 0),
  );
  const economyPoints = Math.min(uniqueEconomies.length * 5, 15);

  // --- Body Count (cap 15) ---
  const bodyCount = qualBodies.length;
  const bodyCountPoints = Math.min(bodyCount * 2, 15);

  // --- Epic View Points (cap 30) — v2: geometry is a HOME-PICKER, priced like one.
  // "epic is probably the reason I'd make a system home" — HIP 47126 was claimed for
  // its epic tight pair; the twin worlds then hosted the first two builds. +10 per
  // distinct triggered criterion (twins / ringEdge / bigSky / binary).
  const epicPoints = Math.min((epicView.criteria || []).length * 10, 30);

  // Geo signal census — no points (yet); persisted so the UI can filter/badge
  // surface-mining venues without re-fetching bodies. Counts every body with
  // geological signals, landable or not.
  let geoCount = 0;
  let geoSiteTotal = 0;
  for (const b of bodies) {
    const g = b.signals?.signals?.['$SAA_SignalType_Geological;'] || 0;
    if (g > 0) { geoCount++; geoSiteTotal += g; }
  }

  const total =
    starPoints + atmospherePoints + diversityPoints + oxygenPoints + exoticPoints + ringPoints + proximityPoints + economyPoints + bodyCountPoints + epicPoints;

  return {
    starPoints,
    starDetails,
    atmospherePoints,
    atmosphereCount,
    diversityPoints,
    distinctAtmoClasses,
    oxygenPoints,
    oxygenCount,
    exoticPoints,
    exoticCount,
    ringPoints,
    ringCount,
    proximityPoints,
    proximityCount,
    economyPoints,
    uniqueEconomies,
    bodyCountPoints,
    bodyCount,
    starCount: stars.length, // all stars (incl. brown dwarfs / remnants), for the "multiple stars" note
    epicView, // { isEpic, reasons[], criteria[] }
    epicPoints,
    geoCount,
    geoSiteTotal,
    total,
    hasRingedLandable: ringCount > 0,
    // Consistent with oxygenPoints: icy oxygen bodies earn nothing, so they
    // don't set the flag either.
    hasOxygenAtmosphere: hasNonIcyOxygen,
    hazardousStars,
  };
}

/**
 * Zero-valued ScoreBreakdown for placeholder entries (e.g. favorites scouted
 * without body data). A factory, not a shared const — the arrays inside must
 * not be shared across entries.
 */
export function emptyScore() {
  return {
    starPoints: 0,
    starDetails: [],
    atmospherePoints: 0,
    atmosphereCount: 0,
    diversityPoints: 0,
    distinctAtmoClasses: 0,
    epicPoints: 0,
    oxygenPoints: 0,
    oxygenCount: 0,
    exoticPoints: 0,
    exoticCount: 0,
    ringPoints: 0,
    ringCount: 0,
    proximityPoints: 0,
    proximityCount: 0,
    economyPoints: 0,
    uniqueEconomies: [],
    bodyCountPoints: 0,
    bodyCount: 0,
    starCount: 0,
    epicView: { isEpic: false, reasons: [] },
    geoCount: 0,
    geoSiteTotal: 0,
    total: 0,
    hasRingedLandable: false,
    hasOxygenAtmosphere: false,
    hazardousStars: [],
  };
}
