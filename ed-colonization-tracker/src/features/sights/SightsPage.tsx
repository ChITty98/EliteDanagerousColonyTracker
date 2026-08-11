import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Sighting } from '@/store/types';
import { sseSubscribe } from '@/services/sseBus';
import { TAGS, TAG_LABELS } from '@/features/companion/SightingCard';
import { uploadAllToGalleryKey } from '@/lib/galleryUpload';

/**
 * 📸 Sights — the postcard wall. Every recorded sighting, newest first: photo
 * thumbnails (F10 auto-attached or device-uploaded), tags, note, click-through
 * to System View. Reads /api/sightings + the normal gallery meta — no state of
 * its own, so it's always in agreement with the 2nd-screen card and the
 * per-system galleries.
 */

interface GalleryImage { id: string; url: string; caption?: string; addedAt?: string }

function apiUrl(path: string): string {
  let t: string | null = null;
  try { t = sessionStorage.getItem('colony-token'); } catch { /* no storage */ }
  return t ? `${path}${path.includes('?') ? '&' : '?'}token=${t}` : path;
}

/** Pop-out links keep the token so a new tab authenticates on network devices. */
function href(path: string): string {
  return apiUrl(path);
}

export function SightsPage() {
  const [sightings, setSightings] = useState<Sighting[]>([]);
  const [gallery, setGallery] = useState<Record<string, GalleryImage[]>>({});
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  // Lightbox browses ALL of a sighting's photos, not just the cover.
  const [lightbox, setLightbox] = useState<{ photos: GalleryImage[]; index: number } | null>(null);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // One hidden input reused for every card — clicking a card's Add-photo arms it
  // with that sighting's gallery key first.
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingKeyRef = useRef<string | null>(null);

  const pickFor = (sighting: Sighting) => {
    pendingKeyRef.current = sighting.galleryKey;
    setUploadingFor(null);
    setUploadError(null);
    fileRef.current?.click();
  };

  const onFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    const key = pendingKeyRef.current;
    if (!files || files.length === 0 || !key) return;
    setUploadingFor(key);
    const err = await uploadAllToGalleryKey(key, files);
    if (err) setUploadError(err);
    setUploadingFor(null);
    pendingKeyRef.current = null;
    if (fileRef.current) fileRef.current.value = '';
    load();
  };

  const load = useCallback(() => {
    fetch(apiUrl('/api/sightings'))
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { sightings: Sighting[] } | null) => { if (d) setSightings(d.sightings); })
      .catch(() => {});
    fetch(apiUrl('/api/gallery'))
      .then((r) => (r.ok ? r.json() : null))
      .then((m: Record<string, GalleryImage[]> | null) => { if (m) setGallery(m); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const offs = ['sighting_recorded', 'sighting_updated', 'sighting_deleted', 'screenshot_saved']
      .map((t) => sseSubscribe(t, () => load()));
    return () => { offs.forEach((fn) => fn()); };
  }, [load]);

  // --- Per-card edit mode (tags + note) ---
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTags, setDraftTags] = useState<Set<string>>(new Set());
  const [draftNote, setDraftNote] = useState('');
  const [editBusy, setEditBusy] = useState(false);

  const startEdit = (s: Sighting) => {
    setEditingId(s.id);
    setDraftTags(new Set(s.tags));
    setDraftNote(s.note || '');
    setUploadError(null);
  };

  const saveEdit = async () => {
    if (!editingId || draftTags.size === 0 || editBusy) return;
    setEditBusy(true);
    try {
      const r = await fetch(apiUrl('/api/sightings'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editingId, tags: [...draftTags], note: draftNote }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Save failed');
      setEditingId(null);
      load();
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setEditBusy(false);
    }
  };

  const deleteSighting = async (s: Sighting) => {
    if (!window.confirm(`Delete the ${s.bodyName || s.systemName} sighting? Its photos stay in the ${s.bodyName ? 'body' : 'system'} gallery.`)) return;
    try {
      const r = await fetch(apiUrl(`/api/sightings/${encodeURIComponent(s.id)}`), { method: 'DELETE' });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'Delete failed'); }
      setEditingId(null);
      load();
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  const allTags = useMemo(() => {
    const seen = new Map<string, number>();
    for (const s of sightings) for (const t of s.tags) seen.set(t, (seen.get(t) || 0) + 1);
    return [...seen.entries()].sort((a, b) => b[1] - a[1]);
  }, [sightings]);

  const shown = tagFilter ? sightings.filter((s) => s.tags.includes(tagFilter)) : sightings;

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <h2 className="text-2xl font-bold">{'\u{1F4F8}'} Sights</h2>
        <span className="text-xs text-muted-foreground">
          {sightings.length} recorded — the postcard wall. Record new ones from the 2nd Screen.
        </span>
      </div>

      {allTags.length > 1 && (
        <div className="flex flex-wrap gap-2 mb-4">
          <button
            onClick={() => setTagFilter(null)}
            className={`px-2.5 py-1 rounded-lg text-xs border ${!tagFilter ? 'bg-emerald-500/20 border-emerald-400 text-emerald-200' : 'bg-muted/30 border-border text-muted-foreground'}`}
          >
            All ({sightings.length})
          </button>
          {allTags.map(([tag, n]) => (
            <button
              key={tag}
              onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
              className={`px-2.5 py-1 rounded-lg text-xs border ${tagFilter === tag ? 'bg-emerald-500/20 border-emerald-400 text-emerald-200' : 'bg-muted/30 border-border text-muted-foreground hover:border-emerald-500/40'}`}
            >
              {TAG_LABELS[tag] || tag} ({n})
            </button>
          ))}
        </div>
      )}

      {shown.length === 0 && (
        <div className="text-sm text-muted-foreground border border-border rounded-lg p-6 text-center">
          Nothing here yet. Land somewhere great, open the 2nd Screen, and hit
          {' '}<span className="text-emerald-400">📸 Record this spot</span> — then F10 in-game to attach the view.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {shown.map((s) => {
          const photos = gallery[s.galleryKey] || [];
          return (
            <div key={s.id} className="bg-card border border-border rounded-lg overflow-hidden flex flex-col">
              {photos.length > 0 ? (
                <div>
                  <button
                    onClick={() => setLightbox({ photos, index: photos.length - 1 })}
                    className="block w-full h-44 overflow-hidden bg-black/40"
                    title="View full size"
                  >
                    <img
                      src={photos[photos.length - 1].url}
                      alt={s.bodyName || s.systemName}
                      className="w-full h-full object-cover hover:scale-105 transition-transform"
                      loading="lazy"
                    />
                  </button>
                  {photos.length > 1 && (
                    <div className="flex gap-1 p-1 bg-black/30 overflow-x-auto">
                      {photos.map((p, i) => (
                        <button
                          key={p.id}
                          onClick={() => setLightbox({ photos, index: i })}
                          className="h-12 w-16 shrink-0 overflow-hidden rounded border border-border/50 hover:border-emerald-400"
                          title={p.caption || ''}
                        >
                          <img src={p.url} alt="" className="w-full h-full object-cover" loading="lazy" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="w-full h-16 flex items-center justify-center text-xs text-muted-foreground/60 bg-muted/20">
                  no photo yet — F10 in-game or Add photo on the 2nd Screen
                </div>
              )}
              <div className="p-3 flex-1 flex flex-col gap-1.5">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-foreground">{s.bodyName || s.systemName}</span>
                  {photos.length > 1 && <span className="text-xs text-emerald-400">{'\u{1F4F7}'} {photos.length}</span>}
                  <span className="text-[11px] text-muted-foreground/60 ml-auto">
                    {new Date(s.recordedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                </div>
                {s.bodyName && <div className="text-xs text-muted-foreground">{s.systemName}</div>}
                {editingId === s.id ? (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-1">
                      {TAGS.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => setDraftTags((prev) => {
                            const next = new Set(prev);
                            if (next.has(t.id)) next.delete(t.id); else next.add(t.id);
                            return next;
                          })}
                          className={`px-1.5 py-0.5 rounded text-[11px] border ${
                            draftTags.has(t.id)
                              ? 'bg-emerald-500/20 border-emerald-400 text-emerald-200'
                              : 'bg-muted/30 border-border text-muted-foreground hover:border-emerald-500/40'
                          }`}
                        >
                          {t.icon} {t.label}
                        </button>
                      ))}
                    </div>
                    <input
                      value={draftNote}
                      onChange={(e) => setDraftNote(e.target.value)}
                      placeholder="Note (empty clears it)…"
                      className="w-full bg-muted border border-border rounded px-2 py-1 text-xs focus:outline-none focus:border-emerald-500"
                    />
                    <div className="flex gap-2 text-xs">
                      <button
                        onClick={saveEdit}
                        disabled={draftTags.size === 0 || editBusy}
                        className="px-2.5 py-1 rounded bg-emerald-500 text-black font-semibold hover:bg-emerald-400 disabled:opacity-40"
                      >
                        {editBusy ? 'Saving…' : 'Save'}
                      </button>
                      <button onClick={() => setEditingId(null)} className="px-2.5 py-1 rounded border border-border text-muted-foreground hover:bg-muted/40">
                        Cancel
                      </button>
                      <button
                        onClick={() => deleteSighting(s)}
                        className="ml-auto px-2.5 py-1 rounded border border-red-500/40 text-red-300 hover:bg-red-500/10"
                        title="Delete this sighting (photos stay in the location's gallery)"
                      >
                        {'\u{1F5D1}\u{FE0F}'} Delete
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-1">
                      {s.tags.map((t) => (
                        <span key={t} className="px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 text-[11px]">
                          {TAG_LABELS[t] || t}
                        </span>
                      ))}
                    </div>
                    {s.note && <div className="text-xs text-muted-foreground italic">“{s.note}”</div>}
                  </>
                )}
                <div className="mt-auto pt-1.5 flex gap-3 text-xs items-baseline">
                  <Link className="text-sky-400 hover:text-sky-300 underline" to={`/systems/${encodeURIComponent(s.systemName)}`}>
                    System page
                  </Link>
                  <a
                    className="text-sky-400 hover:text-sky-300 underline"
                    href={href(`/system-view?system=${encodeURIComponent(s.systemName)}`)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    System View ↗
                  </a>
                  <button
                    onClick={() => (editingId === s.id ? setEditingId(null) : startEdit(s))}
                    className="ml-auto px-2 py-0.5 rounded border border-border text-muted-foreground hover:bg-muted/40"
                  >
                    {'✏️'} Edit
                  </button>
                  <button
                    onClick={() => pickFor(s)}
                    disabled={uploadingFor === s.galleryKey}
                    className="px-2 py-0.5 rounded border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-40"
                  >
                    {uploadingFor === s.galleryKey ? 'Uploading…' : '\u{1F4F7} Add photo'}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {uploadError && <div className="mt-3 text-xs text-red-400">{uploadError}</div>}
      <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={onFiles} />

      {/* Lightbox — browses every photo of the sighting; backdrop click closes */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 cursor-zoom-out"
          onClick={() => setLightbox(null)}
        >
          <img
            src={lightbox.photos[lightbox.index].url}
            alt={lightbox.photos[lightbox.index].caption || ''}
            className="max-w-full max-h-full object-contain"
          />
          {lightbox.photos.length > 1 && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); setLightbox({ ...lightbox, index: (lightbox.index - 1 + lightbox.photos.length) % lightbox.photos.length }); }}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-3xl px-3 py-2 rounded-lg bg-black/50 text-white hover:bg-black/80"
                title="Previous"
              >
                ‹
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setLightbox({ ...lightbox, index: (lightbox.index + 1) % lightbox.photos.length }); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-3xl px-3 py-2 rounded-lg bg-black/50 text-white hover:bg-black/80"
                title="Next"
              >
                ›
              </button>
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs text-white/80 bg-black/50 rounded px-2 py-1">
                {lightbox.index + 1} / {lightbox.photos.length}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
