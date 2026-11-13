// The measured-additions split (1.60.27): each facility's measured addition is its weight, their sum is
// the system's baseline, and the system's population is shared in proportion. Inventories are real.
import { describe, it, expect } from 'vitest';
import {
  populationClass, estimateFacilityPopulations, formatEstimatedPopulation, describeFacilityEstimate,
  effectiveSystemPopulation, describePopulationTrend, agoLabel, POPULATION_ADDITIONS, populationAdditionFor, rampFraction,
} from '../server/journal/populationEstimate.js';

const A = POPULATION_ADDITIONS;
const P = 196_044_357;

describe('the additions table — every figure carries its basis', () => {
  it('the measured ones say what was measured; the scaled ones say so', () => {
    expect(A.planetary_port).toMatchObject({ value: 58_400_000, n: 2, days: 12 });
    expect(A.planetary_port.basis).toMatch(/Chitty City/);
    expect(A.dodec).toMatchObject({ value: 26_500_000, n: 1 });
    expect(A.surface_outpost).toMatchObject({ value: 11_000_000, low: 9_100_000, high: 12_900_000, n: 2 });
    expect(A.orbis.n).toBe(0);
    expect(A.orbis.basis).toMatch(/Unmeasured/);
    expect(A.unit).toMatchObject({ value: 55_000, low: 37_871, high: 59_151, days: 14, n: 4 });
    expect(A.outpost_mil).toMatchObject({ value: 55_000, days: 14, n: 3 });
    expect(A.coriolis).toMatchObject({ value: 440_000, days: 14, n: 1 });
    expect(A.coriolis.basis).toMatch(/Sassoon Vision/);
    expect(A.none.value).toBe(0);
    // every entry with a figure measures the same thing: the two weeks after opening
    for (const k of ['planetary_port', 'dodec', 'surface_outpost', 'outpost_mil', 'coriolis', 'unit']) expect(A[k].days, k).toBe(k === 'planetary_port' ? 12 : 14);
  });
  it('lookup by any vocabulary', () => {
    expect(populationAdditionFor('CraterPort').value).toBe(58_400_000);
    expect(populationAdditionFor('civilian_surface_outpost').value).toBe(11_000_000);
    expect(populationAdditionFor('Planetary Outpost').value).toBe(11_000_000);
    expect(populationAdditionFor('Outpost').value).toBe(55_000);
    expect(populationAdditionFor('military_outpost').value).toBe(55_000);
    expect(populationAdditionFor('scientific_outpost').value).toBe(55_000);
    expect(populationAdditionFor('Coriolis').value).toBe(440_000);
    expect(populationAdditionFor('security_installation').value).toBe(0);
    expect(populationAdditionFor('refinery_hub').value).toBe(0);
    expect(populationAdditionFor('').value).toBe(55_000);
  });
});

describe('the trend line — how the system moved since the last dock here', () => {
  const NOW = Date.parse('2026-10-05T03:00:00Z');
  it('grown, with the age of the previous figure', () => {
    expect(describePopulationTrend({ population: 190_951_733, at: '2026-10-01T22:00:00Z' }, P, NOW))
      .toBe('\u{1F4C8} The system has grown by 5.1M since your last visit (3 days ago)');
  });
  it('shrunk', () => {
    expect(describePopulationTrend({ population: 200_000_000, at: '2026-10-04T23:00:00Z' }, P, NOW))
      .toBe('\u{1F4C9} The system has shrunk by 4.0M since your last visit (earlier today)');
  });
  it('nothing to say without a previous figure, a current reading, or any movement', () => {
    expect(describePopulationTrend(null, P, NOW)).toBeNull();
    expect(describePopulationTrend({ population: 0, at: '2026-10-01T00:00:00Z' }, P, NOW)).toBeNull();
    expect(describePopulationTrend({ population: 5, at: null }, P, NOW)).toBeNull();
    expect(describePopulationTrend({ population: P, at: '2026-10-01T00:00:00Z' }, P, NOW)).toBeNull();
    expect(describePopulationTrend({ population: 5, at: '2026-10-01T00:00:00Z' }, 0, NOW)).toBeNull();
  });
  it('ago labels', () => {
    expect(agoLabel('2026-10-05T01:00:00Z', NOW)).toBe('earlier today');
    expect(agoLabel('2026-10-03T20:00:00Z', NOW)).toBe('yesterday');
    expect(agoLabel('2026-09-28T00:00:00Z', NOW)).toBe('7 days ago');
    expect(agoLabel('2026-09-14T00:00:00Z', NOW)).toBe('3 weeks ago');
    expect(agoLabel('2026-04-29T00:00:00Z', NOW)).toBe('5 months ago');
    expect(agoLabel('2025-04-29T00:00:00Z', NOW)).toBe('over a year ago');
    expect(agoLabel('not a date', NOW)).toBeNull();
  });
});

describe('effectiveSystemPopulation — the journal reading unless the override is newer', () => {
  const known = { population: P, lastSeen: '2026-10-03T15:35:20Z' };
  it('the stale 14 September override of the home system loses to the 3 October reading', () => {
    expect(effectiveSystemPopulation(known, { population: 154_659_936, updatedAt: '2026-09-14T03:05:11Z' })).toBe(P);
  });
  it('an override newer than the reading wins', () => {
    expect(effectiveSystemPopulation(known, { population: 300_000_000, updatedAt: '2026-10-04T00:00:00Z' })).toBe(300_000_000);
  });
  it('either one alone stands; neither gives 0', () => {
    expect(effectiveSystemPopulation(known, undefined)).toBe(P);
    expect(effectiveSystemPopulation(undefined, { population: 5_000, updatedAt: '2026-01-01T00:00:00Z' })).toBe(5_000);
    expect(effectiveSystemPopulation({ population: 0, lastSeen: '2026-10-03T00:00:00Z' }, { population: 0, updatedAt: '2026-10-04T00:00:00Z' })).toBe(0);
    expect(effectiveSystemPopulation(null, null)).toBe(0);
  });
  it('an undated value loses to a dated one', () => {
    expect(effectiveSystemPopulation(known, { population: 1, updatedAt: undefined })).toBe(P);
    expect(effectiveSystemPopulation({ population: 7 }, { population: 9, updatedAt: '2026-01-01T00:00:00Z' })).toBe(9);
  });
});

describe('populationClass — one answer across the four vocabularies', () => {
  it('ports and starports', () => {
    expect(populationClass('CraterPort').cls).toBe('planetary_port');
    expect(populationClass('large_planetary_port').cls).toBe('planetary_port');
    expect(populationClass('Planetary Port').cls).toBe('planetary_port');
    expect(populationClass('Dodec').cls).toBe('dodec');
    expect(populationClass('dodec_starport').cls).toBe('dodec');
    expect(populationClass('StationDodec').cls).toBe('dodec');
    expect(populationClass('Orbis Starport').cls).toBe('orbis');
    expect(populationClass('StationONeilOrbis').cls).toBe('orbis');
    expect(populationClass('StationONeilCylinder').cls).toBe('orbis');
    expect(populationClass('Ocellus').cls).toBe('ocellus');
    expect(populationClass('StationBernalSphere').cls).toBe('ocellus');
    expect(populationClass('Bernal').cls).toBe('ocellus');
  });
  it('every surface outpost is one class whatever its economy; orbital outposts and settlements are units', () => {
    for (const t of ['civilian_surface_outpost', 'industrial_surface_outpost', 'scientific_surface_outpost', 'CraterOutpost', 'PlanetaryOutpost', 'Planetary Outpost']) {
      expect(populationClass(t), t).toEqual({ cls: 'surface_outpost', units: 1 });
    }
    for (const t of ['Outpost', 'commercial_outpost', 'industrial_outpost', 'OnFootSettlement', 'agriculture_settlement_large', 'Settlement', 'SurfaceStation']) {
      expect(populationClass(t), t).toEqual({ cls: 'unit', units: 1 });
    }
    expect(populationAdditionFor('scientific_surface_outpost').value).toBe(11_000_000);
  });
  it('military and scientific outposts carry a point; Coriolis and asteroid bases likewise', () => {
    expect(populationClass('military_outpost')).toEqual({ cls: 'outpost_mil', units: 1 });
    expect(populationClass('scientific_outpost')).toEqual({ cls: 'outpost_mil', units: 1 });
    for (const t of ['Coriolis', 'StationCoriolis', 'Coriolis Starport', 'AsteroidBase', 'asteroid_starport']) {
      expect(populationClass(t), t).toEqual({ cls: 'coriolis', units: 1 });
    }
  });
  it('installations, hubs, depots, carriers and megaships carry nothing', () => {
    for (const t of ['security_installation', 'relay_installation', 'space_farm', 'Installation', 'refinery_hub', 'industrial_hub', 'extraction_hub', 'SpaceConstructionDepot', 'PlanetaryConstructionDepot', 'FleetCarrier', 'SquadronCarrier', 'Drake-Class Carrier', 'MegaShip', 'Mega ship', 'StationMegaShip']) {
      expect(populationClass(t), t).toEqual({ cls: 'none', units: 0 });
    }
  });
  it('blank or unknown types are flagged', () => {
    expect(populationClass('')).toEqual({ cls: 'unknown', units: 1 });
    expect(populationClass('Unknown')).toEqual({ cls: 'unknown', units: 1 });
    expect(populationClass(undefined)).toEqual({ cls: 'unknown', units: 1 });
  });
});

const D952 = [
  { key: 'chiang bastion', stationType: 'Outpost' },
  { key: 'deshpande plant', stationType: 'civilian_surface_outpost' },
  { key: 'hawkins foods', stationType: 'agriculture_settlement_large' },
  { key: "thagard's progress", stationType: 'civilian_outpost' },
  { key: 'rankin legacy', stationType: 'industrial_outpost' },
  { key: "kabbah's castings", stationType: 'industrial_settlement_large' },
  { key: 'kamov hub', stationType: 'refinery_hub' },
  { key: 'atmo sky cairn asc', stationType: 'large_planetary_port' },
  { key: 'kewell range', stationType: 'civilian_surface_outpost' },
  { key: 'skov prospecting complex', stationType: 'OnFootSettlement' },
  { key: 'carrizo synthetics silo', stationType: 'OnFootSettlement' },
  { key: 'ehlinger depot', stationType: 'security_installation' },
  { key: "eberhardt's inheritance", stationType: 'relay_installation' },
  { key: 'palmisano vision', stationType: 'security_installation' },
  { key: 'wilder horizons', stationType: 'space_farm' },
  { key: 'barjavel vista', stationType: 'mining_industrial_installation' },
  { key: 'rothman gateway', stationType: 'government_installation' },
  { key: 'k8r-m2x', stationType: 'FleetCarrier' },
];
// port + two civilian surface outposts + seven outposts/settlements; Kamov Hub and the installations add nothing
const BASE_952 = A.planetary_port.value + 2 * A.surface_outpost.value + 7 * A.unit.value; // 80,785,000

describe('estimateFacilityPopulations — the home system, by measured additions', () => {
  const r = estimateFacilityPopulations(P, D952);
  it('counts the dockables with population only; the baseline is the sum of their additions', () => {
    expect(r.counted).toBe(10);
    expect(r.baseline).toBe(BASE_952);
    expect(r.baseline).toBe(80_785_000);
  });
  it('Sky Cairn takes 58.4M of 80.8M: about 142M, 72% of the system', () => {
    const sc = r.byKey['atmo sky cairn asc'];
    expect(sc.cls).toBe('planetary_port');
    expect(sc.addition).toBe(58_400_000);
    expect(sc.estimate).toBe(Math.round(P * 58_400_000 / BASE_952));
    expect(Math.round(sc.share * 100)).toBe(72);
    expect(formatEstimatedPopulation(sc.estimate)).toBe('142M');
    expect(sc.basis).toBe('adds 58M of the 81M baseline');
  });
  it('a civilian surface outpost takes 11M of the baseline, a settlement 55K — and both rise with the system', () => {
    expect(r.byKey['deshpande plant'].estimate).toBe(Math.round(P * 11_000_000 / BASE_952));
    expect(formatEstimatedPopulation(r.byKey['deshpande plant'].estimate)).toBe('27M');
    expect(r.byKey['hawkins foods'].estimate).toBe(Math.round(P * 55_000 / BASE_952));
    expect(formatEstimatedPopulation(r.byKey['hawkins foods'].estimate)).toBe('133K');
    const later = estimateFacilityPopulations(P * 2, D952);
    expect(later.byKey['deshpande plant'].estimate).toBe(Math.round(P * 2 * 11_000_000 / BASE_952));
  });
  it('installations, the hub and the carrier have no estimate and no addition', () => {
    for (const k of ['ehlinger depot', 'wilder horizons', 'rothman gateway', 'kamov hub', 'k8r-m2x']) {
      expect(r.byKey[k].estimate, k).toBeNull();
      expect(r.byKey[k].share, k).toBeNull();
      expect(r.byKey[k].addition, k).toBe(0);
    }
  });
  it('the dock-banner line is the place and its figure, nothing else', () => {
    expect(describeFacilityEstimate(r.byKey['atmo sky cairn asc'])).toBe('\u{1F465} Population ~142M (est.)');
    expect(describeFacilityEstimate(r.byKey['deshpande plant'])).toBe('\u{1F465} Population ~27M (est.)');
    expect(describeFacilityEstimate(r.byKey['ehlinger depot'])).toBeNull();
    expect(describeFacilityEstimate(undefined)).toBeNull();
  });
  it('a second planetary port doubles the port part of the baseline and the ports split equally', () => {
    const two = estimateFacilityPopulations(P, [...D952, { key: 'core boson complex', stationType: 'CraterPort' }]);
    expect(two.baseline).toBe(BASE_952 + 58_400_000);
    expect(two.byKey['atmo sky cairn asc'].estimate).toBe(two.byKey['core boson complex'].estimate);
    expect(two.byKey['deshpande plant'].estimate).toBe(Math.round(P * 11_000_000 / (BASE_952 + 58_400_000)));
  });
});

describe('estimateFacilityPopulations — other shapes', () => {
  it('HIP 52629: a planetary port beside a Coriolis, two settlements and a military outpost', () => {
    const pop = 371_551_399;
    const r = estimateFacilityPopulations(pop, [
      { key: 'kalian port', stationType: 'Coriolis' },
      { key: 'broutsos chemical', stationType: 'OnFootSettlement' },
      { key: "barbosa's industrial", stationType: 'OnFootSettlement' },
      { key: 'chitty city', stationType: 'large_planetary_port' },
      { key: "leestma's folly", stationType: 'military_outpost' },
      { key: 'tedin vision', stationType: 'relay_installation' },
    ]);
    const base = 58_400_000 + 440_000 + 2 * 55_000 + 55_000; // the Coriolis adds 0.44M, the settlements and the outpost 55K each
    expect(r.baseline).toBe(base);
    expect(r.byKey['chitty city'].estimate).toBe(Math.round(pop * 58_400_000 / base));
    expect(formatEstimatedPopulation(r.byKey['chitty city'].estimate)).toBe('368M');
    expect(r.byKey['kalian port'].estimate).toBe(Math.round(pop * 440_000 / base));
    expect(formatEstimatedPopulation(r.byKey['kalian port'].estimate)).toBe('2.8M');
  });
  it('HIP 47126: two Dodecs split equally; the civilian surface outpost outweighs the small ones', () => {
    const pop = 312_243_355;
    const r = estimateFacilityPopulations(pop, [
      { key: 'zalyotin terminal', stationType: 'commercial_outpost' },
      { key: 'cavallo nero corona', stationType: 'dodec_starport' },
      { key: 'volpe radiante horizon', stationType: 'dodec_starport' },
      { key: 'ma gateway', stationType: 'civilian_surface_outpost' },
    ]);
    const base = 2 * 26_500_000 + 11_000_000 + 55_000;
    expect(r.baseline).toBe(base);
    expect(r.byKey['cavallo nero corona'].estimate).toBe(Math.round(pop * 26_500_000 / base));
    expect(r.byKey['volpe radiante horizon'].estimate).toBe(r.byKey['cavallo nero corona'].estimate);
    expect(r.byKey['ma gateway'].estimate).toBe(Math.round(pop * 11_000_000 / base));
    expect(r.byKey['ma gateway'].estimate).toBeGreaterThan(r.byKey['zalyotin terminal'].estimate * 50);
  });
  it('a lone outpost owns the whole system, however small', () => {
    const r = estimateFacilityPopulations(456_845, [{ key: 'oefelein beacon', stationType: 'commercial_outpost' }]);
    expect(r.byKey['oefelein beacon'].estimate).toBe(456_845);
    expect(r.byKey['oefelein beacon'].share).toBe(1);
    expect(formatEstimatedPopulation(456_845)).toBe('457K');
  });
  it('two outposts share evenly; an outpost beside a port keeps 55K of 58.455M', () => {
    const noPort = estimateFacilityPopulations(100_000_000, [{ key: 'a', stationType: 'Outpost' }, { key: 'b', stationType: 'Outpost' }]);
    expect(noPort.byKey.a.estimate).toBe(50_000_000);
    expect(noPort.byKey.b.estimate).toBe(50_000_000);
    const withPort = estimateFacilityPopulations(100_000_000, [{ key: 'a', stationType: 'Outpost' }, { key: 'p', stationType: 'CraterPort' }]);
    expect(withPort.byKey.a.estimate).toBe(Math.round(100_000_000 * 55_000 / 58_455_000));
    expect(withPort.byKey.p.estimate).toBe(Math.round(100_000_000 * 58_400_000 / 58_455_000));
  });
  it('no population reading means no estimate', () => {
    const r = estimateFacilityPopulations(0, [{ key: 'a', stationType: 'Outpost' }]);
    expect(r.byKey.a.estimate).toBeNull();
    expect(r.population).toBe(0);
  });
  it('an unknown type counts as a small facility and says so', () => {
    const r = estimateFacilityPopulations(10_000_000, [{ key: 'a', stationType: 'Outpost' }, { key: 'x', stationType: '' }]);
    expect(r.byKey.x.cls).toBe('unknown');
    expect(r.byKey.x.estimate).toBe(5_000_000);
    expect(r.byKey.x.basis).toBe('adds 55K of the 110K baseline, type unknown');
  });
  it('an unmeasured starport says so', () => {
    const r = estimateFacilityPopulations(10_000_000, [{ key: 'o', stationType: 'Orbis' }]);
    expect(r.byKey.o.basis).toMatch(/unmeasured$/);
  });
  it('formatting', () => {
    expect(formatEstimatedPopulation(18_320_926_115)).toBe('18.3B');
    expect(formatEstimatedPopulation(1_900_000)).toBe('1.9M');
    expect(formatEstimatedPopulation(950)).toBe('950');
    expect(formatEstimatedPopulation(null)).toBe('—');
  });
});

describe('the opening ramp (1.60.29) — a new facility grows into its addition over the measured window', () => {
  const OPEN = '2026-10-07T04:24:13Z';               // Core Boson Complex: the first dock at the finished port
  const AT = (iso) => Date.parse(iso);
  const CBC = { key: 'core boson complex cbc', stationType: 'CraterPort', openedAt: OPEN };
  it('rampFraction: nothing on opening day, everything from day 12 (ports) or 14 (the rest); no date or no window = fully grown', () => {
    expect(rampFraction('planetary_port', OPEN, AT(OPEN))).toBe(0);
    expect(rampFraction('planetary_port', OPEN, AT('2026-10-13T04:24:13Z'))).toBeCloseTo(0.5, 9);
    expect(rampFraction('planetary_port', OPEN, AT('2026-10-19T04:24:13Z'))).toBe(1);
    expect(rampFraction('planetary_port', OPEN, AT('2026-11-01T00:00:00Z'))).toBe(1);
    expect(rampFraction('surface_outpost', OPEN, AT('2026-10-14T04:24:13Z'))).toBeCloseTo(0.5, 9);
    expect(rampFraction('unit', OPEN, AT('2026-10-14T04:24:13Z'))).toBeCloseTo(0.5, 9);
    expect(rampFraction('planetary_port', null, AT(OPEN))).toBe(1);
    expect(rampFraction('planetary_port', 'not a date', AT(OPEN))).toBe(1);
    expect(rampFraction('orbis', OPEN, AT(OPEN))).toBe(1);                              // unmeasured class: no window
    expect(rampFraction('planetary_port', OPEN, AT('2026-10-06T00:00:00Z'))).toBe(0);   // a date ahead of the clock
  });
  it('the day the port opens it weighs nothing: the baseline and everyone else stand, and the banner says so', () => {
    const before = estimateFacilityPopulations(P, D952, AT(OPEN));
    const r = estimateFacilityPopulations(P, [...D952, CBC], AT(OPEN));
    const cbc = r.byKey['core boson complex cbc'];
    expect(cbc).toMatchObject({ ramp: 0, weight: 0, addition: 58_400_000, estimate: 0, openedAt: OPEN });
    expect(cbc.basis).toBe('adds 58M of the 81M baseline, opened earlier today (0% grown)');
    expect(r.baseline).toBe(BASE_952);
    expect(r.byKey['atmo sky cairn asc'].estimate).toBe(before.byKey['atmo sky cairn asc'].estimate);
    expect(r.byKey['deshpande plant'].estimate).toBe(before.byKey['deshpande plant'].estimate);
    expect(describeFacilityEstimate(cbc, AT(OPEN))).toBe('\u{1F465} Population ~0 (est.) \u00B7 opened earlier today');
    expect(describeFacilityEstimate(r.byKey['atmo sky cairn asc'], AT(OPEN))).toBe('\u{1F465} Population ~142M (est.)');
  });
  it('six days in, half the weight; from day 12 the full port, indistinguishable from one with no date', () => {
    const half = estimateFacilityPopulations(P, [...D952, CBC], AT('2026-10-13T04:24:13Z'));
    const w = Math.round(58_400_000 * 0.5);
    expect(half.byKey['core boson complex cbc'].weight).toBe(w);
    expect(half.baseline).toBe(BASE_952 + w);
    expect(half.byKey['core boson complex cbc'].estimate).toBe(Math.round(P * w / (BASE_952 + w)));
    expect(half.byKey['core boson complex cbc'].basis).toBe('adds 58M of the 110M baseline, opened 6 days ago (50% grown)');
    expect(describeFacilityEstimate(half.byKey['core boson complex cbc'], AT('2026-10-13T04:24:13Z'))).toMatch(/^\u{1F465} Population ~\d+(\.\d)?M \(est\.\) \u00B7 opened 6 days ago$/u);
    const full = estimateFacilityPopulations(P, [...D952, CBC], AT('2026-10-20T00:00:00Z'));
    const undated = estimateFacilityPopulations(P, [...D952, { key: 'core boson complex cbc', stationType: 'CraterPort' }]);
    expect(full.byKey['core boson complex cbc']).toMatchObject({ ramp: 1, weight: 58_400_000, estimate: undated.byKey['core boson complex cbc'].estimate });
    expect(full.byKey['core boson complex cbc'].basis).toBe('adds 58M of the 139M baseline');
    expect(describeFacilityEstimate(full.byKey['core boson complex cbc'], AT('2026-10-20T00:00:00Z'))).not.toMatch(/opened/);
  });
});
