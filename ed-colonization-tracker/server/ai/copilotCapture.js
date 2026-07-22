// server/ai/copilotCapture.js
//
// The corpus flywheel's storage layer. An append-only JSONL log of every
// co-pilot line shown to the commander, plus rating events. The point: the
// commander's own play generates (and pays the tokens for) a growing library of
// lines; a dev-side promote/export step later templatizes the best LIVE captures
// from their LOGGED INPUTS (never by parsing prose) and bakes them into the
// shipped canned pool — so future installs get them for free.
//
// - LIVE lines carry their full structured `inputs` (for templatize → promote).
// - CANNED lines carry their pool reference (persona + scenario) so a thumbs-down
//   can prune a weak line from rotation.
// - Ratings are appended as their own events and reconciled by id downstream
//   (append-only keeps writes cheap and crash-safe during play).

import { appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

/** Create a capture store bound to a JSONL file path (owned by server.mjs). */
export function createCaptureStore(file) {
  function append(obj) {
    try {
      appendFileSync(file, `${JSON.stringify(obj)}\n`);
    } catch (e) {
      console.error('[Copilot] capture write failed:', e && e.message);
    }
  }

  return {
    /**
     * Log a shown line. Returns the id to broadcast with the line so a later
     * rating can reference it. Never throws — capture must not break playback.
     * @param {{ source:'live'|'canned', persona:string, beat:string, mood?:string, prose:string, inputs?:object|null }} rec
     */
    capture(rec) {
      let id;
      try { id = randomUUID(); } catch { id = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`; }
      append({
        kind: 'line',
        id,
        ts: new Date().toISOString(),
        source: rec.source,
        persona: rec.persona,
        beat: rec.beat,
        mood: rec.mood || null,
        prose: rec.prose,
        inputs: rec.inputs || null,
        trigger: rec.trigger || null,
      });
      return id;
    },

    /** Log a 👍 (+1) / 👎 (-1) rating against a previously-captured line id, with an
     *  optional thumbs-down reason and/or a free-text comment (full context). */
    rate(id, rating, reason, comment) {
      const r = Number(rating);
      if (!id || (r !== 1 && r !== -1)) return false;
      append({ kind: 'rating', id, ts: new Date().toISOString(), rating: r, reason: reason || null, comment: comment || null });
      return true;
    },
  };
}
