import { useState } from 'react';
import { storeToken, needsToken } from '@/store';

/**
 * Access-token prompt for network devices.
 *
 * Before this, the ONLY way in from another device was a `?token=…` URL — which
 * meant an ugly bookmark, and (worse) an iPad home-screen shortcut that lost auth
 * whenever the tab was recycled, because the token lived in sessionStorage alone.
 * Paste it once here and it persists in localStorage, so a clean
 * `http://<host>:5173` bookmark just works from then on.
 *
 * The token is printed in the app's own console window at startup, and lives in
 * colony-token.txt beside the exe.
 */
export function TokenGate({ children }: { children: React.ReactNode }) {
  const [locked, setLocked] = useState(() => needsToken());
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  if (!locked) return <>{children}</>;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = value.trim();
    if (!token || checking) return;
    setChecking(true);
    setError(null);
    try {
      // Verify before storing, so a typo says so instead of silently half-working.
      const res = await fetch(`/api/version?token=${encodeURIComponent(token)}`);
      if (!res.ok) throw new Error(res.status === 401 ? 'That token was rejected.' : `Server said ${res.status}.`);
      storeToken(token);
      setLocked(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach the app.');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm bg-card border border-border rounded-lg p-5 space-y-3">
        <h1 className="text-lg font-bold text-primary">ED Colony Architect</h1>
        <p className="text-sm text-muted-foreground">
          This device needs the access token. It&apos;s printed in the app&apos;s console window on the PC,
          and saved in <span className="font-mono text-xs">colony-token.txt</span> next to the exe.
        </p>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Paste token"
          autoFocus
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="w-full bg-muted border border-border rounded-lg px-3 py-2 font-mono text-sm focus:outline-none focus:border-primary"
        />
        {error && <div className="text-xs text-red-400">{error}</div>}
        <button
          type="submit"
          disabled={!value.trim() || checking}
          className="w-full rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
        >
          {checking ? 'Checking…' : 'Connect'}
        </button>
        <p className="text-[11px] text-muted-foreground/70">
          Saved on this device, so you can bookmark the plain address from now on.
        </p>
      </form>
    </div>
  );
}
