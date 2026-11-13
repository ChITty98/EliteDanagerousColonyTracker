import { useEffect, useState } from 'react';

// The Anthropic API tally (1.61.3): what the co-pilot has spent of your credits, from the server's own
// ledger (copilot-spend.json — every call priced from the API's usage counts). Shown on the Cockpit and in
// Settings. The key never comes near this: the status endpoint only says whether it was found.

interface Bucket { usd: number; calls: number }
export interface ApiStatus {
  backend: 'cli' | 'api';
  keyPresent: boolean;
  model: string;
  capUsd: number;
  month: string;
  spentUsd: number;
  calls: number;
  overCap: boolean;
  today?: Bucket;
  byPurpose?: Record<string, Bucket>;
  byModel?: Record<string, Bucket>;
  tokens?: { in: number; out: number; cacheRead: number; cacheWrite: number };
  errors?: number;
  refusals?: number;
  last?: { at: string; purpose: string; model: string | null; usd: number; inTokens: number; outTokens: number; ms: number } | null;
  history?: { month: string; usd: number; calls: number }[];
}

const withToken = (p: string) => {
  try { const t = sessionStorage.getItem('colony-token'); return t ? `${p}${p.includes('?') ? '&' : '?'}token=${t}` : p; }
  catch { return p; }
};

/** Poll the status every 30 s, and again whenever `refreshKey` changes (a new co-pilot line, say). */
export function useApiStatus(refreshKey?: unknown): ApiStatus | null {
  const [s, setS] = useState<ApiStatus | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch(withToken('/copilot-api-status'))
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => { if (alive && j && !j.error) setS(j as ApiStatus); })
        .catch(() => { /* server unreachable — keep the last figures */ });
    };
    load();
    const t = window.setInterval(load, 30_000);
    return () => { alive = false; window.clearInterval(t); };
  }, [refreshKey]);
  return s;
}

const usd = (n: number) => (n >= 1 ? `$${n.toFixed(2)}` : n >= 0.01 ? `$${n.toFixed(3)}` : `$${n.toFixed(4)}`);
const num = (n: number) => Math.round(n || 0).toLocaleString();
const MODEL_NAME: Record<string, string> = { 'claude-opus-5-5': 'Opus 5.5', 'claude-sonnet-5-5': 'Sonnet 5.5', 'claude-haiku-5-5': 'Haiku 5.5' };
const PURPOSE_NAME: Record<string, string> = { line: 'Lines', opinion: 'Station opinions', screenshot: 'Screenshots' };
const monthName = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return Number.isFinite(y) && Number.isFinite(m) ? new Date(Date.UTC(y, m - 1, 1)).toLocaleString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }) : ym;
};
const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 36 * 3600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
};

/** The tally itself. Renders nothing until the server has answered. */
export function ApiTally({ status }: { status: ApiStatus | null }) {
  if (!status) return null;
  const pct = status.capUsd > 0 ? Math.min(100, (status.spentUsd / status.capUsd) * 100) : 100;
  const bar = status.overCap ? 'bg-red-400' : pct >= 80 ? 'bg-amber-400' : 'bg-primary';
  const purposes = Object.entries(status.byPurpose || {}).sort((a, b) => b[1].usd - a[1].usd);
  const t = status.tokens;
  const last = status.last;
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3 text-xs space-y-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="font-medium text-foreground">Anthropic API · {monthName(status.month)}</span>
        <span className="text-muted-foreground">
          {status.backend === 'api' ? (MODEL_NAME[status.model] || status.model) : 'not in use — Settings has the Claude CLI selected'}
          {status.backend === 'api' && !status.keyPresent ? ' · no key file yet' : ''}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={`tabular-nums ${status.overCap ? 'text-red-400 font-medium' : 'text-foreground'}`}>
          {usd(status.spentUsd)} <span className="text-muted-foreground">of {usd(status.capUsd)} cap</span>
        </span>
        <div className="w-28 h-1.5 bg-muted/30 rounded overflow-hidden" aria-label={`${pct.toFixed(0)}% of the monthly cap`}>
          <div className={`h-full ${bar}`} style={{ width: `${pct}%` }} />
        </div>
        <span className="tabular-nums text-muted-foreground">{num(status.calls)} call{status.calls === 1 ? '' : 's'}</span>
        {status.today && <span className="tabular-nums text-muted-foreground">· today {usd(status.today.usd)} ({num(status.today.calls)})</span>}
        {status.calls > 0 && <span className="tabular-nums text-muted-foreground">· {usd(status.spentUsd / status.calls)} a call</span>}
        {status.overCap && <span className="text-red-400">· cap reached — canned lines only</span>}
      </div>

      {(purposes.length > 0 || (status.errors || 0) > 0 || (status.refusals || 0) > 0) && (
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-muted-foreground tabular-nums">
          {purposes.map(([k, b]) => (
            <span key={k}><span className="text-foreground">{PURPOSE_NAME[k] || k}</span> {num(b.calls)} · {usd(b.usd)}</span>
          ))}
          {(status.errors || 0) > 0 && <span>failed calls {num(status.errors || 0)}</span>}
          {(status.refusals || 0) > 0 && <span>refused {num(status.refusals || 0)}</span>}
        </div>
      )}

      {t && status.calls > 0 && (
        <div className="text-muted-foreground tabular-nums">
          Tokens: {num(t.in)} in · {num(t.cacheRead)} cache read · {num(t.cacheWrite)} cache write · {num(t.out)} out (incl. thinking)
        </div>
      )}

      {last && (
        <div className="text-muted-foreground tabular-nums">
          Last call {ago(last.at)} — {PURPOSE_NAME[last.purpose] ? PURPOSE_NAME[last.purpose].toLowerCase().replace(/s$/, '') : last.purpose} · {usd(last.usd)} · {num(last.inTokens)} in / {num(last.outTokens)} out{last.ms ? ` · ${(last.ms / 1000).toFixed(1)} s` : ''}
        </div>
      )}

      {(status.history || []).length > 0 && (
        <div className="text-muted-foreground tabular-nums">
          Earlier: {(status.history || []).map((h) => `${monthName(h.month)} ${usd(h.usd)} (${num(h.calls)})`).join(' · ')}
        </div>
      )}
    </div>
  );
}
