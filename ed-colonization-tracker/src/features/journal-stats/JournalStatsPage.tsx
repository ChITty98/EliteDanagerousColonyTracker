import { useState, useCallback, useMemo } from 'react';
import { scanJournalHistory, getJournalFolderHandle, selectJournalFolder, type JournalHistoryStats } from '@/services/journalReader';

function formatCredits(amount: number): string {
  if (amount >= 1_000_000_000) return `${(amount / 1_000_000_000).toFixed(1)}B CR`;
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M CR`;
  if (amount >= 1_000) return `${Math.round(amount / 1_000).toLocaleString()}K CR`;
  return `${amount.toLocaleString()} CR`;
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function formatDistance(ly: number): string {
  if (ly >= 1_000_000) return `${(ly / 1_000_000).toFixed(2)}M ly`;
  if (ly >= 1_000) return `${(ly / 1_000).toFixed(1)}K ly`;
  return `${ly.toLocaleString()} ly`;
}

function formatPlaytime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  if (days > 0) return `${days.toLocaleString()}d ${remainingHours}h`;
  return `${hours}h`;
}

function StatCard({ icon, label, value, sub }: { icon: string; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 px-4 py-3">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-base">{icon}</span>
        <span className="text-xs text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-xl font-bold text-foreground">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function RankList({ items, valueLabel }: { items: { name: string; value: string; sub?: string }[]; valueLabel: string }) {
  return (
    <div className="space-y-1">
      {items.map((item, i) => (
        <div key={item.name} className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground w-5 text-right">{i + 1}.</span>
          <div className="flex-1 min-w-0">
            <span className="text-foreground truncate block">{item.name}</span>
            {item.sub && <span className="text-xs text-muted-foreground/70">{item.sub}</span>}
          </div>
          <span className="text-muted-foreground tabular-nums whitespace-nowrap">{item.value} {valueLabel}</span>
        </div>
      ))}
    </div>
  );
}

export function JournalStatsPage() {
  const [stats, setStats] = useState<JournalHistoryStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ pct: 0, phase: '' });
  const [error, setError] = useState<string | null>(null);
  const [systemSearch, setSystemSearch] = useState('');

  const systemSearchResults = useMemo(() => {
    if (!stats || !systemSearch.trim()) return [];
    const q = systemSearch.trim().toLowerCase();
    return stats.allSystemVisits
      .filter((s) => s.name.toLowerCase().includes(q))
      .slice(0, 25);
  }, [stats, systemSearch]);

  const handleScan = useCallback(async () => {
    let handle = getJournalFolderHandle();
    if (!handle) {
      handle = await selectJournalFolder();
      if (!handle) return;
    }
    setLoading(true);
    setError(null);
    setProgress({ pct: 0, phase: 'Starting...' });
    try {
      const result = await scanJournalHistory(handle, (pct, phase) => {
        setProgress({ pct, phase });
      });
      setStats(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to scan journals');
    } finally {
      setLoading(false);
    }
  }, []);

  if (!stats && !loading) {
    return (
      <div className="text-center py-20">
        <p className="text-4xl mb-4">📖</p>
        <h2 className="text-xl font-bold text-foreground mb-2">Journal History</h2>
        <p className="text-muted-foreground mb-6">
          Scan your entire journal history to see lifetime stats across years of gameplay.
          This reads every log file in your journal directory.
        </p>
        <button
          onClick={handleScan}
          className="px-6 py-2.5 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors"
        >
          Scan Journal History
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="text-center py-20">
        <p className="text-4xl mb-4 animate-pulse">📖</p>
        <h2 className="text-xl font-bold text-foreground mb-2">Scanning Journals...</h2>
        <div className="w-64 mx-auto mb-3">
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-300"
              style={{ width: `${progress.pct}%` }}
            />
          </div>
        </div>
        <p className="text-sm text-muted-foreground">{progress.phase}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-20">
        <p className="text-4xl mb-4">⚠️</p>
        <h2 className="text-xl font-bold text-foreground mb-2">Scan Failed</h2>
        <p className="text-muted-foreground mb-4">{error}</p>
        <button
          onClick={handleScan}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm hover:bg-primary/90"
        >
          Try Again
        </button>
      </div>
    );
  }

  if (!stats) return null;

  const dateRange = stats.firstEventDate && stats.lastEventDate
    ? `${new Date(stats.firstEventDate).toLocaleDateString()} — ${new Date(stats.lastEventDate).toLocaleDateString()}`
    : '';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Journal History</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {dateRange && <span>{dateRange} &middot; </span>}
            {formatNumber(stats.journalFileCount)} journal files processed
          </p>
        </div>
        <button
          onClick={handleScan}
          className="px-4 py-2 bg-muted/50 text-foreground rounded-lg text-sm hover:bg-muted transition-colors border border-border"
        >
          Rescan
        </button>
      </div>

      {/* Game Stats Banner (if available) */}
      {stats.gameStats?.timePlayed && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
            <div>
              <div className="text-lg font-bold text-primary">{formatPlaytime(stats.gameStats.timePlayed)}</div>
              <div className="text-xs text-muted-foreground">Time Played</div>
            </div>
            {stats.gameStats.currentWealth != null && (
              <div>
                <div className="text-lg font-bold text-primary">{formatCredits(stats.gameStats.currentWealth)}</div>
                <div className="text-xs text-muted-foreground">Current Wealth</div>
              </div>
            )}
            {(stats.farthestFromSolLY > 0 || stats.gameStats.greatestDistance != null) && (
              <div>
                <div className="text-lg font-bold text-primary">
                  {formatDistance(stats.farthestFromSolLY > 0 ? stats.farthestFromSolLY : Math.round(stats.gameStats.greatestDistance!))}
                </div>
                <div className="text-xs text-muted-foreground">
                  Farthest from Sol{stats.farthestSystemName && <> &mdash; {stats.farthestSystemName}</>}
                </div>
              </div>
            )}
            {stats.gameStats.enginesUsed != null && stats.gameStats.enginesUsed > 0 && (
              <div>
                <div className="text-lg font-bold text-primary">{stats.gameStats.enginesUsed}</div>
                <div className="text-xs text-muted-foreground">Engineers Used</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Travel */}
      <Section title="Travel" icon="🚀">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <StatCard icon="⚡" label="Jumps" value={formatNumber(stats.totalJumps)} />
          <StatCard icon="📏" label="Distance" value={formatDistance(stats.totalDistanceLY)} />
          <StatCard icon="🌟" label="Systems" value={formatNumber(stats.uniqueSystemsVisited)} />
          <StatCard icon="🛰️" label="Stations" value={formatNumber(stats.uniqueStationsDocked)} />
        </div>
        {stats.topSystems.length > 0 && (
          <div className="rounded-lg border border-border bg-muted/10 p-4">
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Most Visited Systems</h4>
            <RankList
              items={stats.topSystems.map((s) => ({
                name: s.name,
                value: formatNumber(s.visits),
                sub: s.lastVisited ? `last visited ${new Date(s.lastVisited).toLocaleDateString()}` : undefined,
              }))}
              valueLabel="visits"
            />
          </div>
        )}
        {stats.topStations && stats.topStations.length > 0 && (
          <div className="rounded-lg border border-border bg-muted/10 p-4 mt-3">
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Most Visited Stations</h4>
            <RankList
              items={stats.topStations.map((s) => ({
                name: s.name,
                value: formatNumber(s.visits),
                sub: `${s.systemName}${s.lastVisited ? ` \u00B7 last ${new Date(s.lastVisited).toLocaleDateString()}` : ''}`,
              }))}
              valueLabel="docks"
            />
          </div>
        )}
        {/* System Search */}
        <div className="rounded-lg border border-border bg-muted/10 p-4">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">System Lookup</h4>
          <input
            value={systemSearch}
            onChange={(e) => setSystemSearch(e.target.value)}
            placeholder="Search for a system..."
            className="w-full bg-muted border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary mb-3"
          />
          {systemSearchResults.length > 0 && (
            <div className="space-y-1">
              {systemSearchResults.map((s) => (
                <div key={s.name} className="flex items-center gap-3 text-sm py-1 border-t border-border/30 first:border-0">
                  <span className="flex-1 text-foreground font-medium truncate">{s.name}</span>
                  <span className="text-muted-foreground tabular-nums">{formatNumber(s.visits)} visits</span>
                  <span className="text-xs text-muted-foreground/70 whitespace-nowrap">
                    {s.firstVisited && new Date(s.firstVisited).toLocaleDateString()}
                    {s.firstVisited && s.lastVisited && s.firstVisited !== s.lastVisited && (
                      <> — {new Date(s.lastVisited).toLocaleDateString()}</>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
          {systemSearch.trim() && systemSearchResults.length === 0 && (
            <p className="text-sm text-muted-foreground">No systems found matching "{systemSearch}"</p>
          )}
        </div>
      </Section>

      {/* Exploration */}
      <Section title="Exploration" icon="🔭">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <StatCard icon="📡" label="Honked" value={formatNumber(stats.systemsHonked)} sub="discovery scans" />
          <StatCard icon="🔍" label="Scanned" value={formatNumber(stats.bodiesScanned)} sub={`${formatNumber(stats.bodiesDiscovered)} first discoveries`} />
          <StatCard icon="🗺️" label="Mapped" value={formatNumber(stats.surfaceMapped)} sub={`${formatNumber(stats.efficientMaps)} efficient`} />
          <StatCard icon="💰" label="Earnings" value={formatCredits(stats.explorationEarnings)} sub="from cartographics" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard icon="🌍" label="Earth-likes" value={formatNumber(stats.earthlikesFound)} sub={stats.earthlikesDiscovered > 0 ? `${formatNumber(stats.earthlikesDiscovered)} first discoveries` : 'scanned'} />
          <StatCard icon="💧" label="Water Worlds" value={formatNumber(stats.waterWorldsFound)} sub={stats.waterWorldsDiscovered > 0 ? `${formatNumber(stats.waterWorldsDiscovered)} first discoveries` : 'scanned'} />
          <StatCard icon="☁️" label="Ammonia Worlds" value={formatNumber(stats.ammoniaWorldsFound)} sub={stats.ammoniaWorldsDiscovered > 0 ? `${formatNumber(stats.ammoniaWorldsDiscovered)} first discoveries` : 'scanned'} />
          <StatCard icon="🦶" label="Landings" value={formatNumber(stats.totalLandings)} sub={`${formatNumber(stats.landablesFound)} landables found`} />
        </div>
      </Section>

      {/* Combat */}
      <Section title="Combat" icon="⚔️">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard icon="🎯" label="Bounties" value={formatNumber(stats.bountiesCollected)} sub={formatCredits(stats.bountyEarnings)} />
          <StatCard icon="🏅" label="Combat Bonds" value={formatNumber(stats.combatBonds)} sub={formatCredits(stats.combatBondEarnings)} />
          <StatCard icon="💀" label="Deaths" value={formatNumber(stats.deaths)} />
          <StatCard icon="🚨" label="Interdicted" value={formatNumber(stats.interdictions)} sub={stats.interdictions > 0 ? `${formatNumber(stats.interdictionEscapes)} escaped` : undefined} />
        </div>
      </Section>

      {/* Trade */}
      <Section title="Trade" icon="📦">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <StatCard icon="🛒" label="Bought" value={`${formatNumber(stats.tonsBought)}t`} sub={formatCredits(stats.creditsSpent)} />
          <StatCard icon="💵" label="Sold" value={`${formatNumber(stats.tonsSold)}t`} sub={formatCredits(stats.creditsEarned)} />
          <StatCard icon="📋" label="Missions" value={formatNumber(stats.missionsCompleted)} sub={formatCredits(stats.missionEarnings)} />
          {stats.contributionsMade > 0 && (
            <StatCard icon="🏗️" label="Colonization" value={`${formatNumber(stats.contributionsMade)} drops`} sub={`${formatNumber(stats.systemsClaimed)} systems claimed`} />
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {stats.topCommoditiesBought.length > 0 && (
            <div className="rounded-lg border border-border bg-muted/10 p-4">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Top Commodities Bought</h4>
              <RankList
                items={stats.topCommoditiesBought.map((c) => ({ name: c.name, value: formatNumber(c.tons) }))}
                valueLabel="t"
              />
            </div>
          )}
          {stats.topCommoditiesSold.length > 0 && (
            <div className="rounded-lg border border-border bg-muted/10 p-4">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Top Commodities Sold</h4>
              <RankList
                items={stats.topCommoditiesSold.map((c) => ({ name: c.name, value: formatNumber(c.tons) }))}
                valueLabel="t"
              />
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
        <span>{icon}</span> {title}
      </h3>
      {children}
    </div>
  );
}
