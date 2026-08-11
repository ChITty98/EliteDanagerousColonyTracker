import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Sighting } from '@/store/types';
import { sseSubscribe } from '@/services/sseBus';
import { TAG_LABELS } from '@/features/companion/SightingCard';

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
  const [lightbox, setLightbox] = useState<GalleryImage | null>(null);

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
    const offRec = sseSubscribe('sighting_recorded', () => load());
    const offShot = sseSubscribe('screenshot_saved', () => load());
    return () => { offRec(); offShot(); };
  }, [load]);

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
                <button
                  onClick={() => setLightbox(photos[photos.length - 1])}
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
                <div className="flex flex-wrap gap-1">
                  {s.tags.map((t) => (
                    <span key={t} className="px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 text-[11px]">
                      {TAG_LABELS[t] || t}
                    </span>
                  ))}
                </div>
                {s.note && <div className="text-xs text-muted-foreground italic">“{s.note}”</div>}
                <div className="mt-auto pt-1.5 flex gap-3 text-xs">
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
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Lightbox — plain full-size view, click anywhere to close */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 cursor-zoom-out"
          onClick={() => setLightbox(null)}
        >
          <img src={lightbox.url} alt={lightbox.caption || ''} className="max-w-full max-h-full object-contain" />
        </div>
      )}
    </div>
  );
}
