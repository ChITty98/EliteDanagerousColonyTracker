// Station opinions: the fact sheet holds only what the app knows; a take must cite real facts, quote only
// their numbers, follow its facts' pulls, explain any change of mind, stay in character and not repeat
// itself; it is remembered per persona per station and dropped on a thumbs-down. A fake API client
// stands in for the network and temp files stand in for the live memory and ledger.
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildStationDossier, economyMix } from '../server/ai/copilotDossier.js';
import { validateOpinion, numbersIn, changedFacts, pickFacts, detectOpinion, runOpinion, onOpinionRated, opinionFor, noteOwnStationEvents, _resetOpinionTimers, OPINION_SCHEMA } from '../server/ai/copilotOpinions.js';
import { initCopilotMemory, getMemory } from '../server/ai/copilotMemory.js';
import { initCopilotApi } from '../server/ai/copilotApi.js';
import { _resetNearby, noteNearbyEvent, noteOwnNearby, nearbyNow } from '../server/radar/nearbyNow.js';
import { conflictsFromEvent, factionSnapshotFromEvent } from '../server/journal/factions.js';
import { recentlyOpined, _resetOpinionMarks, markOpined } from '../server/ai/copilotOpinionMarks.js';
import { detectAffinityBeat } from '../server/ai/copilotAffinity.js';

const MID = 4365774083;
const SYS = 'Col 173 Sector AX-J d9-52';
const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();

function fixtureState(over = {}) {
  return {
    settings: { copilotBackend: 'api', copilotApiModel: 'claude-opus-5-5', copilotApiCapUsd: 100, copilotPersonality: 'tars', copilotEnabled: true },
    currentShip: { type: 'type8', name: '' },
    knownStations: {
      a: {
        marketId: MID, stationName: "Thagard's Progress", stationType: 'Outpost', systemName: SYS, systemAddress: 1797401856371,
        landingPads: { small: 4, medium: 1, large: 0 }, distFromStarLS: 2040.77,
        economies: [{ name: '$economy_Refinery;', nameLocalised: 'Refinery', proportion: 1.4 }, { name: '$economy_Agri;', nameLocalised: 'Agriculture', proportion: 0.8 }],
        services: ['dock', 'commodities', 'blackmarket'], faction: 'Order of Copernicus', currentFaction: 'Order of Copernicus', dockedCount: 25,
        body: `${SYS} 1 a`,
      },
    },
    knownSystems: { [SYS]: { systemName: SYS, population: 308927814, economy: 'Industrial', economyLocalised: 'Industrial' } },
    systemFactions: {
      [SYS.toLowerCase()]: {
        systemName: SYS, updatedAt: iso(), allegiance: 'Empire', security: 'High Security', history: [],
        factions: [{ name: 'Order of Copernicus', influence: 0.128, state: 'War', government: 'Confederacy', allegiance: 'Independent', reputation: 95, active: ['War'], pending: [], recovering: [] }],
        conflicts: [{ warType: 'war', status: 'active', factions: [{ name: 'Pro-JDP League', stake: 'Atmo Sky Cairn Asc', wonDays: 0 }, { name: 'Order of Copernicus', stake: "Thagard's Progress", wonDays: 1 }] }],
      },
    },
    projects: [{ systemName: SYS, marketId: MID, name: 'Thagard', commodities: [] }],
    ...over,
  };
}
const granted = () => ({ allEvents: [{ timestamp: iso(1000), event: 'DockingGranted', StationName: "Thagard's Progress", StationType: 'Outpost', MarketID: MID, LandingPad: 2 }] });
const sheet = (persona = 'tars', state = fixtureState()) => buildStationDossier({ ev: granted().allEvents[0], state, persona, memory: {}, nearby: null });

describe('station fact sheet', () => {
  it('holds the war stake, the build, the pads and the economy — weights never quoted as percentages', () => {
    const d = sheet();
    const ids = d.facts.map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(['war.stake', 'history.built', 'pads', 'econ.Refinery', 'econ.Agriculture', 'svc.blackmarket', 'security', 'allegiance']));
    const stake = d.facts.find((f) => f.id === 'war.stake');
    expect(stake.salience).toBe(80);
    expect(stake.numbers).toEqual([1, 0]);
    expect(stake.text).toMatch(/stake in its war with Pro-JDP League — days won 1–0/);
    for (const f of d.facts.filter((x) => x.group === 'economy')) expect(f.numbers).toEqual([]);
    expect(d.facts.find((f) => f.id === 'econ.Agriculture').text).toMatch(/strong Agriculture side/);
    expect(d.facts.find((f) => f.id === 'pads').text).toMatch(/1 of them fit the Type-8/);
  });

  it('never quotes a dock count — only "a regular stop", or a round milestone', () => {
    const d = sheet();
    const reg = d.facts.find((f) => f.id === 'history.regular');
    expect(reg).toBeTruthy();
    expect(reg.numbers).toEqual([]);
    const s = fixtureState(); s.knownStations.a.dockedCount = 99;
    expect(sheet('tars', s).facts.find((f) => f.id === 'history.milestone').numbers).toEqual([100]);
  });

  it('a station whose main economy is one of the rare five gets no economy facts', () => {
    const s = fixtureState();
    s.knownStations.a.economies = [{ nameLocalised: 'Damaged', proportion: 1 }, { nameLocalised: 'Industrial', proportion: 0.8 }];
    expect(sheet('k2', s).facts.some((f) => f.group === 'economy')).toBe(false);
  });

  it('pulls come from each persona\'s tastes', () => {
    const agri = (p) => sheet(p).facts.find((f) => f.id === 'econ.Agriculture').pull[p];
    expect(agri('wash')).toBe(2);
    expect(agri('tars')).toBe(0);
    expect(sheet('k2').facts.find((f) => f.id === 'svc.blackmarket').pull.k2).toBe(1);
  });

  it('economy weights are relative to the main economy', () => {
    const mix = economyMix([{ Name_Localised: 'High Tech', Proportion: 0.6 }, { Name_Localised: 'Industrial', Proportion: 0.55 }, { Name_Localised: 'Extraction', Proportion: 0.1 }]);
    expect(mix.map((e) => e.name)).toEqual(['High Tech', 'Industrial', 'Extraction']);
    expect(mix[0].rel).toBe(1);
    expect(mix[1].rel).toBeCloseTo(0.55 / 0.6, 9);
  });
});

describe('opinion checks', () => {
  const ok = { line: "Thagard's. One medium pad, and the Order has bet it on a war it leads 1 to 0. I'd rather it stayed theirs.", stance: 1, mood: 'calm', used: ['pads', 'war.stake'], angle: 'war' };

  it('passes a take that cites real facts and quotes only their numbers', () => {
    expect(validateOpinion(ok, { dossier: sheet(), persona: 'tars' })).toEqual([]);
  });

  it('rejects a number no cited fact backs', () => {
    const why = validateOpinion({ ...ok, line: 'Seven medium pads? No. 7 pads would be a dream.' }, { dossier: sheet(), persona: 'tars' });
    expect(why.join(' ')).toMatch(/numbers not backed by a cited fact: 7/);
  });

  it('rejects ids that are not on the sheet', () => {
    expect(validateOpinion({ ...ok, used: ['made.up'] }, { dossier: sheet(), persona: 'tars' }).join(' ')).toMatch(/not on the sheet/);
  });

  it('rejects a verdict its own reasons argue against', () => {
    // Agriculture pulls Tycho 0, the black market pulls Wren −1 — a Wren "love it" on the black market alone is illogical.
    const why = validateOpinion({ line: 'A black market. Lovely.', stance: 2, mood: 'calm', used: ['svc.blackmarket'], angle: 'services' }, { dossier: sheet('wash'), persona: 'wash' });
    expect(why.join(' ')).toMatch(/positive stance needs/);
  });

  it('a change of mind must cite something that changed', () => {
    const stored = { stance: -1, line: 'old', used: [], factValues: {} };
    expect(validateOpinion(ok, { dossier: sheet(), persona: 'tars', stored, changed: [] }).join(' ')).toMatch(/changed your mind/);
    expect(validateOpinion(ok, { dossier: sheet(), persona: 'tars', stored, changed: [{ id: 'war.stake' }] })).toEqual([]);
  });

  it('keeps character: no she/her, no co-pilot names, Wren never leads with a number', () => {
    expect(validateOpinion({ ...ok, line: 'She is a fine outpost with 1 medium pad.' }, { dossier: sheet(), persona: 'tars' }).join(' ')).toMatch(/never "she"/);
    expect(validateOpinion({ ...ok, line: 'Tycho approves of 1 medium pad.' }, { dossier: sheet(), persona: 'tars' }).join(' ')).toMatch(/never name yourself/);
    expect(validateOpinion({ ...ok, line: '1 medium pad. Of course.', stance: 0 }, { dossier: sheet('wash'), persona: 'wash' }).join(' ')).toMatch(/Wren never leads with a number/);
  });

  it('rejects a line too close to a recent one', () => {
    const recentLines = ["Thagard's. One medium pad, and the Order has bet it on a war. I'd rather it stayed theirs."];
    expect(validateOpinion(ok, { dossier: sheet(), persona: 'tars', recentLines }).length).toBeGreaterThan(0);
  });

  it('reads numbers without mistaking names for them', () => {
    expect(numbersIn('Col 173 Sector AX-J d9-52 has 1 medium pad and a Type-8 queue.', [SYS])).toEqual([1]);
    expect(numbersIn('About 17 million people and twenty-one pilots.', [])).toEqual([17e6, 21]);
    expect(numbersIn('The 21st time — one of those places.', [])).toEqual([21]);
  });
});

describe('remembering and comparing', () => {
  it('a later reading diffs against the stored values', () => {
    const d1 = sheet();
    const stored = { factValues: Object.fromEntries(d1.facts.map((f) => [f.id, f.value])) };
    const s2 = fixtureState();
    s2.systemFactions[SYS.toLowerCase()].factions[0] = { ...s2.systemFactions[SYS.toLowerCase()].factions[0], state: 'Boom', active: ['Boom'] };
    s2.systemFactions[SYS.toLowerCase()].conflicts = [];
    const ch = changedFacts(stored, sheet('tars', s2)).map((c) => c.id);
    expect(ch).toEqual(expect.arrayContaining(['owner.state.Boom', 'war.stake']));
  });

  it('recent angles drop down the list', () => {
    const d = sheet();
    const top = pickFacts(d, 'tars', { recentAngles: ['war'] });
    const withoutPenalty = pickFacts(d, 'tars', {});
    expect(withoutPenalty[0].group).toBe('war');
    expect(top[0].group).not.toBe('war');
  });
});

describe('war table from the journal', () => {
  it('keeps each side\'s stake and days won', () => {
    const ev = { Conflicts: [{ WarType: 'war', Status: 'active', Faction1: { Name: 'Pro-JDP League', Stake: 'Atmo Sky Cairn Asc', WonDays: 0 }, Faction2: { Name: 'Order of Copernicus', Stake: "Thagard's Progress", WonDays: 2 } }] };
    expect(conflictsFromEvent(ev)).toEqual([{ warType: 'war', status: 'active', factions: [{ name: 'Pro-JDP League', stake: 'Atmo Sky Cairn Asc', wonDays: 0 }, { name: 'Order of Copernicus', stake: "Thagard's Progress", wonDays: 2 }] }]);
    const snap = factionSnapshotFromEvent({ StarSystem: SYS, timestamp: iso(), Factions: [{ Name: 'Order of Copernicus', Influence: 0.13 }], ...ev });
    expect(snap.conflicts).toHaveLength(1);
    expect(factionSnapshotFromEvent({ StarSystem: SYS, timestamp: iso(), Factions: [{ Name: 'X', Influence: 1 }] }).conflicts).toEqual([]);
  });
});

describe('nearby right now', () => {
  beforeEach(() => _resetNearby());
  it('counts other pilots at a station over 30 minutes, never the commander\'s own uploads', () => {
    const now = Date.now();
    noteNearbyEvent('granted', MID, new Date(now - 5 * 60_000).toISOString(), {}, now);
    noteNearbyEvent('denied', MID, new Date(now - 4 * 60_000).toISOString(), { reason: 'NoSpace' }, now);
    noteNearbyEvent('granted', MID, new Date(now - 60_000).toISOString(), {}, now);      // the commander's own
    noteOwnNearby('granted', MID, new Date(now - 50_000).toISOString(), now);
    noteNearbyEvent('granted', MID, new Date(now - 45 * 60_000).toISOString(), {}, now); // too old
    const n = nearbyNow(MID, now);
    expect(n.granted).toBe(1);
    expect(n.denied).toBe(1);
    expect(n.deniedReasons).toEqual({ NoSpace: 1 });
  });
});

describe('economy affinity follows the mix (CLI path too)', () => {
  beforeEach(() => _resetOpinionMarks());
  const docked = (econs) => ({ event: 'Docked', timestamp: iso(), StationName: 'X', MarketID: 77, StationServices: [], StationEconomies: econs, StationEconomy_Localised: econs[0].Name_Localised });
  it('a Colony station with a strong Agriculture side still gets Wren\'s reaction', () => {
    const b = detectAffinityBeat(docked([{ Name_Localised: 'Colony', Proportion: 1 }, { Name_Localised: 'Agriculture', Proportion: 0.6 }]), 'wash', false, { settings: {} });
    expect(b && b.key).toBe('affinity-economy');
    expect(b.intent).toMatch(/Colony station with a strong Agriculture side/);
  });
  it('the rare five are forgotten, and an opinion just given holds the remark off', () => {
    const b = detectAffinityBeat(docked([{ Name_Localised: 'Damaged', Proportion: 1 }, { Name_Localised: 'Industrial', Proportion: 0.8 }]), 'k2', false, { settings: {} });
    expect(b && b.key).not.toBe('affinity-economy');
    markOpined(77);
    const held = detectAffinityBeat(docked([{ Name_Localised: 'Colony', Proportion: 1 }, { Name_Localised: 'Agriculture', Proportion: 0.6 }]), 'wash', false, { settings: {} });
    expect(held && held.key).not.toBe('affinity-economy');
  });
});

describe('opinion beat end to end (fake API)', () => {
  let dir; let calls; let replies; let said; let captures;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-op-'));
    fs.writeFileSync(path.join(dir, 'anthropic-key.txt'), 'sk-ant-test-0000000000');
    fs.writeFileSync(path.join(dir, 'copilot-memory.json'), '{}'); // a fresh memory per test (init keeps the old one when the file is missing)
    initCopilotMemory(path.join(dir, 'copilot-memory.json'));
    _resetOpinionTimers();
    _resetOpinionMarks();
    _resetNearby();
    calls = []; replies = []; said = []; captures = 0;
    initCopilotApi({
      keyFile: path.join(dir, 'anthropic-key.txt'), spendFile: path.join(dir, 'copilot-spend.json'),
      clientFactory: () => ({ messages: { create: async (params) => {
        calls.push(params);
        const j = replies.length > 1 ? replies.shift() : replies[0];
        return { content: [{ type: 'text', text: JSON.stringify(j) }], usage: { input_tokens: 500, output_tokens: 150 }, stop_reason: 'end_turn' };
      } } }),
    });
  });
  const deps = () => ({ broadcastEvent: (e) => said.push(e), captureLine: () => `cap-${++captures}` });
  const good = { line: "Thagard's. One medium pad, and the Order has bet it on a war it leads 1 to 0. I'd rather it stayed theirs.", stance: 1, mood: 'calm', used: ['pads', 'war.stake'], angle: 'war' };

  it('speaks a checked take, remembers it, and keeps quiet next time when nothing changed', async () => {
    replies = [good];
    const state = fixtureState();
    const beat = detectOpinion(granted(), state, 'tars');
    expect(beat && beat.key).toBe('station-opinion');
    const line = await runOpinion(beat, state, state.settings, deps());
    expect(line).toBe(good.line);
    expect(said[0]).toMatchObject({ type: 'copilot_line', beat: 'station-opinion', line: good.line });
    expect(calls[0].output_config.format.schema).toBe(OPINION_SCHEMA);
    const stored = opinionFor('tars', MID);
    expect(stored.stance).toBe(1);
    expect(stored.used.map((u) => u.id)).toEqual(['pads', 'war.stake']);
    expect(recentlyOpined(MID)).toBe(true);
    _resetOpinionTimers();
    expect(detectOpinion(granted(), state, 'tars')).toBeNull(); // nothing changed
    const s2 = fixtureState();
    s2.systemFactions[SYS.toLowerCase()].conflicts[0].factions[1].wonDays = 4;
    expect(detectOpinion(granted(), s2, 'tars')).not.toBeNull(); // the war moved
  });

  it('gets one rewrite, then stays silent rather than say a wrong line', async () => {
    replies = [{ ...good, line: 'Seven pads. 7 of them!' }];
    const state = fixtureState();
    const beat = detectOpinion(granted(), state, 'tars');
    expect(await runOpinion(beat, state, state.settings, deps())).toBeNull();
    expect(calls).toHaveLength(2);
    expect(calls[1].messages[0].content).toMatch(/REJECTED: numbers not backed/);
    expect(said).toHaveLength(0);
    expect(opinionFor('tars', MID)).toBeNull();
  });

  it('a thumbs-down drops the stored take', async () => {
    replies = [good];
    const state = fixtureState();
    await runOpinion(detectOpinion(granted(), state, 'tars'), state, state.settings, deps());
    expect(opinionFor('tars', MID)).not.toBeNull();
    expect(onOpinionRated('cap-1', -1)).toBe(true);
    expect(opinionFor('tars', MID)).toBeNull();
  });

  it('stays off with the CLI backend or with live lines switched off', () => {
    const s = fixtureState();
    expect(detectOpinion(granted(), { ...s, settings: { ...s.settings, copilotBackend: 'cli' } }, 'tars')).toBeNull();
    expect(detectOpinion(granted(), { ...s, settings: { ...s.settings, copilotLiveEnabled: false } }, 'tars')).toBeNull();
  });

  it('counts the commander\'s own turn-aways once per journal line', () => {
    const ev = { timestamp: iso(5000), event: 'DockingDenied', StationName: "Thagard's Progress", MarketID: MID, Reason: 'NoSpace' };
    noteOwnStationEvents({ allEvents: [ev] });
    noteOwnStationEvents({ allEvents: [ev] }); // the same line re-read
    expect(getMemory().dockDenials[String(MID)]).toMatchObject({ count: 1, reasons: { NoSpace: 1 } });
  });
});
