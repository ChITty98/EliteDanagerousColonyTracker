// server/journal/navLock.js
//
// The commander's NAV-LOCKED destination, lifted from Status.json.
//
// WHY THIS EXISTS: the journal never records what you targeted. There is no nav-lock event of any
// kind — verified 2026-08-28 against a full 63-rock session, whose only SupercruiseDestinationDrop
// records were the fleet carrier at either end. Status.json DOES carry it, but that file is a live
// snapshot overwritten every few seconds and never archived, so the value has to be caught as it
// passes or it is gone forever.
//
// WHY IT MATTERS: hotspots have no in-ring position, so until now "was this rock mined in a hotspot"
// was ground truth only the commander could supply by hand (see miningLog.js annotations). The
// nav lock closes that gap automatically — you flew to the hotspot, so the game knows which one.
//
// THE SHAPE, captured live on 2026-08-28 while nav-locked onto a Tritium hotspot:
//   "Destination": { "System": 11348075190362, "Body": 42,
//                    "Name": "$SAA_RingHotspot:#type=$Tritium_name;;",
//                    "Name_Localised": "Tritium Hotspot" }
// Three gifts in that one line: the $SAA_RingHotspot: prefix SELF-IDENTIFIES a hotspot (so "not a
// hotspot" is a string test, not a guess), the material arrives in the same $x_name; token the rest
// of the journal uses (so commodityKey resolves it unchanged), and Body is the ring's own BodyID.
//
// Deliberately generic: this stores whatever was locked, and callers decide what it means. Surface
// mining's Planetary Mining Locations are expected to arrive through the same field.

import { commodityKey } from './miningMissions.js';

let lock = null; // { name, nameLocalised, system, body, at } — or null when nothing is locked

/** Record the current Status.json Destination. Called from the status poll on every write. */
export function setNavLock(d) {
  lock = d && d.name ? d : null;
  return lock;
}

export function getNavLock() { return lock; }

// "$SAA_RingHotspot:#type=$Tritium_name;;" → "$Tritium_name". The trailing semicolons are the
// game's own token terminators doubled up; the lazy group stops before them.
const RING_HOTSPOT_RE = /^\$SAA_RingHotspot:#type=(.+?);*$/;

/**
 * Resolve a nav lock into a ring hotspot, or null when it is anything else (a station, a body, the
 * fleet carrier, nothing at all).
 *
 * `systemAddress` guards against a stale lock from a previous system leaking into this ring's
 * attribution — same-system is the commander's stated bar, and the ring visit is short enough that
 * no separate time window is needed.
 */
export function ringHotspotFromNavLock(navLock, systemAddress) {
  if (!navLock || !navLock.name) return null;
  if (systemAddress != null && navLock.system != null && String(navLock.system) !== String(systemAddress)) return null;
  const m = RING_HOTSPOT_RE.exec(String(navLock.name));
  if (!m) return null; // not a hotspot — and per the commander's rule, that settles it
  const material = commodityKey(m[1]);
  if (!material) return null;
  return { material, body: navLock.body ?? null, label: navLock.nameLocalised || '' };
}
