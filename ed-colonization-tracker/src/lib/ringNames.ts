/**
 * Readable ring labels.
 *
 * Elite names rings with an UPPERCASE letter and moons with a lowercase one, so a gas giant's
 * first ring is "HIP 52629 A 4 A Ring" while its first moon is "HIP 52629 A 4 a". At a glance
 * those are the same string, and "a ring at A 4 A" reads as a body that does not exist — which
 * is exactly how it was misread in practice.
 *
 * The letter is positional: A is innermost, then B, C, D outward. So the letter can simply be
 * said out loud, which removes the collision entirely.
 *
 *   HIP 52629 A 4 A Ring  ->  A 4 · inner ring
 *   HIP 52629 A 9 B Ring  ->  A 9 · outer ring
 *
 * DISPLAY ONLY. The raw name is the storage key — mining-log rows, hotspot marks and the ring
 * index all join on it, and rewriting it is what orphaned 45 rocks once already. Format at the
 * edge, never on the way in.
 */

/** Positional word for the ring letter. A is innermost; most bodies have one or two. */
const POSITION: Record<string, string> = {
  A: 'inner',
  B: 'outer',
  C: 'third',
  D: 'fourth',
  E: 'fifth',
};

const RING_RE = /^(.*?)\s+([A-E])\s+(Ring|Belt)$/;

export interface RingLabel {
  /** The body the ring belongs to, system prefix intact: "HIP 52629 A 4". */
  body: string;
  /** "inner ring" / "outer ring" / "third belt". */
  ring: string;
  /** Body with the system prefix dropped: "A 4". */
  shortBody: string;
  /** Ready to render: "A 4 · inner ring". */
  label: string;
}

/**
 * Parse a raw ring name. Returns null for anything that is not one — callers then fall back to
 * showing the string unchanged, which is the safe behaviour for belt clusters and oddities.
 */
export function parseRingName(raw: string | null | undefined): RingLabel | null {
  if (!raw) return null;
  const m = RING_RE.exec(String(raw).trim());
  if (!m) return null;
  const [, body, letter, kind] = m;
  // Drop a leading system name so the label stays short in a table. The body designation is the
  // trailing run of short tokens ("A 4", "1 c", "AB 2"); anything before it is the system.
  const parts = body.split(' ');
  let i = parts.length;
  while (i > 0 && /^[A-Za-z]{1,3}$|^\d{1,3}$/.test(parts[i - 1])) i--;
  const shortBody = (i < parts.length ? parts.slice(i) : parts).join(' ');
  const position = POSITION[letter] || letter.toLowerCase();
  const ring = `${position} ${kind.toLowerCase()}`;
  return { body, ring, shortBody: shortBody || body, label: `${shortBody || body} · ${ring}` };
}

/** "HIP 52629 A 4 A Ring" -> "A 4 · inner ring". Anything unrecognised passes through unchanged. */
export function formatRingName(raw: string | null | undefined): string {
  if (!raw) return '';
  return parseRingName(raw)?.label ?? String(raw);
}

/** Same, but keeping the system prefix — for headings where the system is not already obvious. */
export function formatRingNameFull(raw: string | null | undefined): string {
  if (!raw) return '';
  const p = parseRingName(raw);
  return p ? `${p.body} · ${p.ring}` : String(raw);
}
