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
const BIO_MIN = 2;

/**
 * Genera worth a 💰 flag, judged on BASE species values only (calibrated from the
 * user's 2026-08-11 Vista sale): Tubus 7.8–11.9M, Aleoida 3.4–12.9M, Stratum up to
 * 19M (Tectonicas), Cactoida up to 16.2M (Vermis), Concha up to ~16.8M (Biconcavis;
 * Renibus ~4.5M sold that night). First-logged ×5 is upside, never assumed —
 * someone else may have logged the variant already.
 */
const HIGH_VALUE_GENERA = new Set(['Tubus', 'Aleoida', 'Stratum', 'Cactoida', 'Concha']);

/**
 * FSS-time Tubus hint — the ONLY genus with a profile calibrated from the user's
 * own ledger (3 hits, edge-validated by near-misses): Rocky body · CO₂ atmosphere ·
 * 0.05–0.15 g · 160–190 K · no volcanism. The 156 K family missed it (too cold),
 * the 0.17 g rocky missed it (too heavy). An ESTIMATE — the card marks it "?" and
 * the DSS genus list replaces it. Other genera earn hints only when the ledger
 * supports a profile (Tussock is deliberately unhinted: 1M filler that co-resides
 * with Tubus anyway; Concha's two sightings are opposite regimes — no profile yet).
 */
function tubusLikely(b) {
  if (!b || !b.landable) return false;
  if (!/^Rocky body$/i.test(b.subTypeRaw || '')) return false;
  if (!/carbon ?dioxide/i.test(b.atmoRaw || '')) return false;
  if (b.gravityG == null || b.gravityG < 0.05 || b.gravityG > 0.15) return false;
  if (b.tempK == null || b.tempK < 160 || b.tempK > 190) return false;
  if (b.volcRaw && !/^(|none)$/i.test(b.volcRaw)) return false;
  return true;
}

const state = {
  systemAddress: null,
  systemName: null,
  honk: false,
  bodyCountFromHonk: 0,
  allFound: false,
  scannedBodies: new Map(), // bodyId -> { name, distLs, landable, bio, isPlanet }
  targets: new Map(),       // bodyId -> target row
  mappedBodyIds: new Set(), // SAAScanComplete seen this visit
  bioDone: new Map(),       // bodyId -> Set(species analysed) — exobio progress
  bodyGenera: new Map(),    // bodyId -> [genus names] — from DSS SAASignalsFound
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
  state.bioDone.clear();
  state.bodyGenera.clear();
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
    // Money first (💰 genera confirmed by DSS), then nearest.
    targets: [...state.targets.values()].sort((a, b) => (b.hot ? 1 : 0) - (a.hot ? 1 : 0) || (a.distLs || 0) - (b.distLs || 0)),
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

  // Exobio progress: species analysed vs signals present ("i may forget how many
  // remain"). A bio target auto-completes when every signal is analysed.
  const done = (state.bioDone.get(bodyId) || new Set()).size;
  const bioComplete = bioWorthy && done >= (b.bio || 0);
  const genera = state.bodyGenera.get(bodyId) || [];
  const hot = genera.some((g) => HIGH_VALUE_GENERA.has(g));
  // Estimate shown only until the DSS delivers facts.
  const hint = !genera.length && bioWorthy && tubusLikely(b) ? 'Tubus?' : null;

  state.targets.set(bodyId, {
    bodyId,
    bodyName: shortName(b.name),
    stars: worth ? worth.stars : '🧬',
    reasons,
    bio: bioWorthy ? b.bio : 0,
    bioDone: bioWorthy ? Math.min(done, b.bio) : 0,
    genera,
    hot,
    hint,
    distLs: Math.round(b.distLs || 0),
    far,
    mapped: state.mappedBodyIds.has(bodyId) || bioComplete || (existing ? existing.mapped : false),
    skipped: existing ? existing.skipped : false,
  });
}

/**
 * Adapt a journalExplorationCache body to the raw-Scan shape mapWorth expects,
 * so an already-FSS'd system can preload its targets (the game never re-emits
 * Scan events for bodies you've resolved — "I can't do it again").
 */
function cachedBodyToScanShape(b) {
  return {
    PlanetClass: b.starType ? undefined : b.subType,
    StarType: b.starType,
    TerraformState: b.terraformState,
    WasDiscovered: b.wasDiscovered,
    WasMapped: b.wasMapped,
  };
}

/**
 * Point the checklist at a system without a live FSDJump — server boot mid-session
 * (position from state) or arrival in a previously-scanned system. Preloads bodies
 * from the exploration cache and epic criteria from the stored score when given.
 * Previously-DSS'd bodies show unchecked (the old visit's SAA events aren't in the
 * cache) — tap-to-skip covers those honestly.
 */
export function checklistSeed(systemAddress, systemName, cachedSystem, epicView, organicScans) {
  if (systemAddress == null) return false;
  if (state.systemAddress === systemAddress) return false;
  reset(systemAddress, systemName || (cachedSystem && cachedSystem.systemName) || null);
  // Prior exobio progress from the organics ledger — species analysed on earlier
  // visits still count toward "how many remain".
  if (organicScans) {
    const prefix = `${systemAddress}|`;
    for (const [key, rec] of Object.entries(organicScans)) {
      if (!key.startsWith(prefix) || !rec) continue;
      const bodyId = Number(key.slice(prefix.length));
      if (!Number.isFinite(bodyId)) continue;
      state.bioDone.set(bodyId, new Set(rec.analysedSpecies || []));
      // Genera you've begun scanning are known even without a fresh DSS.
      if (Array.isArray(rec.genera) && rec.genera.length) state.bodyGenera.set(bodyId, rec.genera);
    }
  }
  if (cachedSystem && Array.isArray(cachedSystem.scannedBodies)) {
    state.honk = true;
    state.bodyCountFromHonk = cachedSystem.bodyCount || 0;
    state.allFound = !!cachedSystem.fssAllBodiesFound;
    for (const b of cachedSystem.scannedBodies) {
      if (b.bodyId == null) continue;
      if (!b.subType && !b.starType) continue;
      state.scannedBodies.set(b.bodyId, {
        name: b.bodyName,
        distLs: b.distanceToArrival ?? 0,
        landable: !!b.isLandable,
        bio: b.bioSignals || 0,
        worth: b.starType ? null : mapWorth(cachedBodyToScanShape(b)),
        subTypeRaw: b.subType || '',
        atmoRaw: b.atmosphereType || '',
        gravityG: b.gravity != null ? b.gravity / 9.81 : null,
        tempK: b.surfaceTemperature ?? null,
        volcRaw: b.volcanism || '',
      });
      evaluate(b.bodyId);
    }
  }
  if (epicView) checklistAddEpic(epicView);
  return true;
}

/** Feed one batch of parsed journal events through the checklist. Returns true if anything changed. */
export function checklistProcess(parsed, existing) {
  let changed = false;

  const seedFromState = (addr, name) => {
    const cached = existing && existing.journalExplorationCache ? existing.journalExplorationCache[String(addr)] : null;
    const scouted = existing && existing.scoutedSystems ? existing.scoutedSystems[String(addr)] : null;
    return checklistSeed(addr, name, cached, scouted && scouted.score ? scouted.score.epicView : null, existing && existing.organicScans);
  };

  for (const ev of parsed.fsdJumpEvents || []) {
    if (seedFromState(ev.SystemAddress, ev.StarSystem)) changed = true;
  }
  // Location fires on game boot / relog — seed if it names a DIFFERENT system than
  // we're tracking (never reset mid-system: Location also fires on foot/board).
  for (const ev of parsed.locationEvents || []) {
    if (ev.SystemAddress != null && ev.SystemAddress !== state.systemAddress) {
      if (seedFromState(ev.SystemAddress, ev.StarSystem)) changed = true;
    }
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
      subTypeRaw: ev.PlanetClass || '',
      atmoRaw: ev.AtmosphereType || ev.Atmosphere || '',
      gravityG: ev.SurfaceGravity != null ? ev.SurfaceGravity / 9.81 : null,
      tempK: ev.SurfaceTemperature ?? null,
      volcRaw: ev.Volcanism || '',
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
  // DSS body signals → the body's actual GENUS list (rings carry no Genuses, so
  // they filter themselves out). This is fact, not prediction.
  for (const ev of parsed.saaSignalsFoundEvents || []) {
    if (ev.SystemAddress !== state.systemAddress || ev.BodyID == null) continue;
    const genera = (ev.Genuses || []).map((g) => g.Genus_Localised || g.Genus).filter(Boolean);
    if (!genera.length) continue;
    state.bodyGenera.set(ev.BodyID, genera);
    evaluate(ev.BodyID);
    changed = true;
  }
  // ScanOrganic Analyse → per-body species progress on bio targets.
  for (const ev of parsed.scanOrganicEvents || []) {
    if (ev.SystemAddress !== state.systemAddress || ev.Body == null) continue;
    if (ev.ScanType !== 'Analyse') continue;
    const species = ev.Species_Localised || ev.Species;
    if (!species) continue;
    let set = state.bioDone.get(ev.Body);
    if (!set) state.bioDone.set(ev.Body, (set = new Set()));
    if (!set.has(species)) {
      set.add(species);
      evaluate(ev.Body); // refresh bioDone / auto-complete
      changed = true;
    }
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
