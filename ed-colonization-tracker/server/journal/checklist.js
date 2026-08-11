/**
 * 🧭 Exploration checklist — per-current-system, journal-driven, self-checking.
 *
 * The journal reports every completion state: honk (FSSDiscoveryScan), full FSS
 * (FSSAllBodiesFound), and each DSS (SAAScanComplete per body) — so rows tick
 * themselves as the commander flies. Manual input is only "skip this one".
 *
 * Distance rule ("unless it's super valuable, I don't want to go out beyond 40k
 * Ls"): ★★ terraformables and bio targets beyond DIST_CAP_LS are not listed
 * (counted in farSkipped); ★★★ bodies (ELW / water / ammonia) are always listed,
 * flagged `far`, distance shown — a far first-discovery water world is the
 * commander's call, not silently hidden.
 *
 * In-memory per visit: a server restart mid-system forgets skips (never scans —
 * those are journal-derived and re-accumulate).
 */
import { mapWorth } from './mapWorth.js';

const DIST_CAP_LS = 40_000;
const BIO_MIN = 3;

const state = {
  systemAddress: null,
  systemName: null,
  honk: false,
  bodyCountFromHonk: 0,
  allFound: false,
  scannedBodies: new Map(), // bodyId -> { name, distLs, landable, bio, isPlanet }
  targets: new Map(),       // bodyId -> target row
  mappedBodyIds: new Set(), // SAAScanComplete seen this visit
  farSkipped: 0,
};

function reset(systemAddress, systemName) {
  state.systemAddress = systemAddress ?? null;
  state.systemName = systemName ?? null;
  state.honk = false;
  state.bodyCountFromHonk = 0;
  state.allFound = false;
  state.scannedBodies.clear();
  state.targets.clear();
  state.mappedBodyIds.clear();
  state.farSkipped = 0;
}

function shortName(bodyName) {
  const sys = state.systemName;
  return sys && bodyName && bodyName.startsWith(sys) ? bodyName.slice(sys.length).trim() || bodyName : bodyName;
}

export function checklistSnapshot() {
  return {
    system: state.systemName,
    systemAddress: state.systemAddress,
    honk: state.honk,
    bodyCountFromHonk: state.bodyCountFromHonk,
    scanned: state.scannedBodies.size,
    allFound: state.allFound,
    targets: [...state.targets.values()].sort((a, b) => (a.distLs || 0) - (b.distLs || 0)),
    farSkipped: state.farSkipped,
    updatedAt: new Date().toISOString(),
  };
}

/** Re-evaluate one body against the target rules (called on Scan and on signals). */
function evaluate(bodyId) {
  const b = state.scannedBodies.get(bodyId);
  if (!b) return;
  const existing = state.targets.get(bodyId);

  // Map-worthiness came from the Scan event itself (stored on the body record).
  const worth = b.worth;
  const bioWorthy = b.landable && (b.bio || 0) >= BIO_MIN;
  if (!worth && !bioWorthy) return;

  const far = (b.distLs || 0) > DIST_CAP_LS;
  // Distance rule: only ★★★ survives beyond the cap.
  if (far && !(worth && worth.tier === 3)) {
    if (!existing) state.farSkipped++;
    else state.targets.delete(bodyId); // e.g. bio count arrived for an already-far body
    return;
  }

  const reasons = [];
  if (worth) reasons.push(...worth.reasons);
  if (bioWorthy) reasons.push(`${b.bio} bio signals`);

  state.targets.set(bodyId, {
    bodyId,
    bodyName: shortName(b.name),
    stars: worth ? worth.stars : '🧬',
    reasons,
    distLs: Math.round(b.distLs || 0),
    far,
    mapped: state.mappedBodyIds.has(bodyId) || (existing ? existing.mapped : false),
    skipped: existing ? existing.skipped : false,
  });
}

/** Feed one batch of parsed journal events through the checklist. Returns true if anything changed. */
export function checklistProcess(parsed) {
  let changed = false;

  for (const ev of parsed.fsdJumpEvents || []) {
    reset(ev.SystemAddress, ev.StarSystem);
    changed = true;
  }
  for (const ev of parsed.fssDiscoveryScanEvents || []) {
    if (state.systemAddress === null) reset(ev.SystemAddress, ev.SystemName || null);
    if (ev.SystemAddress !== state.systemAddress) continue;
    state.honk = true;
    state.bodyCountFromHonk = ev.BodyCount || 0;
    changed = true;
  }
  for (const ev of parsed.scanEvents || []) {
    if (ev.SystemAddress !== state.systemAddress || ev.BodyID == null) continue;
    if (ev.PlanetClass === 'Belt Cluster') continue;
    if (!ev.PlanetClass && !ev.StarType) continue;
    const prev = state.scannedBodies.get(ev.BodyID) || {};
    state.scannedBodies.set(ev.BodyID, {
      name: ev.BodyName,
      distLs: ev.DistanceFromArrivalLS ?? prev.distLs ?? 0,
      landable: !!ev.Landable,
      bio: prev.bio || 0,
      worth: ev.PlanetClass ? mapWorth(ev) : null,
    });
    evaluate(ev.BodyID);
    changed = true;
  }
  for (const ev of parsed.fssBodySignalsEvents || []) {
    if (ev.SystemAddress !== state.systemAddress || ev.BodyID == null) continue;
    const bio = (ev.Signals || []).find((s) => String(s.Type).includes('Biological'));
    if (!bio) continue;
    const b = state.scannedBodies.get(ev.BodyID);
    if (b) { b.bio = bio.Count; evaluate(ev.BodyID); }
    else state.scannedBodies.set(ev.BodyID, { name: ev.BodyName, distLs: 0, landable: false, bio: bio.Count, worth: null });
    changed = true;
  }
  for (const ev of parsed.fssAllBodiesFoundEvents || []) {
    if (ev.SystemAddress !== state.systemAddress) continue;
    state.allFound = true;
    changed = true;
  }
  for (const ev of parsed.saaScanCompleteEvents || []) {
    if (ev.SystemAddress != null && ev.SystemAddress !== state.systemAddress) continue;
    if (ev.BodyID == null) continue;
    state.mappedBodyIds.add(ev.BodyID);
    const t = state.targets.get(ev.BodyID);
    if (t) { t.mapped = true; t.skipped = false; }
    changed = true;
  }
  // ApproachBody auto-checks EPIC targets — flying to the view counts as done.
  for (const ev of parsed.approachBodyEvents || []) {
    if (ev.SystemAddress !== state.systemAddress || ev.BodyID == null) continue;
    const t = state.targets.get(ev.BodyID);
    if (t && t.kind === 'epic' && !t.mapped) { t.mapped = true; t.skipped = false; changed = true; }
  }

  return changed;
}

/**
 * Epic-view criteria become GO-SEE targets. Called by the overlay after scoring
 * (that's where full-system geometry gets computed). Reason strings name their
 * bodies ("2 a — skims the ring edge of 2", "A 13 c & A 13 d — twin worlds, 28°"),
 * so resolve each named body against this visit's scans for the ApproachBody
 * auto-check; star-pair criteria (no approachable body) list unresolved and are
 * tap-to-skip only. Epic counts as "super valuable": always listed, far-flagged.
 */
export function checklistAddEpic(epicView) {
  if (!epicView || !epicView.isEpic || !Array.isArray(epicView.reasons)) return false;
  let changed = false;
  const byShort = new Map();
  for (const [id, b] of state.scannedBodies) byShort.set(shortName(b.name), { id, b });

  for (const reason of epicView.reasons) {
    const [left, right] = String(reason).split(' — ');
    if (!right) continue;
    const names = left.split(' & ').map((s) => s.trim()).filter(Boolean);
    for (const n of names) {
      const hit = byShort.get(n);
      const key = hit ? hit.id : `epic:${n}`;
      const already = state.targets.get(key);
      if (already) {
        // Body is also a map/bio target — keep its DSS auto-check, add the epic reason.
        if (!already.reasons.includes(right)) { already.reasons.push(right); changed = true; }
        continue;
      }
      state.targets.set(key, {
        bodyId: hit ? hit.id : null,
        bodyName: n,
        kind: 'epic',
        stars: '✨',
        reasons: [right],
        distLs: hit ? Math.round(hit.b.distLs || 0) : 0,
        far: hit ? (hit.b.distLs || 0) > DIST_CAP_LS : false,
        mapped: false,
        skipped: false,
      });
      changed = true;
    }
  }
  return changed;
}

/** Manual "not going" toggle from the 2nd screen. */
export function checklistSetSkipped(bodyId, skipped) {
  const t = state.targets.get(Number(bodyId)) ?? state.targets.get(String(bodyId));
  if (!t) return false;
  t.skipped = !!skipped;
  return true;
}
