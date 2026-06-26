/**
 * Commodity build-recommender — body-buff awareness (Raven Colonial model).
 *
 * The user's case: "how do I produce Medical Diagnostic Equipment in my main
 * system?" Before this, the commodity wasn't even in the recommender. Now it
 * resolves to High-Tech, and a body with bio/geo signals should be flagged as
 * the best host (High-Tech gains +0.4 per bio/geo signal, +0.4 for ELW/WW/AW).
 */
import { describe, it, expect } from 'vitest';
import { recommendInstallationsForCommodity } from '../src/lib/commodityRecommender';
import { bodyBuffForEconomy, bestBodyBuff } from '../src/lib/bodyBuffs';

describe('bodyBuffForEconomy (Raven ±0.4 model)', () => {
  it('High-Tech gains +0.4 per bio/geo signal', () => {
    const bio = { signals: { signals: { '$SAA_SignalType_Biological;': 3 } } };
    expect(bodyBuffForEconomy('HighTech', bio).modifier).toBeCloseTo(0.4);
  });

  it('High-Tech stacks body type + bio + geo (+1.2 on an ELW with both)', () => {
    const elwBioGeo = {
      subType: 'Earth-like world',
      signals: { signals: { '$SAA_SignalType_Biological;': 2, '$SAA_SignalType_Geological;': 1 } },
    };
    expect(bodyBuffForEconomy('HighTech', elwBioGeo).modifier).toBeCloseTo(1.2);
  });

  it('Agriculture is penalised on icy bodies, rewarded on water worlds', () => {
    expect(bodyBuffForEconomy('Agriculture', { subType: 'Icy body' }).modifier).toBeCloseTo(-0.4);
    expect(bodyBuffForEconomy('Agriculture', { subType: 'Water world' }).modifier).toBeCloseTo(0.4);
  });

  it('bestBodyBuff picks the highest across the producing economies', () => {
    // Ammonia world: +0.4 for High-Tech, nothing for Refinery (no reserve data)
    expect(bestBodyBuff(['Refinery', 'HighTech'], { subType: 'Ammonia world' }).modifier).toBeCloseTo(0.4);
  });
});

describe('recommendInstallationsForCommodity — Medical Diagnostic Equipment', () => {
  const ctx = {
    systemName: 'Test System',
    bodies: [
      {
        name: 'Test 1',
        subType: 'High metal content world',
        isLandable: true,
        signals: { signals: { '$SAA_SignalType_Biological;': 4, '$SAA_SignalType_Geological;': 2 } },
      },
      { name: 'Test 2', subType: 'Icy body', isLandable: true, signals: { signals: {} } },
    ],
    stations: [],
  };

  it('is now a known commodity and resolves to High-Tech', () => {
    const r = recommendInstallationsForCommodity('Medical Diagnostic Equipment', ctx);
    expect(r).not.toBeNull();
    expect(r.commodityName).toBe('Medical Diagnostic Equipment');
    expect(r.producingEconomies).toContain('HighTech');
  });

  it('flags the bio/geo body as the best High-Tech host (buff-aware)', () => {
    const r = recommendInstallationsForCommodity('Medical Diagnostic Equipment', ctx);
    const buffedHub = r.supportingHubs.find((h) => h.bestBuffBody);
    expect(buffedHub).toBeTruthy();
    expect(buffedHub.bestBuffBody.body).toBe('Test 1');
    // bio (+0.4) + geo (+0.4)
    expect(buffedHub.bestBuffBody.buff.modifier).toBeCloseTo(0.8);
  });
});
