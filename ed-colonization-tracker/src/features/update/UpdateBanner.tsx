import { useEffect, useState, useCallback } from 'react';
import { sseSubscribe } from '@/services/sseBus';

/**
 * Update notice. The server asks GitHub what the latest release is; this shows it
 * and links to the download. Deliberately does NOT install anything — updating is
 * manual (replace the .exe in its existing folder, where your data lives).
 *
 * Dismissal is remembered per version, so saying "later" to one release doesn't
 * silence the next.
 */
interface UpdateStatus {
  current: string | null;
  latest: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  assetUrl: string | null;
  lastChecked: string | null;
  lastError: string | null;
}

const DISMISS_KEY = 'colony-update-dismissed';

function apiUrl(path: string): string {
  let t: string | null = null;
  try { t = sessionStorage.getItem('colony-token'); } catch { /* no storage */ }
  return t ? `${path}${path.includes('?') ? '&' : '?'}token=${t}` : path;
}

export function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(() => {
    try { return localStorage.getItem(DISMISS_KEY); } catch { return null; }
  });

  const load = useCallback(() => {
    fetch(apiUrl('/api/version'))
      .then((r) => (r.ok ? r.json() : null))
      .then((d: UpdateStatus | null) => { if (d) setStatus(d); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    return sseSubscribe('update_available', () => load());
  }, [load]);

  if (!status || !status.updateAvailable) return null;
  if (dismissed === status.latest) return null;

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, status.latest || ''); } catch { /* private mode */ }
    setDismissed(status.latest);
  };

  return (
    <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-amber-200">
          {'⬆'} <strong>{status.latest}</strong> is available
          {status.current && <span className="text-amber-200/70"> — you&apos;re on {status.current}</span>}
        </span>

        {status.assetUrl && (
          <a
            href={status.assetUrl}
            className="rounded bg-amber-500 px-2.5 py-1 text-xs font-semibold text-black hover:bg-amber-400"
          >
            Download
          </a>
        )}
        {status.releaseUrl && (
          <a href={status.releaseUrl} target="_blank" rel="noreferrer" className="text-amber-300 underline hover:text-amber-100">
            What&apos;s new
          </a>
        )}

        <span className="text-xs text-amber-200/60">
          Close the app, then replace the .exe in its current folder — your data lives beside it.
        </span>

        <button onClick={dismiss} className="ml-auto text-xs text-amber-200/60 hover:text-amber-100">
          Later
        </button>
      </div>
    </div>
  );
}
