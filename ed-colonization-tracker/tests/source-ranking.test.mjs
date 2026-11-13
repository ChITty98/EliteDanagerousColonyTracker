// The needs table's source hint: sufficiency first, then the project's own system, then nearest, then large pads;
// no score floor and no distance cap. Cases from Espinoza Obligation on 2026-09-22.
import { describe, it, expect } from 'vitest';
import { rankSources } from '../src/lib/sourceRanking';

const c = (o) => ({ stationName: 'x', systemName: 'Col 173 Sector AX-J d9-52', hasLargePads: false, isPlanetary: false, stock: 0, buyPrice: 1000, lastSeen: '2026-09-23T04:01:30Z', distanceLy: 0, sameSystem: true, ...o });

describe('source ranking — sufficiency first', () => {
  it('a far station that covers the need outranks the same-system outpost holding a token amount, which stays as the in-system note', () => {
    const thagard = c({ stationName: "Thagard's Progress", stock: 39 });
    const ma = c({ stationName: 'Ma Gateway', systemName: 'HIP 47126', stock: 4207, distanceLy: 103, sameSystem: false });
    const pick = rankSources([thagard, ma], 684);
    expect(pick.best.stationName).toBe('Ma Gateway');
    expect(pick.covers).toBe(true);
    expect(pick.local.stationName).toBe("Thagard's Progress");
  });

  it('among stations that cover it: same system first, then nearest, then large pads', () => {
    const oefelein = c({ stationName: 'Oefelein Beacon', systemName: 'Col 173 Sector YI-V c17-34', stock: 1262, distanceLy: 14, sameSystem: false });
    const cavallo = c({ stationName: 'Cavallo Nero Corona', systemName: 'HIP 47126', stock: 40264, distanceLy: 103, sameSystem: false, hasLargePads: true });
    expect(rankSources([cavallo, oefelein], 192).best.stationName).toBe('Oefelein Beacon');
    const local = c({ stationName: 'Local Dock', stock: 500 });
    const pick = rankSources([cavallo, oefelein, local], 192);
    expect(pick.best.stationName).toBe('Local Dock');
    expect(pick.local).toBeNull();
    const twinM = c({ stationName: 'Twin M', systemName: 'Elsewhere', stock: 300, distanceLy: 20, sameSystem: false });
    const twinL = c({ stationName: 'Twin L', systemName: 'Elsewhere', stock: 300, distanceLy: 20, sameSystem: false, hasLargePads: true });
    expect(rankSources([twinM, twinL], 192).best.stationName).toBe('Twin L');
  });

  it('when nothing covers the need, the largest stock leads and the shortfall is flagged', () => {
    const rankin = c({ stationName: 'Rankin Legacy', stock: 27 });
    const far = c({ stationName: 'Far Outpost', systemName: 'Elsewhere', stock: 900, distanceLy: 250, sameSystem: false });
    const pick = rankSources([rankin, far], 2634);
    expect(pick.best.stationName).toBe('Far Outpost');
    expect(pick.covers).toBe(false);
    expect(pick.local.stationName).toBe('Rankin Legacy');
  });

  it('no distance cap and no score floor: a lone stocked station 820 ly out is still the source; nothing stocked is no source', () => {
    const akhenaten = c({ stationName: 'Akhenaten Survey', systemName: 'Antliae Sector KM-V b2-4', stock: 799, distanceLy: 820, sameSystem: false });
    expect(rankSources([akhenaten], 192).best.stationName).toBe('Akhenaten Survey');
    expect(rankSources([c({ stock: 0 }), c({ stock: 5, buyPrice: 0 })], 10)).toBeNull();
    expect(rankSources([akhenaten], 0)).toBeNull();
  });
});

describe('source ranking — starred factions (1.60.32)', () => {
  const thagard = c({ stationName: "Thagard's Progress", stock: 63892, buyPrice: 4145, faction: 'Order of Copernicus' });
  const kewell = c({ stationName: 'Kewell Range', stock: 655363, buyPrice: 3709, faction: 'The 9th Legion', hasLargePads: true });
  const deshpande = c({ stationName: 'Deshpande Plant', stock: 1021043, buyPrice: 2140, faction: 'HIP 104349 Ring', hasLargePads: true });
  it('without stars the plain ranking stands and nothing is marked preferred', () => {
    const pick = rankSources([thagard, kewell, deshpande], 3084);
    expect(pick.best.stationName).toBe('Deshpande Plant'); // all cover it, same system, large pads: most stock wins
    expect(pick.preferred).toBe(false);
    expect(pick.fallback).toBeNull();
  });
  it("a starred faction's in-system station is the pick, the plain pick becomes the fallback", () => {
    const pick = rankSources([thagard, kewell, deshpande], 3084, { preferredFactions: ['Order of Copernicus'] });
    expect(pick.best.stationName).toBe("Thagard's Progress");
    expect(pick.preferred).toBe(true);
    expect(pick.covers).toBe(true);
    expect(pick.fallback.stationName).toBe('Deshpande Plant');
  });
  it('the starred station is kept even when it falls short, flagged by covers=false', () => {
    const pick = rankSources([c({ ...thagard, stock: 1859 }), kewell], 3084, { preferredFactions: ['Order of Copernicus'] });
    expect(pick.best.stationName).toBe("Thagard's Progress");
    expect(pick.covers).toBe(false);
    expect(pick.fallback.stationName).toBe('Kewell Range');
  });
  it('a starred faction with no stocked station here falls through to the next star, then to the plain pick', () => {
    const pick = rankSources([kewell, c({ ...deshpande, stock: 5000 })], 3084, { preferredFactions: ['Order of Copernicus', 'HIP 104349 Ring'] });
    expect(pick.best.stationName).toBe('Deshpande Plant');
    expect(pick.preferred).toBe(true);
    const none = rankSources([kewell], 3084, { preferredFactions: ['Order of Copernicus'] });
    expect(none.best.stationName).toBe('Kewell Range');
    expect(none.preferred).toBe(false);
  });
  it('a star only reaches stations in the project\'s own system', () => {
    const far = c({ stationName: 'Order Depot Far Away', systemName: 'HIP 47126', sameSystem: false, distanceLy: 103, stock: 90000, faction: 'Order of Copernicus' });
    const pick = rankSources([far, kewell], 3084, { preferredFactions: ['Order of Copernicus'] });
    expect(pick.best.stationName).toBe('Kewell Range');
    expect(pick.preferred).toBe(false);
  });
  it('when the starred station is also the plain pick nothing is flagged', () => {
    const pick = rankSources([thagard], 3084, { preferredFactions: ['Order of Copernicus'] });
    expect(pick.best.stationName).toBe("Thagard's Progress");
    expect(pick.preferred).toBe(false);
    expect(pick.fallback).toBeNull();
  });
});
