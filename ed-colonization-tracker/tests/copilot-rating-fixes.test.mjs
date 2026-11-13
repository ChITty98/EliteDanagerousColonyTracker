// Fixes from the commander's co-pilot ratings, 2026-10-29/30: never the gamer tag; an oxygen world is
// described by its type, not a 0.14% trace; a construction site in your own colony is yours from the
// first clearance; no orbital-only docking lines at a surface pad.
import { describe, it, expect } from 'vitest';
import { buildSnapshot, dossierFlavour } from '../server/ai/copilotContext.js';
import { buildStationDossier } from '../server/ai/copilotDossier.js';
import { pickCanned } from '../server/ai/copilotCanned.js';

const SYS = 'Col 173 Sector AX-J d9-52';

describe('co-pilot rating fixes', () => {
  it('addresses the commander as Commander, never by gamer tag', () => {
    const snap = buildSnapshot({ settings: { commanderName: 'VexMoor', copilotPersonality: 'tars' } });
    expect(snap).not.toContain('VexMoor');
    expect(snap).toMatch(/"Commander"/);
  });

  it('describes the atmosphere by its type — a sulphur trace does not make oxygen "sulphurous"', () => {
    const base = { traces: ['Sulphur dioxide'], gravityG: 0.45, tempK: null, volc: '', brainTrees: false, landings: 0, dockings: 0, timesHere: 0 };
    const oxy = dossierFlavour({ ...base, atmoType: 'Thin Oxygen' }).join(' | ');
    expect(oxy).toMatch(/thin oxygen atmosphere/);
    expect(oxy).not.toMatch(/sulph/i);
    const so2 = dossierFlavour({ ...base, atmoType: 'Thin Sulphur dioxide', traces: [] }).join(' | ');
    expect(so2).toMatch(/sulphurous/);
  });

  it('an airless world is told as airless: no "none atmosphere", nothing tinting the sky', () => {
    const base = { traces: [], gravityG: 0.24, tempK: null, volc: '', brainTrees: false, landings: 0, dockings: 0, timesHere: 0 };
    for (const t of ['None', 'No atmosphere', 'none']) {
      const s = dossierFlavour({ ...base, atmoType: t }).join(' | ');
      expect(s).toMatch(/no atmosphere/);
      expect(s).not.toMatch(/none atmosphere|tints the sky/i);
    }
    expect(dossierFlavour({ ...base, atmoType: '' }).join(' | ')).not.toMatch(/atmosphere/); // nothing on file: nothing said
  });

  it('a construction site in your own colony is your build on the very first clearance', () => {
    const state = {
      commanderPosition: { systemName: SYS, coordinates: { x: 0, y: 0, z: 0 } },
      knownSystems: { [SYS]: { systemName: SYS, population: 308927814 } },
      manualColonizedSystems: [SYS],
      projects: [],
      knownStations: {},
    };
    const ev = { event: 'DockingGranted', StationName: 'Planetary Construction Site: Forward Vista', StationType: 'PlanetaryConstructionDepot', MarketID: 4399169539, timestamp: new Date().toISOString() };
    const d = buildStationDossier({ ev, state, persona: 'tars', memory: {}, nearby: null });
    expect(d.identity.systemName).toBe(SYS);
    expect(d.identity.builtByYou).toBe(true);
    expect(d.facts.find((f) => f.id === 'history.built').text).toMatch(/own construction site/);
    expect(d.facts.some((f) => f.id === 'pop')).toBe(true); // system facts are back on a first visit
  });

  it('never picks an orbital-only docking line at a surface pad', () => {
    const seen = new Set();
    for (let i = 0; i < 80; i++) seen.add(pickCanned('tars', 'docked', { surface: true, station: 'X', system: SYS }));
    expect([...seen].some((l) => /rotat/i.test(l))).toBe(false);
    const orbital = new Set();
    for (let i = 0; i < 80; i++) orbital.add(pickCanned('tars', 'docked', { surface: false, station: 'X', system: SYS }));
    expect([...orbital].some((l) => /rotat/i.test(l))).toBe(true);
  });
});
