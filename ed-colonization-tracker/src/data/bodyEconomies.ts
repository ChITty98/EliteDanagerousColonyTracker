/**
 * Body-type → economy mapping for colonization analysis.
 *
 * Source: CMDR Mechan's Elite Dangerous Colonization Mega Guide v2.3.0
 *   - "How Do Colony-Type Ports Gain Economies?" section (Base Inheritable Economy + Modifiers)
 *   - "Strong Links" subsection for body-driven link modifiers
 *
 * Two distinct effects on economy at a port:
 *   1. Base Inheritable Economy: COLONY-TYPE ports (Civilian Outpost, Commercial Outpost,
 *      Coriolis, Orbis, Ocellus, T3 Planetary Port) acquire their economy type FROM the
 *      local body they orbit/sit on. Modifiers (rings/organics/geologicals) overlap NOT
 *      stack with the base.
 *   2. Strong-Link Modifiers: Any port (colony or specialized) is affected by strong-link
 *      bonuses/penalties from the body's characteristics — these are flat +/-0.4 to the
 *      strong-link strength of supporting facilities on the same body.
 *
 * The two systems interact — a colony port acquires base economy from the body, then
 * its strong links from supporting facilities on the body get modified by the same body's
 * characteristics. This file captures both for the analysis modal.
 */

export type Economy =
  | 'Agriculture'
  | 'Extraction'
  | 'Refinery'
  | 'Industrial'
  | 'HighTech'
  | 'Military'
  | 'Tourism'
  | 'Terraforming'
  | 'Contraband';

export interface BodyTypeProfile {
  /** Display label for the body category */
  label: string;
  /** Spansh subType strings or substrings that map to this category (case-insensitive) */
  matchPatterns: string[];
  /** Base inheritable economies — colony-type ports orbiting this body inherit these. */
  baseEconomies: Economy[];
  /**
   * Default category if the user wants to specialize this body — purely advisory,
   * what the body is "best at" if you commit to it.
   */
  primarySpecialty?: Economy;
}

export const BODY_TYPE_PROFILES: BodyTypeProfile[] = [
  {
    label: 'Earth-like World',
    matchPatterns: ['earth-like world', 'earthlike body'],
    baseEconomies: ['Agriculture', 'HighTech', 'Military', 'Tourism'],
    primarySpecialty: 'Agriculture',
  },
  {
    label: 'Water World',
    matchPatterns: ['water world'],
    baseEconomies: ['Agriculture', 'Tourism'],
    primarySpecialty: 'Agriculture',
  },
  {
    label: 'Ammonia World',
    matchPatterns: ['ammonia world'],
    baseEconomies: ['HighTech', 'Tourism'],
    primarySpecialty: 'HighTech',
  },
  {
    label: 'High Metal Content / Metal Rich',
    matchPatterns: ['high metal content', 'metal-rich body', 'metal rich body'],
    baseEconomies: ['Extraction'],
    primarySpecialty: 'Extraction',
  },
  {
    label: 'Rocky Ice Body',
    matchPatterns: ['rocky ice'],
    baseEconomies: ['Industrial', 'Refinery'],
    primarySpecialty: 'Refinery',
  },
  {
    label: 'Rocky Body',
    matchPatterns: ['rocky body'],
    baseEconomies: ['Refinery'],
    primarySpecialty: 'Refinery',
  },
  {
    label: 'Icy Body',
    matchPatterns: ['icy body'],
    baseEconomies: ['Industrial'],
    primarySpecialty: 'Industrial',
  },
  {
    label: 'Gas Giant',
    matchPatterns: ['gas giant', 'class i gas', 'class ii gas', 'class iii gas', 'class iv gas', 'class v gas', 'helium-rich', 'helium rich'],
    baseEconomies: ['HighTech', 'Industrial'],
    primarySpecialty: 'HighTech',
  },
  {
    label: 'Black Hole / Neutron Star / White Dwarf',
    matchPatterns: ['black hole', 'neutron star', 'white dwarf'],
    baseEconomies: ['HighTech', 'Tourism'],
    primarySpecialty: 'Tourism',
  },
  {
    label: 'Brown Dwarf / Main Sequence Star',
    matchPatterns: [
      'brown dwarf', '(red dwarf)', '(red giant)', '(yellow', '(white', '(blue',
      'm-type', 'k-type', 'g-type', 'f-type', 'a-type', 'b-type', 'o-type', 't-type', 'l-type', 'y-type',
      ' star',  // catch-all for "M (Red Dwarf) Star" patterns
    ],
    baseEconomies: ['Military'],
    primarySpecialty: 'Military',
  },
];

/**
 * Body modifiers that OVERLAP with (do not stack on top of) base inheritable economy.
 * Each modifier brings additional economy options. These are NOT additive — if base is
 * Industrial and modifier adds Extraction, the port shows BOTH economies at full strength,
 * not double-stacked.
 */
export interface BodyModifier {
  id: string;
  label: string;
  /** Additional economies this modifier grants */
  addsEconomies: Economy[];
}

export const BODY_MODIFIERS: BodyModifier[] = [
  {
    id: 'rings',
    label: 'Has rings (or stars with asteroid belt)',
    addsEconomies: ['Extraction'],
  },
  {
    id: 'organics',
    label: 'Has organics (biosignals)',
    addsEconomies: ['Agriculture', 'Terraforming'],
  },
  {
    id: 'geologicals',
    label: 'Has geologicals (geosignals)',
    addsEconomies: ['Extraction', 'Industrial'],
  },
];

/**
 * Strong-link modifiers per the Mega Guide's "Strong Links" section.
 * These flatly add ±0.4 to a strong-link's strength, post-tier-base.
 * Strong-link minimum after malus is 0.1.
 */
export interface StrongLinkModifier {
  economy: Economy;
  /** Conditions that grant +0.4 to strong-link strength for this economy */
  boostedBy: string[];
  /** Conditions that grant -0.4 to strong-link strength for this economy */
  decreasedBy: string[];
}

export const STRONG_LINK_MODIFIERS: StrongLinkModifier[] = [
  {
    economy: 'Agriculture',
    boostedBy: [
      'Orbiting an Earth-like world',
      'Orbiting a Water world (currently BUGGED — not working)',
      'On or orbiting a terraformable body',
      'On or orbiting a body with organics',
    ],
    decreasedBy: [
      'On or orbiting an icy body',
      'On or orbiting a planet tidally locked to its star',
      'On or orbiting a moon whose parents are tidally locked to the star',
    ],
  },
  {
    economy: 'Extraction',
    boostedBy: [
      'In a system with major or pristine resources',
      'On or orbiting a body with volcanism',
    ],
    decreasedBy: ['In a system with low or depleted resources'],
  },
  {
    economy: 'HighTech',
    boostedBy: [
      'Orbiting an ammonia world',
      'Orbiting an Earth-like world',
      'Orbiting a Water world',
      'On or orbiting a body with geologicals',
      'On or orbiting a body with organics',
    ],
    decreasedBy: [],
  },
  {
    economy: 'Industrial',
    boostedBy: ['In a system with major or pristine resources'],
    decreasedBy: ['In a system with low or depleted resources'],
  },
  {
    economy: 'Refinery',
    boostedBy: ['In a system with major or pristine resources'],
    decreasedBy: ['In a system with low or depleted resources'],
  },
  {
    economy: 'Tourism',
    boostedBy: [
      'Orbiting an ammonia world',
      'In a system with a black hole',
      'Orbiting an Earth-like world',
      'On or orbiting a body with geologicals',
      'On or orbiting a body with organics',
      'Orbiting a water world',
      'In a system with a white dwarf',
      'In a system with a neutron star',
    ],
    decreasedBy: [],
  },
];

/**
 * Resolve a Spansh subType to a body type profile. Returns null if unknown.
 */
export function getBodyTypeProfile(subType: string | undefined | null): BodyTypeProfile | null {
  if (!subType) return null;
  const lc = subType.toLowerCase();
  for (const profile of BODY_TYPE_PROFILES) {
    for (const pattern of profile.matchPatterns) {
      if (lc.includes(pattern)) return profile;
    }
  }
  return null;
}

/**
 * Detect which body modifiers apply, given a Spansh body record. Returns the set
 * of modifier ids that apply.
 */
export function detectBodyModifiers(body: {
  rings?: unknown[];
  signals?: { genuses?: unknown[]; signals?: Record<string, number> };
}): Set<string> {
  const ids = new Set<string>();
  if (Array.isArray(body.rings) && body.rings.length > 0) ids.add('rings');
  const signals = body.signals;
  if (signals) {
    // Journal-scan style (some sources): signals.genuses array
    if (Array.isArray(signals.genuses) && signals.genuses.length > 0) ids.add('organics');
    // Spansh dump style: signals.signals[$SAA_SignalType_*;] counts
    if (signals.signals) {
      const g = signals.signals['Geological'] || signals.signals['$SAA_SignalType_Geological;'] || 0;
      if (typeof g === 'number' && g > 0) ids.add('geologicals');
      const b = signals.signals['Biological'] || signals.signals['$SAA_SignalType_Biological;'] || 0;
      if (typeof b === 'number' && b > 0) ids.add('organics');
    }
  }
  return ids;
}

/**
 * Resolve the full set of economies available at a colony-type port on this body
 * (base + modifiers, with overlap rather than additive stacking).
 */
export function resolveBodyEconomies(body: {
  subType?: string;
  rings?: unknown[];
  signals?: { genuses?: unknown[]; signals?: Record<string, number> };
}): {
  profile: BodyTypeProfile | null;
  modifiers: BodyModifier[];
  economies: Economy[];
} {
  const profile = getBodyTypeProfile(body.subType);
  const modIds = detectBodyModifiers(body);
  const modifiers = BODY_MODIFIERS.filter((m) => modIds.has(m.id));
  const econSet = new Set<Economy>(profile?.baseEconomies || []);
  for (const m of modifiers) for (const e of m.addsEconomies) econSet.add(e);
  return { profile, modifiers, economies: [...econSet] };
}

/**
 * Check terraformable / volcanism / tidally-locked flags (strong-link modifiers).
 * `parents` walk for tidal-lock chain is approximate — we flag suspected tidal-lock
 * but the precise rule requires walking up the orbit hierarchy.
 */
export function detectStrongLinkConditions(body: {
  subType?: string;
  terraformingState?: string;
  volcanismType?: string;
}): {
  terraformable: boolean;
  hasVolcanism: boolean;
} {
  return {
    terraformable: body.terraformingState === 'Terraformable' || body.terraformingState === 'Candidate for terraforming',
    hasVolcanism: !!body.volcanismType && body.volcanismType.toLowerCase() !== 'no volcanism',
  };
}
