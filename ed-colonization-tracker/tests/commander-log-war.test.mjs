// A war night in the Commander's Log: conflict-zone kills are paid in combat bonds (not bounties), so the
// log counts them on their own — before 1.61.1 a night spent fighting a war read "quiet". Fixture
// journal in a temp dir; nothing live is read.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readJournalEvents, buildCommanderLog, sittingSummary } from '../server/journal/commanderLog.js';

const SYS = 'Col 173 Sector AX-J d9-52';
const T = (h, m = 0) => `2026-10-27T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`;
const bond = (h, m, reward, side = 'The 9th Legion', foe = 'HIP 104349 Ring') => ({ timestamp: T(h, m), event: 'FactionKillBond', Reward: reward, AwardingFaction: side, VictimFaction: foe });
const drop = (h, m, lvl) => ({ timestamp: T(h, m), event: 'SupercruiseDestinationDrop', Type: `$Warzone_PointRace_${lvl}:#index=1;`, Type_Localised: `Conflict Zone [${lvl === 'Med' ? 'Medium' : lvl} Intensity]`, Threat: 0 });
let log;

beforeAll(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edca-clog-war-'));
  const ev = [
    { timestamp: T(4, 0), event: 'LoadGame', Ship: 'anacondamkii', ShipName: '' },
    { timestamp: T(4, 1), event: 'Location', StarSystem: SYS, Docked: false },
    drop(4, 10, 'Low'), bond(4, 15, 30000), bond(4, 20, 34278),
    drop(4, 40, 'Low'), bond(4, 50, 40000),
    drop(5, 5, 'Med'),                        // dropped in and left — not a zone fought in
    drop(5, 10, 'Med'), bond(5, 20, 50000),
    { timestamp: T(5, 30), event: 'Docked', StationName: 'Chiang Bastion', StarSystem: SYS, MarketID: 1 },
    { timestamp: T(5, 31), event: 'RedeemVoucher', Type: 'CombatBond', Amount: 400000, Faction: 'The 9th Legion' },
    { timestamp: T(5, 40), event: 'Shutdown' },
  ];
  fs.writeFileSync(path.join(dir, 'Journal.2026-10-27T040000.01.log'), ev.map((o) => JSON.stringify(o)).join('\n') + '\n');
  log = buildCommanderLog({ events: readJournalEvents(dir) });
});

describe('war nights', () => {
  it('logs the fighting: zones fought in, kills, bonds, who for and against, what was redeemed', () => {
    const war = log.events.filter((e) => e.kind === 'war_night');
    expect(war).toHaveLength(1);
    expect(war[0]).toMatchObject({ weight: 'notable', system: SYS });
    expect(war[0].line).toBe(`War at ${SYS} for The 9th Legion against HIP 104349 Ring: 3 conflict zones (2 low, 1 medium), 4 kills, 154k cr in bonds · 400k cr redeemed`);
  });

  it('the sitting carries the kills, so it is never "quiet"', () => {
    const s = log.sittings[0];
    expect(s.bonds).toBe(4);
    expect(s.zonesFought).toBe(3);
    expect(s.bondSides).toEqual({ 'The 9th Legion': 4 });
    // The routine line leaves the kills to the war entry it already has — but a sitting with kills
    // and no entry would still say them.
    expect(sittingSummary({ ...s, events: [] })).toBe('4 conflict-zone kills');
  });
});
