/**
 * Brain Tree detection helpers.
 *
 * Two notions:
 *  - **Confirmed** — stored in `bodyFlags[key].brainTrees` (set by a manual
 *    toggle or auto-set server-side from a brain-tree `CodexEntry` scan).
 *  - **Candidate** — *derived* here from body data: a body that meets the basic
 *    spawn conditions (landable + volcanic + surface temp 200–496 K), so it
 *    *could* host brain trees and is worth checking. Necessary-not-sufficient —
 *    proximity to Guardian ruins / ejecta craters isn't in any data — so expect
 *    false positives. Never stored.
 *
 * Conditions per Canonn / the ED wiki: brain trees require volcanism, occur on
 * landable worlds of any class, cluster in ejecta craters, and sit in roughly
 * the 200–496 K surface-temperature band.
 */

export const BRAINTREE_TEMP_MIN = 200; // K
export const BRAINTREE_TEMP_MAX = 496; // K

/** Body fields needed to assess brain-tree candidacy (subset of SpanshDumpBody). */
export interface BrainTreeBodyLike {
  isLandable?: boolean;
  volcanismType?: string | null;
  surfaceTemperature?: number;
}

/** A body that *could* host brain trees (landable + volcanic + in temperature band). */
export function isBrainTreeCandidate(b: BrainTreeBodyLike | null | undefined): boolean {
  if (!b || !b.isLandable) return false;
  const volc = (b.volcanismType || '').trim();
  if (!volc || /^no volcanism$/i.test(volc)) return false;
  const t = b.surfaceTemperature;
  return typeof t === 'number' && t >= BRAINTREE_TEMP_MIN && t <= BRAINTREE_TEMP_MAX;
}

/** Store key for per-body flags. MUST match the server's `${System}|${bodyName}`. */
export function bodyFlagKey(systemName: string, bodyName: string): string {
  return `${systemName}|${bodyName}`;
}

/**
 * Whether a CodexEntry's localised name is a Brain Tree. All colour variants
 * (Roseum, Lividum, Gypseeum, …) localise to "<Colour> Brain Tree"; the raw
 * `Name` is the genus `$Codex_Ent_Seed_Name;`, so match the localised text.
 */
export function isBrainTreeCodexName(nameLocalised: string | undefined | null): boolean {
  return !!nameLocalised && /brain tree/i.test(nameLocalised);
}
