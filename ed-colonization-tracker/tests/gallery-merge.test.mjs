// 1.62.3 — a browser's gallery save merges into the server's gallery instead of replacing it. The case that
// found it: Screenshot_0046 (2 Nov) was adopted and read by the server, then a save from the browser — whose
// copy predated both — overwrote the file, and the paid read was gone.
import { describe, it, expect } from 'vitest';
import { mergeGalleryMeta, removeGalleryEntry } from '../server/journal/galleryMerge.js';

const K_BODY = "system:col 173 sector ax-j d9-52:body:thagard's progress";
const K_STATION = "system:col 173 sector ax-j d9-52:station:thagard's progress";
const read = { kind: 'station_screen', description: 'The station services screen.', tags: [], at: '2026-11-02T02:47:12Z' };
const older = { id: 'img_1', url: '/gallery-images/img_1.jpg', caption: 'Screenshot_0042.bmp', addedAt: '2026-11-02T02:47:01Z', vision: read, copilotLine: { line: 'Hello, Vice President.', persona: 'tars', at: read.at } };
const adopted = { id: 'img_2', url: '/gallery-images/img_2.jpg', caption: 'Screenshot_0046.bmp', addedAt: '2026-11-02T03:42:56Z', vision: { ...read, at: '2026-11-02T03:43:10Z' } };

describe('merging a browser gallery save', () => {
  it('keeps a shot the server adopted after the browser loaded, with its read', () => {
    const server = { [K_BODY]: [older, adopted] };
    const browser = { [K_BODY]: [{ id: 'img_1', url: older.url, caption: 'Screenshot_0042.bmp', addedAt: older.addedAt, vision: read, copilotLine: older.copilotLine }] };
    const out = mergeGalleryMeta(server, browser);
    expect(out[K_BODY].map((e) => e.id)).toEqual(['img_1', 'img_2']);
    expect(out[K_BODY][1].vision.at).toBe('2026-11-02T03:43:10Z');
  });

  it("a stale copy cannot strip the server's read, flag or converted url — but the browser's caption wins", () => {
    const server = { [K_BODY]: [{ ...older, utility: true }] };
    const browser = { [K_BODY]: [{ id: 'img_1', url: '/gallery-images/img_1.bmp', caption: 'Virgil Hall, 2 Nov', addedAt: older.addedAt }] };
    const e = mergeGalleryMeta(server, browser)[K_BODY][0];
    expect(e.caption).toBe('Virgil Hall, 2 Nov');
    expect(e.url).toBe('/gallery-images/img_1.jpg');
    expect(e.utility).toBe(true);
    expect(e.vision).toEqual(read);
    expect(e.copilotLine.line).toBe('Hello, Vice President.');
  });

  it("the browser's order stands for what it knows; unknown entries follow", () => {
    const a = { id: 'a', url: '/gallery-images/a.jpg', caption: 'a', addedAt: '2026-11-01T00:00:00Z' };
    const b = { id: 'b', url: '/gallery-images/b.jpg', caption: 'b', addedAt: '2026-11-01T00:01:00Z' };
    const c = { id: 'c', url: '/gallery-images/c.jpg', caption: 'c', addedAt: '2026-11-02T00:00:00Z' };
    const out = mergeGalleryMeta({ [K_STATION]: [a, b, c] }, { [K_STATION]: [b, a] }); // the browser made b primary
    expect(out[K_STATION].map((e) => e.id)).toEqual(['b', 'a', 'c']);
  });

  it('a photo deleted explicitly stays deleted; a save alone removes nothing', () => {
    const server = { [K_BODY]: [older, adopted] };
    expect(mergeGalleryMeta(server, { [K_BODY]: [] })[K_BODY].map((e) => e.id)).toEqual(['img_1', 'img_2']);
    const meta = { [K_BODY]: [older, adopted] };
    expect(removeGalleryEntry(meta, 'img_2').id).toBe('img_2');
    expect(mergeGalleryMeta(meta, { [K_BODY]: [older] })[K_BODY].map((e) => e.id)).toEqual(['img_1']);
    expect(removeGalleryEntry(meta, 'img_1').id).toBe('img_1');
    expect(meta[K_BODY]).toBeUndefined(); // an emptied key goes with its last photo
  });

  it('an empty server takes the browser copy whole (the one-time migration)', () => {
    const browser = { [K_STATION]: [{ id: 'x', url: '/gallery-images/x.jpg', caption: 'x', addedAt: '2026-11-01T00:00:00Z' }] };
    expect(mergeGalleryMeta({}, browser)).toEqual(browser);
    expect(mergeGalleryMeta(null, browser)).toEqual(browser);
  });
});
