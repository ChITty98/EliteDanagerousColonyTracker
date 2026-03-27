import type { SpanshDumpBody } from '@/services/spanshApi';

// --- Body Filter Pipeline ---

const ICY_SUBTYPES = new Set(['Icy body', 'Rocky ice world', 'Rocky Ice world']);

/** Check if a body has a real atmosphere (thin counts, but "No atmosphere"/"None"/empty don't) */
function isColonisableAtmosphere(atmosphereType?: string | null): boolean {
  if (!atmosphereType) return false;
  const lower = atmosphereType.toLowerCase().trim();
  if (!lower) return false;
  // Filter out non-atmosphere values Spansh may return
  if (lower === 'no atmosphere' || lower === 'none' || lower === 'no' || lower === 'null') return false;
  return true;
}

export interface QualifyingBody {
  body: SpanshDumpBody;
  parentStarId: number | null; // bodyId of the parent star (from parents array)
  isPrimaryStar: boolean; // orbits the main star (or its barycenter)
  economy: string; // classified economy
  hasAtmosphere: boolean;
  hasRings: boolean;
  distanceLs: number;
}

export function filterQualifyingBodies(bodies: SpanshDumpBody[]): QualifyingBody[] {
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
function findParentStarId(body: SpanshDumpBody, allBodies: SpanshDumpBody[]): number | null {
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
function isUnderPrimaryStar(
  body: SpanshDumpBody,
  allBodies: SpanshDumpBody[],
  mainStarId: number,
): boolean {
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
function collectEconomies(body: SpanshDumpBody, parentStar?: SpanshDumpBody): string[] {
  const econs = new Set<string>();

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

function classifyEconomy(body: SpanshDumpBody, parentStar?: SpanshDumpBody): string {
  const econs = collectEconomies(body, parentStar);
  // Return highest priority non-Refinery, or Refinery if nothing else
  return econs
    .sort((a, b) => (ECONOMY_PRIORITY[b] ?? 0) - (ECONOMY_PRIORITY[a] ?? 0))
    [0] ?? 'Refinery';
}

// Economy display priority
const ECONOMY_PRIORITY: Record<string, number> = {
  Tourism: 7,
  'High Tech': 6,
  Agriculture: 5,
  Industrial: 4,
  Extraction: 3,
  Military: 2,
  Refinery: 1,
};

const ECONOMY_EMOJI: Record<string, string> = {
  Tourism: '\u{1F3D6}\u{FE0F}', // 🏖️
  Agriculture: '\u{1F33F}', // 🌿
  'High Tech': '\u{1F4BB}', // 💻
  Military: '\u{1F6E1}\u{FE0F}', // 🛡️
  Industrial: '\u{1F3ED}', // 🏭
  Extraction: '\u26CF\u{FE0F}', // ⛏️
};

// --- Star Type Classification ---

export interface StarInfo {
  bodyId: number;
  name: string;
  subType: string;
  isMainStar: boolean;
  emoji: string;
  scorePoints: number;
  isHazardous: boolean;
}

const STAR_SCORE: [RegExp, number, boolean][] = [
  [/black hole/i, 20, false],
  [/neutron/i, 20, false],
  [/^O\b/i, 18, false],
  [/wolf.rayet/i, 15, true],
  [/white dwarf/i, 12, false],
  [/^B\b|blue.white super/i, 8, false],
  [/carbon/i, 6, false],
  [/^A\b|A \(/i, 4, false],
];

function starEmoji(subType: string): string {
  const s = subType.toLowerCase();
  if (s.includes('neutron')) return '\u{1F4AB}\u2605'; // 💫★
  if (s.includes('black hole')) return '\u26AB\u2605'; // ⚫★
  if (s.includes('white dwarf')) return '\u{1F90D}\u2605'; // 🤍★
  if (s.includes('brown dwarf')) return '\u{1F7E4}'; // 🟤
  if (s.includes('blue-white super') || s.includes('blue white super'))
    return '\u{1F535}\u2605'; // 🔵★
  return '\u2605'; // ★
}

export function classifyStars(bodies: SpanshDumpBody[]): StarInfo[] {
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

function formatDistanceLs(ls: number): string {
  if (ls < 1000) return `${Math.round(ls)}ls`;
  return `${(ls / 1000).toFixed(1)}k`;
}

// --- Distance decay multiplier (primary star bodies only) ---

function distanceDecay(distanceLs: number): number {
  if (distanceLs < 4000) return 1.0;
  if (distanceLs < 10000) return 0.7;
  if (distanceLs < 20000) return 0.4;
  return 0.15;
}

// --- Body String Builder ---

export function buildBodyString(
  qualBodies: QualifyingBody[],
  stars: StarInfo[],
): string {
  // Group bodies by parent star
  const buckets = new Map<number | null, QualifyingBody[]>();
  for (const qb of qualBodies) {
    const list = buckets.get(qb.parentStarId) ?? [];
    list.push(qb);
    buckets.set(qb.parentStarId, list);
  }

  const parts: string[] = [];
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
      .map((qb) => {
        let s = '';
        if (qb.hasAtmosphere && /oxygen/i.test(qb.body.atmosphereType || '')) s += '\u{1F7E2}'; // 🟢 oxygen
        else if (qb.hasAtmosphere && /nitrogen/i.test(qb.body.atmosphereType || '')) s += '\u{1F535}'; // 🔵 nitrogen
        else if (qb.hasAtmosphere && /ammonia/i.test(qb.body.atmosphereType || '')) s += '\u{1F7E1}'; // 🟡 ammonia
        else if (qb.hasAtmosphere && /helium/i.test(qb.body.atmosphereType || '')) s += '\u{1FA76}'; // 🩶 helium
        else if (qb.hasAtmosphere) s += '\u{1F32B}\u{FE0F}'; // 🌫️
        if (qb.hasRings) s += '\u{1F48D}'; // 💍
        s += '\u25C9'; // ◉
        s += `(${formatDistanceLs(qb.distanceLs)})`;
        const econ = qb.economy;
        if (econ !== 'Refinery' && ECONOMY_EMOJI[econ]) s += ECONOMY_EMOJI[econ];
        return s;
      });
    parts.push(`${star.emoji}${label}: ${bodyStrs.join(' ')}`);
  }

  // Handle bodies with no identified parent star
  const orphans = buckets.get(null);
  if (orphans && orphans.length > 0) {
    const bodyStrs = orphans
      .sort((a, b) => a.distanceLs - b.distanceLs)
      .map((qb) => {
        let s = '';
        if (qb.hasAtmosphere && /oxygen/i.test(qb.body.atmosphereType || '')) s += '\u{1F7E2}';
        else if (qb.hasAtmosphere && /nitrogen/i.test(qb.body.atmosphereType || '')) s += '\u{1F535}';
        else if (qb.hasAtmosphere && /ammonia/i.test(qb.body.atmosphereType || '')) s += '\u{1F7E1}';
        else if (qb.hasAtmosphere && /helium/i.test(qb.body.atmosphereType || '')) s += '\u{1FA76}';
        else if (qb.hasAtmosphere) s += '\u{1F32B}\u{FE0F}';
        if (qb.hasRings) s += '\u{1F48D}';
        s += '\u25C9'; // ◉
        s += `(${formatDistanceLs(qb.distanceLs)})`;
        const econ = qb.economy;
        if (econ !== 'Refinery' && ECONOMY_EMOJI[econ]) s += ECONOMY_EMOJI[econ];
        return s;
      });
    parts.push(bodyStrs.join(' '));
  }

  return parts.join(' | ') || '\u2014';
}

// --- Body Segment Builder (structured, for tooltip rendering) ---

export interface BodySegment {
  text: string;
  tooltip: string;
}

export function buildBodySegments(
  qualBodies: QualifyingBody[],
  stars: StarInfo[],
): BodySegment[] {
  const segments: BodySegment[] = [];

  const buckets = new Map<number | null, QualifyingBody[]>();
  for (const qb of qualBodies) {
    const list = buckets.get(qb.parentStarId) ?? [];
    list.push(qb);
    buckets.set(qb.parentStarId, list);
  }

  function bodyToSegment(qb: QualifyingBody): BodySegment {
    let s = '';
    const atmoType = (qb.body.atmosphereType || '').toLowerCase();
    const isOxygen = qb.hasAtmosphere && /oxygen/.test(atmoType);
    const isNitrogen = qb.hasAtmosphere && /nitrogen/.test(atmoType);
    const isAmmonia = qb.hasAtmosphere && /ammonia/.test(atmoType);
    const isHelium = qb.hasAtmosphere && /helium/.test(atmoType);
    if (isOxygen) s += '\u{1F7E2}';
    else if (isNitrogen) s += '\u{1F535}';
    else if (isAmmonia) s += '\u{1F7E1}';
    else if (isHelium) s += '\u{1FA76}';
    else if (qb.hasAtmosphere) s += '\u{1F32B}\u{FE0F}';
    if (qb.hasRings) s += '\u{1F48D}';
    s += '\u25C9';
    s += `(${formatDistanceLs(qb.distanceLs)})`;
    const econ = qb.economy;
    if (econ !== 'Refinery' && ECONOMY_EMOJI[econ]) s += ECONOMY_EMOJI[econ];

    const shortName = qb.body.name.split(' ').pop() ?? qb.body.name;
    const features: string[] = [];
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

function countProximityClusters(qualBodies: QualifyingBody[]): number {
  // Group by parent star bucket
  const buckets = new Map<number | null, QualifyingBody[]>();
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

export interface ScoreBreakdown {
  starPoints: number;
  starDetails: string[];
  atmospherePoints: number;
  atmosphereCount: number;
  oxygenPoints: number;
  oxygenCount: number;
  ringPoints: number;
  ringCount: number;
  proximityPoints: number;
  proximityCount: number;
  economyPoints: number;
  uniqueEconomies: string[];
  bodyCountPoints: number;
  bodyCount: number;
  total: number;
  hasRingedLandable: boolean;
  hasOxygenAtmosphere: boolean;
  hazardousStars: string[];
}

export function scoreSystem(bodies: SpanshDumpBody[]): ScoreBreakdown {
  const stars = classifyStars(bodies);
  const qualBodies = filterQualifyingBodies(bodies);

  // --- Star Type (cap 60) ---
  let starPoints = 0;
  const starDetails: string[] = [];
  const hazardousStars: string[] = [];
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
  for (const qb of atmosBodies) {
    atmosphereCount++;
    const basePoints =
      atmosphereCount === 1 ? 15 : atmosphereCount === 2 ? 12 : atmosphereCount === 3 ? 9 : 5;
    const decay = qb.isPrimaryStar ? distanceDecay(qb.distanceLs) : 1.0;
    // Icy atmospheric worlds are less valuable than rocky/HMC ones
    const icyPenalty = ICY_SUBTYPES.has(qb.body.subType) ? 0.5 : 1.0;
    atmospherePoints += Math.round(basePoints * decay * icyPenalty);
  }

  // --- Oxygen Atmosphere Bonus (cap 20) ---
  let oxygenPoints = 0;
  let oxygenCount = 0;
  for (const qb of qualBodies) {
    if (qb.hasAtmosphere && /oxygen/i.test(qb.body.atmosphereType || '')) {
      oxygenCount++;
      oxygenPoints += oxygenCount === 1 ? 10 : 5; // 10 for first, 5 for each additional
    }
  }
  oxygenPoints = Math.min(oxygenPoints, 20);

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
  const uniqueEcons = new Set<string>();
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

  const total =
    starPoints + atmospherePoints + oxygenPoints + ringPoints + proximityPoints + economyPoints + bodyCountPoints;

  return {
    starPoints,
    starDetails,
    atmospherePoints,
    atmosphereCount,
    oxygenPoints,
    oxygenCount,
    ringPoints,
    ringCount,
    proximityPoints,
    proximityCount,
    economyPoints,
    uniqueEconomies,
    bodyCountPoints,
    bodyCount,
    total,
    hasRingedLandable: ringCount > 0,
    hasOxygenAtmosphere: qualBodies.some((qb) => qb.hasAtmosphere && /oxygen/i.test(qb.body.atmosphereType || '')),
    hazardousStars,
  };
}
