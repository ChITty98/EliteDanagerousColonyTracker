import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/store';
import type { Sighting } from '@/store/types';
import { sseSubscribe } from '@/services/sseBus';
import { uploadAllToGalleryKey } from '@/lib/galleryUpload';

/**
 * "Record this spot" — the 2nd-screen postcard button. One tap sends TAGS only;
 * the server snapshots system/body from commanderPosition/currentBody, so this
 * works from an iPad that knows nothing about the game state.
 *
 * Photos: in-game F10 shots auto-attach (same system, ±10 min, either order), and
 * the Add-photo button uploads from this device (iOS camera/library) into the
 * sighting's gallery key — which is the NORMAL system/body gallery, so pictures
 * also appear on that system's detail page, colonized or not.
 */

// Tag chips — drawn from the field-tested taste model, brain trees included.
// Exported: the Sights wall reuses this list for its edit mode and filters.
export const TAGS: Array<{ id: string; icon: string; label: string }> = [
  { id: 'closebodies', icon: '✨', label: 'Close bodies' },
  { id: 'rings', icon: '\u{1F48D}', label: 'Rings' },
  { id: 'terrain', icon: '\u{1F3DC}\u{FE0F}', label: 'Terrain' },
  { id: 'sky', icon: '\u{1F308}', label: 'Pretty sky' },
  { id: 'life', icon: '\u{1F9EC}', label: 'Life' },
  { id: 'braintrees', icon: '\u{1F333}', label: 'Brain Trees' },
  { id: 'geology', icon: '\u{1F30B}', label: 'Geology' },
  { id: 'home', icon: '\u{1F3E0}', label: 'Home candidate' },
  { id: 'landmark', icon: '\u{1F5FD}', label: 'Landmark' }, // famous in-game places — Jaques, megaships, tourist spots
  { id: 'cool', icon: '⭐', label: 'Just cool' },
];

export const TAG_LABELS: Record<string, string> = Object.fromEntries(TAGS.map((t) => [t.id, `${t.icon} ${t.label}`]));

function apiUrl(path: string): string {
  let t: string | null = null;
  try { t = sessionStorage.getItem('colony-token'); } catch { /* no storage */ }
  return t ? `${path}${path.includes('?') ? '&' : '?'}token=${t}` : path;
}

export function SightingCard() {
  const commanderPosition = useAppStore((s) => s.commanderPosition);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<Sighting | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<Sighting[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadRecent = useCallback(() => {
    fetch(apiUrl('/api/sightings'))
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { sightings: Sighting[] } | null) => {
        if (!d) return;
        setRecent(d.sightings.slice(0, 8));
        // Keep the "✓ Recorded" line live — an F10 shot landing seconds after Save
        // bumps autoShots server-side, and the stale POST response hid it.
        setSaved((prev) => (prev ? d.sightings.find((s) => s.id === prev.id) || prev : prev));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadRecent();
    const offRec = sseSubscribe('sighting_recorded', () => loadRecent());
    const offShot = sseSubscribe('screenshot_saved', () => loadRecent());
    return () => { offRec(); offShot(); };
  }, [loadRecent]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setSaved(null);
    setError(null);
  };

  const save = () => {
    if (selected.size === 0 || saving) return;
    setSaving(true);
    setError(null);
    fetch(apiUrl('/api/sightings'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: [...selected], note: note.trim() || undefined }),
    })
      .then((r) => r.json().then((d) => (r.ok ? d : Promise.reject(new Error(d.error || 'Failed')))))
      .then((rec: Sighting) => {
        setSaved(rec);
        setSelected(new Set());
        setNote('');
        loadRecent();
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setSaving(false));
  };

  // Upload photos from THIS device into the saved sighting's gallery key.
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !saved) return;
    setUploading(true);
    const err = await uploadAllToGalleryKey(saved.galleryKey, files);
    if (err) setError(err);
    loadRecent();
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const here = commanderPosition?.systemName || 'position unknown';

  return (
    <div className="bg-card border border-emerald-500/30 rounded-lg p-4 mb-4">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-sm font-semibold text-emerald-400">{'\u{1F4F8}'} Record this spot</h3>
        <span className="text-xs text-muted-foreground truncate ml-3">{here}</span>
      </div>

      <div className="flex flex-wrap gap-2 mb-2">
        {TAGS.map((t) => (
          <button
            key={t.id}
            onClick={() => toggle(t.id)}
            className={`px-2.5 py-1.5 rounded-lg text-xs border transition-colors ${
              selected.has(t.id)
                ? 'bg-emerald-500/20 border-emerald-400 text-emerald-200'
                : 'bg-muted/30 border-border text-muted-foreground hover:border-emerald-500/40'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional note…"
          className="flex-1 bg-muted border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-emerald-500"
        />
        <button
          onClick={save}
          disabled={selected.size === 0 || saving}
          className="px-4 py-1.5 rounded-lg text-sm font-semibold bg-emerald-500 text-black hover:bg-emerald-400 disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {error && <div className="mt-2 text-xs text-red-400">{error}</div>}

      {saved && (
        <div className="mt-2 text-xs text-emerald-300 flex items-center gap-2 flex-wrap">
          <span>
            {'✓'} Recorded {saved.bodyName || saved.systemName}
            {(saved.autoShots ?? 0) > 0 && ` · ${saved.autoShots} F10 shot${(saved.autoShots ?? 0) > 1 ? 's' : ''} attached`}
          </span>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="px-2 py-0.5 rounded border border-emerald-500/40 hover:bg-emerald-500/10 disabled:opacity-40"
          >
            {uploading ? 'Uploading…' : '\u{1F4F7} Add photo'}
          </button>
          <span className="text-muted-foreground">F10 in-game also auto-attaches for 3 min.</span>
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={onFile} />
        </div>
      )}

      {recent.length > 0 && (
        <div className="mt-3 border-t border-border/50 pt-2">
          <div className="text-[11px] text-muted-foreground mb-1">Recent sightings</div>
          <div className="space-y-1">
            {recent.map((s) => (
              <div key={s.id} className="text-xs flex items-baseline gap-2 flex-wrap">
                <span className="text-foreground">{s.bodyName || s.systemName}</span>
                <span className="text-muted-foreground">{s.tags.map((t) => TAG_LABELS[t] || t).join(' · ')}</span>
                {(s.autoShots ?? 0) > 0 && <span className="text-emerald-400">{'\u{1F4F7}'}{s.autoShots}</span>}
                {s.note && <span className="text-muted-foreground italic truncate max-w-[16rem]">“{s.note}”</span>}
                <span className="text-muted-foreground/60 ml-auto">{new Date(s.recordedAt).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
