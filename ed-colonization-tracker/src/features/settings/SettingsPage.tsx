import { useState, useCallback, useRef, useEffect } from 'react';
import { useAppStore } from '@/store';
import { selectJournalFolder, isFileSystemAccessSupported, getJournalFolderHandle } from '@/services/journalReader';
import {
  ALL_STAR_TYPES,
  ALL_ATMO_TYPES,
  ALL_STATION_TYPES,
  DEFAULT_HIGHLIGHT_STARS,
  DEFAULT_HIGHLIGHT_ATMOS,
  DEFAULT_HIGHLIGHT_STATIONS,
  atmoStyle,
  STAR_SORT_ORDER,
  ATMO_SORT_ORDER,
  STATION_SORT_ORDER,
} from '@/features/domain/domainHelpers';

const STORAGE_KEY = 'ed-colonization-tracker';

export function SettingsPage() {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const fleetCarriers = useAppStore((s) => s.fleetCarriers);
  const fleetCarrierSpaceUsage = useAppStore((s) => s.fleetCarrierSpaceUsage);
  const setFleetCarrierSpaceUsage = useAppStore((s) => s.setFleetCarrierSpaceUsage);
  const myFcUsage = settings.myFleetCarrier ? fleetCarrierSpaceUsage?.[settings.myFleetCarrier] : undefined;
  const [journalStatus, setJournalStatus] = useState<string>(
    getJournalFolderHandle() ? 'Journal folder connected \u2713' : 'No folder selected'
  );
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleResetData = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    window.location.reload();
  }, []);

  const handleExport = useCallback(async () => {
    // Try server storage first, fall back to localStorage
    let raw: string | null = null;
    try {
      const token = sessionStorage.getItem('colony-token');
      const url = token ? `/api/state?token=${token}` : '/api/state';
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data && Object.keys(data).length > 0) {
          raw = JSON.stringify({ state: data, version: 18 });
        }
      }
    } catch { /* fall through */ }
    if (!raw) raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) { alert('No data to export'); return; }
    const blob = new Blob([raw], { type: 'application/json' });
    const defaultName = `ed-colony-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`;

    // Use File System Access API save dialog if available
    if ('showSaveFilePicker' in window) {
      try {
        const handle = await (window as unknown as { showSaveFilePicker: (opts: unknown) => Promise<FileSystemFileHandle> }).showSaveFilePicker({
          suggestedName: defaultName,
          types: [{ description: 'JSON Backup', accept: { 'application/json': ['.json'] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return;
      } catch {
        // User cancelled or API unavailable — fall through to download
      }
    }

    // Fallback: trigger browser download
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = defaultName;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string);
        // Basic validation — must have state with projects
        if (!data.state || !Array.isArray(data.state.projects)) {
          setImportStatus('Invalid backup file — missing project data');
          return;
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        setImportStatus('Imported successfully — reloading...');
        setTimeout(() => window.location.reload(), 1000);
      } catch {
        setImportStatus('Failed to parse backup file');
      }
    };
    reader.readAsText(file);
    // Reset the file input so the same file can be re-imported
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const handleSelectFolder = async () => {
    const handle = await selectJournalFolder();
    if (handle) {
      setJournalStatus(`Connected: ${handle.name} \u2713`);
    }
  };

  // Parse squadron callsigns from comma-separated input
  const squadronCallsignsStr = settings.squadronCarrierCallsigns.join(', ');

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <h2 className="text-2xl font-bold">Settings</h2>
        <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">Auto-saved</span>
      </div>
      <div className="max-w-lg space-y-6">
        {/* Commander */}
        <div>
          <label className="block text-sm text-muted-foreground mb-1">Commander Name</label>
          <input
            value={settings.commanderName}
            onChange={(e) => updateSettings({ commanderName: e.target.value })}
            className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:border-primary"
            placeholder="CMDR Name"
          />
        </div>

        {/* Cargo */}
        <div>
          <label className="block text-sm text-muted-foreground mb-1">Ship Cargo Capacity (tons)</label>
          <input
            type="number"
            min="1"
            value={settings.cargoCapacity}
            onChange={(e) => updateSettings({ cargoCapacity: parseInt(e.target.value) || 794, cargoCapacityManual: true })}
            className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:border-primary"
          />
          <div className="flex items-center justify-between mt-1">
            <p className="text-xs text-muted-foreground">
              Used to estimate remaining trips.
              {settings.cargoCapacityManual
                ? <span className="text-yellow-400 ml-1">Manual override — journal won't change this</span>
                : <span className="ml-1">Auto-updated from journal Loadout events</span>
              }
            </p>
            {settings.cargoCapacityManual && (
              <button
                onClick={() => updateSettings({ cargoCapacityManual: false })}
                className="text-xs text-sky-400 hover:text-sky-300 transition-colors whitespace-nowrap ml-2"
              >
                Re-enable auto-detect
              </button>
            )}
          </div>
        </div>

        {/* Home System */}
        <div>
          <label className="block text-sm text-muted-foreground mb-1">Home System</label>
          <input
            value={settings.homeSystem}
            onChange={(e) => updateSettings({ homeSystem: e.target.value })}
            className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:border-primary"
            placeholder="e.g. Sol, HIP 47126"
          />
        </div>

        {/* Fleet Carrier section */}
        <div className="border-t border-border pt-6">
          <h3 className="text-sm font-semibold text-foreground mb-4">{'\u2693'} Fleet Carrier</h3>

          <div className="space-y-4">
            <div>
              <label className="block text-sm text-muted-foreground mb-1">My Fleet Carrier Callsign</label>
              <input
                value={settings.myFleetCarrier}
                onChange={(e) => updateSettings({ myFleetCarrier: e.target.value.toUpperCase() })}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:border-primary font-mono"
                placeholder="e.g. Q8W-T6Z"
                maxLength={7}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Your FC callsign (XXX-XXX format). Used to identify your carrier in journal data.
              </p>
            </div>

            <div>
              <label className="block text-sm text-muted-foreground mb-1">My Fleet Carrier Market ID</label>
              <input
                type="number"
                value={settings.myFleetCarrierMarketId ?? ''}
                onChange={(e) => updateSettings({ myFleetCarrierMarketId: e.target.value ? parseInt(e.target.value) : null })}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:border-primary font-mono"
                placeholder="Auto-detected from journal"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Optional — auto-detected when you dock at your carrier.
                {settings.myFleetCarrier && fleetCarriers.find((fc) => fc.callsign === settings.myFleetCarrier) && (
                  <span className="text-progress-complete ml-1">
                    {'\u2713'} Detected: {fleetCarriers.find((fc) => fc.callsign === settings.myFleetCarrier)?.marketId}
                  </span>
                )}
              </p>
            </div>

            {/* FC Capacity configuration */}
            {settings.myFleetCarrier && (
              <div className="bg-muted/30 border border-border rounded-lg p-3">
                <label className="block text-sm font-semibold text-foreground mb-2">
                  {'\u{1F69A}'} FC Capacity
                </label>
                <p className="text-xs text-muted-foreground mb-3">
                  Max capacity is fixed at <span className="text-foreground font-mono">25,000t</span>. Free cargo is computed live as <code className="text-foreground">25,000 − Modules − Current Cargo</code>, where current cargo is tracked from your journal.
                </p>
                <div>
                  <label className="block text-[10px] uppercase text-muted-foreground mb-1">Modules (t)</label>
                  <input
                    type="number"
                    value={settings.fcModulesCapacity}
                    onChange={(e) => updateSettings({ fcModulesCapacity: e.target.value ? parseInt(e.target.value) : 0 })}
                    className="w-full bg-muted border border-border rounded px-2 py-1 text-sm text-foreground font-mono"
                    placeholder="0"
                  />
                </div>
                <p className="text-[10px] text-muted-foreground mt-2">
                  Modules (t) = total tons used by installed services. You can read this off Carrier Management → Cargo tab.
                </p>
              </div>
            )}

            <div>
              <label className="block text-sm text-muted-foreground mb-1">Squadron Carrier Callsigns</label>
              <input
                value={squadronCallsignsStr}
                onChange={(e) => {
                  const callsigns = e.target.value
                    .split(',')
                    .map((s) => s.trim().toUpperCase())
                    .filter((s) => s.length > 0);
                  updateSettings({ squadronCarrierCallsigns: callsigns });
                }}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:border-primary font-mono"
                placeholder="e.g. A1B-C2D, X3Y-Z4W"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Comma-separated callsigns. Squadron carriers will be labeled differently from unknown FCs.
              </p>
            </div>
          </div>
        </div>

        {/* Domain Highlights */}
        <DomainHighlightsSection settings={settings} updateSettings={updateSettings} />

        {/* Overlay */}
        <OverlaySection settings={settings} updateSettings={updateSettings} />

        {/* Journal Folder */}
        {isFileSystemAccessSupported() && (
          <div className="border-t border-border pt-6">
            <label className="block text-sm text-muted-foreground mb-1">ED Journal Folder</label>
            <div className="flex gap-3 items-center">
              <button
                onClick={handleSelectFolder}
                className="px-4 py-2 bg-secondary/20 text-secondary rounded-lg text-sm hover:bg-secondary/30 transition-colors"
              >
                Select Folder
              </button>
              <span className="text-sm text-muted-foreground">{journalStatus}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Usually at: C:\Users\YourName\Saved Games\Frontier Developments\Elite Dangerous
            </p>
          </div>
        )}

        {/* Data Backup */}
        <div className="border-t border-border pt-6">
          <h3 className="text-sm font-semibold text-foreground mb-2">{'\uD83D\uDCBE'} Data Backup</h3>
          <p className="text-xs text-muted-foreground mb-3">
            Export your data as a JSON file for safekeeping, or import a previous backup.
            This includes all projects, colonized systems, installations, and settings.
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={handleExport}
              className="px-4 py-2 bg-secondary/20 text-secondary rounded-lg text-sm hover:bg-secondary/30 transition-colors"
            >
              Export Backup
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2 bg-muted text-muted-foreground rounded-lg text-sm hover:bg-muted/80 transition-colors"
            >
              Import Backup
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleImport}
              className="hidden"
            />
          </div>
          {importStatus && (
            <p className={`text-xs mt-2 ${importStatus.includes('success') ? 'text-progress-complete' : 'text-red-400'}`}>
              {importStatus}
            </p>
          )}
        </div>

        {/* Danger Zone */}
        <div className="border-t border-red-500/30 pt-6">
          <h3 className="text-sm font-semibold text-red-400 mb-2">{'\u26A0'} Danger Zone</h3>
          <p className="text-xs text-muted-foreground mb-3">
            Permanently delete all stored data including projects, settings, sessions, and custom sources.
            Journal files on disk are not affected.
          </p>
          {!showResetConfirm ? (
            <button
              onClick={() => setShowResetConfirm(true)}
              className="px-4 py-2 bg-red-500/15 text-red-400 border border-red-500/30 rounded-lg text-sm hover:bg-red-500/25 transition-colors"
            >
              Reset All Data
            </button>
          ) : (
            <div className="flex items-center gap-3">
              <button
                onClick={handleResetData}
                className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors"
              >
                Yes, delete everything
              </button>
              <button
                onClick={() => setShowResetConfirm(false)}
                className="px-4 py-2 bg-muted text-muted-foreground rounded-lg text-sm hover:bg-muted/80 transition-colors"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Network Access section with QR code ---

function NetworkAccessSection() {
  const [networkUrl, setNetworkUrl] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Fetch the full network URL with token from the server (localhost only endpoint)
    fetch('/api/network-url').then(r => r.ok ? r.json() : null).then(data => {
      if (data?.url) setNetworkUrl(data.url);
    }).catch(() => {
      // Fallback: try sessionStorage token
      const token = (() => { try { return sessionStorage.getItem('colony-token'); } catch { return null; } })();
      if (token) setNetworkUrl(`${window.location.origin}?token=${token}`);
    });
  }, []);

  const handleCopy = () => {
    navigator.clipboard.writeText(networkUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="border-t border-border pt-6">
      <h3 className="text-sm font-semibold text-foreground mb-3">{'\u{1F4F1}'} Network Access</h3>
      <p className="text-xs text-muted-foreground mb-3">
        Open this URL on your iPad, Surface, or phone to access the app remotely.
      </p>

      <div className="flex items-start gap-4">
        {networkUrl && (
          <div className="shrink-0 bg-white p-2 rounded-lg">
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(networkUrl)}`}
              alt="Scan with phone/tablet"
              width={150} height={150} className="block"
            />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="bg-muted/30 border border-border rounded-lg p-4 mb-2">
            <div className="text-xs text-muted-foreground mb-2">Network URL (includes access token):</div>
            <div className="text-sm font-mono text-primary break-all select-all">{networkUrl || 'Loading...'}</div>
          </div>
      <div className="flex items-center gap-2">
        <button
          onClick={handleCopy}
          disabled={!networkUrl}
          className="px-3 py-1.5 text-xs bg-primary/20 text-primary rounded hover:bg-primary/30 transition-colors"
        >
          {copied ? 'Copied!' : 'Copy to Clipboard'}
        </button>
        <span className="text-[10px] text-muted-foreground">
          Tip: bookmark this URL on each device so you don't need to copy it again.
        </span>
      </div>
        </div>
      </div>
    </div>
  );
}

// --- Domain Highlights configuration section ---

import type { AppSettings } from '@/store/types';

function HighlightChip({ label, active, icon, colorClass, onToggle }: {
  label: string; active: boolean; icon?: string; colorClass?: string; onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs border transition-colors ${
        active
          ? `${colorClass || 'text-yellow-400'} border-current bg-current/10`
          : 'text-muted-foreground/50 border-border/50 bg-transparent hover:border-border'
      }`}
    >
      {icon && <span>{icon}</span>}
      {label}
    </button>
  );
}

function DomainHighlightsSection({
  settings,
  updateSettings,
}: {
  settings: AppSettings;
  updateSettings: (updates: Partial<AppSettings>) => void;
}) {
  const hlStars = settings.domainHighlightStars ?? DEFAULT_HIGHLIGHT_STARS;
  const hlAtmos = settings.domainHighlightAtmos ?? DEFAULT_HIGHLIGHT_ATMOS;
  const hlStations = settings.domainHighlightStations ?? DEFAULT_HIGHLIGHT_STATIONS;

  const toggleStar = (type: string) => {
    const set = new Set(hlStars);
    set.has(type) ? set.delete(type) : set.add(type);
    updateSettings({ domainHighlightStars: [...set] });
  };
  const toggleAtmo = (type: string) => {
    const set = new Set(hlAtmos);
    set.has(type) ? set.delete(type) : set.add(type);
    updateSettings({ domainHighlightAtmos: [...set] });
  };
  const toggleStation = (type: string) => {
    const set = new Set(hlStations);
    set.has(type) ? set.delete(type) : set.add(type);
    updateSettings({ domainHighlightStations: [...set] });
  };

  const resetAll = () => {
    updateSettings({
      domainHighlightStars: [...DEFAULT_HIGHLIGHT_STARS],
      domainHighlightAtmos: [...DEFAULT_HIGHLIGHT_ATMOS],
      domainHighlightStations: [...DEFAULT_HIGHLIGHT_STATIONS],
    });
  };

  // Sort types by their defined order
  const sortedStarTypes = [...ALL_STAR_TYPES].sort((a, b) => (STAR_SORT_ORDER[a] ?? 99) - (STAR_SORT_ORDER[b] ?? 99));
  const sortedAtmoTypes = [...ALL_ATMO_TYPES].sort((a, b) => (ATMO_SORT_ORDER[a] ?? 99) - (ATMO_SORT_ORDER[b] ?? 99));
  const sortedStationTypes = [...ALL_STATION_TYPES].sort((a, b) => (STATION_SORT_ORDER[a] ?? 99) - (STATION_SORT_ORDER[b] ?? 99));

  return (
    <div className="border-t border-border pt-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground">{'\u{1F3DB}\u{FE0F}'} Domain Highlights</h3>
        <button
          onClick={resetAll}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Reset to defaults
        </button>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Choose which types appear as highlights on the Architect's Domain page. Toggled types get showcased at the top.
      </p>

      {/* Stars */}
      <div className="mb-4">
        <div className="text-xs font-medium text-muted-foreground mb-2">{'\u2B50'} Star Types</div>
        <div className="flex flex-wrap gap-1.5">
          {sortedStarTypes.map((type) => (
            <HighlightChip
              key={type}
              label={type}
              active={hlStars.includes(type)}
              colorClass="text-purple-400"
              onToggle={() => toggleStar(type)}
            />
          ))}
        </div>
      </div>

      {/* Atmospheres */}
      <div className="mb-4">
        <div className="text-xs font-medium text-muted-foreground mb-2">{'\u{1F30D}'} Landable Atmosphere Types</div>
        <div className="flex flex-wrap gap-1.5">
          {sortedAtmoTypes.map((type) => {
            const style = atmoStyle(type);
            return (
              <HighlightChip
                key={type}
                label={type}
                active={hlAtmos.includes(type)}
                icon={style.icon}
                colorClass={style.color}
                onToggle={() => toggleAtmo(type)}
              />
            );
          })}
        </div>
      </div>

      {/* Stations */}
      <div>
        <div className="text-xs font-medium text-muted-foreground mb-2">{'\u{1F6F0}\u{FE0F}'} Station & Installation Types</div>
        <div className="flex flex-wrap gap-1.5">
          {sortedStationTypes.map((type) => (
            <HighlightChip
              key={type}
              label={type}
              active={hlStations.includes(type)}
              colorClass="text-orange-400"
              onToggle={() => toggleStation(type)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// --- Overlay connection & test section ---

function OverlaySection({
  settings,
  updateSettings,
}: {
  settings: AppSettings;
  updateSettings: (updates: Partial<AppSettings>) => void;
}) {
  const [overlayStatus, setOverlayStatus] = useState<'unknown' | 'connected' | 'disconnected'>('unknown');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  // Poll overlay connection status every 5s while enabled
  useEffect(() => {
    if (settings.overlayEnabled === false) {
      setOverlayStatus('unknown');
      return;
    }

    let cancelled = false;

    const check = async () => {
      try {
        const res = await fetch('/overlay/status');
        const data = await res.json();
        if (!cancelled) setOverlayStatus(data.connected ? 'connected' : 'disconnected');
      } catch {
        if (!cancelled) setOverlayStatus('disconnected');
      }
    };

    check();
    const interval = setInterval(check, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [settings.overlayEnabled]);

  const handleTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/overlay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'overlay-test',
          text: 'Colony Tracker overlay is working!',
          color: '#00ff88',
          x: 40,
          y: 40,
          ttl: 8,
          type: 'message',
        }),
      });
      const data = await res.json();
      if (data.connected) {
        setTestResult('Message sent to overlay');
      } else {
        setTestResult('Server reached but overlay not connected — is EDMCModernOverlay running?');
      }
    } catch {
      setTestResult('Could not reach server — is the app running via the exe/bat launcher?');
    } finally {
      setTesting(false);
    }
  }, []);

  const statusIcon =
    overlayStatus === 'connected' ? '\u2705' :
    overlayStatus === 'disconnected' ? '\u{1F534}' :
    '\u26AA';

  const statusText =
    overlayStatus === 'connected' ? 'Connected to EDMCModernOverlay' :
    overlayStatus === 'disconnected' ? 'Not connected' :
    'Status unknown';

  return (
    <div className="border-t border-border pt-6">
      <h3 className="text-sm font-semibold text-foreground mb-4">{'\u{1F3AE}'} In-Game Overlay</h3>

      <div className="space-y-4">
        {/* Enable toggle */}
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.overlayEnabled !== false}
            onChange={(e) => updateSettings({ overlayEnabled: e.target.checked })}
            className="w-4 h-4 accent-primary"
          />
          <span className="text-sm text-foreground">Enable overlay notifications</span>
        </label>

        {/* Connection status */}
        {settings.overlayEnabled !== false && (
          <div className="bg-muted/50 border border-border rounded-lg p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm">{statusIcon}</span>
                <span className={`text-sm ${
                  overlayStatus === 'connected' ? 'text-green-400' :
                  overlayStatus === 'disconnected' ? 'text-red-400' :
                  'text-muted-foreground'
                }`}>
                  {statusText}
                </span>
              </div>
              <button
                onClick={handleTest}
                disabled={testing}
                className="px-3 py-1 bg-secondary/20 text-secondary rounded text-xs hover:bg-secondary/30 transition-colors disabled:opacity-50"
              >
                {testing ? 'Sending...' : 'Test Overlay'}
              </button>
            </div>
            {testResult && (
              <p className={`text-xs mt-2 ${testResult.includes('working') || testResult.includes('sent') ? 'text-green-400' : 'text-yellow-400'}`}>
                {testResult}
              </p>
            )}
          </div>
        )}

        {/* What overlay shows */}
        <div className="text-xs text-muted-foreground space-y-1">
          <p className="font-medium text-foreground text-sm mb-1">Overlay shows:</p>
          <p>{'\u2022'} Scouting scores when jumping to scored/new systems</p>
          <p>{'\u2022'} Needed commodities when docking at stations (active session)</p>
          <p>{'\u2022'} Fleet carrier load list when docking at your FC</p>
          <p>{'\u2022'} Image reminders for installations missing screenshots</p>
          <p>{'\u2022'} Welcome-back message when entering home system</p>
        </div>

        {/* Setup instructions */}
        {settings.overlayEnabled !== false && overlayStatus === 'disconnected' && (
          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3">
            <p className="text-xs font-medium text-yellow-400 mb-1">Setup required:</p>
            <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
              <li>Install <span className="text-foreground">EDMCModernOverlay</span> from GitHub</li>
              <li>Launch it — it listens on TCP port 5010</li>
              <li>Launch Elite Dangerous — overlay attaches to the game window</li>
              <li>This app auto-connects to the overlay when detected</li>
            </ol>
            <p className="text-xs text-muted-foreground mt-2">
              The overlay runs independently — this app sends messages to it. An active journal watcher session is required for triggers.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
