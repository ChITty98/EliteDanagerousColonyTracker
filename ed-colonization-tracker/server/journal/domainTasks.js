// server/journal/domainTasks.js
//
// Things worth doing in the commander's OWN systems — ring scans, unfinished FSS sweeps, systems
// never photographed.
//
// SCOPED TO THE SYSTEM THE COMMANDER IS STANDING IN. Domain-wide this is 60+ entries and unusable
// on a second screen; scoped to where they just jumped it answers the only question that matters in
// the moment — what is worth doing HERE, before I leave. Nothing outside the current system appears.
//
// ORDERED BY DISTANCE FROM THE ARRIVAL STAR, always. That is the commander's stated rule and it
// does the filtering that a threshold would otherwise have to: the 43 Ls ring sits at the top, the
// 300,000 Ls iceball sinks to the bottom on its own. Nothing is hidden for being far — it just
// stops competing for attention.
//
// DISMISSAL IS PERMANENT. "I may never do them" was the whole point, so a dismissed task must never
// resurface — not on a rescan, not on a restart, not when the underlying data is rebuilt. Ids are
// therefore derived from stable identity (kind + target name), never from array position or a
// timestamp, because an id that drifts silently un-dismisses the thing it named.

/** Stable, lowercase, position-independent. Changing this shape orphans existing dismissals. */
export function taskId(kind, target) {
  return `${kind}:${String(target || '').toLowerCase()}`;
}

const KINDS = {
  ring:  { label: 'DSS the ring', icon: '\u{1F4A0}' },
  fss:   { label: 'Finish the FSS sweep', icon: '\u{1F52D}' },
  photo: { label: 'No photographs yet', icon: '\u{1F4F8}' },
};

/**
 * Which domain systems already have gallery images.
 *
 * Gallery keys look like `system:<name>`, optionally with `:body:<name>` or `:station:<name>`
 * appended — so the system is everything between the first `system:` and the next segment marker.
 */
function photographedSystems(gallery) {
  const out = new Set();
  for (const key of Object.keys(gallery || {})) {
    const m = /^system:([^:]+)/.exec(String(key));
    if (m) out.add(m[1].toLowerCase());
  }
  return out;
}

/**
 * Build the list.
 *
 * `unmappedRings` comes from miningIndex.getUnmappedRings() — already scoped to these systems.
 * `gallery` is the raw gallery map (key -> images). `dismissed` is the persisted id set.
 */
export function buildDomainTasks(state, unmappedRings, gallery, { system = '', includeDismissed = false } = {}) {
  const dismissed = new Set(Object.keys(state?.dismissedTasks || {}));
  const only = String(system || '').toLowerCase();
  const here = (name) => !only || String(name || '').toLowerCase() === only;
  const tasks = [];

  // 1. Rings seen but never deep-scanned. The highest-value entry: without a DSS pass the tracker
  //    cannot know what a ring concentrates, so these are invisible to every other feature.
  for (const r of unmappedRings || []) {
    if (!here(r.system)) continue;
    tasks.push({
      id: taskId('ring', r.name),
      kind: 'ring',
      title: r.name,
      systemName: r.system || '',
      detail: [r.ringClass, r.reserve].filter(Boolean).join(' · '),
      distanceLs: r.depthLs ?? null,
    });
  }

  // 2. Systems where the honk never finished. bodyCount is what the discovery scan promised;
  //    scannedBodies is what was actually resolved.
  const colony = new Set();
  for (const p of state?.projects || []) {
    const n = p && (p.systemName || p.system);
    if (n) colony.add(String(n));
  }
  for (const n of state?.manualColonizedSystems || []) colony.add(String(n));
  const colonyLower = new Set([...colony].map((s) => s.toLowerCase()));

  for (const c of Object.values(state?.journalExplorationCache || {})) {
    if (!c || !c.systemName) continue;
    if (!colonyLower.has(String(c.systemName).toLowerCase())) continue;
    if (!here(c.systemName)) continue;
    const total = Number(c.bodyCount) || 0;
    const done = Number(c.scannedBodies) || 0;
    if (c.fssAllBodiesFound || !total || done >= total) continue;
    tasks.push({
      id: taskId('fss', c.systemName),
      kind: 'fss',
      title: c.systemName,
      systemName: c.systemName,
      detail: `${done} of ${total} bodies resolved`,
      // A whole system has no single distance; sort it with the nearest work.
      distanceLs: 0,
    });
  }

  // 3. Systems you hold but have never photographed.
  const shot = photographedSystems(gallery);
  for (const name of colony) {
    if (!here(name)) continue;
    if (shot.has(name.toLowerCase())) continue;
    tasks.push({
      id: taskId('photo', name),
      kind: 'photo',
      title: name,
      systemName: name,
      detail: 'nothing in the gallery',
      distanceLs: 0,
    });
  }

  const visible = includeDismissed ? tasks : tasks.filter((t) => !dismissed.has(t.id));

  // Distance first, always. Unknown distances sort last rather than pretending to be near.
  visible.sort((a, b) =>
    (a.distanceLs ?? Number.MAX_SAFE_INTEGER) - (b.distanceLs ?? Number.MAX_SAFE_INTEGER) ||
    String(a.title).localeCompare(String(b.title)));

  return {
    system: system || null,
    inDomain: !only || colonyLower.has(only),
    tasks: visible.map((t) => ({ ...t, label: KINDS[t.kind]?.label || t.kind, icon: KINDS[t.kind]?.icon || '' })),
    total: tasks.length,
    dismissedHere: tasks.length - visible.length,
    dismissedCount: dismissed.size,
  };
}
