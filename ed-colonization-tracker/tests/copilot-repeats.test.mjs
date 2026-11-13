// 1.62.0 — not paying twice for the same line ("lots of repetition in these live messages that I'm
// paying for only very slight deviations on"). The near-copy measure on the commander's own repeated
// lines, the per-moment memory and facts gate, the gate and backstop wired through a real co-pilot tick
// (a fake API client, temp key and ledger files — nothing live is touched), the flown ship's cargo
// capacity, the carrier free-space bands, the humour dial in canned lines, and no quotable lines left
// in the rules.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rememberLine, linesFor, factsSaid, nearCopyOf, _resetRepeats, MEMORY_MS } from '../server/ai/copilotRepeats.js';
import { flownCargoCapacity, setNavDestination } from '../server/ai/copilotContext.js';
import { carrierSpaceFp, detectAffinityBeat } from '../server/ai/copilotAffinity.js';
import { pickCanned, percentWords, cannedAvailable } from '../server/ai/copilotCanned.js';
import { COPILOT_RULES, BEATS } from '../server/ai/copilotRules.js';
import { runCopilot, setInGame } from '../server/ai/copilot.js';
import { initCopilotApi } from '../server/ai/copilotApi.js';
import { parseJournalLines } from '../server/journal/parser.js';

const SYS = 'Col 173 Sector AX-J d9-52';
const FC = 'K8R-M2X';

// The commander's own repeated lines from 29–30 Oct (copilot-captures.jsonl), name swapped for "Commander".
const SCA_A = "I've got the ship, Commander — sit back, this cruise leg's mine all the way in. Home system, high security, nothing out there but our own neighbourhood, so I'll keep it smooth and boring. Boring is my best work; I've been told I'm very good at it.";
const SCA_B = "I've got the ship. Sit back, Commander, I'll fly us in. High-security Imperial space, our own system, and a Type-8 that steers like a filing cabinet; I find all three very relaxing.";
const FC_A = "Old Tin-Can's hold has 16,709 tonnes of free space, call it about twelve and three-quarter loads of the Clipper. Plenty of room, so nobody has to play cargo Tetris yet. I've played it, I'm undefeated, and I would still rather not.";
const FC_B = "Old Tin-can's hold has 16,709 tons free, call it twelve and change Type-8 loads before it's full. Plenty of room to keep stacking. I'll keep counting so you don't have to, it's the closest thing I have to a hobby.";
const HOME_A = "Docked on the OLD TIN-CAN, with 16,709 tons of hold space free. That's a lot of empty, and I find empty space emotionally relatable. If you want to pull stock for the run, the market's right there, and I'll handle the paperwork with my usual alarming enthusiasm.";
const HOME_B = "Docked on the OLD TIN-CAN, and the hold's showing about 15,966 tonnes free. That's a lot of empty floor, so we can stage whatever we pick up without playing cargo Tetris. If you want, I'll pull up what's worth stashing here before we head back out; I promise to keep the enthusiasm at regulation levels.";
const CLAMPS_A = "Clamps are on. This market's got what we need: six tonnes of Evacuation Shelters and twenty-seven of Survival Equipment, so I'd recommend picking both up while we're parked here. It's a full emergency kit in one stop, which makes us either very responsible or deeply pessimistic, and I'd prefer you don't check which.";
const CLAMPS_B = "Clamps are on. This market has 52 tonnes of Advanced Catalysers and 275 of Structural Regulators the build still wants, so I'd suggest topping up on both while we're parked. Humour's at 90, so I did draft a catalyser pun, but it was too slow to react and I let it go.";

describe('near-copies — measured on the lines the commander flagged', () => {
  it('catches the supercruise, carrier and docked-at-carrier repeats', () => {
    expect(nearCopyOf(SCA_B, [SCA_A])).not.toBeNull();
    expect(nearCopyOf(FC_B, [FC_A])).not.toBeNull();
    expect(nearCopyOf(HOME_B, [HOME_A])).not.toBeNull();
  });
  it('lets the same opening through when the news is new', () => {
    expect(nearCopyOf(CLAMPS_B, [CLAMPS_A])).toBeNull();
  });
});

describe('per-moment memory and the facts gate', () => {
  beforeEach(() => _resetRepeats());
  it('keeps each moment\'s last three lines for three hours', () => {
    const t = Date.parse('2026-10-30T04:00:00Z');
    for (const [i, l] of ['one', 'two', 'three', 'four'].entries()) rememberLine('sca', l, null, t + i);
    expect(linesFor('sca', t + 10)).toEqual(['two', 'three', 'four']);
    expect(linesFor('fc-dock-request', t + 10)).toEqual([]);
    expect(linesFor('sca', t + MEMORY_MS + 10)).toEqual([]);
  });
  it('the same facts within three hours are already said; other facts are not', () => {
    const t = Date.parse('2026-10-30T04:00:00Z');
    rememberLine('fc-dock-request', 'a line', 'carrier-space|k8r-m2x|40+', t);
    expect(factsSaid('carrier-space|k8r-m2x|40+', t + 60 * 60e3)).toBe(true);
    expect(factsSaid('carrier-space|k8r-m2x|30+', t + 60 * 60e3)).toBe(false);
    expect(factsSaid('carrier-space|k8r-m2x|40+', t + MEMORY_MS + 1)).toBe(false);
  });
});

describe('the ship being flown, and the carrier as news', () => {
  it('reads the flown ship\'s capacity from the journal before the Settings planning figure', () => {
    expect(flownCargoCapacity({ currentShip: { type: 'type8', cargoCapacity: 384 }, settings: { cargoCapacity: 1304 } })).toBe(384);
    expect(flownCargoCapacity({ currentShip: { type: 'type8', cargoCapacity: 0 }, settings: { cargoCapacity: 1304 } })).toBe(1304);
    expect(flownCargoCapacity({ settings: { cargoCapacity: 1304 } })).toBe(1304);
    expect(flownCargoCapacity({})).toBe(0);
  });
  it('bands free space so the routine loop (one load in per arrival) is not news', () => {
    // 16,709 → 15,582 t over four arrivals on 30 Oct: 43 → 40 Type-8 loads, one band.
    expect(carrierSpaceFp(FC, 16709, 384)).toBe(carrierSpaceFp(FC, 15582, 384));
    expect(carrierSpaceFp(FC, 15000, 384)).not.toBe(carrierSpaceFp(FC, 15582, 384)); // 39 loads: a new band
    expect(carrierSpaceFp(FC, 3000, 384)).toBe(carrierSpaceFp(FC, 2000, 384)); // 7 and 5: the five-to-nine band
    expect(carrierSpaceFp(FC, 1900, 384)).toMatch(/\|4\|nearly-full$/);
    expect(carrierSpaceFp(FC, 1500, 384)).not.toBe(carrierSpaceFp(FC, 1900, 384)); // every load near the end
  });
  it('the docking request counts Type-8 loads, and the docked line shares its news', () => {
    const state = {
      settings: { myFleetCarrier: FC, cargoCapacity: 1304 },
      fleetCarrierSpaceUsage: { [FC]: { name: 'OLD TIN-CAN', freeSpace: 16709 } },
      currentShip: { type: 'type8', cargoCapacity: 384 },
    };
    const ts = new Date().toISOString();
    const req = detectAffinityBeat({ event: 'DockingRequested', StationName: FC, timestamp: ts }, 'tars', true, state);
    expect(req.key).toBe('fc-dock-request');
    expect(req.intent).toMatch(/about 43\.5 full ship-loads/);
    expect(req.intent).toMatch(/~384t/);
    expect(req.fp).toBe(carrierSpaceFp(FC, 16709, 384));
    const home = detectAffinityBeat({ event: 'Docked', StationName: FC, timestamp: ts }, 'tars', true, state);
    expect(home.key).toBe('carrier-home');
    expect(home.fp).toBe(req.fp);
  });
});

describe('canned lines and the rules', () => {
  it('Tycho quotes the real humour dial, and only when it is known', () => {
    expect(percentWords(90)).toBe('ninety');
    expect(percentWords(45)).toBe('forty-five');
    expect(percentWords(100)).toBe('one hundred');
    expect(percentWords(undefined)).toBe('');
    const withDial = new Set();
    const without = new Set();
    for (let i = 0; i < 120; i++) {
      withDial.add(pickCanned('tars', 'idle-joke', { humor: 'ninety' }));
      without.add(pickCanned('tars', 'idle-joke', {}));
    }
    expect([...withDial].some((l) => /humor setting is at ninety percent/.test(l))).toBe(true);
    expect([...withDial, ...without].some((l) => /forty percent|\{humor\}/.test(l))).toBe(false);
  });
  it('knows which personas have a free line for a moment', () => {
    expect(cannedAvailable('wash', 'cargo-bay-gripe', { hull: 'Type-8 Transporter', action: 'launching us' })).toBe(true);
    expect(cannedAvailable('tars', 'cargo-bay-gripe', { hull: 'Type-8 Transporter', action: 'launching us' })).toBe(false);
  });
  it('hands the model no quotable lines, and no knocks on the ship\'s handling', () => {
    expect(COPILOT_RULES).not.toMatch(/handles like a brick|I've got the ship/);
    expect(COPILOT_RULES).toMatch(/Type-8, for one, is nimble/);
    const sca = BEATS.find((b) => b.key === 'sca');
    expect(sca.intent).not.toMatch(/I've got the ship/);
  });
});

describe('the gate and the backstop, through a real co-pilot tick', () => {
  let dir; let calls; let replies; let said;
  const state = {
    settings: { copilotEnabled: true, copilotBackend: 'api', copilotApiModel: 'claude-opus-5-5', copilotApiCapUsd: 100, copilotPersonality: 'tars', copilotIdleGapSec: 120, myFleetCarrier: FC },
    commanderPosition: { systemName: SYS },
    // A two-seat hull: in the single-seat Type-8, supercruise assist also starts the cargo-hold joke, which outranks it.
    currentShip: { type: 'anaconda', cargoCapacity: 500 },
    fleetCarrierSpaceUsage: { [FC]: { name: 'OLD TIN-CAN', freeSpace: 16709 } },
    projects: [], knownStations: {}, knownSystems: {}, scoutedSystems: {},
  };
  const deps = { broadcastEvent: (e) => said.push(e), captureLine: () => 'cap', readState: () => state };
  const tick = () => runCopilot(parseJournalLines([JSON.stringify({ timestamp: new Date().toISOString(), event: 'StatusScaActive' })]), state, deps);

  beforeEach(() => {
    _resetRepeats();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-repeats-'));
    fs.writeFileSync(path.join(dir, 'anthropic-key.txt'), 'sk-ant-test-0000000000');
    calls = []; said = []; replies = [];
    initCopilotApi({
      keyFile: path.join(dir, 'anthropic-key.txt'), spendFile: path.join(dir, 'copilot-spend.json'),
      clientFactory: () => ({ messages: { create: async (params) => { calls.push(params); return { content: [{ type: 'text', text: replies.shift() || 'Quiet lane.' }], usage: { input_tokens: 3000, output_tokens: 80 }, stop_reason: 'end_turn' }; } } }),
    });
    vi.useFakeTimers({ toFake: ['Date'] });
    setInGame(true, 'test');
  });
  afterEach(() => { vi.useRealTimers(); setNavDestination(null); });

  it('pays once per leg, sees its own last line, and speaks every line it pays for', async () => {
    const t0 = Date.parse('2026-10-30T04:00:00Z');
    replies = [
      'The lane out to the carrier is clear, and the primary is doing its slow orange glow again.',
      "Thagard's Progress is on the nose, and the ring behind it is lit up like a runway.",
      'Forward Vista is on the nose, and the ring behind it is lit up like a runway.',
    ];
    vi.setSystemTime(t0);
    setNavDestination({ name: FC, nameLocalised: '', system: SYS, body: null });
    await tick();
    expect(calls).toHaveLength(1);
    const prompt1 = calls[0].messages[0].content;
    expect(prompt1).toMatch(/This leg is heading for: OLD TIN-CAN, the commander's own fleet carrier/);
    expect(said.filter((e) => e.beat === 'sca')).toHaveLength(1);

    // Ten minutes on, the same leg again: nothing new, so no call at all.
    vi.setSystemTime(t0 + 10 * 60e3);
    await tick();
    expect(calls).toHaveLength(1);

    // A new destination is news — and the prompt shows what it said last time for this moment.
    vi.setSystemTime(t0 + 20 * 60e3);
    setNavDestination({ name: "Thagard's Progress", nameLocalised: '', system: SYS, body: null });
    await tick();
    expect(calls).toHaveLength(2);
    expect(calls[1].messages[0].content).toMatch(/this same moment came up, you said[\s\S]*slow orange glow/);
    expect(said.filter((e) => e.beat === 'sca')).toHaveLength(2);

    // New facts, and the model rewords its last line: paid once and SPOKEN — a paid line is never dropped (1.62.3).
    vi.setSystemTime(t0 + 30 * 60e3);
    setNavDestination({ name: 'Forward Vista', nameLocalised: '', system: SYS, body: null });
    await tick();
    expect(calls).toHaveLength(3);
    expect(said.filter((e) => e.beat === 'sca')).toHaveLength(3);
  });
});
