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
