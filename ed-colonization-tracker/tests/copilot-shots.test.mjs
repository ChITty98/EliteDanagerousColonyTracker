// The co-pilot reading F10 screenshots (1.62.0): every shot is described; a station screen's representative
// is kept only when the screen names the station you are docked at. Since 1.62.3 every line it writes is
// SPOKEN (the commander's rule: a paid line is never thrown away) — the rules live in the prompt, and the only
// post-processing fixes text: the commander's name, a carrier callsign, a ship called "she", stray markdown.
// A fake API client stands in for the network; temp files stand in for the key and ledger.
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readScreenshot, noteShotTaken, polishShotLine, acceptStation, buildShotContext, scrubDescription, isDepositShot, _resetShots, SHOT_SCHEMA } from '../server/ai/copilotShots.js';
import { initCopilotApi } from '../server/ai/copilotApi.js';
import { buildStationDossier } from '../server/ai/copilotDossier.js';

const SYS = 'Col 173 Sector AX-J d9-52';
const MID = 4365774083;
const iso = () => new Date().toISOString();
const settings = { copilotEnabled: true, copilotBackend: 'api', copilotApiModel: 'claude-opus-5-5', copilotApiCapUsd: 100, copilotPersonality: 'tars', commanderName: 'VexMoor' };
const state = (rep) => ({
  settings,
  currentDock: { marketId: MID, stationName: "Thagard's Progress", systemName: SYS },
  currentShip: { type: 'type8' },
  knownStations: { [String(MID)]: { marketId: MID, stationName: "Thagard's Progress", systemName: SYS, stationType: 'Outpost', ...(rep ? { representative: rep } : {}) } },
});
const stationRead = {
  kind: 'station_screen', description: 'The station services screen for Thagard\'s Progress.', tags: ['home'], mood: 'calm',
  line: 'Vice President Virgil Hall is apologising for the war again. I find that oddly comforting.',
  station: { stationName: "THAGARD'S PROGRESS", representativeTitle: 'Vice President', representativeName: 'Virgil Hall', greeting: "Welcome to Thagard's Progress, Commander. I'm sorry for the danger in getting here. I hope it wasn't too much trouble.", factionName: 'Order of Copernicus', factionState: 'War', influencePct: 12.8, operationalStatus: 'Normal', architectIsCommander: true },
};
const img = { mediaType: 'image/jpeg', data: Buffer.from('fake').toString('base64') };
const OWN = { callsign: 'K8R-M2X', name: 'OLD TIN-CAN' };

describe('screenshot reading', () => {
  let dir; let calls; let reply; let said;
  beforeEach(() => {
    _resetShots();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-shots-'));
    fs.writeFileSync(path.join(dir, 'anthropic-key.txt'), 'sk-ant-test-0000000000');
    calls = []; said = [];
    reply = stationRead;
    initCopilotApi({
      keyFile: path.join(dir, 'anthropic-key.txt'), spendFile: path.join(dir, 'copilot-spend.json'),
      clientFactory: () => ({ messages: { create: async (params) => { calls.push(params); return { content: [{ type: 'text', text: JSON.stringify(reply) }], usage: { input_tokens: 2000, output_tokens: 120 }, stop_reason: 'end_turn' }; } } }),
    });
  });
  const deps = () => ({ broadcastEvent: (e) => said.push(e), captureLine: () => 'cap-1', canSpeak: () => true, noteLine: () => {} });

  it('reads a station screen: keeps the representative and greets them by name when new', async () => {
    const seq = noteShotTaken();
    const r = await readScreenshot({ ev: { timestamp: iso(), System: SYS, Body: "Thagard's Progress" }, image: img, state: state(null), settings, seq, deps: deps() });
    expect(calls[0].messages[0].content[0]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg' } });
    expect(calls[0].output_config.format.schema).toBe(SHOT_SCHEMA);
    expect(r.station).toMatchObject({ title: 'Vice President', name: 'Virgil Hall', faction: 'Order of Copernicus', factionState: 'War', influencePct: 12.8, architectIsYou: true });
    expect(r.stationIsNew).toBe(true);
    expect(r.tags).toEqual([]); // Sights tags are for places, not menus (a real read tagged this screen "home")
    expect(r.line).toMatch(/Virgil Hall/);
    expect(said[0]).toMatchObject({ type: 'copilot_line', beat: 'screenshot' });
  });

  it('a known representative is told to the model — and whatever it says back is spoken', async () => {
    const known = { title: 'Vice President', name: 'Virgil Hall', seenAt: iso() };
    reply = { ...stationRead, line: 'Pad five again. The refinery board has not changed, and neither has my opinion of it.' };
    const r = await readScreenshot({ ev: { timestamp: iso(), System: SYS }, image: img, state: state(known), settings, seq: noteShotTaken(), deps: deps() });
    expect(calls[0].messages[0].content.find((b) => b.type === 'text').text).toMatch(/already know this station's representative, Vice President Virgil Hall/);
    expect(r.station.name).toBe('Virgil Hall');
    expect(r.stationIsNew).toBe(false);
    expect(r.line).toMatch(/^Pad five again/);
    expect(r.silent).toBeNull();
    expect(said).toHaveLength(1);
  });

  it('every shot of a burst speaks — a paid line is never thrown away', async () => {
    reply = { kind: 'vista', description: 'A ringed gas giant over a pale horizon.', tags: ['rings', 'sky', 'bogus'], line: 'Now that is a sky worth stopping for.', mood: 'awe', station: null };
    const first = noteShotTaken();
    noteShotTaken(); // a second F10 before the first was read
    const r = await readScreenshot({ ev: { timestamp: new Date(Date.now() - 10 * 60e3).toISOString(), System: SYS }, image: img, state: state(null), settings, seq: first, deps: deps() });
    expect(r.description).toMatch(/ringed gas giant/);
    expect(r.tags).toEqual(['rings', 'sky']); // only Sights tags
    expect(r.line).toBe('Now that is a sky worth stopping for.');
    expect(said).toHaveLength(1);
  });

  it('the lines the 1.62.1–1.62.2 checks threw away are spoken as written', async () => {
    // Screenshot_0045 (dropped: "numbers not backed: 9.85, 90") and Screenshot_0048 (dropped: "too long (50 words)").
    const carrier = "9.85 kilometres to the Old Tin-Can, and from here the whole carrier fits under one targeting reticle. Lovely framing. Humour's at 90, so I'm legally obliged to call it the world's largest hood ornament.";
    reply = { kind: 'vista', description: 'Cockpit view of a fleet carrier, the Old Tin-Can KBR-M2X, targeted about 9.85 km ahead against a starfield.', tags: ['sky'], line: carrier, mood: 'calm', station: null };
    const r = await readScreenshot({ ev: { timestamp: iso(), System: SYS, Body: `${SYS} 1 a` }, image: img, state: state(null), settings: { ...settings, copilotTarsHumor: 90 }, seq: noteShotTaken(), deps: deps() });
    expect(r.line).toBe(carrier);
    expect(r.fixes).toEqual([]);
    expect(r.description).not.toMatch(/KBR-M2X/); // a misread callsign is never stored
    const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ') + ', 215 m/s at twenty-seven degrees, 5.30 Ls out.';
    reply = { kind: 'vista', description: 'A magenta gas giant behind brown rings.', tags: ['rings'], line: long, mood: 'awe', station: null };
    const r2 = await readScreenshot({ ev: { timestamp: iso(), System: SYS }, image: img, state: state(null), settings, seq: noteShotTaken(), deps: deps() });
    expect(r2.line).toBe(long);
    expect(said).toHaveLength(2);
  });

  it('keeps the reason when there is no line, and the fixes when there were any', async () => {
    reply = { kind: 'vista', description: 'A pale ridge under a black sky.', tags: ['terrain'], line: '', mood: 'calm', station: null };
    const quiet = await readScreenshot({ ev: { timestamp: iso(), System: SYS }, image: img, state: state(null), settings, seq: noteShotTaken(), deps: deps() });
    expect(quiet.silent).toBe('the model gave no line');
    expect(said).toHaveLength(0);
    reply = { kind: 'vista', description: 'A pale ridge under a black sky.', tags: ['terrain'], line: 'Nice ridge, CMDR VexMoor — *very* nice.', mood: 'calm', station: null };
    const fixed = await readScreenshot({ ev: { timestamp: iso(), System: SYS }, image: img, state: state(null), settings, seq: noteShotTaken(), deps: deps() });
    expect(fixed.line).toBe('Nice ridge, Commander — very nice.');
    expect(fixed.fixes).toEqual(['markdown stripped', 'commander name → Commander', 'CMDR → Commander']);
    expect(said).toHaveLength(1);
  });

  it('holds only while fighting or out of the game', async () => {
    reply = { kind: 'vista', description: 'Rings.', tags: ['rings'], line: 'That ring is doing all the work in this shot.', mood: 'awe', station: null };
    const r = await readScreenshot({ ev: { timestamp: iso(), System: SYS }, image: img, state: state(null), settings, seq: noteShotTaken(), deps: { ...deps(), canSpeak: () => false } });
    expect(r.line).toBeNull();
    expect(r.silent).toBe('out of the game or in combat');
    expect(said).toHaveLength(0);
  });

  it('fixes text instead of dropping the line: name, CMDR, callsign, markdown, a ship called she', () => {
    expect(polishShotLine('Nice shot, VexMoor.', { commanderName: 'VexMoor' })).toEqual({ line: 'Nice shot, Commander.', fixes: ['commander name → Commander'] });
    expect(polishShotLine('Nice shot, CMDR.', {})).toEqual({ line: 'Nice shot, Commander.', fixes: ['CMDR → Commander'] });
    expect(polishShotLine('Nice shot, CMDR VexMoor.', { commanderName: 'VexMoor' }).line).toBe('Nice shot, Commander.');
    expect(polishShotLine('KBR-M2X dead ahead, all lit up.', { carrier: OWN })).toEqual({ line: 'OLD TIN-CAN dead ahead, all lit up.', fixes: ['callsign → OLD TIN-CAN'] }); // a misread of our own callsign
    expect(polishShotLine('Someone parked XYZ-9AB in the lane.', { carrier: OWN }).line).toBe('Someone parked in the lane.'); // not ours: removed
    expect(polishShotLine('The OLD TIN-CAN dead ahead, all lit up.', { carrier: OWN })).toEqual({ line: 'The OLD TIN-CAN dead ahead, all lit up.', fixes: [] });
    expect(polishShotLine('She handles the glide beautifully, and her nose is dead on the pad.', { kind: 'vista' })).toEqual({ line: 'It handles the glide beautifully, and its nose is dead on the pad.', fixes: ['ship pronoun → it'] });
    expect(polishShotLine('She says welcome, and I believe her.', { kind: 'station_screen' }).fixes).toEqual([]); // the representative, not the ship
    expect(polishShotLine('Coming in at 215 m/s, nose down twenty-seven degrees.', {})).toEqual({ line: 'Coming in at 215 m/s, nose down twenty-seven degrees.', fixes: [] });
  });

  it('names the commander\'s carrier for the model, never its callsign', () => {
    const st = { ...state(null), settings: { myFleetCarrier: 'K8R-M2X' }, fleetCarrierSpaceUsage: { 'K8R-M2X': { name: 'OLD TIN-CAN' } } };
    const c = buildShotContext({ System: SYS }, st);
    const carrierLine = c.lines.find((l) => /fleet carrier/.test(l));
    expect(carrierLine).toMatch(/the OLD TIN-CAN/);
    expect(carrierLine).toMatch(/never write its callsign/);
    expect(c.lines.join(' ')).not.toMatch(/K8R-M2X/);
    expect(c.carrier).toEqual(OWN);
  });

  it('never keeps a commander name or credits in the stored description', () => {
    expect(scrubDescription('Connected as CMDR Somebody. A ringed gas giant fills the sky.', '')).toBe('A ringed gas giant fills the sky.');
    expect(scrubDescription('Somebody stands by the SRV. Pale dunes run to the horizon.', 'Somebody')).toBe('Pale dunes run to the horizon.');
    expect(scrubDescription('The panel shows 4,120,000,000 credits. The pad is lit.', '')).toBe('The pad is lit.');
  });

  it('skips a shot only when it is taken on the ground while surface mining — never by file name', () => {
    // Docked at a surface outpost (Thagard's, 2 Nov): coordinates but no altitude — read it.
    expect(isDepositShot({ Latitude: -67.954918, Longitude: -121.677734, Heading: 0 }, false)).toBe(false);
    expect(isDepositShot({ Latitude: -67.954918, Longitude: -121.677734, Heading: 0 }, true)).toBe(false);
    // In the SRV at a deposit while mining (1 b, 3 Sep): the HUD panel is the record — skip it.
    expect(isDepositShot({ Latitude: -36.197327, Longitude: 143.228989, Altitude: 0.30349 }, true)).toBe(true);
    // The same spot when not mining is a ground-level vista — read it.
    expect(isDepositShot({ Latitude: -36.197327, Longitude: 143.228989, Altitude: 0.30349 }, false)).toBe(false);
    // A flyover (1,691 m) and a shot in space are never deposit records.
    expect(isDepositShot({ Latitude: -36.2, Longitude: 143.2, Altitude: 1691 }, true)).toBe(false);
    expect(isDepositShot({}, true)).toBe(false);
  });

  it('keeps a representative only when the screen names the station you are docked at', () => {
    const dock = { marketId: 1, stationName: 'Planetary Construction Site: Forward Vista' };
    expect(acceptStation({ ...stationRead.station, stationName: 'FORWARD VISTA' }, dock, { timestamp: iso() })).toMatchObject({ name: 'Virgil Hall' });
    expect(acceptStation({ ...stationRead.station, stationName: 'SOMEWHERE ELSE' }, dock, { timestamp: iso() })).toBeNull();
    expect(acceptStation(stationRead.station, null, {})).toBeNull();
  });

  it('does nothing when the API is not in use', async () => {
    const r = await readScreenshot({ ev: { timestamp: iso() }, image: img, state: state(null), settings: { ...settings, copilotBackend: 'cli' }, seq: noteShotTaken(), deps: deps() });
    expect(r).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('the context comes from the journal, never from the picture', () => {
    const c = buildShotContext({ System: SYS, Body: "Thagard's Progress" }, state(null));
    expect(c.lines).toContain(`System: ${SYS}`);
    expect(c.lines).toContain("Docked at: Thagard's Progress");
    expect(c.lines.some((l) => /Type-8/.test(l))).toBe(true);
  });

  it('the representative joins the station fact sheet', () => {
    const st = state({ title: 'Vice President', name: 'Virgil Hall', greeting: 'Welcome.', seenAt: iso() });
    const d = buildStationDossier({ ev: { event: 'DockingGranted', StationName: "Thagard's Progress", StationType: 'Outpost', MarketID: MID, timestamp: iso() }, state: st, persona: 'tars', memory: {}, nearby: null });
    expect(d.facts.find((f) => f.id === 'people.rep').text).toMatch(/Vice President Virgil Hall is the station's representative/);
  });
});
