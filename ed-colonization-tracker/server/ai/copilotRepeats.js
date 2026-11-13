// server/ai/copilotRepeats.js
//
// Not paying twice for the same line (1.62.0).
//
// The commander: "lots of repetition in these live messages that I'm paying for only very slight
// deviations on". Measured on copilot-captures.jsonl from 29 Oct: 13 of 32 paid lines were near-copies
// of an earlier line for the same moment (supercruise assist 6 of 9, the carrier docking request 4 of 5),
// and in 12 of the 13 the earlier line had already dropped out of the 8-line recent list the prompt
// carries. So each moment (beat key) keeps its own memory, for three hours:
//   - the FACTS it was given, as the beat's `fp` string: the same facts again → no paid call at all;
//   - its last three LINES: shown to the model as what not to repeat, and a line that still comes
//     out a near-copy of one of them is not spoken.
// Process memory, like the recent-lines list: a restart starts it fresh.

export const MEMORY_MS = 3 * 60 * 60 * 1000;
const PER_MOMENT = 3;
const lines = new Map(); // beat key -> [{ at, line }]
const facts = new Map(); // fp -> when a line last went out for those facts

/** A line went out for this moment (with the facts it was given, when the beat carries them). */
export function rememberLine(key, line, fp, now = Date.now()) {
  if (!key || !line) return;
  const list = (lines.get(key) || []).filter((x) => now - x.at < MEMORY_MS);
  list.push({ at: now, line: String(line) });
  while (list.length > PER_MOMENT) list.shift();
  lines.set(key, list);
  if (fp) facts.set(fp, now);
}

/** This moment's own last lines, oldest first (within the memory window). */
export function linesFor(key, now = Date.now()) {
  return (lines.get(key) || []).filter((x) => now - x.at < MEMORY_MS).map((x) => x.line);
}

/** Were these exact facts already said within the window? */
export function factsSaid(fp, now = Date.now()) {
  if (!fp) return false;
  const at = facts.get(fp);
  return at != null && now - at < MEMORY_MS;
}

const STOP = new Set(('the a an and or but so to of in on at for with is it its this that we our you your i im ive id '
  + 'me my be are was were as if just all up out into from by not no yes do dont').split(' '));
const words = (s) => String(s || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
const contentWords = (s) => new Set(words(s).filter((w) => !STOP.has(w)));
const opening = (s) => words(s).slice(0, 3).join(' ');

/** How alike two lines are: the share of content words they have in common (0–1) and whether they open alike. */
export function likeness(a, b) {
  const A = contentWords(a);
  const B = contentWords(b);
  let shared = 0;
  for (const w of A) if (B.has(w)) shared += 1;
  const union = A.size + B.size - shared;
  const oa = opening(a);
  return { overlap: union ? shared / union : 0, sameOpening: !!oa && oa === opening(b) };
}

/**
 * The earlier line this one copies, or null. A copy shares 30% of its content words, or opens with the
 * same three words AND shares 20%. Opening alike alone is not a copy: "Clamps are on." over two different
 * shopping lists is the same habit with new news, and the news is the point of the line.
 */
export function nearCopyOf(line, earlier) {
  for (const e of earlier || []) {
    const { overlap, sameOpening } = likeness(line, e);
    if (overlap >= 0.3 || (sameOpening && overlap >= 0.2)) return { line: e, overlap, sameOpening };
  }
  return null;
}

/** Test seam. */
export function _resetRepeats() { lines.clear(); facts.clear(); }
