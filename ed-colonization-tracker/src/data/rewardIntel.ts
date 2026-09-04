/**
 * What a reward commodity is actually FOR.
 *
 * This is the layer nothing else has. Ardent knows what a commodity SELLS for; it has no idea
 * that 25 Modular Terminals are the only thing standing between you and Marco Qwent. Price is
 * the easy half — use is the half that decides a reward screen.
 *
 * ⚠️ THIS LIST IS INTENDED TO BE COMPLETE, and that is what makes it useful.
 * Every commodity with a non-trade purpose is here: all Technology Broker recipes (sourced from
 * INARA's tech broker database) plus every engineer unlock that costs a commodity. So an item
 * NOT in this list is not "unknown" — it is a plain trade good with no special use, which is a
 * real answer worth giving. Adding a wrong entry breaks that guarantee, so only add what you
 * have a source for.
 *
 * Worked example of why it matters: a board offered 63 Nanobreakers beside 50M credits. They
 * look valuable — zero galactic stock. They are dead content, removed from engineering in 2.2,
 * and nothing anywhere needs them.
 */

/** Where the item can come from. `mission` means it cannot be bought, anywhere, ever. */
export type RewardSource = 'mission' | 'mining' | 'market' | 'rare' | 'salvage';

export interface RewardIntel {
  name: string;
  kind: 'commodity' | 'material';
  source: RewardSource;
  /** Dead content — kept explicitly, because "no known use" and "no data" are different answers. */
  dead?: { since: string; note: string };
  gate?: {
    type: 'engineer' | 'techbroker';
    /** Engineer name EXACTLY as EngineerProgress writes it, so the join works. */
    who: string;
    qty: number;
    what?: string;
  };
  note?: string;
}

export const REWARD_INTEL: RewardIntel[] = [
  // ---------------------------------------------------------------- engineer unlocks
  {
    name: 'Modular Terminals', kind: 'commodity', source: 'mission',
    gate: { type: 'engineer', who: 'Marco Qwent', qty: 25 },
    note: 'Cannot be bought anywhere. Once your own unlock is done the only value left is giving them to someone whose is not — via a carrier market.',
  },
  {
    name: 'Painite', kind: 'commodity', source: 'mining',
    gate: { type: 'engineer', who: 'Selene Jean', qty: 10 },
    note: 'Minable — no reason to spend a reward slot on it.',
  },
  {
    name: 'Bromellite', kind: 'commodity', source: 'mining',
    gate: { type: 'engineer', who: 'Bill Turner', qty: 50 },
    note: 'Minable. Also needs Selene Jean at grade 3–4 and Alioth access first.',
  },
  {
    name: 'Kongga Ale', kind: 'commodity', source: 'rare',
    gate: { type: 'engineer', who: 'Lori Jameson', qty: 25 },
    note: 'Rare good — buy at Laplace Ring, Kongga. Lori is in Shinrarta Dezhra, so an Elite rank is required to reach her.',
  },
  {
    name: 'Progenitor Cells', kind: 'commodity', source: 'market',
    gate: { type: 'engineer', who: 'Petra Olmanova', qty: 200 },
    note: 'Also gated on Expert combat rank.',
  },

  // ---------------------------------------------------------------- tech broker: guardian
  {
    name: 'Micro-Weave Cooling Hoses', kind: 'commodity', source: 'mission',
    gate: { type: 'techbroker', who: 'Technology Broker', qty: 10, what: 'Guardian Plasma Charger [Fixed Large 10 / Fixed Medium 8]' },
    note: 'Mission-only, so a squadron mate chasing the Guardian weapons cannot buy past it either.',
  },
  {
    name: 'Articulation Motors', kind: 'commodity', source: 'salvage',
    gate: { type: 'techbroker', who: 'Technology Broker', qty: 10, what: 'Guardian Plasma Charger [Turreted L 10 / M 8] · Flechette Launcher [Turreted M 10]' },
  },
  {
    name: 'Micro Controllers', kind: 'commodity', source: 'salvage',
    gate: { type: 'techbroker', who: 'Technology Broker', qty: 18, what: 'Guardian Shard Cannon [Fixed L 18 / Turreted L 12 / Turreted M 12]' },
  },
  {
    name: 'HN Shock Mount', kind: 'commodity', source: 'salvage',
    gate: { type: 'techbroker', who: 'Technology Broker', qty: 8, what: 'Guardian FSD Booster' },
  },
  {
    name: 'Reinforced Mounting Plate', kind: 'commodity', source: 'salvage',
    gate: { type: 'techbroker', who: 'Technology Broker', qty: 12, what: 'Guardian Hull Reinforcement 12 · Module Reinforcement 9' },
  },
  {
    name: 'Heatsink Interlink', kind: 'commodity', source: 'salvage',
    gate: { type: 'techbroker', who: 'Technology Broker', qty: 6, what: 'Guardian Hybrid Power Distributor' },
  },
  {
    name: 'Energy Grid Assembly', kind: 'commodity', source: 'salvage',
    gate: { type: 'techbroker', who: 'Technology Broker', qty: 10, what: 'Guardian Power Plant' },
  },
  {
    name: 'Hardware Diagnostic Sensor', kind: 'commodity', source: 'salvage',
    gate: { type: 'techbroker', who: 'Technology Broker', qty: 8, what: 'Guardian Shield Reinforcement' },
  },

  // ---------------------------------------------------------------- tech broker: human
  {
    name: 'Neofabric Insulation', kind: 'commodity', source: 'market',
    gate: { type: 'techbroker', who: 'Technology Broker', qty: 12, what: 'Corrosion Resistant Cargo Rack (with 16 Meta-Alloys + 22 Radiation Baffle)' },
    note: 'Cargo, not a ship material — it looks like one on the board. Produced by surface ports and settlements in Industrial systems, so a reward slot is convenience, not access.',
  },
  {
    name: 'Radiation Baffle', kind: 'commodity', source: 'salvage',
    gate: { type: 'techbroker', who: 'Technology Broker', qty: 22, what: 'Corrosion Resistant Cargo Rack 22 · Enzyme Missile Rack 6' },
  },
  {
    name: 'Meta-Alloys', kind: 'commodity', source: 'market',
    gate: { type: 'techbroker', who: 'Technology Broker', qty: 16, what: 'Corrosion Resistant Cargo Rack 16 · Bobblehead 10' },
  },
  {
    name: 'Power Converter', kind: 'commodity', source: 'salvage',
    gate: { type: 'techbroker', who: 'Technology Broker', qty: 8, what: 'Shock Cannon [Fixed L 8 / Fixed S 4 / Gimballed M 10]' },
  },
  {
    name: 'Ion Distributor', kind: 'commodity', source: 'salvage',
    gate: { type: 'techbroker', who: 'Technology Broker', qty: 6, what: 'Shock Cannon [Fixed M 6 / Turreted L 10 / Turreted S 4]' },
  },
  {
    name: 'Power Transfer Bus', kind: 'commodity', source: 'salvage',
    gate: { type: 'techbroker', who: 'Technology Broker', qty: 8, what: 'Shock Cannon [Turreted M 8 / Gimballed L 12 / Gimballed S 4]' },
  },
  {
    name: 'Thargoid Heart', kind: 'commodity', source: 'salvage',
    gate: { type: 'techbroker', who: 'Technology Broker', qty: 1, what: 'Bobblehead' },
  },
  {
    name: 'Thargoid Energy Cell', kind: 'commodity', source: 'salvage',
    gate: { type: 'techbroker', who: 'Technology Broker', qty: 16, what: 'Enzyme Missile Rack [Fixed Medium]' },
  },
  {
    name: 'Thargoid Organic Circuitry', kind: 'commodity', source: 'salvage',
    gate: { type: 'techbroker', who: 'Technology Broker', qty: 18, what: 'Enzyme Missile Rack [Fixed Medium]' },
  },

  // ---------------------------------------------------------------- dead content
  {
    name: 'Nanobreakers', kind: 'commodity', source: 'mission',
    dead: {
      since: 'update 2.2',
      note: 'Was an engineering component; cargo components were removed and nothing replaced them. No blueprint, no tech broker, no squadron use — sell it for the hold space.',
    },
  },
];

const BY_NAME = new Map(REWARD_INTEL.map((r) => [r.name.toLowerCase(), r]));
const loose = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const BY_LOOSE = new Map(REWARD_INTEL.map((r) => [loose(r.name), r]));

export function findRewardIntel(name: string | null | undefined): RewardIntel | undefined {
  if (!name) return undefined;
  const key = String(name).trim().toLowerCase();
  // Boards, journals and wikis disagree on hyphens and plurals ("Micro-Weave" / "Micro weave",
  // "Meta-Alloys" / "Meta Alloy"), so fall back to a punctuation-free match.
  return BY_NAME.get(key)
    || BY_LOOSE.get(loose(key))
    || BY_LOOSE.get(loose(key).replace(/s$/, ''))
    || REWARD_INTEL.find((r) => loose(r.name).replace(/s$/, '') === loose(key).replace(/s$/, ''));
}
