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
  const [uploading, setUploading] = useState(false);
  // Collapsed by default — the 2nd screen got busy; the panel expands only while recording.
  const [open, setOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refreshSaved = useCallback(() => {
    fetch(apiUrl('/api/sightings'))
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { sightings: Sighting[] } | null) => {
        if (!d) return;
        // Keep the '✓ Recorded' line live — an F10 shot landing seconds after Save
        // bumps autoShots server-side, and the stale POST response hid it.
        setSaved((prev) => (prev ? d.sightings.find((s) => s.id === prev.id) || prev : prev));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshSaved();
    const offRec = sseSubscribe('sighting_recorded', () => refreshSaved());
    const offShot = sseSubscribe('screenshot_saved', () => refreshSaved());
    return () => { offRec(); offShot(); };
  }, [refreshSaved]);

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
        setOpen(false); // collapse after save — the ✓ line stays visible in the strip
        refreshSaved();
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
    refreshSaved();
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const here = commanderPosition?.systemName || 'position unknown';

  return (
    <div className="bg-card border border-emerald-500/30 rounded-lg mb-4">
      {/* Collapsed strip — one tap to open the recorder; the wall owns browsing */}
      <div className="flex items-center gap-2 px-4 py-2.5">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
        >
          <span className="text-sm font-semibold text-emerald-400">{'\u{1F4F8}'} Record this spot</span>
          <span className="text-xs text-muted-foreground truncate">{here}</span>
          <span className="text-emerald-400/70 text-xs ml-auto">{open ? '▾' : '▸'}</span>
        </button>
        <a href={apiUrl('/sights')} target="_blank" rel="noreferrer" className="text-xs text-sky-400 hover:text-sky-300 underline shrink-0">
          wall ↗
        </a>
      </div>

      {!open && saved && (
        <div className="px-4 pb-2 text-xs text-emerald-300">
          {'✓'} {saved.bodyName || saved.systemName}
          {(saved.autoShots ?? 0) > 0 && ` · ${saved.autoShots} F10 shot${(saved.autoShots ?? 0) > 1 ? 's' : ''}`}
        </div>
      )}

      {open && (
      <div className="px-4 pb-3">
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
      </div>
      )}
    </div>
  );
}
