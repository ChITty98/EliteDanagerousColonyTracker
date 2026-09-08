// The rig allocation: four rigs on a signal, no more than three on one commodity, richest first.
// The commander's own case — "I don't think I could have woven in helium with the grandidierite
// and LTDs" — is the shape this has to get right.
import { describe, it, expect } from 'vitest';
import { allocateRigs, rigValue, MAX_RIGS_TOTAL, MAX_RIGS_PER_COMMODITY } from '../src/features/surface-mining/rigValue.ts';

const PRICES = { Grandidierite: 185000, Rhodplumsite: 171300, Iridium: 129763, Platinum: 58000, Helium: 73920, Worthless: 0 };
const priceOf = (c) => PRICES[c] ?? null;

describe('surface signal rig allocation', () => {
  it('caps a single commodity at three rigs and the signal at four', () => {
    expect(MAX_RIGS_PER_COMMODITY).toBe(3);
    expect(MAX_RIGS_TOTAL).toBe(4);
    // Four confirmed grandidierite rigs: only three can run, and the fourth slot goes elsewhere.
    const slots = allocateRigs(['Grandidierite', 'Platinum'], priceOf, (c) => (c === 'Grandidierite' ? 4 : 1));
    expect(slots).toEqual([
      { commodity: 'Grandidierite', rigs: 3, each: 185000, value: 555000 },
      { commodity: 'Platinum', rigs: 1, each: 58000, value: 58000 },
    ]);
  });

  it('leaves no room for a fourth commodity once three rigs are on the richest', () => {
    // Three grandidierite + one LTD fills the Rhino; helium never gets a rig.
    const slots = allocateRigs(['Grandidierite', 'Rhodplumsite', 'Helium'], priceOf,
      (c) => (c === 'Grandidierite' ? 3 : 1));
    expect(slots.map((s) => s.commodity)).toEqual(['Grandidierite', 'Rhodplumsite']);
    expect(slots.reduce((t, s) => t + s.rigs, 0)).toBe(4);
    expect(rigValue(['Grandidierite', 'Rhodplumsite', 'Helium'], priceOf, (c) => (c === 'Grandidierite' ? 3 : 1)))
      .toBe(3 * 185000 + 171300);
  });

  it('spreads across four commodities when none has more than one deposit', () => {
    const names = ['Grandidierite', 'Rhodplumsite', 'Iridium', 'Helium', 'Platinum'];
    const slots = allocateRigs(names, priceOf);
    expect(slots.map((s) => s.commodity)).toEqual(['Grandidierite', 'Rhodplumsite', 'Iridium', 'Helium']);
    expect(slots.every((s) => s.rigs === 1)).toBe(true);   // Platinum is the fifth-richest — no rig left
  });

  it('never spends a rig on something with no price', () => {
    const slots = allocateRigs(['Worthless', 'Platinum'], priceOf, () => 2);
    expect(slots.map((s) => s.commodity)).toEqual(['Platinum']);
    expect(slots[0].rigs).toBe(2);
  });

  it('treats an unconfirmed deposit as one rig', () => {
    expect(rigValue(['Platinum'], priceOf)).toBe(58000);
    expect(rigValue(['Platinum'], priceOf, () => null)).toBe(58000);
  });
});
