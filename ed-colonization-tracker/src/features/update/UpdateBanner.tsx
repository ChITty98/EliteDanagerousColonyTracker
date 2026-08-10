import { useEffect, useState, useCallback } from 'react';
import { sseSubscribe } from '@/services/sseBus';

/**
 * Update notice + one-click self-update.
 *
 * The server checks GitHub Releases; this just reflects that status and drives
 * the two endpoints. Dismissal is remembered per version, so saying "later" to
 * v1.33 doesn't silence v1.34.
 */
interface UpdateStatus {
  current: string | null;
  latest: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  notes: string | null;
  lastChecked: string | null;
  lastError: string | null;
  downloaded: string | null;
  downloading: boolean;
  canSelfUpdate: boolean;
}

const DISMISS_KEY = 'colony-update-dismissed';

function authToken(): string | null {
  try { return sessionStorage.getItem('colony-token'); } catch { return null; }
}

export function apiUrl(path: string): string {
  const t = authToken();
  return t ? `${path}${path.includes('?') ? '&' : '?'}token=${t}` : path;
}

export function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(() => {
    try { return localStorage.getItem(DISMISS_KEY); } catch { return null; }
  });
  const [percent, setPercent] = useState<number | null>(null);
  const [phase, setPhase] = useState<'idle' | 'downloading' | 'ready' | 'applying' | 'failed'>('idle');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(apiUrl('/api/version'))
      .then((r) => (r.ok ? r.json() : null))
      .then((d: UpdateStatus | null) => {
        if (!d) return;
        setStatus(d);
        if (d.downloaded) setPhase('ready');
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const offProgress = sseSubscribe('update_progress', (e) => {
      setPhase('downloading');
      if (typeof e.percent === 'number') setPercent(e.percent);
    });
    const offReady = sseSubscribe('update_ready', () => { setPhase('ready'); setPercent(100); });
    const offFailed = sseSubscribe('update_failed', (e) => {
      setPhase('failed');
      setError(typeof e.error === 'string' ? e.error : 'Update failed');
    });
    const offAvail = sseSubscribe('update_available', () => load());
    return () => { offProgress(); offReady(); offFailed(); offAvail(); };
  }, [load]);

  const startDownload = () => {
    setError(null);
    setPhase('downloading');
    setPercent(0);
    fetch(apiUrl('/api/update/download'), { method: 'POST' }).catch(() => {
      setPhase('failed');
      setError('Could not start the download');
    });
  };

  const applyNow = () => {
    setPhase('applying');
    fetch(apiUrl('/api/update/apply'), { method: 'POST' })
      .then((r) => (r.ok ? r.json() : r.json().then((d) => Promise.reject(new Error(d.error)))))
      .catch((e: Error) => { setPhase('failed'); setError(e.message); });
  };

  if (!status || !status.updateAvailable) return null;
  if (phase === 'idle' && dismissed === status.latest) return null;

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, status.latest || ''); } catch { /* private mode */ }
    setDismissed(status.latest);
  };

  return (
    <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-amber-200">
          {'⬆'} <strong>{status.latest}</strong> is available
          {status.current && <span className="text-amber-200/70"> — you're on {status.current}</span>}
        </span>

        {status.releaseUrl && (
          <a href={status.releaseUrl} target="_blank" rel="noreferrer" className="text-amber-300 underline hover:text-amber-100">
            What's new
          </a>
        )}

        {phase === 'applying' ? (
          <span className="text-amber-200/80">Restarting to finish the update…</span>
        ) : phase === 'ready' ? (
          <button onClick={applyNow} className="rounded bg-amber-500 px-2.5 py-1 text-xs font-semibold text-black hover:bg-amber-400">
            Restart &amp; install
          </button>
        ) : phase === 'downloading' ? (
          <span className="text-amber-200/80">Downloading{percent != null ? ` ${percent}%` : ''}…</span>
        ) : status.canSelfUpdate ? (
          <button onClick={startDownload} className="rounded bg-amber-500 px-2.5 py-1 text-xs font-semibold text-black hover:bg-amber-400">
            Update now
          </button>
        ) : (
          <span className="text-amber-200/60 text-xs">(run the .exe build to self-update)</span>
        )}

        {phase !== 'applying' && (
          <button onClick={dismiss} className="ml-auto text-xs text-amber-200/60 hover:text-amber-100">
            Later
          </button>
        )}
      </div>

      {phase === 'downloading' && percent != null && (
        <div className="mt-1.5 h-1 w-full overflow-hidden rounded bg-amber-900/40">
          <div className="h-full bg-amber-400 transition-all" style={{ width: `${percent}%` }} />
        </div>
      )}

      {error && (
        <div className="mt-1 text-xs text-red-300">
          {error} {status.releaseUrl && (
            <>— you can still <a className="underline" href={status.releaseUrl} target="_blank" rel="noreferrer">download it manually</a>.</>
          )}
        </div>
      )}
    </div>
  );
}
