// 1.63.0 — how the Materials page's "Colony bodies" tab arranges what the server sends: the per-material overview and the
// bodies that carry one material. Icy bodies are listed, never leading (the commander's standing rule).
import { describe, it, expect } from 'vitest';
import { bodiesCarrying, materialOverview, shortBody, shortSite } from '../src/lib/colonyBodies.ts';

const SYS = 'Col 173 Sector AX-J d9-52';
const b = (name, materials, extra = {}) => ({ body: `${SYS} ${name}`, system: SYS, source: 'scan', at: null, materials, gravity: 0.4, planetClass: 'Rocky body', atmosphere: 'none', icy: false, distanceLs: 10, sites: [], ...extra });
const bodies = [
  b('2 b', { tungsten: 1.2, iron: 20 }),
  b('10 a', { tungsten: 1.2, iron: 12 }),
  b('3 a', { tungsten: 2.4, sulphur: 30 }, { icy: true, planetClass: 'Icy body' }),
  b('1 a', { iron: 22, nickel: 15 }),
];
const mat = (id, displayName, grade, cap) => ({ id, displayName, category: 'raw', grade, line: 'x', cap });
const RAW = [mat('iron', 'Iron', 1, 300), mat('nickel', 'Nickel', 1, 300), mat('tungsten', 'Tungsten', 3, 200), mat('tellurium', 'Tellurium', 4, 150), mat('sulphur', 'Sulphur', 1, 300)];

describe('the bodies that carry a material', () => {
  it('lists the richest first, an icy body after the others whatever its share, ties in natural order', () => {
    expect(bodiesCarrying(bodies, 'tungsten').map((x) => shortBody(x.body, x.system))).toEqual(['2 b', '10 a', '3 a']);
    expect(bodiesCarrying(bodies, 'iron').map((x) => shortBody(x.body, x.system))).toEqual(['1 a', '2 b', '10 a']);
    expect(bodiesCarrying(bodies, 'tellurium')).toEqual([]);
  });
  it('does not reorder the list it was given', () => {
    const before = bodies.map((x) => x.body);
    bodiesCarrying(bodies, 'tungsten');
    expect(bodies.map((x) => x.body)).toEqual(before);
  });
});

describe('the overview, one row per raw material', () => {
  const rows = materialOverview(bodies, RAW, { tungsten: 9, iron: 300, nickel: 292 });
  const row = (id) => rows.find((r) => r.material.id === id);

  it('gives stock, room, how many bodies carry it and the richest of them', () => {
    expect(row('tungsten')).toMatchObject({ held: 9, room: 191, bodies: 3, bestPct: 1.2 });
    expect(shortBody(row('tungsten').best.body, SYS)).toBe('2 b');       // the 2.4% body is icy: listed, not leading
    expect(row('iron')).toMatchObject({ held: 300, room: 0, bodies: 3, bestPct: 22 });
    expect(row('sulphur')).toMatchObject({ held: 0, room: 300, bodies: 1, bestPct: 30 });
    expect(row('sulphur').best.icy).toBe(true);                           // only an icy body carries it, so that is the richest
  });
  it('puts a material no colony body carries last, with no figure', () => {
    expect(row('tellurium')).toMatchObject({ bodies: 0, bestPct: null, best: null, room: 150 });
    expect(rows[rows.length - 1].material.id).toBe('tellurium');
  });
  it('orders by grade, then by best share', () => {
    expect(rows.map((r) => r.material.id)).toEqual(['tungsten', 'sulphur', 'iron', 'nickel', 'tellurium']);
  });
});

describe('short names', () => {
  it('drops the system from a body in its own system, and only then', () => {
    expect(shortBody(`${SYS} 2 b`, SYS)).toBe('2 b');
    expect(shortBody(`${SYS.toUpperCase()} 2 b`, SYS)).toBe('2 b');
    expect(shortBody('HIP 52629 A 2 a', SYS)).toBe('HIP 52629 A 2 a');
  });
  it('names a construction site by the port it will be', () => {
    expect(shortSite('Planetary Construction Site: Russo Expedition')).toBe('Russo Expedition');
    expect(shortSite('Orbital Construction Site: Rankin Legacy')).toBe('Rankin Legacy');
    expect(shortSite('Deshpande Plant')).toBe('Deshpande Plant');
  });
});
