// server/ai/copilotTastes.js
//
// Which way each fact about a station PULLS each persona — the logic half of a station opinion. The
// model writes the line; these tables decide whether a reason counts for or against, so a take is
// checkable: a "love it" whose cited reasons all pull the other way gets rejected (copilotOpinions).
//
// Pull scale: +2 strong like · +1 mild like · 0 neutral / indifferent · −1 mild dislike · −2 strong dislike.
// Keys: wash = Wren, tars = Tycho, k2 = K2.
//
// SOURCES — keep them honest:
//   SPEC  = the commander's persona handoff (Downloads/claude-code-handoff-copilot-personas_1.md),
//           master affinity matrix + the Minor Faction / Station Services / Body sections
//   TARS  = Downloads/copilot-persona-tars.md (single source of truth for Tycho)
//   DRAFT = new for station opinions (2026-10-28), proposed to the commander for approval — change freely
// Affinities are FLAVOUR: they colour a take, they never make the co-pilot more or less helpful.

const P = (wash, tars, k2) => ({ wash, tars, k2 });

// Economy — keyed to the station's economy MIX, weighted by share (SPEC: "keyed to the actual market
// economy weights … NOT just the nominal station type"). Colony / Service neutral by design (SPEC).
export const ECONOMY_PULL = {
  Agriculture: P(2, 0, 0),
  'High Tech': P(0, 2, 0),
  Industrial: P(0, 0, 2),
  Military: P(0, 0, 2),
  Extraction: P(1, -1, 1),
  Refinery: P(0, 1, 0),
  Tourism: P(1, 0, -2),
  Colony: P(0, 0, 0),
  Service: P(0, 0, 0),
};
// The commander, 2026-10-28: "forget those economies". A station whose MAIN economy is one of these gets
// no economy facts at all — otherwise the Industrial 0.80 still listed under a war-damaged station would
// have K2 admiring the industry of a wreck.
export const RARE_ECONOMIES = new Set(['Damaged', 'Rescue', 'Repair', 'Prison', 'Terraforming']);

// Superpower (SPEC matrix).
export const SUPERPOWER_PULL = {
  Alliance: P(2, 0, 0),
  Federation: P(-1, 2, 0),
  Empire: P(-1, 0, 1),
};

// Government of the station's owner (SPEC, Minor Faction Awareness): Wren wary of authoritarian rule,
// warm at Cooperative/Democracy; Tycho approves Democracy; K2 recognises authoritarian rule like a
// defector — familiar, not endorsing (a flavour note, so pull 0).
export const GOVERNMENT_PULL = {
  Dictatorship: P(-1, 0, 0),
  Communism: P(-1, 0, 0),
  Corporate: P(-1, 0, 0),
  Cooperative: P(1, 0, 0),
  Democracy: P(1, 1, 0),
  Anarchy: P(-1, 0, 1),
};
export const AUTHORITARIAN = new Set(['Dictatorship', 'Feudal', 'Patronage', 'Theocracy', 'Prison colony', 'Communism']);

// Owner's faction state (SPEC: K2 tactical, Wren wary, Tycho factual).
export const STATE_PULL = {
  War: P(-1, 0, 1),
  'Civil war': P(-1, 0, 1),
  CivilWar: P(-1, 0, 1),
  Outbreak: P(-1, 0, 0),
  Famine: P(-1, 0, 0),
  Lockdown: P(-1, 0, 0),
  CivilUnrest: P(-1, 0, 0),
  Boom: P(0, 0, 0),
  Election: P(0, 0, 0),
};

// The commander's standing with the owner (SPEC: Wren social warmth; the robots just note standing).
export const REPUTATION_PULL = {
  Allied: P(1, 0, 0),
  Friendly: P(1, 0, 0),
  Unfriendly: P(-1, 0, 0),
  Hostile: P(-1, 0, 0),
};

// Station services (SPEC matrix). Keys are the journal's StationServices ids, lower-cased.
export const SERVICE_PULL = {
  blackmarket: { pull: P(-1, 0, 1), label: 'a black market' },
  bartender: { pull: P(1, 0, 0), label: 'a bar' },
  materialtrader: { pull: P(0, 1, 0), label: 'a material trader' },
  techbroker: { pull: P(0, 1, 0), label: 'a technology broker' },
  exploration: { pull: P(0, 1, 0), label: 'Universal Cartographics' },
  facilitator: { pull: P(0, 0, 1), label: 'Interstellar Factors' },
};

// The world the station sits on or over (SPEC body matrix + TARS phenomena-with-history, in-world only).
export const BODY_PULL = {
  metalRich: P(0, 2, 0),
  volcanism: P(1, 0, 2),
  geysers: P(2, 0, 0),
  rareAtmosphere: P(2, 1, 0),   // oxygen / nitrogen / ammonia / helium
  sulphurDioxide: P(-2, 0, 0),  // Wren's smell quirk
  ringed: P(1, 1, 1),
  earthLike: P(1, 1, 1),
  icy: P(-1, 0, 0),
  waterWorld: P(0, -1, 0),      // TARS: wary of beautiful, lethal things
  highGravity: P(0, -1, 0),     // TARS: dread about time and cost
};
export const STAR_PULL = {
  blackHole: P(0, 0, 0),        // TARS: awe and weight, not a like/dislike — salience, not pull
  neutron: P(0, 0, 0),
  brightStar: P(-1, 0, 0),      // SPEC: Wren squints at O/B glare
};

// ── DRAFT — new for station opinions, awaiting the commander's approval ─────────────────────────────
export const SECURITY_PULL = {
  High: P(1, 0, -1),     // Wren feels safe; K2 has nothing to watch
  Medium: P(0, 0, 0),
  Low: P(-1, 0, 1),      // Wren nervous; K2 comfortable on the edge
  Anarchy: P(-1, 0, 1),  // SPEC (anarchy systems: K2 comfortable, Wren nervous)
};
export const POPULATION_PULL = {
  crowded: P(1, 0, -1),  // ≥ 1 billion — Wren likes people and noise; K2 sees a threat surface
  sparse: P(-1, 0, 1),   // < 100,000 — Wren finds it lonely; K2 finds it easy to watch
};
export const DISTANCE_PULL = {
  far: P(-1, 0, 1),      // ≥ 50,000 ls out — Wren dreads the cruise; K2 likes remote and defensible
  close: P(1, 0, 0),     // ≤ 100 ls — a short hop
};
export const PADS_PULL = {
  tight: P(-1, 0, -1),   // one pad fits the ship — queues for Wren, a chokepoint for K2
  roomy: P(1, 0, 0),     // eight or more fit — easy in
};

// Commander-history and situation pulls (SPEC: own colonies hit harder; grudges retained; DRAFT rest).
export const HISTORY_PULL = {
  builtByYou: P(1, 1, 0),
  ownColony: P(1, 1, 0),
  grudge: P(-1, -1, -1),
  turnedAway: P(-1, 0, -1),
  regular: P(1, 0, 0),
};
export const WAR_STAKE_PULL = P(-1, 0, 1);       // this very station is staked in a war
export const CONSTRUCTION_PULL = P(0, 0, -1);    // SPEC station-type lines: K2 reads a site as undefended
export const SLAVES_PULL = P(-2, -1, 0);         // existing slavery beat: Wren revolted, Tycho honest, K2 clinical

// Market garnish by commodity category — the persona's own kind of goods on the shelves (SPEC: an
// occasional real commodity as flavour, never a list).
export const GARNISH = {
  wash: /food|agricultur/i,
  tars: /technolog/i,
  k2: /machinery|industrial|weapon|military/i,
};

/** A persona's pull from one of the tables above, 0 when the table has nothing for it. */
export function pullOf(entry, persona) {
  const p = entry && (entry.pull || entry);
  const v = p && p[persona];
  return Number.isFinite(v) ? v : 0;
}
