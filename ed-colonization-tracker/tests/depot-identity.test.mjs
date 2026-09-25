/**
 * depotIdentity — a construction project's names for a market id, from whatever has seen the
 * depot. Guards the Kewell Range case (2026-09-14): the watcher skips history on boot, saw a
 * depot event without its Docked event, and created "Depot 4389829123 ()" with nothing to fill
 * the blanks later.
 */
import { describe, it, expect } from 'vitest';
import { depotIdentity, depotProjectName, depotRename } from '../server/journal/util.js';

const MID = 4389829123;
const docked = {
  event: 'Docked', MarketID: MID, StationName: 'Planetary Construction Site: Kewell Range',
  StationType: 'PlanetaryConstructionDepot', StarSystem: 'Col 173 Sector AX-J d9-52', SystemAddress: 1797401856371,
};
const dossier = { [String(MID)]: { marketId: MID, stationName: 'Planetary Construction Site: Kewell Range', stationType: 'PlanetaryConstructionDepot', systemName: 'Col 173 Sector AX-J d9-52', systemAddress: 1797401856371 } };

describe('depotIdentity', () => {
  it('takes the Docked event in the batch first', () => {
    expect(depotIdentity(MID, { dockedEvents: [docked] })).toEqual({
      stationName: 'Planetary Construction Site: Kewell Range',
      systemName: 'Col 173 Sector AX-J d9-52',
      systemAddress: 1797401856371,
      stationType: 'PlanetaryConstructionDepot',
    });
  });

  it('falls back to the persisted current dock, then the station dossier', () => {
    const fromDock = depotIdentity(MID, { currentDock: { marketId: MID, stationName: 'Planetary Construction Site: Kewell Range', systemName: 'Col 173 Sector AX-J d9-52' } });
    expect(fromDock.systemName).toBe('Col 173 Sector AX-J d9-52');
    expect(fromDock.stationName).toBe('Planetary Construction Site: Kewell Range');
    expect(fromDock.systemAddress).toBeNull(); // the dock record carries no address
    const fromDossier = depotIdentity(MID, { knownStations: dossier });
    expect(fromDossier.systemAddress).toBe(1797401856371);
    expect(fromDossier.stationType).toBe('PlanetaryConstructionDepot');
  });

  it('is blank when nobody has seen the depot — and the name is "Depot <marketId>"', () => {
    const none = depotIdentity(MID, {});
    expect(none).toEqual({ stationName: '', systemName: '', systemAddress: null, stationType: '' });
    expect(depotProjectName(none, MID)).toBe('Depot 4389829123');
  });

  it('never borrows another market id', () => {
    const other = { ...docked, MarketID: 1 };
    const ident = depotIdentity(MID, { dockedEvents: [other], currentDock: { marketId: 2, stationName: 'X', systemName: 'Y' }, knownStations: { '1': { ...dossier[String(MID)], marketId: 1 } } });
    expect(ident.systemName).toBe('');
  });

  it('builds "System - Station" for the project name', () => {
    expect(depotProjectName(depotIdentity(MID, { dockedEvents: [docked] }), MID))
      .toBe('Col 173 Sector AX-J d9-52 - Planetary Construction Site: Kewell Range');
  });
});

describe('depotRename — a site renamed while still under construction', () => {
  const RID = 4391682051;
  const OLD = 'Planetary Construction Site: Espinoza Obligation';
  const NEW = 'Planetary Construction Site: Core Boson Complex Cbc';
  const project = { id: 'p', name: `Col 173 Sector AX-J d9-52 - ${OLD}`, systemName: 'Col 173 Sector AX-J d9-52', stationName: OLD, marketId: RID };
  const dockedAs = (name, type = 'PlanetaryConstructionDepot') => ({ ...docked, MarketID: RID, StationName: name, StationType: type });

  it('follows the rename: the station name, and the auto-built display name with it', () => {
    expect(depotRename(project, depotIdentity(RID, { dockedEvents: [dockedAs(NEW)] }), RID))
      .toEqual({ stationName: NEW, name: `Col 173 Sector AX-J d9-52 - ${NEW}` });
  });

  it('leaves a display name the commander typed alone', () => {
    expect(depotRename({ ...project, name: 'Silo two' }, depotIdentity(RID, { dockedEvents: [dockedAs(NEW)] }), RID))
      .toEqual({ stationName: NEW });
  });

  it('is null when nothing changed, when nobody has seen the depot, or when the name is the finished station', () => {
    expect(depotRename(project, depotIdentity(RID, { dockedEvents: [dockedAs(OLD)] }), RID)).toBeNull();
    expect(depotRename(project, depotIdentity(RID, {}), RID)).toBeNull();
    expect(depotRename(project, depotIdentity(RID, { dockedEvents: [dockedAs('Core Boson Complex', 'Outpost')] }), RID)).toBeNull(); // completion is the depot's own path
  });

  it('takes the rename from the persisted current dock when the Docked event is not in the batch', () => {
    expect(depotRename(project, depotIdentity(RID, { currentDock: { marketId: RID, stationName: NEW, systemName: 'Col 173 Sector AX-J d9-52' } }), RID))
      .toEqual({ stationName: NEW, name: `Col 173 Sector AX-J d9-52 - ${NEW}` });
  });
});
