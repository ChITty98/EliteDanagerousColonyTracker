// The Populated layer's store: gated to the bubble, upserts by name, counts what the stream added.
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initPopulatedStore, notePopulatedSystem, getPopulatedSystems, flushPopulatedStore, inBubble, BUBBLES, BUBBLE_CENTRE, BUBBLE_RADIUS_LY, _resetPopulatedStore } from '../server/radar/populatedStore.js';

describe('populated systems store', () => {
  beforeEach(() => { _resetPopulatedStore(); initPopulatedStore(null); });

  it('keeps a populated arrival inside the bubble and ignores the rest', () => {
    const c = BUBBLE_CENTRE;
    expect(notePopulatedSystem({ name: 'HIP 47126', id64: 1, pos: [c.x, c.y, c.z], population: 315102182, at: '2026-09-06T00:00:00Z' })).toBe(true);
    expect(notePopulatedSystem({ name: 'Far Away', id64: 2, pos: [c.x + BUBBLE_RADIUS_LY + 50, c.y, c.z], population: 1000 })).toBe(false);
    expect(notePopulatedSystem({ name: 'Empty', id64: 3, pos: [c.x + 10, c.y, c.z], population: 0 })).toBe(false);
    expect(notePopulatedSystem({ name: 'No position', id64: 4, pos: null, population: 5 })).toBe(false);
    const s = getPopulatedSystems();
    expect(s.count).toBe(1);
    expect(s.live).toBe(1);
    expect(s.systems[0]).toMatchObject({ name: 'HIP 47126', pop: 315102182, live: true });
  });

  it('upserts by name — a refreshed population replaces, an identical sighting only touches the time', () => {
    const c = BUBBLE_CENTRE;
    notePopulatedSystem({ name: 'Ega', id64: 9, pos: [c.x + 1, c.y, c.z], population: 100, at: '2026-09-01T00:00:00Z' });
    expect(notePopulatedSystem({ name: 'ega', pos: [c.x + 1, c.y, c.z], population: 100, at: '2026-09-02T00:00:00Z' })).toBe(false);
    expect(notePopulatedSystem({ name: 'EGA', pos: [c.x + 1, c.y, c.z], population: 250, at: '2026-09-03T00:00:00Z' })).toBe(true);
    const s = getPopulatedSystems();
    expect(s.count).toBe(1);
    expect(s.live).toBe(1);                       // one system, however many times it was seen
    expect(s.systems[0]).toMatchObject({ id64: 9, pop: 250, at: '2026-09-03T00:00:00.000Z' });
  });

  it('inBubble is the one gate — 700 ly around HIP 47126, 500 ly around Praea Euq AT-U d2-47', () => {
    const c = BUBBLE_CENTRE;
    expect(BUBBLES.length).toBe(2);
    expect(inBubble([c.x, c.y, c.z + 699])).toBe(true);
    expect(inBubble([c.x, c.y + 400, c.z + 701])).toBe(false);          // past the first, not in the second
    const p = BUBBLES[1];
    expect(inBubble([p.x, p.y, p.z + 499])).toBe(true);                // the far side of the Praea Euq bubble
    expect(inBubble([p.x, p.y, p.z + 501])).toBe(false);
    expect(inBubble([1, 2])).toBe(false);
    expect(inBubble(['a', 'b', 'c'])).toBe(false);
  });
  it('adopts a reseed written while running, and keeps what the stream added on top of it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edca-pop-'));
    const file = path.join(dir, 'populated-systems.json');
    const c = BUBBLE_CENTRE;
    fs.writeFileSync(file, JSON.stringify({ generatedAt: '2026-09-06T00:00:00Z', source: 'seed-a', live: 0, count: 1, systems: [{ name: 'Seed One', x: c.x + 1, y: c.y, z: c.z, pop: 10, live: false }] }));
    _resetPopulatedStore(); initPopulatedStore(dir);
    notePopulatedSystem({ name: 'Fresh Colony', pos: [c.x + 2, c.y, c.z], population: 500, at: '2026-09-06T01:00:00Z' });
    // the generator runs while the server is up: a newer, bigger file lands on disk
    const later = Date.now() + 5000;
    fs.writeFileSync(file, JSON.stringify({ generatedAt: '2026-09-07T00:00:00Z', source: 'seed-b', live: 0, count: 2, systems: [{ name: 'Seed One', x: c.x + 1, y: c.y, z: c.z, pop: 11, live: false }, { name: 'Seed Two', x: c.x + 3, y: c.y, z: c.z, pop: 20, live: false }] }));
    fs.utimesSync(file, later / 1000, later / 1000);
    const got = getPopulatedSystems();
    expect(got.source).toBe('seed-b');
    expect(got.systems.map((r) => r.name).sort()).toEqual(['Fresh Colony', 'Seed One', 'Seed Two']);
    expect(got.systems.find((r) => r.name === 'Seed One').pop).toBe(11);      // the reseed's reading
    expect(got.systems.find((r) => r.name === 'Fresh Colony').live).toBe(true); // the stream's row survived
    expect(flushPopulatedStore()).toBe(true);                                   // and the merge is what gets written
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).count).toBe(3);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ }
  });
});
