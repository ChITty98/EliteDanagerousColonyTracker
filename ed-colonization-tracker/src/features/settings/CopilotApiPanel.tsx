import { useEffect, useState } from 'react';
import type { AppSettings } from '@/store/types';
import { ApiTally, type ApiStatus as TallyStatus } from '@/features/copilot/ApiTally';

// Which engine writes the co-pilot's live lines (1.61.0). The Anthropic API option spends the commander's
// own credits; its key is a FILE beside the exe (anthropic-key.txt), read by the server only. Nothing here
// ever sees or sends the key — the status endpoint reports only whether the server found it.

interface ApiStatus {
  backend: 'cli' | 'api';
  keyPresent: boolean;
  model: string;
  capUsd: number;
  month: string;
  spentUsd: number;
  calls: number;
  overCap: boolean;
}

const MODELS: { id: NonNullable<AppSettings['copilotApiModel']>; label: string }[] = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5 — the best voice ($4 / $20 per million tokens in / out)' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5 — half the cost ($2 / $10)' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5 — cheapest ($0.10 / $0.50), flatter voice' },
];

// LAN devices carry the session token; on localhost the server bypasses auth for loopback.
const withTok = (p: string): string => {
  try { const t = sessionStorage.getItem('colony-token'); return t ? `${p}?token=${t}` : p; }
  catch { return p; }
};

export function CopilotApiPanel({ settings, updateSettings }: {
  settings: AppSettings;
  updateSettings: (u: Partial<AppSettings>) => void;
}) {
  const [status, setStatus] = useState<ApiStatus | null>(null);
  const [error, setError] = useState(false);
  const backend = settings.copilotBackend === 'api' ? 'api' : 'cli';

  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch(withTok('/copilot-api-status'))
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((j: ApiStatus) => { if (alive) { setStatus(j); setError(false); } })
        .catch(() => { if (alive) setError(true); });
    };
    load();
    const t = window.setInterval(load, 30_000);
    return () => { alive = false; window.clearInterval(t); };
  }, [backend, settings.copilotApiModel, settings.copilotApiCapUsd]);

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-3">
        <span className="text-sm text-foreground w-40 shrink-0">Live lines written by</span>
        <select
          id="copilot-backend"
          value={backend}
          onChange={(e) => updateSettings({ copilotBackend: e.target.value === 'api' ? 'api' : 'cli' })}
          className="bg-muted border border-border rounded px-2 py-1 text-sm text-foreground"
        >
          <option value="cli">Claude CLI on this PC (your Max login)</option>
          <option value="api">Anthropic API (your credits)</option>
        </select>
      </label>

      {backend === 'api' && (
        <div className="bg-muted/50 border border-border rounded-lg p-3 space-y-2">
          <div className="text-sm">
            {error || !status ? (
              <span className="text-muted-foreground">Checking the API key…</span>
            ) : status.keyPresent ? (
              <span className="text-green-400">Key found (anthropic-key.txt beside the exe).</span>
            ) : (
              <span className="text-amber-400">
                No key yet. Create <code className="text-xs">anthropic-key.txt</code> beside the exe with your API key
                on one line. Until then the co-pilot uses its canned lines.
              </span>
            )}
          </div>

          <label className="flex items-center gap-3">
            <span className="text-sm text-foreground w-40 shrink-0">Model</span>
            <select
              id="copilot-api-model"
              value={settings.copilotApiModel || 'claude-opus-5-5'}
              onChange={(e) => updateSettings({ copilotApiModel: e.target.value as AppSettings['copilotApiModel'] })}
              className="bg-muted border border-border rounded px-2 py-1 text-sm text-foreground"
            >
              {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>

          <label className="flex items-center gap-3">
            <span className="text-sm text-foreground w-40 shrink-0">Monthly cap (USD)</span>
            <input
              id="copilot-api-cap"
              type="number"
              min={0}
              step={5}
              value={settings.copilotApiCapUsd ?? 100}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && v >= 0) updateSettings({ copilotApiCapUsd: v });
              }}
              className="w-24 bg-muted border border-border rounded px-2 py-1 text-sm text-foreground tabular-nums"
            />
            {status && (
              <span className={`text-sm tabular-nums ${status.overCap ? 'text-red-400' : 'text-muted-foreground'}`}>
                ${status.spentUsd.toFixed(2)} spent in {status.month} · {status.calls} call{status.calls === 1 ? '' : 's'}
                {status.overCap ? ' — cap reached, canned lines only' : ''}
              </span>
            )}
          </label>

          <ApiTally status={status as TallyStatus | null} />

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              id="copilot-opinions"
              type="checkbox"
              checked={settings.copilotOpinions !== false}
              onChange={(e) => updateSettings({ copilotOpinions: e.target.checked })}
              className="w-4 h-4 accent-primary"
            />
            <span className="text-sm text-foreground">
              Station opinions
              <span className="text-muted-foreground"> — the co-pilot's own take on a station when docking is granted, remembered for next time</span>
            </span>
          </label>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              id="copilot-screenshots"
              type="checkbox"
              checked={settings.copilotScreenshots !== false}
              onChange={(e) => updateSettings({ copilotScreenshots: e.target.checked })}
              className="w-4 h-4 accent-primary"
            />
            <span className="text-sm text-foreground">
              Co-pilot looks at your screenshots
              <span className="text-muted-foreground"> — each F10 is described and tagged on the photo, the station screen's representative is kept on the station, and it may say something about the shot</span>
            </span>
          </label>

          <p className="text-xs text-muted-foreground">
            Each call sends that moment's prompt to Anthropic — and, when it reads a screenshot, a scaled copy of
            that shot; nothing else leaves this PC. Spend is counted from the
            API's own usage figures and kept in copilot-spend.json beside the exe.
          </p>
        </div>
      )}
    </div>
  );
}
