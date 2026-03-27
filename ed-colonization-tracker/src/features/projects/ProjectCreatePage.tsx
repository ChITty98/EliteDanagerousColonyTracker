import { Fragment, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/store';
import { COMMODITIES, CATEGORY_ORDER, CATEGORY_LABELS, type CommodityCategory } from '@/data/commodities';
import type { ProjectCommodity } from '@/store/types';
import {
  scanJournalFiles,
  isFileSystemAccessSupported,
  selectJournalFolder,
  getJournalFolderHandle,
  type DiscoveredDepot,
} from '@/services/journalReader';
import { formatNumber } from '@/lib/utils';

export function ProjectCreatePage() {
  const navigate = useNavigate();
  const addProject = useAppStore((s) => s.addProject);
  const existingProjects = useAppStore((s) => s.projects);

  const [mode, setMode] = useState<'choose' | 'manual' | 'journal'>('choose');
  const [name, setName] = useState('');
  const [systemName, setSystemName] = useState('');
  const [stationType, setStationType] = useState('');
  const [commodities, setCommodities] = useState<ProjectCommodity[]>([]);
  const [discoveredDepots, setDiscoveredDepots] = useState<DiscoveredDepot[]>([]);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const [selectedMarketId, setSelectedMarketId] = useState<number | null>(null);

  const initManualCommodities = () => {
    setCommodities(
      COMMODITIES.map((c) => ({
        commodityId: c.id,
        name: c.name,
        requiredQuantity: 0,
        providedQuantity: 0,
      }))
    );
  };

  const handleScanJournals = async () => {
    setScanning(true);
    setError('');
    try {
      // If no folder handle yet, prompt user to select one
      if (!getJournalFolderHandle()) {
        const handle = await selectJournalFolder();
        if (!handle) {
          setError('No folder selected. Please select your ED journal folder to scan.');
          setScanning(false);
          return;
        }
      }

      const depots = await scanJournalFiles();
      const activeDepots = depots.filter((d) => !d.isComplete);
      setDiscoveredDepots(activeDepots);
      if (activeDepots.length === 0) {
        setError('No active construction depots found in journal files.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to scan journal files');
    } finally {
      setScanning(false);
    }
  };

  const handleSelectDepot = (depot: DiscoveredDepot) => {
    const depotName = depot.systemName
      ? `${depot.systemName}${depot.stationName ? ` - ${depot.stationName}` : ''}`
      : `Depot ${depot.marketId}`;
    setName(depotName);
    setSystemName(depot.systemName || '');
    setStationType(depot.stationType || '');
    setSelectedMarketId(depot.marketId);
    setCommodities(depot.commodities);
    setMode('manual'); // Switch to edit mode with pre-filled data
  };

  /** Auto-import: create or update projects for all discovered depots */
  const handleImportAll = () => {
    let created = 0;
    let updated = 0;
    for (const depot of discoveredDepots) {
      // Check if a project already exists for this MarketID
      const existing = existingProjects.find((p) => p.marketId === depot.marketId);
      if (existing) {
        // Update existing project's commodities
        useAppStore.getState().updateAllCommodities(existing.id, depot.commodities);
        // Also update system/station info if we now have it
        if (depot.systemName && !existing.systemName) {
          useAppStore.getState().updateProject(existing.id, {
            systemName: depot.systemName,
            stationType: depot.stationType || existing.stationType,
          });
        }
        updated++;
      } else {
        // Create new project
        const depotName = depot.systemName
          ? `${depot.systemName}${depot.stationName ? ` - ${depot.stationName}` : ''}`
          : `Depot ${depot.marketId}`;
        addProject({
          name: depotName,
          systemName: depot.systemName || '',
          systemAddress: depot.systemAddress ?? null,
          stationType: depot.stationType || '',
          stationName: depot.stationName || '',
          marketId: depot.marketId,
          commodities: depot.commodities,
          status: 'active',
          notes: '',
        });
        created++;
      }
    }
    // Navigate to projects list after bulk import
    navigate('/projects', {
      state: { message: `Synced ${discoveredDepots.length} depot(s): ${created} created, ${updated} updated` },
    });
  };

  const handleCommodityChange = (commodityId: string, field: 'requiredQuantity' | 'providedQuantity', value: number) => {
    setCommodities((prev) =>
      prev.map((c) => (c.commodityId === commodityId ? { ...c, [field]: value } : c))
    );
  };

  const handleSave = () => {
    if (!name.trim()) {
      setError('Project name is required');
      return;
    }
    const filtered = commodities.filter((c) => c.requiredQuantity > 0);
    if (filtered.length === 0) {
      setError('At least one commodity with a required quantity is needed');
      return;
    }
    const id = addProject({
      name: name.trim(),
      systemName: systemName.trim(),
      systemAddress: null,
      stationType: stationType.trim(),
      stationName: '',
      marketId: selectedMarketId,
      commodities: filtered,
      status: 'active',
      notes: '',
    });
    navigate(`/projects/${id}`);
  };

  // Choose mode
  if (mode === 'choose') {
    return (
      <div>
        <h2 className="text-2xl font-bold mb-6">New Project</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl">
          <button
            onClick={() => { setMode('manual'); initManualCommodities(); }}
            className="bg-card border border-border rounded-lg p-6 text-left hover:border-primary/50 transition-colors"
          >
            <div className="text-2xl mb-2">{'\u270F\uFE0F'}</div>
            <h3 className="font-semibold mb-1">Manual Entry</h3>
            <p className="text-sm text-muted-foreground">Enter project details and commodity quantities by hand</p>
          </button>

          {isFileSystemAccessSupported() && (
            <button
              onClick={() => { setMode('journal'); handleScanJournals(); }}
              className="bg-card border border-border rounded-lg p-6 text-left hover:border-primary/50 transition-colors"
            >
              <div className="text-2xl mb-2">{'\u{1F4C2}'}</div>
              <h3 className="font-semibold mb-1">Import from Journal</h3>
              <p className="text-sm text-muted-foreground">
                Scan ED journal files for active construction depots
              </p>
            </button>
          )}

          {!isFileSystemAccessSupported() && (
            <div className="bg-card border border-border rounded-lg p-6 text-left opacity-50">
              <div className="text-2xl mb-2">{'\u{1F4C2}'}</div>
              <h3 className="font-semibold mb-1">Import from Journal</h3>
              <p className="text-sm text-muted-foreground">
                Not available — requires Chrome or Edge. Firefox does not support the File System Access API.
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Journal import mode - depot selection
  if (mode === 'journal' && commodities.length === 0) {
    // Check which depots already have an existing project
    const existingMarketIds = new Set(existingProjects.map((p) => p.marketId).filter(Boolean));

    return (
      <div>
        <div className="flex items-center gap-4 mb-6">
          <button onClick={() => setMode('choose')} className="text-muted-foreground hover:text-foreground">{'\u2190'} Back</button>
          <h2 className="text-2xl font-bold">Import from Journal</h2>
        </div>

        {scanning && <p className="text-muted-foreground">Scanning journal files...</p>}
        {error && (
          <div className="mb-4">
            <p className="text-destructive mb-3">{error}</p>
            {error.includes('No folder selected') && (
              <button
                onClick={handleScanJournals}
                className="px-4 py-2 bg-secondary/20 text-secondary rounded-lg text-sm hover:bg-secondary/30 transition-colors"
              >
                Select Journal Folder
              </button>
            )}
          </div>
        )}

        {!scanning && discoveredDepots.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-4">
              <p className="text-muted-foreground">
                Found {discoveredDepots.length} active depot(s).
              </p>
              <button
                onClick={handleImportAll}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                {'\u{1F504}'} Sync All ({discoveredDepots.length})
              </button>
            </div>

            <p className="text-xs text-muted-foreground mb-2">
              Click a depot to review before importing, or use "Sync All" to create/update all at once.
            </p>

            {discoveredDepots.map((depot) => {
              const totalReq = depot.commodities.reduce((s, c) => s + c.requiredQuantity, 0);
              const totalProv = depot.commodities.reduce((s, c) => s + c.providedQuantity, 0);
              const alreadyTracked = existingMarketIds.has(depot.marketId);

              return (
                <button
                  key={depot.marketId}
                  onClick={() => handleSelectDepot(depot)}
                  className="w-full bg-card border border-border rounded-lg p-4 text-left hover:border-primary/50 transition-colors"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      {depot.systemName ? (
                        <>
                          <span className="font-medium">{depot.systemName}</span>
                          {depot.stationName && (
                            <span className="text-sm text-muted-foreground ml-2">
                              {depot.stationName}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="font-medium">Market ID: {depot.marketId}</span>
                      )}
                      <span className="text-sm text-muted-foreground ml-2">
                        ({depot.commodities.length} commodities)
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {alreadyTracked && (
                        <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded">
                          Already tracked
                        </span>
                      )}
                      <span className="text-sm text-muted-foreground">
                        {Math.round(depot.constructionProgress * 100)}% complete
                      </span>
                    </div>
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {formatNumber(totalProv)} / {formatNumber(totalReq)} tons delivered
                    {depot.stationType && ` \u2022 ${depot.stationType}`}
                  </div>
                </button>
              );
            })}

            {/* Rescan button */}
            <div className="pt-2">
              <button
                onClick={handleScanJournals}
                disabled={scanning}
                className="text-sm text-secondary hover:underline disabled:opacity-50"
              >
                {scanning ? 'Rescanning...' : 'Rescan journal files'}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Manual entry / edit mode
  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => { setMode('choose'); setCommodities([]); }} className="text-muted-foreground hover:text-foreground">{'\u2190'} Back</button>
        <h2 className="text-2xl font-bold">
          {commodities.some((c) => c.providedQuantity > 0) ? 'Review Imported Project' : 'New Project'}
        </h2>
      </div>

      {error && <p className="text-destructive mb-4">{error}</p>}

      {/* Project info */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div>
          <label className="block text-sm text-muted-foreground mb-1">Project Name *</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:border-primary"
            placeholder="e.g. HIP 47126 Coriolis"
          />
        </div>
        <div>
          <label className="block text-sm text-muted-foreground mb-1">System Name</label>
          <input
            value={systemName}
            onChange={(e) => setSystemName(e.target.value)}
            className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:border-primary"
            placeholder="e.g. HIP 47126"
          />
        </div>
        <div>
          <label className="block text-sm text-muted-foreground mb-1">Station Type</label>
          <input
            value={stationType}
            onChange={(e) => setStationType(e.target.value)}
            className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:border-primary"
            placeholder="e.g. Coriolis, Outpost, Orbis"
          />
        </div>
      </div>

      {/* Commodity table */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border text-sm text-muted-foreground">
              <th className="text-left px-4 py-3">Commodity</th>
              <th className="text-right px-4 py-3 w-36">Required</th>
              <th className="text-right px-4 py-3 w-36">Provided</th>
            </tr>
          </thead>
          <tbody>
            {CATEGORY_ORDER.map((category) => {
              const catCommodities = commodities.filter((c) => {
                const def = COMMODITIES.find((d) => d.id === c.commodityId);
                return def?.category === category;
              });
              if (catCommodities.length === 0) return null;

              return (
                <Fragment key={category}>
                  <tr>
                    <td colSpan={3} className="px-4 py-2 text-xs font-semibold uppercase tracking-wider" style={{ color: `var(--color-commodity-${category})` }}>
                      {CATEGORY_LABELS[category as CommodityCategory]}
                    </td>
                  </tr>
                  {catCommodities.map((c) => (
                    <tr key={c.commodityId} className="border-t border-border/50 hover:bg-muted/30">
                      <td className="px-4 py-2 text-sm">{c.name}</td>
                      <td className="px-4 py-2">
                        <input
                          type="number"
                          min="0"
                          value={c.requiredQuantity || ''}
                          onChange={(e) => handleCommodityChange(c.commodityId, 'requiredQuantity', parseInt(e.target.value) || 0)}
                          className="w-full bg-muted border border-border rounded px-2 py-1 text-right text-sm text-foreground focus:outline-none focus:border-primary"
                          placeholder="0"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input
                          type="number"
                          min="0"
                          value={c.providedQuantity || ''}
                          onChange={(e) => handleCommodityChange(c.commodityId, 'providedQuantity', parseInt(e.target.value) || 0)}
                          className="w-full bg-muted border border-border rounded px-2 py-1 text-right text-sm text-foreground focus:outline-none focus:border-primary"
                          placeholder="0"
                        />
                      </td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-6 flex gap-3">
        <button
          onClick={handleSave}
          className="px-6 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors"
        >
          Create Project
        </button>
        <button
          onClick={() => navigate('/projects')}
          className="px-6 py-2 bg-muted text-muted-foreground rounded-lg hover:bg-muted/80 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
