/**
 * Shared line-streaming helper for the region tools.
 *
 * Chunk-based (not readline) — readline's async iterator piles up drain
 * listeners under backpressure (MaxListenersExceeded, exit 134). Supports an
 * async onLine so callers that write output can await their own drain.
 */
import fs from 'node:fs';

export async function streamLines(path, onLine) {
  let tail = '';
  for await (const chunk of fs.createReadStream(path, { encoding: 'utf8' })) {
    const text = tail + chunk;
    let start = 0, nl;
    while ((nl = text.indexOf('\n', start)) !== -1) {
      await onLine(text.slice(start, nl));
      start = nl + 1;
    }
    tail = text.slice(start);
  }
  if (tail) await onLine(tail);
}
