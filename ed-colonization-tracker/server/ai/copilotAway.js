/**
 * "Away team" state — is the commander OUT of the big ship right now?
 *
 * The Nomad is an SRV (journal `SRVType: "lander01"`), deployed from the ship and
 * returned to it. Crucially the big ship FOLLOWS the deployed vehicle around
 * (verified by the commander in the field) — so the co-pilot left aboard is not
 * reading a telemetry feed from orbit, they are station-keeping directly overhead
 * with EYES ON. That's the conceit this module exists to support: every persona
 * line while the commander is away should imply "I'm up here in the <ship>,
 * watching you down there".
 *
 * Three nested states, all the same answer for where the co-pilot is:
 *   in the SRV        — LaunchSRV → DockSRV
 *   on foot from it   — Disembark(SRV: true) → Embark
 *   on foot from ship — Disembark(OnPlanet, no SRV) → Embark  (ship is landed, so
 *                       the co-pilot is in the parked ship rather than overhead)
 *
 * NOT to be confused with the single-seat "crammed in the cargo hold" gag
 * (copilotContext.detectCargoBayGripe) — that's about a hull with no second seat
 * and is suppressed while away, because its premise is wrong out here.
 */

// Journal SRV type ids → display names. lander01 = Nomad (ARX EA, June 2026).
// mev_rhino = Rhino, the surface-mining SRV (2026-09-02, game 4.4.1.0 build r332753). Id confirmed
// from three sources: RestockVehicle.Type, LaunchSRV.SRVType, and the in-cockpit HUD. It needs the
// Mk II Large Planetary Vehicle Hangar (int_mkiilargebuggybay_size4_class3), so it only appears on
// ships outfitted for it — but the hull-overwrite below applies the moment you log in inside one.
const SRV_NAMES = {
  lander01: 'Nomad',
  testbuggy: 'Scarab',
  combat_multicrew_srv_01: 'Scorpion',
  mev_rhino: 'Rhino',
};

/** SRV type ids are NOT ship hulls — LoadGame reports "Lander01" as Ship when you
 *  log in inside one, which would otherwise overwrite the real hull everywhere. */
const SRV_TYPE_IDS = new Set(Object.keys(SRV_NAMES));

export function isSrvType(t) {
  return SRV_TYPE_IDS.has(String(t || '').toLowerCase());
}

export function srvDisplayName(t) {
  return SRV_NAMES[String(t || '').toLowerCase()] || 'SRV';
}

const state = {
  inSrv: false,
  srvType: null,     // 'lander01'
  onFoot: false,
  fromSrv: false,    // on foot having stepped out of the SRV (vs out of the ship)
  motherShip: null,  // hull id of the ship we left behind — it follows us
  since: null,
};

/** The hull the co-pilot is sitting in. Captured before launch, never an SRV. */
export function noteMotherShip(hullId) {
  if (!hullId || isSrvType(hullId)) return;
  state.motherShip = String(hullId).toLowerCase();
}

export function awayState() {
  return { ...state, away: state.inSrv || state.onFoot };
}

/**
 * Fold one parsed tick into the away state. Returns true when the state changed
 * (so callers can fire an arrival/departure beat).
 */
export function awayProcess(parsed, stateSnapshot) {
  let changed = false;

  // Seed the mothership from persisted state on first use / after a restart.
  if (!state.motherShip && stateSnapshot && stateSnapshot.currentShip) {
    const cs = stateSnapshot.currentShip;
    noteMotherShip(typeof cs === 'object' ? cs.type : cs);
  }

  for (const ev of parsed.launchSrvEvents || []) {
    state.inSrv = true;
    state.srvType = String(ev.SRVType || 'lander01').toLowerCase();
    state.since = ev.timestamp;
    changed = true;
  }
  for (const ev of parsed.dockSrvEvents || []) {
    state.inSrv = false;
    state.onFoot = false;
    state.fromSrv = false;
    state.srvType = String(ev.SRVType || state.srvType || '').toLowerCase() || null;
    state.since = ev.timestamp;
    changed = true;
  }
  for (const ev of parsed.disembarkEvents || []) {
    if (!ev.OnPlanet && !ev.SRV) continue; // station/ship interior walking isn't "away"
    state.onFoot = true;
    state.fromSrv = !!ev.SRV;
    if (ev.SRV) state.inSrv = false; // stepped OUT of the SRV; it's parked beside us
    state.since = ev.timestamp;
    changed = true;
  }
  for (const ev of parsed.embarkEvents || []) {
    state.onFoot = false;
    if (ev.SRV) state.inSrv = true;   // climbed back into the Nomad
    state.since = ev.timestamp;
    changed = true;
  }

  return changed;
}

/**
 * The context fact injected into EVERY beat while away, so existing lines reframe
 * themselves instead of needing new ones. Returns null when aboard.
 * `shipLabel` is a friendly hull name resolved by the caller (extractor.friendlyShip).
 */
export function awayContextFact(shipLabel) {
  if (!state.inSrv && !state.onFoot) return null;
  const ship = shipLabel || 'the ship';
  const srv = srvDisplayName(state.srvType);

  if (state.inSrv) {
    return `The commander is NOT aboard — they are out driving the ${srv}, a one-person surface vehicle. `
      + `YOU are in the ${ship}, which follows the ${srv} automatically, station-keeping overhead: you can `
      + `SEE them down there on the surface. Speak from up here, watching. Never imply you are in the ${srv} `
      + `with them, and never imply you are in a cargo hold.`;
  }
  if (state.fromSrv) {
    return `The commander is NOT aboard — they are ON FOOT on the surface, having stepped out of the ${srv}, `
      + `which is parked beside them. YOU are in the ${ship} holding station overhead and can SEE both of them: `
      + `a parked vehicle and a very small figure walking around. Speak from up here, watching.`;
  }
  return `The commander is NOT aboard — they are ON FOOT on the surface. YOU are in the ${ship}, `
    + `which is landed nearby. Speak from the ship, watching them out there.`;
}
