// The Commander's Log extractor: weights from journal facts, sittings from LoadGame/Shutdown
// (or silence), touchdowns rated by what the body is, photos counted from the gallery key,
// deaths joined to their rebuy. Fixture journal in a temp dir; nothing live is read.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readJournalEvents, buildCommanderLog, searchCommanderLog, sittingSummary, sittingWhere, RANKS } from '../server/journal/commanderLog.js';

const line = (o) => JSON.stringify(o) + '\n';
const T = (h, m = 0, s = 0) => `2026-09-01T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}Z`;
let dir; let log;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edca-clog-'));
  const jumps = [];
  for (let i = 0; i < 85; i++) jumps.push({ timestamp: `2026-09-02T${String(Math.floor(i / 6)).padStart(2, '0')}:${String((i % 6) * 10).padStart(2, '0')}:00Z`, event: 'FSDJump', StarSystem: `Hop ${i}`, JumpDist: 40 });
  fs.writeFileSync(path.join(dir, 'Journal.2026-09-01T000000.01.log'), [
    { timestamp: T(0), event: 'LoadGame', Ship: 'Krait_Light', Ship_Localised: 'Krait Phantom', ShipName: 'Wren' },
    { timestamp: T(0, 1), event: 'Location', StarSystem: 'Alpha', Docked: true, StationName: 'Alpha Hub' },
    { timestamp: T(0, 5), event: 'ShipyardNew', ShipType: 'mandalay', ShipType_Localised: 'Mandalay', NewShipID: 9 },
    { timestamp: T(0, 6), event: 'Loadout', Ship: 'mandalay', Ship_Localised: 'Mandalay', ShipName: 'Sparrow' },
    { timestamp: T(0, 10), event: 'Promotion', Explore: 5 },
    { timestamp: T(0, 20), event: 'FSDJump', StarSystem: 'Beta', JumpDist: 30 },
    { timestamp: T(0, 25), event: 'Scan', BodyName: 'Beta 2', StarSystem: 'Beta', PlanetClass: 'Water world', TerraformState: 'Terraformable', WasDiscovered: false, Landable: false, SurfaceGravity: 9.8 },
    { timestamp: T(0, 26), event: 'Scan', BodyName: 'Beta 3 a', StarSystem: 'Beta', PlanetClass: 'High metal content body', Atmosphere: 'thin oxygen atmosphere', WasDiscovered: false, Landable: true, SurfaceGravity: 4.9, Rings: [{ Name: 'Beta 3 a A Ring' }] },
    { timestamp: T(0, 26, 30), event: 'Scan', BodyName: 'Beta 2', StarSystem: 'Beta', PlanetClass: 'Water world', TerraformState: 'Terraformable', WasDiscovered: false, ScanType: 'Detailed' }, // the game scans twice — one entry
    { timestamp: T(0, 27), event: 'Scan', BodyName: 'Beta 4', StarSystem: 'Beta', PlanetClass: 'Rocky body', Atmosphere: 'thin carbon dioxide atmosphere', WasDiscovered: false, Landable: true, SurfaceGravity: 2.0 },
    { timestamp: T(0, 40), event: 'Touchdown', PlayerControlled: true, StarSystem: 'Beta', Body: 'Beta 3 a', BodyID: 7, OnStation: false, OnPlanet: true, Latitude: 10, Longitude: 20 },
    { timestamp: T(0, 50), event: 'Touchdown', PlayerControlled: true, StarSystem: 'Beta', Body: 'Beta 4', OnStation: false, OnPlanet: true, Latitude: 1, Longitude: 2 },
    { timestamp: T(0, 55), event: 'Touchdown', PlayerControlled: true, StarSystem: 'Beta', Body: 'Beta 4', OnStation: false, OnPlanet: true, Latitude: 1, Longitude: 3 },
    { timestamp: T(1, 0), event: 'CodexEntry', Name_Localised: 'Roseum Brain Tree', System: 'Beta', IsNewEntry: true },
    { timestamp: T(1, 5), event: 'WingAdd', Name: 'Cavallo Nero' },
    ...Array.from({ length: 12 }, (_, i) => ({ timestamp: T(1, 10 + i), event: 'Bounty', Rewards: [{ Faction: 'F', Reward: 100000 }], TotalReward: 100000 })),
    { timestamp: T(1, 30), event: 'Cargo', Vessel: 'Ship', Count: 120, Inventory: [] },
    { timestamp: T(2, 0), event: 'Died' },
    { timestamp: T(2, 1), event: 'Resurrect', Option: 'rebuy', Cost: 4200000, Bankrupt: false },
    // The game wrote a second Died ten minutes later — noise, not a second event.
    { timestamp: T(2, 10), event: 'Died' },
    { timestamp: T(2, 11), event: 'Resurrect', Option: 'rebuy', Cost: 4200000, Bankrupt: false },
    { timestamp: T(2, 30), event: 'ColonisationSystemClaim', StarSystem: 'Beta' },
    { timestamp: T(3, 0), event: 'Shutdown' },
    // Second sitting: the long haul, ended by silence (no Shutdown), then a third with the engineer snapshot logic.
    { timestamp: '2026-09-02T00:00:00Z', event: 'LoadGame', Ship: 'mandalay', Ship_Localised: 'Mandalay' },
    ...jumps,
    { timestamp: '2026-09-03T12:00:00Z', event: 'LoadGame', Ship: 'mandalay', Ship_Localised: 'Mandalay' },
    { timestamp: '2026-09-03T12:00:05Z', event: 'EngineerProgress', Engineers: [{ Engineer: 'Tod McQuinn', Progress: 'Unlocked', Rank: 5 }, { Engineer: 'Selene Jean', Progress: 'Invited' }] },
    { timestamp: '2026-09-03T12:10:00Z', event: 'EngineerProgress', Engineer: 'Selene Jean', EngineerID: 1, Progress: 'Unlocked', Rank: 1, RankProgress: 0 },
    { timestamp: '2026-09-03T12:20:00Z', event: 'Shutdown' },
  ].map(line).join(''));
  const events = readJournalEvents(dir);
  const state = {
    sightings: { s1: { bodyName: 'Beta 3 a', tags: ['terrain', 'sky'], galleryKey: 'system:beta:body:beta 3 a' } },
    scoutedSystems: [{ name: 'Gamma', score: { atmospherePoints: 60, exoticPoints: 40, ringPoints: 25 }, scoutedAt: '2026-08-30T10:00:00Z', isColonised: false }, { name: 'Delta', score: { atmospherePoints: 10 }, scoutedAt: '2026-08-30T11:00:00Z' }],
  };
  const gallery = { 'system:beta:body:beta 3 a': [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };
  log = buildCommanderLog({ events, state, gallery });
});
afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ } });

const byKind = (k) => log.events.filter((e) => e.kind === k);

describe("commander's log extractor", () => {
  it('weights the big things the way the commander ranked them', () => {
    expect(byKind('claim')[0]).toMatchObject({ weight: 'huge', line: 'Claimed Beta' });
    expect(byKind('ship_new')[0]).toMatchObject({ weight: 'major', line: 'New ship: Mandalay at Alpha Hub' });
    expect(byKind('promotion')[0]).toMatchObject({ weight: 'major', line: 'Promoted: Explore Pathfinder' });
    expect(RANKS.Combat[8]).toBe('Elite');
    expect(byKind('death').length).toBe(1); // the second Died the same day is folded away
    const death = byKind('death')[0];
    expect(death.weight).toBe('major');
    expect(death.line).toBe('Died at Beta · Beta 4 in the Mandalay "Sparrow" · rebuy 4.2M cr'); // no manifest of what was lost
    expect(log.sittings.find((s) => s.startedAt === T(0)).ship).toBe('Mandalay "Sparrow"'); // the Loadout after the purchase renamed the sitting's ship
  });

  it('rates a first discovery by class and a touchdown by what the body is, with photos counted', () => {
    const d = byKind('discovery');
    expect(d.length).toBe(1); // one entry per system per sitting, every body named, the second scan of Beta 2 not counted twice
    expect(d[0].weight).toBe('major'); // a terraformable water world is among them
    expect(d[0].line).toBe('First discoveries in Beta: 2 water world, terraformable; 3 a HMC, thin oxygen; 4 rocky, thin carbon dioxide');
    const t = byKind('touchdown').sort((a, b) => (a.at < b.at ? -1 : 1));
    expect(t[0]).toMatchObject({ weight: 'major', body: 'Beta 3 a', photos: 3, first: true });
    expect(t[0].line).toBe('Landed on Beta 3 a · High metal content body, thin oxygen atmosphere, 0.50 g · oxygen atmosphere, rings, a sighting (terrain, sky), first discovered by you · 3 photos');
    expect(t[1]).toMatchObject({ weight: 'notable', body: 'Beta 4', first: true });   // a CO2 rock you first discovered: named, not major
    expect(t[1].line).toContain('first discovered by you');
    // Setting down on Beta 4 again five minutes later is repositioning, not an event.
    expect(t.length).toBe(2);
  });

  it('decides sitting-level events once the sitting is complete', () => {
    // Who you flew with belongs on the sitting, not in an entry of its own.
    expect(byKind('wing')).toEqual([]);
    expect(log.sittings.find((s) => s.startedAt === T(0)).wing).toEqual(['Cavallo Nero']);
    expect(byKind('bounty_night')[0].line).toBe('Bounty night at Beta: 12 bounties, 1.2M cr, largest 100k');
    expect(byKind('codex_first')[0].line).toBe('Codex first: Roseum Brain Tree (Beta)');
    const haul = byKind('long_haul')[0];
    expect(haul.line).toBe('85 jumps, 3,400 ly: Beta → Hop 84'); // a run of jumps: from where the run began
    const sittings = log.sittings.slice().sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1));
    expect(sittings.length).toBe(3);
    expect(sittings[0].endReason).toBe('shutdown');
    expect(sittings[1].endReason).toBe('relog');       // the haul had no Shutdown — closed by the next LoadGame
    expect(sittings[1].jumps).toBe(85);
    expect(sittingSummary(sittings[0])).toBe('1 jump, 30 ly · 1 system · 3 landings · 3 bodies scanned (3 first)'); // Beta 2 scanned twice counts once
  });

  it('a haul survives a relog but not a real break', () => {
    const line = (o) => JSON.stringify(o) + '\n';
    const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'edca-clog-haul-'));
    const ev = [{ timestamp: '2026-09-05T00:00:00Z', event: 'LoadGame', Ship: 'mandalay', Ship_Localised: 'Mandalay' }, { timestamp: '2026-09-05T00:00:05Z', event: 'Location', StarSystem: 'Start' }];
    for (let i = 0; i < 12; i++) ev.push({ timestamp: `2026-09-05T00:${String(5 + i * 4).padStart(2, '0')}:00Z`, event: 'FSDJump', StarSystem: `A${i}`, JumpDist: 50 });
    // The game hung on a jump: relog, then keep going within the gap.
    ev.push({ timestamp: '2026-09-05T00:55:00Z', event: 'LoadGame', Ship: 'mandalay', Ship_Localised: 'Mandalay' });
    for (let i = 0; i < 10; i++) ev.push({ timestamp: `2026-09-05T01:${String(i * 4).padStart(2, '0')}:00Z`, event: 'FSDJump', StarSystem: `B${i}`, JumpDist: 50 });
    // A real break: three hours, then a few more jumps that do not belong to the haul.
    for (let i = 0; i < 5; i++) ev.push({ timestamp: `2026-09-05T04:${String(i * 4).padStart(2, '0')}:00Z`, event: 'FSDJump', StarSystem: `C${i}`, JumpDist: 50 });
    ev.push({ timestamp: '2026-09-05T04:30:00Z', event: 'Shutdown' });
    fs.writeFileSync(path.join(d2, 'Journal.2026-09-05T000000.01.log'), ev.map(line).join(''));
    const l2 = buildCommanderLog({ events: readJournalEvents(d2) });
    const hauls = l2.events.filter((e) => e.kind === 'long_haul');
    expect(hauls.map((h) => h.line)).toEqual(['22 jumps, 1,100 ly: Start → B9']);
    // ...and it is filed under the sitting it started in, not the one it ended in.
    const first = l2.sittings.slice().sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1))[0];
    expect(first.events.some((e) => e.kind === 'long_haul')).toBe(true);
    fs.rmSync(d2, { recursive: true, force: true });
  });

  it('says what the app knows and the journal cannot: which ring, which signal, and where the sitting was', () => {
    const rocks = [
      { t: '2026-09-01T01:00:00Z', lastT: '2026-09-01T01:02:00Z', sys: 'Beta', ring: 'Beta 5 A Ring', got: { bromellite: 20, tritium: 4 }, gotTotal: 24 },
      { t: '2026-09-01T01:20:00Z', lastT: '2026-09-01T01:22:00Z', sys: 'Beta', ring: 'Beta 5 A Ring', got: { bromellite: 16 }, gotTotal: 16 },
      { t: '2026-09-01T09:00:00Z', lastT: '2026-09-01T09:01:00Z', sys: 'Beta', ring: 'Beta 5 A Ring', got: { tritium: 9 }, gotTotal: 9 }, // hours later — its own session
    ];
    const visits = [
      { at: '2026-09-01T01:40:00Z', body: 'Beta 3 a', system: 'Beta', siteIndex: 12, tonnes: 88, commodities: { Iridium: 44, Rhodplumsite: 44 }, tph: 125 },
      { at: '2026-09-01T02:40:00Z', body: 'Beta 3 a', system: 'Beta', siteIndex: 7, tonnes: 0, commodities: {} }, // nothing pulled — no entry
    ];
    const l2 = buildCommanderLog({ events: readJournalEvents(dir), rocks, surfaceVisits: visits });
    expect(l2.events.filter((e) => e.kind === 'ring_mining').map((e) => e.line)).toEqual([
      'Mined Beta 5 A Ring: 9 t — Tritium 9 · 1 rocks',
      'Mined Beta 5 A Ring: 40 t — Bromellite 36, Tritium 4 · 2 rocks',
    ]);
    expect(l2.events.filter((e) => e.kind === 'surface_mining').map((e) => e.line)).toEqual([
      'Mined Signal 12 on 3 a: 88 t — Iridium 44, Rhodplumsite 44 · 125 t/h',
    ]);
    const s = l2.sittings.find((x) => x.startedAt === T(0));
    expect(sittingWhere(s)).toBe('Alpha → Beta');            // started docked at Alpha, ended at Beta
    expect(s.events.some((e) => e.kind === 'ring_mining')).toBe(true); // filed under the sitting it happened in
    const haul = l2.sittings.find((x) => x.jumps === 85);
    expect(sittingWhere(haul)).toBe('Beta → Hop 84');         // a run says both ends
  });

  it('treats the first engineer snapshot as the baseline and only a change as news', () => {
    expect(byKind('engineer').map((e) => e.line)).toEqual(['Unlocked Selene Jean']);
  });

  it('brings in the app\'s own high-scoring scouts and nothing below the bar', () => {
    expect(byKind('scouted').map((e) => e.line)).toEqual(['Scouted Gamma: 125 on your scale']);
  });

  it('lists newest first', () => {
    const ats = log.events.map((e) => e.at);
    expect([...ats].sort().reverse()).toEqual(ats);
  });

  it('keeps deposit documentation out of the photo strips', () => {
    const g = {
      'system:beta:body:beta 3 a': [
        { id: 'a', caption: '20260501221448_1', addedAt: '2026-09-01T00:41:00Z' },   // a postcard
        { id: 'b', caption: 'Screenshot_0025.bmp', addedAt: '2026-09-01T00:42:00Z' }, // an F10 HUD panel
        { id: 'c', caption: 'Screenshot_0026.bmp', utility: true },                   // already flagged
      ],
    };
    const l2 = buildCommanderLog({ events: readJournalEvents(dir), gallery: g, depotShots: new Set(['screenshot_0025.bmp']) });
    const t = l2.events.filter((e) => e.kind === 'touchdown' && e.body === 'Beta 3 a')[0];
    expect(t.photoItems.map((p) => p.id)).toEqual(['a']);
    expect(t.photos).toBe(1); // and the count agrees with the strip
  });

  it('gives a finished build its station photos and settles its type from the dossier', () => {
    const state2 = {
      // The orbital site's depot id (1) is NOT the finished station's id (2) — only the name joins them.
      projects: [{ id: 'p1', status: 'completed', completedAt: '2026-08-20T06:10:39Z', systemName: 'Beta', marketId: 1,
        stationName: 'Orbital Construction Site: Vista', completedStationType: 'SpaceConstructionDepot' }],
      knownStations: { s: { marketId: 2, systemName: 'Beta', stationName: 'Vista', stationType: 'dodec_starport' } },
    };
    const g = { 'system:beta:station:vista': [{ id: 'v1', caption: 'shot.jpg' }, { id: 'v2', caption: 'shot2.jpg' }] };
    const b = buildCommanderLog({ events: readJournalEvents(dir), state: state2, gallery: g }).events.filter((e) => e.kind === 'built');
    expect(b.length).toBe(1);
    // The raw type rides along; whether a dodec is a SHOWPIECE is the commander's Domain Highlights
    // setting, decided on the page with the same table the Domain page uses — not a second one here.
    expect(b[0]).toMatchObject({ weight: 'major', stationType: 'dodec_starport', station: 'Vista', photos: 2 });
    expect(b[0].line).toBe('Built Vista · Dodec Starport · Beta');
  });

  it('says a loop of jumps was a loop, and how far out it went', () => {
    const l = (o) => JSON.stringify(o) + '\n';
    const d3 = fs.mkdtempSync(path.join(os.tmpdir(), 'edca-clog-loop-'));
    const ev = [{ timestamp: '2026-09-06T00:00:00Z', event: 'LoadGame', Ship: 'mandalay', Ship_Localised: 'Mandalay' },
      { timestamp: '2026-09-06T00:00:05Z', event: 'Location', StarSystem: 'Home' }];
    // Out to Far and back to Home, 20 jumps in all — the run starts and ends in the same place.
    for (let i = 0; i < 19; i++) {
      ev.push({ timestamp: `2026-09-06T00:${String(5 + i * 2).padStart(2, '0')}:00Z`, event: 'FSDJump',
        StarSystem: i === 9 ? 'Far' : `Hop ${i}`, JumpDist: 20, StarPos: [i === 9 ? 100 : i * 2, 0, 0] });
    }
    ev.push({ timestamp: '2026-09-06T00:45:00Z', event: 'FSDJump', StarSystem: 'Home', JumpDist: 20, StarPos: [0, 0, 0] });
    ev.push({ timestamp: '2026-09-06T01:00:00Z', event: 'Shutdown' });
    fs.writeFileSync(path.join(d3, 'Journal.2026-09-06T000000.01.log'), ev.map(l).join(''));
    const hauls = buildCommanderLog({ events: readJournalEvents(d3) }).events.filter((e) => e.kind === 'long_haul');
    expect(hauls.map((h) => h.line)).toEqual(['20 jumps, 400 ly around Home, out to Far (100 ly)']);
    fs.rmSync(d3, { recursive: true, force: true });
  });

  it('does not claim a first discovery for a body somebody else already mapped', () => {
    const l = (o) => JSON.stringify(o) + '\n';
    const d4 = fs.mkdtempSync(path.join(os.tmpdir(), 'edca-clog-disc-'));
    fs.writeFileSync(path.join(d4, 'Journal.2026-09-07T000000.01.log'), [
      { timestamp: '2026-09-07T00:00:00Z', event: 'LoadGame', Ship: 'mandalay', Ship_Localised: 'Mandalay' },
      { timestamp: '2026-09-07T00:01:00Z', event: 'Location', StarSystem: 'Populated' },
      // WasDiscovered:false alongside WasMapped:true is contradictory — mapping needs discovery first.
      { timestamp: '2026-09-07T00:02:00Z', event: 'Scan', BodyName: 'Populated 2', StarSystem: 'Populated', PlanetClass: 'Sudarsky class I gas giant', WasDiscovered: false, WasMapped: true },
      { timestamp: '2026-09-07T00:03:00Z', event: 'Scan', BodyName: 'Populated 3', StarSystem: 'Populated', PlanetClass: 'High metal content body', WasDiscovered: false, WasMapped: false },
      { timestamp: '2026-09-07T00:30:00Z', event: 'Shutdown' },
    ].map(l).join(''));
    const d = buildCommanderLog({ events: readJournalEvents(d4) }).events.filter((e) => e.kind === 'discovery');
    expect(d.map((e) => e.line)).toEqual(['First discoveries in Populated: 3 HMC']);
    fs.rmSync(d4, { recursive: true, force: true });
  });

  it('shows a build under the name its market id carries now, across a new id at completion', () => {
    const l = (o) => JSON.stringify(o) + '\n';
    const d6 = fs.mkdtempSync(path.join(os.tmpdir(), 'edca-clog-name-'));
    fs.writeFileSync(path.join(d6, 'Journal.2026-09-10T000000.01.log'), [
      { timestamp: '2026-09-10T00:00:00Z', event: 'LoadGame', Ship: 'mandalay', Ship_Localised: 'Mandalay' },
      { timestamp: '2026-09-10T00:01:00Z', event: 'Location', StarSystem: 'Home' },
      // PLANETARY: the id survives completion, so the later name on that id is the answer.
      { timestamp: '2026-09-10T00:05:00Z', event: 'Docked', MarketID: 11, StarSystem: 'Home', StationName: 'Planetary Construction Site: Old Rock', StationType: 'PlanetaryConstructionDepot' },
      { timestamp: '2026-09-10T00:06:00Z', event: 'ColonisationConstructionDepot', MarketID: 11, ConstructionComplete: true },
      { timestamp: '2026-09-10T00:20:00Z', event: 'Docked', MarketID: 11, StarSystem: 'Home', StationName: 'New Rock', StationType: 'CraterPort' },
      // ORBITAL: the finished station is a DIFFERENT id whose first name is the site's name.
      { timestamp: '2026-09-10T00:30:00Z', event: 'Docked', MarketID: 22, StarSystem: 'Home', StationName: 'Orbital Construction Site: Working Title', StationType: 'SpaceConstructionDepot' },
      { timestamp: '2026-09-10T00:31:00Z', event: 'ColonisationConstructionDepot', MarketID: 22, ConstructionComplete: true },
      { timestamp: '2026-09-10T00:40:00Z', event: 'Docked', MarketID: 33, StarSystem: 'Home', StationName: 'Working Title', StationType: 'SurfaceStation' },
      { timestamp: '2026-09-10T00:50:00Z', event: 'Docked', MarketID: 33, StarSystem: 'Home', StationName: 'Final Name', StationType: 'Dodec' },
      { timestamp: '2026-09-10T01:00:00Z', event: 'Shutdown' },
    ].map(l).join(''));
    const b = buildCommanderLog({ events: readJournalEvents(d6) }).events
      .filter((e) => e.kind === 'built').sort((x, y) => x.at.localeCompare(y.at));
    expect(b.map((e) => e.line)).toEqual([
      'Built New Rock · Crater Port · Home (was Old Rock)',
      'Built Final Name · Dodec · Home (was Working Title)',
    ]);
    // The type and photos belong to the id that ended up carrying the station, not to the depot.
    expect(b[1].refs[0]).toMatchObject({ marketId: 22, stationMarketId: 33 });
    fs.rmSync(d6, { recursive: true, force: true });
  });

  it('folds a night of missions into one line and names the payout worth remembering', () => {
    const l = (o) => JSON.stringify(o) + '\n';
    const d5 = fs.mkdtempSync(path.join(os.tmpdir(), 'edca-clog-mis-'));
    fs.writeFileSync(path.join(d5, 'Journal.2026-09-08T000000.01.log'), [
      { timestamp: '2026-09-08T00:00:00Z', event: 'LoadGame', Ship: 'mandalay', Ship_Localised: 'Mandalay' },
      { timestamp: '2026-09-08T00:01:00Z', event: 'Location', StarSystem: 'Rich' },
      { timestamp: '2026-09-08T00:10:00Z', event: 'MissionCompleted', Name: 'Mission_Mining_name', LocalisedName: 'Mine 440 Units of Silver', Reward: 50000000, Faction: 'F' },
      { timestamp: '2026-09-08T00:20:00Z', event: 'MissionCompleted', Name: 'Mission_Courier_name', LocalisedName: 'Deliver a package', Reward: 200000, Faction: 'F' },
      // A donation pays nothing and costs credits — it bought rank, and the line must say so.
      { timestamp: '2026-09-08T00:25:00Z', event: 'MissionCompleted', Name: 'Mission_AltruismCredits_name', LocalisedName: 'Donate 5,000,000 credits', Reward: 0, Donated: 5000000, Faction: 'F' },
      { timestamp: '2026-09-08T00:30:00Z', event: 'MissionFailed', Name: 'Mission_Massacre_name' },
      { timestamp: '2026-09-08T01:00:00Z', event: 'Shutdown' },
      // A second sitting with one small job: still an entry, but a routine one.
      { timestamp: '2026-09-09T00:00:00Z', event: 'LoadGame', Ship: 'mandalay', Ship_Localised: 'Mandalay' },
      { timestamp: '2026-09-09T00:01:00Z', event: 'Location', StarSystem: 'Quiet' },
      { timestamp: '2026-09-09T00:10:00Z', event: 'MissionCompleted', Name: 'Mission_Courier_name', LocalisedName: 'Deliver a package', Reward: 12000, Faction: 'F' },
      { timestamp: '2026-09-09T00:30:00Z', event: 'Shutdown' },
    ].map(l).join(''));
    const m = buildCommanderLog({ events: readJournalEvents(d5) }).events.filter((e) => e.kind === 'missions');
    expect(m.map((e) => e.line)).toEqual([
      'Missions at Quiet: 1 mission, 12k cr, Deliver a package',
      'Missions at Rich: 3 missions, 50.2M cr, 5.0M cr donated, biggest 50.0M: Mine 440 Units of Silver, 1 failed',
    ]);
    expect(m.map((e) => e.weight)).toEqual(['routine', 'major']);
    expect(m[1]).toMatchObject({ count: 3, cr: 50200000 });
    fs.rmSync(d5, { recursive: true, force: true });
  });

  it('logs the first time each surface vehicle is taken out, resolving an untyped launch to the Scarab', () => {
    const l = (o) => JSON.stringify(o) + String.fromCharCode(10);
    const d7 = fs.mkdtempSync(path.join(os.tmpdir(), 'edca-clog-srv-'));
    fs.writeFileSync(path.join(d7, 'Journal.2026-09-11T000000.01.log'), [
      { timestamp: '2026-09-11T00:00:00Z', event: 'LoadGame', Ship: 'mandalay', Ship_Localised: 'Mandalay' },
      { timestamp: '2026-09-11T00:01:00Z', event: 'Location', StarSystem: 'Rocky' },
      { timestamp: '2026-09-11T00:02:00Z', event: 'Touchdown', PlayerControlled: true, StarSystem: 'Rocky', Body: 'Rocky 1 a', OnStation: false, OnPlanet: true, Latitude: 1, Longitude: 2 },
      { timestamp: '2026-09-11T00:05:00Z', event: 'LaunchSRV', SRVType: 'mev_rhino', SRVType_Localised: 'SRV Rhino', ID: 45, PlayerControlled: true },
      { timestamp: '2026-09-11T00:30:00Z', event: 'DockSRV', SRVType: 'mev_rhino', SRVType_Localised: 'SRV Rhino', ID: 45 },
      // A second outing in the same vehicle is not a first.
      { timestamp: '2026-09-11T00:40:00Z', event: 'LaunchSRV', SRVType: 'mev_rhino', SRVType_Localised: 'SRV Rhino', ID: 45, PlayerControlled: true },
      // The Nomad never fires LaunchSRV — DockSRV is what catches it.
      { timestamp: '2026-09-11T00:50:00Z', event: 'DockSRV', SRVType: 'lander01', SRVType_Localised: 'Nomad', ID: 41 },
      // Old journals carry no type — the Scarab was the only SRV, so that is what it was.
      { timestamp: '2026-09-11T00:55:00Z', event: 'LaunchSRV', PlayerControlled: true },
      { timestamp: '2026-09-11T01:00:00Z', event: 'Shutdown' },
    ].map(l).join(''));
    const v = buildCommanderLog({ events: readJournalEvents(d7) }).events
      .filter((e) => e.kind === 'vehicle_first').sort((a, b) => a.at.localeCompare(b.at));
    expect(v.map((e) => e.line)).toEqual([
      'First drive: SRV Rhino · Rocky 1 a · Rocky',
      'First drive: Nomad · Rocky 1 a · Rocky',
      'First drive: SRV Scarab · Rocky 1 a · Rocky',
    ]);
    expect(v.every((e) => e.weight === 'major')).toBe(true);
    fs.rmSync(d7, { recursive: true, force: true });
  });

  it('counts a bio specimen once it is analysed, folds a sitting into one line, and logs the sale and the goal', () => {
    const l = (o) => JSON.stringify(o) + String.fromCharCode(10);
    const d8 = fs.mkdtempSync(path.join(os.tmpdir(), 'edca-clog-bio-'));
    fs.writeFileSync(path.join(d8, 'Journal.2026-09-12T000000.01.log'), [
      { timestamp: '2026-09-12T00:00:00Z', event: 'LoadGame', Ship: 'mandalay', Ship_Localised: 'Mandalay' },
      { timestamp: '2026-09-12T00:01:00Z', event: 'Location', StarSystem: 'Green' },
      { timestamp: '2026-09-12T00:02:00Z', event: 'Touchdown', PlayerControlled: true, StarSystem: 'Green', Body: 'Green 2 a', OnStation: false, OnPlanet: true, Latitude: 1, Longitude: 2 },
      // Log and Sample do NOT complete a specimen — only Analyse does.
      { timestamp: '2026-09-12T00:05:00Z', event: 'ScanOrganic', ScanType: 'Log', Genus_Localised: 'Bacterium', Species_Localised: 'Bacterium Tela' },
      { timestamp: '2026-09-12T00:06:00Z', event: 'ScanOrganic', ScanType: 'Sample', Genus_Localised: 'Bacterium', Species_Localised: 'Bacterium Tela' },
      { timestamp: '2026-09-12T00:07:00Z', event: 'ScanOrganic', ScanType: 'Analyse', Genus_Localised: 'Bacterium', Species_Localised: 'Bacterium Tela' },
      { timestamp: '2026-09-12T00:09:00Z', event: 'ScanOrganic', ScanType: 'Analyse', Genus_Localised: 'Tussock', Species_Localised: 'Tussock Catena' },
      { timestamp: '2026-09-12T00:20:00Z', event: 'Docked', MarketID: 77, StarSystem: 'Green', StationName: 'Green Hub', StationType: 'Coriolis' },
      { timestamp: '2026-09-12T00:25:00Z', event: 'SellOrganicData', MarketID: 77, BioData: [
        { Genus_Localised: 'Bacterium', Species_Localised: 'Bacterium Tela', Value: 90000000, Bonus: 20000000 },
        { Genus_Localised: 'Tussock', Species_Localised: 'Tussock Catena', Value: 5000000, Bonus: 0 },
      ] },
      // A goal you only ever saw advertised is not an event; one you put cargo into is.
      { timestamp: '2026-09-12T00:30:00Z', event: 'CommunityGoal', CurrentGoals: [
        { CGID: 900, Title: 'Haul things somewhere', SystemName: 'Green', MarketName: 'Green Hub', PlayerContribution: 0, TierReached: 'Tier 1', NumContributors: 10 },
        { CGID: 901, Title: 'Watched but not joined', SystemName: 'Blue', MarketName: 'Blue Dock', PlayerContribution: 0, NumContributors: 5 },
      ] },
      { timestamp: '2026-09-12T00:40:00Z', event: 'CommunityGoal', CurrentGoals: [
        { CGID: 900, Title: 'Haul things somewhere', SystemName: 'Green', MarketName: 'Green Hub', PlayerContribution: 4200, TierReached: 'Tier 3', NumContributors: 12 },
      ] },
      { timestamp: '2026-09-12T00:50:00Z', event: 'Shutdown' },
    ].map(l).join(''));
    const log2 = buildCommanderLog({ events: readJournalEvents(d8) });
    const bio = log2.events.filter((e) => e.kind === 'exobiology');
    expect(bio.map((e) => e.line)).toEqual(['Sampled 2 species on Green 2 a — Bacterium, Tussock']);
    const sale = log2.events.filter((e) => e.kind === 'bio_sale');
    expect(sale[0]).toMatchObject({ weight: 'huge', cr: 115000000 });
    expect(sale[0].line).toContain('Sold bio data: 115.0M cr — 2 samples');
    const cg = log2.events.filter((e) => e.kind === 'community_goal');
    expect(cg.length).toBe(1);   // the goal with zero contribution is not an event
    expect(cg[0].line).toBe('Community goal: Haul things somewhere · Green Hub, Green — contributed 4,200, reached Tier 3');
    fs.rmSync(d8, { recursive: true, force: true });
  });

  it('counts being on a body when you log in already standing on it, and docks by market id across a rename', () => {
    const l = (o) => JSON.stringify(o) + String.fromCharCode(10);
    const d9 = fs.mkdtempSync(path.join(os.tmpdir(), 'edca-clog-presence-'));
    fs.writeFileSync(path.join(d9, 'Journal.2026-09-13T000000.01.log'), [
      // Relog on the surface: Location with a latitude, in the SRV, and no Touchdown anywhere.
      { timestamp: '2026-09-13T00:00:00Z', event: 'LoadGame', Ship: 'mandalay', Ship_Localised: 'Mandalay' },
      { timestamp: '2026-09-13T00:00:05Z', event: 'Location', StarSystem: 'Rock', Body: 'Rock 1 a', Latitude: 5, Longitude: 6, InSRV: true, Docked: false },
      // A Touchdown on the same body in the same sitting is repositioning, not a second entry.
      { timestamp: '2026-09-13T00:30:00Z', event: 'Touchdown', PlayerControlled: true, StarSystem: 'Rock', Body: 'Rock 1 a', OnStation: false, OnPlanet: true, Latitude: 5.1, Longitude: 6.1 },
      { timestamp: '2026-09-13T01:00:00Z', event: 'Shutdown' },
      // Docks: one market id, renamed between visits, plus a login already docked there.
      { timestamp: '2026-09-14T00:00:00Z', event: 'LoadGame', Ship: 'mandalay', Ship_Localised: 'Mandalay' },
      { timestamp: '2026-09-14T00:01:00Z', event: 'Docked', MarketID: 500, StarSystem: 'Rock', StationName: 'Old Name', StationType: 'Coriolis' },
      { timestamp: '2026-09-14T00:20:00Z', event: 'Docked', MarketID: 500, StarSystem: 'Rock', StationName: 'New Name', StationType: 'Coriolis' },
      { timestamp: '2026-09-14T00:30:00Z', event: 'Shutdown' },
      { timestamp: '2026-09-15T00:00:00Z', event: 'LoadGame', Ship: 'mandalay', Ship_Localised: 'Mandalay' },
      { timestamp: '2026-09-15T00:00:05Z', event: 'Location', StarSystem: 'Rock', Docked: true, MarketID: 500, StationName: 'New Name', StationType: 'Coriolis' },
      { timestamp: '2026-09-15T00:10:00Z', event: 'Shutdown' },
    ].map(l).join(''));
    const log2 = buildCommanderLog({ events: readJournalEvents(d9) });
    const on = log2.events.filter((e) => e.kind === 'touchdown');
    expect(on.length).toBe(1);
    expect(on[0].line).toMatch(/^On Rock 1 a/);
    expect(on[0].line).toContain('resumed on the surface');
    expect(on[0].first).toBe(true);
    expect(log2.bodies.map((b) => b.name)).toEqual(['Rock 1 a']);
    expect(log2.stations.length).toBe(1);
    expect(log2.stations[0]).toMatchObject({ marketId: 500, name: 'New Name', docks: 3, first: '2026-09-14T00:01:00Z', last: '2026-09-15T00:00:05Z' });
    expect(searchCommanderLog(log2, 'old name').stations.length).toBe(0);   // the name it has NOW is the name
    expect(searchCommanderLog(log2, 'new name').stations.map((st) => st.name)).toEqual(['New Name']);
    fs.rmSync(d9, { recursive: true, force: true });
  });

  it('finds a kind by the word the commander would use for it', () => {
    expect(searchCommanderLog(log, 'builds').events.every((e) => e.kind === 'built')).toBe(true);
    const landings = searchCommanderLog(log, 'landings').events;
    expect(landings.length).toBe(byKind('touchdown').length);
    expect(searchCommanderLog(log, 'Beta 4').events.some((e) => e.body === 'Beta 4')).toBe(true); // plain text still works
  });
});
