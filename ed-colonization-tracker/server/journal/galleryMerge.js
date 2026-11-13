// server/journal/galleryMerge.js
//
// The gallery's metadata (colony-gallery.json) has two writers: the browser, which saves its WHOLE copy on
// every edit (a caption, an upload, a reorder), and the server, which adds F10 shots as they land, converts
// BMPs to JPEG, flags deposit shots and writes the co-pilot's reads. Until 1.62.3 the browser's save REPLACED
// the file, so one tab wiped every shot the server had adopted since that tab loaded, and every co-pilot read
// on photos the tab already knew (Screenshot_0046, 2 Nov: read, paid for, then gone). A save now MERGES:
//   - entries the browser knows: its caption and order win; the server's url, utility flag, vision and
//     co-pilot line win (the browser never writes those, so its copy is stale at best);
//   - entries the browser does not know (added here since it loaded): kept, under their key;
//   - a save never removes anything — a delete is explicit (removeGalleryEntry, from the DELETE route).

const SERVER_OWNED = ['url', 'utility', 'vision', 'copilotLine'];

/** The gallery as it should be after the browser's save `incoming` lands on `current`. */
export function mergeGalleryMeta(current, incoming) {
  const cur = current && typeof current === 'object' ? current : {};
  const inc = incoming && typeof incoming === 'object' ? incoming : {};
  const onServer = new Map(); // id -> { key, entry }
  for (const [key, arr] of Object.entries(cur)) {
    for (const e of Array.isArray(arr) ? arr : []) if (e && e.id) onServer.set(e.id, { key, entry: e });
  }
  const out = {};
  const seen = new Set();
  for (const [key, arr] of Object.entries(inc)) {
    if (!Array.isArray(arr)) continue;
    out[key] = [];
    for (const e of arr) {
      if (!e || !e.id) continue;
      const have = onServer.get(e.id);
      const merged = have ? { ...have.entry, ...e } : { ...e };
      if (have) for (const f of SERVER_OWNED) { if (have.entry[f] !== undefined) merged[f] = have.entry[f]; }
      out[key].push(merged);
      seen.add(e.id);
    }
  }
  for (const [id, { key, entry }] of onServer) {
    if (seen.has(id)) continue;
    if (!Array.isArray(out[key])) out[key] = [];
    out[key].push(entry);
  }
  for (const key of Object.keys(out)) if (!out[key].length) delete out[key];
  return out;
}

/** Remove one photo's entry wherever it sits (in place). Returns the entry removed, or null. */
export function removeGalleryEntry(meta, imageId) {
  let removed = null;
  for (const key of Object.keys(meta || {})) {
    const arr = meta[key];
    if (!Array.isArray(arr)) continue;
    const i = arr.findIndex((e) => e && e.id === imageId);
    if (i >= 0) {
      removed = arr.splice(i, 1)[0];
      if (!arr.length) delete meta[key];
    }
  }
  return removed;
}
