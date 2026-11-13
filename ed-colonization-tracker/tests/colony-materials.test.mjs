// 1.63.0 — material exposure across the colony bodies (the Materials page's "Colony bodies" tab). The commander's own
// scan is the figure; Spansh fills in only where there is none and says so; a landable body with neither is listed as
// unscanned, never as zero. Synthetic state throughout.
import { describe, it, expect } from 'vitest';
import { colonyMaterialBodies, latestSurveys, tidyAtmosphere } from '../server/journal/colonyMaterials.js';

const HOME = 'Test Sector AA-A a1';
const body = (n) => `${HOME} ${n}`;
const scan = (at, name, materials, extra = {}) => ({ k: 'body', at, body: name, system: HOME, systemAddress: 1, gravity: 0.45, bodyId: 1, materials, ...extra });

const state = {
  projects: [{ systemName: HOME }],
  manualColonizedSystems: ['SPANSH ONLY', 'Nothing On File'],
  journalExplorationCache: {
    1: { systemName: HOME, scannedBodies: [
      { bodyId: 1, bodyName: body('2 b'), subType: 'High metal content world', isLandable: true, distanceToArrival: 2817.4, atmosphereType: 'Thin Oxygen' },
      { bodyId: 2, bodyName: body('3 a'), subType: 'Icy body', isLandable: true, distanceToArrival: 5000 },
      { bodyId: 3, bodyName: body('4'), subType: 'Rocky body', isLandable: true, distanceToArrival: 700 },          // landable, never surveyed
      { bodyId: 4, bodyName: body('5'), subType: 'Gas giant', isLandable: false, distanceToArrival: 900 },
    ] },
    9: { systemName: 'Somewhere Else', scannedBodies: [{ bodyId: 1, bodyName: 'Somewhere Else 1', isLandable: true }] },
  },
  scoutedSystems: {
    1: { name: HOME, cachedBodies: [
      { name: body('2 b'), isLandable: true, gravity: 0.4501, subType: 'High metal content world', distanceToArrival: 2817, materials: { Tungsten: 9.9, Iron: 20 } },
    ] },
    2: { name: 'Spansh Only', cachedBodies: [
      { name: 'Spansh Only 1', isLandable: true, gravity: 0.10780024, subType: 'Rocky body', atmosphereType: null, distanceToArrival: 5018.44, updateTime: '2026-10-01 00:00:00', materials: { Tungsten: 1.384, Iron: 18.380018, Arsenic: 0 } },
      { name: 'Spansh Only 2', isLandable: true, subType: 'Rocky body', distanceToArrival: 12 },                     // landable, no figures anywhere
      { name: 'Spansh Only 3', isLandable: false, subType: 'Gas giant', materials: { Iron: 5 } },
    ] },
  },
  knownStations: {
    10: { stationName: 'Planetary Construction Site: Core Works', stationType: 'PlanetaryConstructionDepot', systemName: HOME, body: body('2 b') },
    11: { stationName: 'Core Works', stationType: 'CraterPort', systemName: HOME, body: body('2 b') },
    12: { stationName: 'Orbital Construction Site: High Ring', stationType: 'SpaceConstructionDepot', systemName: HOME, body: body('2 b') },
    13: { stationName: 'V3C-1LK', stationType: 'FleetCarrier', systemName: HOME, body: body('2 b') },
    14: { stationName: 'Ice Camp', stationType: 'OnFootSettlement', systemName: HOME },                             // its body comes from the override
    15: { stationName: 'Far Port', stationType: 'CraterPort', systemName: 'Somewhere Else', body: 'Somewhere Else 1' },
    16: { stationName: '$EXT_PANEL_ColonisationShip; Core Escape', stationType: 'SurfaceStation', systemName: HOME, body: body('2 b') },
    17: { stationName: 'Trailblazer Dream', stationType: 'MegaShip', systemName: HOME, body: body('2 b') },
  },
  stationBodyOverrides: { [`${HOME.toLowerCase()}|ice camp`]: body('3 a') },
};
const records = [
  scan('2026-09-01T00:00:00Z', body('2 b'), { tungsten: 1.1, iron: 19 }, { planetClass: 'High metal content body', atmosphere: 'thin oxygen atmosphere' }),
  scan('2026-10-01T00:00:00Z', body('2 b'), { tungsten: 1.2, iron: 20.5 }),                                          // a later line without the class keys
  scan('2026-09-02T00:00:00Z', body('3 a'), { tungsten: 0.4, sulphur: 30 }, { gravity: 0.08, planetClass: 'Icy body', atmosphere: 'None' }),
  scan('2026-09-03T00:00:00Z', 'Somewhere Else 1', { tungsten: 3 }, { system: 'Somewhere Else' }),
  { k: 'collect', at: '2026-09-04T00:00:00Z', body: body('2 b'), system: HOME, materials: { tungsten: 2 } },       // not a survey
];
const colonies = new Set([HOME.toLowerCase(), 'spansh only', 'nothing on file']);

describe('the surface ledger read as one survey per body', () => {
  it('takes the newest materials and gravity, and the class and atmosphere from any line that has them', () => {
    const s = latestSurveys(records);
    const b = s.get(body('2 b').toLowerCase());
    expect(b.materials).toEqual({ tungsten: 1.2, iron: 20.5 });
    expect(b.at).toBe('2026-10-01T00:00:00Z');
    expect(b.planetClass).toBe('High metal content body');
    expect(b.atmosphere).toBe('thin oxygen atmosphere');
    expect(s.size).toBe(3);                                         // the collection is not a survey
  });
  it('writes the atmosphere short, an airless body as none, and nothing on file as nothing', () => {
    expect(tidyAtmosphere('thin oxygen atmosphere')).toBe('thin oxygen');
    expect(tidyAtmosphere('Thin Oxygen')).toBe('thin oxygen');
    for (const a of ['None', 'No atmosphere', 'none']) expect(tidyAtmosphere(a)).toBe('none');   // airless is a fact
    for (const a of ['', null, undefined]) expect(tidyAtmosphere(a)).toBeNull();                 // nothing on file is not
  });
});

describe('material exposure across the colony bodies', () => {
  const out = colonyMaterialBodies(state, records, colonies);
  const find = (n) => out.bodies.find((b) => b.body === n);

  it('lists only bodies in the colony systems', () => {
    expect(out.bodies.map((b) => b.body)).toEqual(['Spansh Only 1', body('2 b'), body('3 a')]); // by system, then by body
    expect(out.bodies.some((b) => b.system === 'Somewhere Else')).toBe(false);
  });

  it('uses the commander\'s own scan where there is one, whatever Spansh says', () => {
    const b = find(body('2 b'));
    expect(b).toMatchObject({ system: HOME, source: 'scan', at: '2026-10-01T00:00:00Z', gravity: 0.45, planetClass: 'High metal content body', atmosphere: 'thin oxygen', icy: false, distanceLs: 2817 });
    expect(b.materials).toEqual({ tungsten: 1.2, iron: 20.5 });      // not Spansh's 9.9
  });

  it('fills in from Spansh only where no scan exists, labelled, in the ledger\'s own ids and rounding', () => {
    const b = find('Spansh Only 1');
    expect(b).toMatchObject({ system: 'Spansh Only', source: 'spansh', at: '2026-10-01 00:00:00', gravity: 0.11, planetClass: 'Rocky body', atmosphere: null, distanceLs: 5018 });
    expect(b.materials).toEqual({ tungsten: 1.4, iron: 18.4 });      // a zero share is not carried
  });

  it('marks icy bodies, and reads an airless one as having no atmosphere', () => {
    expect(find(body('3 a'))).toMatchObject({ icy: true, atmosphere: 'none', gravity: 0.08 });
  });

  it('names the commander\'s sites at each body: no carriers, colonisation ships or megaships, a construction site and its port once, overrides honoured', () => {
    expect(find(body('2 b')).sites).toEqual(['Core Works', 'Orbital Construction Site: High Ring']);
    expect(find(body('3 a')).sites).toEqual(['Ice Camp']);
    expect(find('Spansh Only 1').sites).toEqual([]);
  });

  it('lists a landable body with no figures as unscanned, never as a row of zeros', () => {
    expect(out.unscanned).toEqual([{ system: 'Spansh Only', bodies: ['Spansh Only 2'] }, { system: HOME, bodies: [body('4')] }]);
    expect(out.bodies.some((b) => b.body === body('4') || b.body === 'Spansh Only 2' || b.body === 'Spansh Only 3')).toBe(false);
  });

  it('counts per colony system, and names the colonies with no bodies on file', () => {
    expect(out.systems).toEqual([
      { name: 'Nothing On File', bodies: 0, spansh: 0, unscanned: 0 },
      { name: 'Spansh Only', bodies: 1, spansh: 1, unscanned: 1 },
      { name: HOME, bodies: 2, spansh: 0, unscanned: 1 },
    ]);
    expect(out.empty).toEqual(['Nothing On File']);
  });

  it('matches system and body names whatever their case', () => {
    const shouted = colonyMaterialBodies(state, records.map((r) => ({ ...r, system: String(r.system).toUpperCase(), body: String(r.body).toUpperCase() })), colonies);
    expect(shouted.bodies.filter((b) => b.source === 'scan').length).toBe(2);
    expect(shouted.bodies.find((b) => b.body.toLowerCase() === body('2 b').toLowerCase())).toMatchObject({ source: 'scan', distanceLs: 2817, sites: ['Core Works', 'Orbital Construction Site: High Ring'] });
  });

  it('with nothing on file it is empty, not an error', () => {
    expect(colonyMaterialBodies({}, [], new Set())).toEqual({ systems: [], bodies: [], unscanned: [], empty: [] });
    expect(colonyMaterialBodies(null, null, null)).toEqual({ systems: [], bodies: [], unscanned: [], empty: [] });
  });
});
