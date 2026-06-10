/**
 * Fixture tests for the canonical scorer (server/journal/scorer.js).
 * Locks the scoring model so refactors (and new components) can't silently
 * change scores: caps, icy exclusions, decay tiers, exotic-atmosphere ladder,
 * body filters, and exact body-string output.
 */
import { describe, it, expect } from 'vitest';
import {
  scoreSystem,
  emptyScore,
  exoticAtmoPoints,
  distanceDecay,
  filterQualifyingBodies,
  classifyStars,
  buildBodyString,
} from '../server/journal/scorer.js';
import {
  scoreSystem as shimScoreSystem,
  emptyScore as shimEmptyScore,
} from '../src/lib/scoutingScorer';

// --- fixture helpers -------------------------------------------------------

let nextId = 1;
function star(subType, { main = false, name } = {}) {
  const id = nextId++;
  return { bodyId: id, id64: 0, name: name ?? `T ${id}`, type: 'Star', subType, mainStar: main, distanceToArrival: 0 };
}
function planet({ subType = 'High metal content world', atmo = null, em = 1, dist = 100, landable = true, rings, parents, name } = {}) {
  const id = nextId++;
  return {
    bodyId: id, id64: 0, name: name ?? `T ${id}`, type: 'Planet',
    subType, isLandable: landable, earthMasses: em, distanceToArrival: dist,
    atmosphereType: atmo, rings, parents,
  };
}
function sys(...bodies) { return bodies; }

// --- shim is the same implementation ---------------------------------------

describe('scoutingScorer shim', () => {
  it('re-exports the exact canonical functions (single source of truth)', () => {
    expect(shimScoreSystem).toBe(scoreSystem);
    expect(shimEmptyScore).toBe(emptyScore);
  });
});

// --- emptyScore -------------------------------------------------------------

describe('emptyScore', () => {
  it('equals scoring an empty system (shape and values stay in sync)', () => {
    expect(emptyScore()).toEqual(scoreSystem([]));
  });
  it('returns fresh arrays each call (no shared references)', () => {
    const a = emptyScore();
    const b = emptyScore();
    expect(a.starDetails).not.toBe(b.starDetails);
    expect(a.uniqueEconomies).not.toBe(b.uniqueEconomies);
    expect(a.hazardousStars).not.toBe(b.hazardousStars);
  });
});

// --- distance decay tiers ----------------------------------------------------

describe('distanceDecay', () => {
  it('matches the documented tiers', () => {
    expect(distanceDecay(0)).toBe(1.0);
    expect(distanceDecay(3999)).toBe(1.0);
    expect(distanceDecay(4000)).toBe(0.7);
    expect(distanceDecay(9999)).toBe(0.7);
    expect(distanceDecay(10000)).toBe(0.4);
    expect(distanceDecay(19999)).toBe(0.4);
    expect(distanceDecay(20000)).toBe(0.15);
  });
});

// --- exotic atmosphere ladder -------------------------------------------------

describe('exoticAtmoPoints', () => {
  it('scores the rarity ladder, with -rich variants checked first', () => {
    expect(exoticAtmoPoints('Silicate vapour')).toBe(25);
    expect(exoticAtmoPoints('Hot thick Silicate vapour')).toBe(25);
    expect(exoticAtmoPoints('Neon')).toBe(25);
    expect(exoticAtmoPoints('Thin Neon')).toBe(25);
    expect(exoticAtmoPoints('Neon-rich')).toBe(0);
    expect(exoticAtmoPoints('Thin Neon-rich')).toBe(0);
    expect(exoticAtmoPoints('Argon-rich')).toBe(12);
    expect(exoticAtmoPoints('Argon')).toBe(4);
    expect(exoticAtmoPoints('Methane-rich')).toBe(8);
    expect(exoticAtmoPoints('Methane')).toBe(4);
    expect(exoticAtmoPoints('Water')).toBe(8);
    expect(exoticAtmoPoints('Water-rich')).toBe(0);
  });
  it('common atmospheres score nothing', () => {
    expect(exoticAtmoPoints('Carbon dioxide')).toBe(0);
    expect(exoticAtmoPoints('Sulphur dioxide')).toBe(0);
    expect(exoticAtmoPoints('Ammonia')).toBe(0);
    expect(exoticAtmoPoints('Nitrogen')).toBe(0);
    expect(exoticAtmoPoints('Oxygen')).toBe(0); // oxygen scored separately
    expect(exoticAtmoPoints(null)).toBe(0);
    expect(exoticAtmoPoints(undefined)).toBe(0);
  });
});

// --- body filter --------------------------------------------------------------

describe('filterQualifyingBodies', () => {
  it('excludes bodies with missing or >=2.5 earth masses', () => {
    const heavy = planet({ em: 2.5 });
    const noMass = planet({ em: null }); // null ≡ absent for the `?? 999` filter
    const ok = planet({ em: 2.4 });
    const qual = filterQualifyingBodies(sys(star('K (Yellow-Orange) Star', { main: true }), heavy, noMass, ok));
    expect(qual.map((q) => q.body.bodyId)).toEqual([ok.bodyId]);
  });
  it('excludes icy bodies without atmosphere, keeps icy with atmosphere', () => {
    const icyBare = planet({ subType: 'Icy body', atmo: null });
    const icyAtmo = planet({ subType: 'Icy body', atmo: 'Thin Oxygen' });
    const qual = filterQualifyingBodies(sys(star('K (Yellow-Orange) Star', { main: true }), icyBare, icyAtmo));
    expect(qual.map((q) => q.body.bodyId)).toEqual([icyAtmo.bodyId]);
  });
  it('excludes non-landable bodies', () => {
    const noLand = planet({ landable: false });
    expect(filterQualifyingBodies(sys(noLand))).toHaveLength(0);
  });
});

// --- scoring components ---------------------------------------------------------

describe('scoreSystem components', () => {
  it('oxygen on a non-icy body near the star: +15, flag set', () => {
    const s = star('K (Yellow-Orange) Star', { main: true });
    const r = scoreSystem(sys(s, planet({ atmo: 'Thin Oxygen', parents: [{ Star: s.bodyId }] })));
    expect(r.oxygenPoints).toBe(15);
    expect(r.oxygenCount).toBe(1);
    expect(r.hasOxygenAtmosphere).toBe(true);
  });

  it('icy oxygen body: no oxygen points, no flag, half atmosphere points', () => {
    const s = star('K (Yellow-Orange) Star', { main: true });
    const r = scoreSystem(sys(s, planet({ subType: 'Icy body', atmo: 'Thin Oxygen', parents: [{ Star: s.bodyId }] })));
    expect(r.oxygenPoints).toBe(0);
    expect(r.oxygenCount).toBe(0);
    expect(r.hasOxygenAtmosphere).toBe(false);
    expect(r.atmospherePoints).toBe(8); // round(15 * 1.0 decay * 0.5 icy)
  });

  it('oxygen decays with distance from arrival (primary-star bodies)', () => {
    const s = star('K (Yellow-Orange) Star', { main: true });
    const r5k = scoreSystem(sys(s, planet({ atmo: 'Thin Oxygen', dist: 5000, parents: [{ Star: s.bodyId }] })));
    expect(r5k.oxygenPoints).toBe(11); // round(15 * 0.7)
    const r25k = scoreSystem(sys(s, planet({ atmo: 'Thin Oxygen', dist: 25000, parents: [{ Star: s.bodyId }] })));
    expect(r25k.oxygenPoints).toBe(2); // round(15 * 0.15)
  });

  it('secondary-star bodies skip distance decay', () => {
    const a = star('K (Yellow-Orange) Star', { main: true });
    const b = star('M (Red dwarf) Star');
    const r = scoreSystem(sys(a, b, planet({ atmo: 'Thin Oxygen', dist: 50000, parents: [{ Star: b.bodyId }] })));
    expect(r.oxygenPoints).toBe(15);
  });

  it('caps: oxygen 45, exotic 50, rings 30, stars 60', () => {
    const s = star('K (Yellow-Orange) Star', { main: true });
    const oxy4 = scoreSystem(sys(s,
      planet({ atmo: 'Thin Oxygen', parents: [{ Star: s.bodyId }] }),
      planet({ atmo: 'Thin Oxygen', parents: [{ Star: s.bodyId }] }),
      planet({ atmo: 'Thin Oxygen', parents: [{ Star: s.bodyId }] }),
      planet({ atmo: 'Thin Oxygen', parents: [{ Star: s.bodyId }] }),
    ));
    expect(oxy4.oxygenPoints).toBe(45); // 4×15=60 → 45
    expect(oxy4.oxygenCount).toBe(4);

    const neon3 = scoreSystem(sys(s,
      planet({ atmo: 'Thin Neon', parents: [{ Star: s.bodyId }] }),
      planet({ atmo: 'Thin Neon', parents: [{ Star: s.bodyId }] }),
      planet({ atmo: 'Thin Neon', parents: [{ Star: s.bodyId }] }),
    ));
    expect(neon3.exoticPoints).toBe(50); // 3×25=75 → 50
    expect(neon3.exoticCount).toBe(3);

    const ring = { name: 'r', type: 'Rocky', innerRadius: 0, outerRadius: 0, mass: 0 };
    const rings3 = scoreSystem(sys(s,
      planet({ rings: [ring], parents: [{ Star: s.bodyId }] }),
      planet({ rings: [ring], parents: [{ Star: s.bodyId }] }),
      planet({ rings: [ring], parents: [{ Star: s.bodyId }] }),
    ));
    expect(rings3.ringPoints).toBe(30); // 3×15=45 → 30
    expect(rings3.ringCount).toBe(3);

    const ns4 = scoreSystem(sys(
      star('Neutron Star', { main: true }),
      star('Neutron Star'), star('Neutron Star'), star('Neutron Star'),
    ));
    expect(ns4.starPoints).toBe(60); // 4×20=80 → 60
  });

  it('exotic atmosphere on an icy body scores nothing', () => {
    const s = star('K (Yellow-Orange) Star', { main: true });
    const r = scoreSystem(sys(s, planet({ subType: 'Icy body', atmo: 'Thin Neon', parents: [{ Star: s.bodyId }] })));
    expect(r.exoticPoints).toBe(0);
    expect(r.exoticCount).toBe(0);
  });

  it('brown dwarf earns no star points', () => {
    const r = scoreSystem(sys(star('Y (Brown dwarf) Star', { main: true })));
    expect(r.starPoints).toBe(0);
  });

  it('proximity: two bodies within 100ls of each other under the same star', () => {
    const s = star('K (Yellow-Orange) Star', { main: true });
    const r = scoreSystem(sys(s,
      planet({ dist: 100, parents: [{ Star: s.bodyId }] }),
      planet({ dist: 150, parents: [{ Star: s.bodyId }] }),
    ));
    expect(r.proximityCount).toBe(1);
    expect(r.proximityPoints).toBe(3);
  });

  it('total is the sum of its components', () => {
    const s = star('Neutron Star', { main: true });
    const r = scoreSystem(sys(s,
      planet({ atmo: 'Thin Oxygen', parents: [{ Star: s.bodyId }] }),
      planet({ atmo: 'Thin Neon', dist: 150, parents: [{ Star: s.bodyId }] }),
    ));
    expect(r.total).toBe(
      r.starPoints + r.atmospherePoints + r.oxygenPoints + r.exoticPoints +
      r.ringPoints + r.proximityPoints + r.economyPoints + r.bodyCountPoints,
    );
  });
});

// --- body string (guards the glyph-builder consolidation) -----------------------

describe('buildBodyString', () => {
  it('renders the exact glyph string for a ringed oxygen HMC world', () => {
    const s = star('K (Yellow-Orange) Star', { main: true, name: 'T A' });
    const p = planet({
      atmo: 'Thin Oxygen',
      rings: [{ name: 'r', type: 'Rocky', innerRadius: 0, outerRadius: 0, mass: 0 }],
      parents: [{ Star: s.bodyId }],
      dist: 100,
    });
    const bodies = sys(s, p);
    const out = buildBodyString(filterQualifyingBodies(bodies), classifyStars(bodies));
    // ★A: 🟢💍◉(100ls)⛏️  (oxygen dot, ring, body marker, distance, Extraction economy)
    expect(out).toBe('★A: \u{1F7E2}\u{1F48D}◉(100ls)⛏\u{FE0F}');
  });
});
