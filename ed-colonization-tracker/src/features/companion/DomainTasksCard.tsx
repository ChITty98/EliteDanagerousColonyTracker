import { useCallback, useEffect, useState } from 'react';
import { sseSubscribe } from '@/services/sseBus';

/**
 * 🏛️ Worth doing here — chores in the CURRENT system, when it is one the commander holds.
 *
 * Scoped to the system they just jumped into rather than the whole domain: domain-wide this is 60+
 * entries and unreadable on a second screen. Ordered by distance from the arrival star, so the
 * 43 Ls ring leads and the 300,000 Ls iceball sinks on its own.
 *
 * Dismissal is permanent and has no undo — that was the point. A task they will never do should
 * never ask again.
 */

interface Task {
  id: string;
  kind: 'ring' | 'fss' | 'photo';
  title: string;
  systemName: string;
  detail: string;
  distanceLs: number | null;
  label: string;
  icon: string;
}
interface TasksResponse {
  system: string | null;
  inDomain: boolean;
  tasks: Task[];
  dismissedHere: number;
}

function apiUrl(path: string): string {
  let t: string | null = null;
  try { t = sessionStorage.getItem('colony-token') || localStorage.getItem('colony-token'); } catch { /* no storage */ }
  return t ? `${path}${path.includes('?') ? '&' : '?'}token=${t}` : path;
}

const fmtLs = (ls: number | null): string => {
  if (ls == null) return '';
  if (ls === 0) return 'system';
  return ls >= 1000 ? `${(ls / 1000).toFixed(ls >= 10000 ? 0 : 1)}k ls` : `${ls} ls`;
};

const TONE: Record<Task['kind'], string> = {
  ring: 'text-purple-300',
  fss: 'text-cyan-300',
  photo: 'text-pink-300',
};

export function DomainTasksCard() {
  const [data, setData] = useState<TasksResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(apiUrl('/api/domain/tasks'))
      .then((r) => (r.ok ? r.json() : null))
      .then((d: TasksResponse | null) => { if (d) setData(d); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    // Re-evaluate on arrival — the whole point is answering "what should I do here".
    const off = sseSubscribe('fsd_jump', () => load());
    return off;
  }, [load]);

  const dismiss = async (id: string) => {
    setBusy(id);
    try {
      await fetch(apiUrl('/api/domain/tasks/dismiss'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      setData((d) => (d ? { ...d, tasks: d.tasks.filter((t) => t.id !== id), dismissedHere: d.dismissedHere + 1 } : d));
    } catch { /* stays listed; try again */ } finally { setBusy(null); }
  };

  // Silent unless there is something to do in a system they actually hold.
  if (!data || !data.inDomain || data.tasks.length === 0) return null;

  return (
    <div className="bg-card border border-amber-500/30 rounded-lg px-4 py-3 mb-4">
      <div className="flex items-baseline gap-2 mb-1.5">
        <h3 className="text-sm font-semibold text-amber-400">{'\u{1F3DB}\u{FE0F}'} Worth doing here</h3>
        <span className="text-xs text-muted-foreground truncate">{data.system}</span>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {data.tasks.length} open
          {data.dismissedHere > 0 && ` · ${data.dismissedHere} dismissed`}
        </span>
      </div>

      <div className="space-y-1">
        {data.tasks.map((t) => (
          <div key={t.id} className="flex items-baseline gap-2 text-xs rounded px-1.5 py-1 hover:bg-muted/20">
            <span className="shrink-0">{t.icon}</span>
            <span className={`font-medium shrink-0 ${TONE[t.kind] || 'text-foreground'}`}>{t.label}</span>
            <span className="truncate text-muted-foreground">
              {t.title.startsWith(t.systemName) ? t.title.slice(t.systemName.length).trim() || t.systemName : t.title}
              {t.detail && ` · ${t.detail}`}
            </span>
            <span className="ml-auto shrink-0 tabular-nums text-muted-foreground/70">{fmtLs(t.distanceLs)}</span>
            <button
              onClick={() => dismiss(t.id)}
              disabled={busy === t.id}
              className="shrink-0 text-muted-foreground/40 hover:text-red-400 disabled:opacity-30 px-1"
              title="Never show this again — there is no undo"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
