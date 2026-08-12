import { useCallback, useEffect, useState } from 'react';
import { sseSubscribe } from '@/services/sseBus';

/**
 * 🧭 Exploration checklist — self-checking card for the CURRENT system.
 * Rows tick themselves from journal events (honk, FSS, DSS per body, ApproachBody
 * for epic views); tapping a row toggles "skipped". Resets on jump. Hidden until
 * the current system has anything to say.
 */

interface ChecklistTarget {
  bodyId: number | string | null;
  bodyName: string;
  kind?: string;
  stars: string;
  reasons: string[];
  bio?: number;
  bioDone?: number;
  distLs: number;
  far: boolean;
  mapped: boolean;
  skipped: boolean;
}
interface ChecklistState {
  system: string | null;
  honk: boolean;
  bodyCountFromHonk: number;
  scanned: number;
  allFound: boolean;
  targets: ChecklistTarget[];
  farSkipped: number;
}

function apiUrl(path: string): string {
  let t: string | null = null;
  try { t = sessionStorage.getItem('colony-token'); } catch { /* no storage */ }
  return t ? `${path}${path.includes('?') ? '&' : '?'}token=${t}` : path;
}

function fmtLs(ls: number): string {
  return ls >= 1000 ? `${(ls / 1000).toFixed(ls >= 10000 ? 0 : 1)}k Ls` : `${ls} Ls`;
}

export function ChecklistCard() {
  const [cl, setCl] = useState<ChecklistState | null>(null);

  const load = useCallback(() => {
    fetch(apiUrl('/api/checklist'))
      .then((r) => (r.ok ? r.json() : null))
      .then((d: ChecklistState | null) => { if (d) setCl(d); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    return sseSubscribe('checklist_update', (ev) => setCl(ev as unknown as ChecklistState));
  }, [load]);

  if (!cl || !cl.system || (!cl.honk && cl.targets.length === 0)) return null;

  const open = cl.targets.filter((t) => !t.mapped && !t.skipped);
  const done = cl.targets.filter((t) => t.mapped);

  const toggleSkip = (t: ChecklistTarget) => {
    if (t.mapped || t.bodyId == null) return;
    fetch(apiUrl('/api/checklist/skip'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bodyId: t.bodyId, skipped: !t.skipped }),
    }).catch(() => {});
  };

  return (
    <div className="bg-card border border-sky-500/30 rounded-lg px-4 py-3 mb-4">
      <div className="flex items-baseline gap-2 mb-1.5">
        <h3 className="text-sm font-semibold text-sky-400">{'\u{1F9ED}'} Checklist</h3>
        <span className="text-xs text-muted-foreground truncate">{cl.system}</span>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {cl.honk ? '✓ honk' : '· honk'}
          {' · '}
          {cl.allFound ? `✓ FSS ${cl.scanned}` : `FSS ${cl.scanned}${cl.bodyCountFromHonk ? '/' + cl.bodyCountFromHonk : ''}`}
        </span>
      </div>

      {cl.targets.length === 0 && cl.allFound && (
        <div className="text-xs text-muted-foreground">Nothing worth probes here — jump on.</div>
      )}

      {cl.targets.length > 0 && (
        <div className="space-y-1">
          {cl.targets.map((t, i) => (
            <button
              key={`${t.bodyId ?? 'x'}-${i}`}
              onClick={() => toggleSkip(t)}
              disabled={t.mapped}
              className={`w-full flex items-baseline gap-2 text-left text-xs rounded px-1.5 py-1 ${
                t.mapped
                  ? 'text-emerald-300'
                  : t.skipped
                  ? 'text-muted-foreground/50 line-through'
                  : 'text-foreground hover:bg-muted/30'
              }`}
              title={t.mapped ? 'Done' : t.skipped ? 'Tap to un-skip' : 'Tap to skip'}
            >
              <span className="shrink-0">{t.mapped ? '✓' : t.stars}</span>
              <span className="font-medium shrink-0">{t.bodyName}</span>
              <span className="text-muted-foreground truncate">{[...t.reasons, ...((t.bio ?? 0) > 0 ? [`bio ${t.bioDone ?? 0}/${t.bio}`] : [])].join(' · ')}</span>
              <span className={`ml-auto shrink-0 tabular-nums ${t.far ? 'text-amber-400' : 'text-muted-foreground/70'}`}>
                {fmtLs(t.distLs)}{t.far ? ' ⚠' : ''}
              </span>
            </button>
          ))}
        </div>
      )}

      {(cl.farSkipped > 0 || done.length > 0 || open.length > 0) && (
        <div className="mt-1.5 text-[11px] text-muted-foreground/70">
          {open.length} open · {done.length} done
          {cl.farSkipped > 0 && ` · ${cl.farSkipped} far target${cl.farSkipped > 1 ? 's' : ''} skipped (>40k Ls)`}
        </div>
      )}
    </div>
  );
}
