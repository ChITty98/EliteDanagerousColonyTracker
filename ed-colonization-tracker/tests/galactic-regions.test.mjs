// The galactic regions: the vendored community grid decodes to the right region for places we know,
// and the generated table the Map draws from has one label per region and well-formed polylines.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { GALACTIC_REGION_LINES, GALACTIC_REGION_LABELS, GALACTIC_REGION_SOURCE } from '../src/data/galacticRegions.ts';

const d = JSON.parse(fs.readFileSync(new URL('../scripts/vendor/EliteDangerousRegionMap/RegionMapData.json', import.meta.url), 'utf8'));
const X0 = -49985, Z0 = -24105;
const regionAt = (x, z) => {
  const px = Math.floor((x - X0) * 83 / 4096), pz = Math.floor((z - Z0) * 83 / 4096);
  if (px < 0 || pz < 0 || pz >= d.regionmap.length) return null;
  let rx = 0;
  for (const [rl, pv] of d.regionmap[pz]) { if (px < rx + rl) return d.regions[pv]; rx += rl; }
  return null;
};

describe('galactic regions', () => {
  it('decodes the places every commander knows to the regions they are in', () => {
    expect(regionAt(0, 0)).toBe('Inner Orion Spur');                        // Sol
    expect(regionAt(-9530.5, 19808.125)).toBe('Inner Scutum-Centaurus Arm'); // Colonia
    expect(regionAt(25.21875, 25899.96875)).toBe('Galactic Centre');         // Sagittarius A*
    expect(regionAt(-1111.5625, 65269.75)).toBe('The Abyss');                // Beagle Point
    expect(regionAt(-49000, -24000)).toBeNull();                              // off the edge of the disc
  });

  it('ships 42 named regions, each with a label inside the galaxy', () => {
    expect(GALACTIC_REGION_LABELS.length).toBe(42);
    const names = new Set(GALACTIC_REGION_LABELS.map(([n]) => n));
    expect(names.size).toBe(42);
    for (const n of ['Inner Orion Spur', 'Galactic Centre', 'Norma Expanse', 'The Abyss', 'Empyrean Straits']) expect(names.has(n)).toBe(true);
    for (const [, x, z] of GALACTIC_REGION_LABELS) { expect(Math.abs(x)).toBeLessThan(60000); expect(z).toBeGreaterThan(-30000); expect(z).toBeLessThan(80000); }
  });

  it('draws boundaries as well-formed polylines that stay inside the grid', () => {
    expect(GALACTIC_REGION_LINES.length).toBeGreaterThan(50);
    for (const line of GALACTIC_REGION_LINES) {
      expect([0, 1]).toContain(line[0]);                 // rim flag
      expect((line.length - 1) % 2).toBe(0);              // pairs after it
      expect(line.length).toBeGreaterThanOrEqual(5);      // at least two points
      for (let i = 1; i < line.length; i += 2) { expect(Math.abs(line[i])).toBeLessThan(60000); expect(Math.abs(line[i + 1])).toBeLessThan(80000); }
    }
    // some of the lines are the rim of the galaxy, most are borders between named regions
    const rim = GALACTIC_REGION_LINES.filter((l) => l[0] === 1).length;
    expect(rim).toBeGreaterThan(0);
    expect(rim).toBeLessThan(GALACTIC_REGION_LINES.length);
  });

  it('credits the source', () => {
    expect(GALACTIC_REGION_SOURCE).toMatch(/Ben Peddell/);
    expect(GALACTIC_REGION_SOURCE).toMatch(/MIT/);
  });
});
