import type { RecentContributionSummary, SessionStats } from '@/services/journalReader';
import type { ColonizationProject } from '@/store/types';
import { cleanProjectName } from '@/lib/utils';

interface Props {
  contributions: RecentContributionSummary[];
  stats: SessionStats | null;
  projects: ColonizationProject[];
  onClose: () => void;
}

function formatDuration(first: string | null, last: string | null): string {
  if (!first || !last) return '';
  const ms = new Date(last).getTime() - new Date(first).getTime();
  if (ms < 0) return '';
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function SessionSummaryModal({ contributions, stats, projects, onClose }: Props) {
  const totalTons = contributions.reduce((sum, c) => sum + c.totalTons, 0);
  const totalTrips = contributions.reduce((sum, c) => sum + c.tripCount, 0);

  // Match contributions to projects by marketId
  function findProject(marketId: number): ColonizationProject | undefined {
    return projects.find((p) => p.marketId === marketId);
  }

  // Determine time range from stats or contributions
  const firstTs = stats?.firstTimestamp || contributions[0]?.firstTimestamp || null;
  const lastTs = stats?.lastTimestamp || contributions[contributions.length - 1]?.lastTimestamp || null;
  const duration = formatDuration(firstTs, lastTs);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-lg font-bold text-foreground">Session Summary</h2>
            <p className="text-sm text-muted-foreground">
              {duration && <span>{duration} &middot; </span>}
              {stats && stats.jumpCount > 0
                ? `${stats.jumpCount} jump${stats.jumpCount !== 1 ? 's' : ''}`
                : `${totalTrips} trip${totalTrips !== 1 ? 's' : ''}`}
              {totalTons > 0 && <span> &middot; {totalTons.toLocaleString()}t delivered</span>}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-xl leading-none px-2"
            title="Dismiss"
          >
            &times;
          </button>
        </div>

        <div className="px-6 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
          {/* Journey Stats Grid */}
          {stats && (stats.jumpCount > 0 || stats.dockingCount > 0) && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {stats.distanceTravelledLY > 0 && (
                <StatCard icon="🚀" label="Distance" value={`${stats.distanceTravelledLY.toLocaleString()} ly`} />
              )}
              {stats.systemsVisited > 0 && (
                <StatCard icon="🌟" label="Systems" value={stats.systemsVisited.toString()} />
              )}
              {stats.stationsDocked > 0 && (
                <StatCard icon="🛰" label="Stations" value={stats.stationsDocked.toString()} />
              )}
              {stats.tonsBought > 0 && (
                <StatCard icon="📦" label="Bought" value={`${stats.tonsBought.toLocaleString()}t`} />
              )}
              {totalTons > 0 && (
                <StatCard icon="🏗" label="Delivered" value={`${totalTons.toLocaleString()}t`} accent />
              )}
              {stats.bodiesScanned > 0 && (
                <StatCard icon="🔭" label="Scanned" value={`${stats.bodiesScanned} bod${stats.bodiesScanned !== 1 ? 'ies' : 'y'}`} />
              )}
              {stats.systemsHonked > 0 && (
                <StatCard icon="📡" label="Honked" value={`${stats.systemsHonked} sys`} />
              )}
              {stats.creditsSpent > 0 && (
                <StatCard icon="💰" label="Spent" value={formatCredits(stats.creditsSpent)} />
              )}
            </div>
          )}

          {/* Systems visited list (compact) */}
          {stats && stats.systemNames.length > 0 && (
            <div className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground/70">Systems visited: </span>
              {stats.systemNames.slice(0, 8).join(' → ')}
              {stats.systemNames.length > 8 && <span className="opacity-50"> +{stats.systemNames.length - 8} more</span>}
            </div>
          )}

          {/* Project contribution rows */}
          {contributions.length > 0 && (
            <>
              {stats && stats.jumpCount > 0 && (
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider pt-1">
                  Contributions
                </div>
              )}
              {contributions.map((c) => {
                const project = findProject(c.marketId);
                const projectName = project
                  ? cleanProjectName(project.name)
                  : c.systemName || `Depot #${c.marketId}`;

                const progressPct = c.latestProgress !== null
                  ? Math.round(c.latestProgress * 100)
                  : null;

                return (
                  <div key={c.marketId} className={`rounded-lg border p-4 ${c.isComplete ? 'border-progress-complete/50 bg-progress-complete/5' : 'border-border bg-muted/20'}`}>
                    {/* Project header */}
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {c.isComplete && <span className="text-progress-complete">✅</span>}
                        <span className="font-semibold text-foreground text-sm">{projectName}</span>
                      </div>
                      <span className="text-lg font-bold text-primary">+{c.totalTons.toLocaleString()}t</span>
                    </div>

                    {/* Progress bar */}
                    {progressPct !== null && (
                      <div className="flex items-center gap-2 mb-2">
                        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${c.isComplete ? 'bg-progress-complete' : 'bg-primary'}`}
                            style={{ width: `${Math.min(100, progressPct)}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground w-10 text-right">{progressPct}%</span>
                      </div>
                    )}

                    {/* Commodity breakdown — top 5 */}
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                      {c.commodities.slice(0, 5).map((com) => (
                        <span key={com.name}>
                          {com.name}: <span className="text-foreground">{com.count}t</span>
                        </span>
                      ))}
                      {c.commodities.length > 5 && (
                        <span className="opacity-50">+{c.commodities.length - 5} more</span>
                      )}
                    </div>

                    {/* Trip count + system */}
                    <div className="mt-1 text-xs text-muted-foreground/70">
                      {c.tripCount} trip{c.tripCount !== 1 ? 's' : ''}
                      {c.systemName && <span> &middot; {c.systemName}</span>}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-border bg-muted/10 flex justify-between items-center">
          <span className="text-xs text-muted-foreground">
            {firstTs ? new Date(firstTs).toLocaleString() : ''}
            {firstTs && lastTs && ' — '}
            {lastTs ? new Date(lastTs).toLocaleString() : ''}
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, accent }: { icon: string; label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${accent ? 'border-primary/30 bg-primary/5' : 'border-border bg-muted/20'}`}>
      <div className="flex items-center gap-1.5">
        <span className="text-sm">{icon}</span>
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <div className={`text-sm font-bold mt-0.5 ${accent ? 'text-primary' : 'text-foreground'}`}>
        {value}
      </div>
    </div>
  );
}

function formatCredits(amount: number): string {
  if (amount >= 1_000_000_000) return `${(amount / 1_000_000_000).toFixed(1)}B CR`;
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M CR`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(1)}K CR`;
  return `${amount} CR`;
}
