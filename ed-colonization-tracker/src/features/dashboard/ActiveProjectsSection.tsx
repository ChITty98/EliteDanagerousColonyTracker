import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { ColonizationProject, KnownSystem } from '@/store/types';
import { StationTypeIcon } from '@/components/StationTypeIcon';
import { cleanProjectName, formatNumber, formatPercent } from '@/lib/utils';

interface ActiveProjectsSectionProps {
  activeBySystem: Record<string, ColonizationProject[]>;
  knownSystems: Record<string, KnownSystem>;
  cargoCapacity: number;
}

export function ActiveProjectsSection({ activeBySystem, knownSystems, cargoCapacity }: ActiveProjectsSectionProps) {
  const totalActive = Object.values(activeBySystem).reduce((sum, ps) => sum + ps.length, 0);
  const [collapsed, setCollapsed] = useState(true);

  if (totalActive === 0) return null;

  // Compute aggregate remaining tonnage for the summary line
  const totalRemaining = Object.values(activeBySystem)
    .flat()
    .reduce((sum, p) => {
      const req = p.commodities.reduce((s, c) => s + c.requiredQuantity, 0);
      const prov = p.commodities.reduce((s, c) => s + c.providedQuantity, 0);
      return sum + Math.max(0, req - prov);
    }, 0);

  return (
    <div className="mb-8">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-2 text-lg font-semibold text-muted-foreground mb-3 hover:text-foreground transition-colors w-full text-left"
      >
        <span className="text-xs transition-transform" style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>
          {'\u25BC'}
        </span>
        {'\u{1F6A7}'} Active Construction ({totalActive})
        {collapsed && (
          <span className="text-sm font-normal text-muted-foreground ml-2">
            {totalRemaining >= 1_000
              ? `${(totalRemaining / 1_000).toFixed(1)}K t remaining`
              : `${totalRemaining.toLocaleString()} t remaining`}
          </span>
        )}
      </button>

      {!collapsed && (
        <>
          {Object.entries(activeBySystem).map(([systemName, projects]) => {
            const sysData = knownSystems[systemName.toLowerCase()];
            return (
              <div key={systemName} className="mb-6">
                {/* System header */}
                <div className="flex items-center gap-2 mb-2">
                  <Link
                    to={`/systems/${encodeURIComponent(systemName)}`}
                    className="text-sm font-semibold text-secondary hover:underline"
                  >
                    {systemName}
                  </Link>
                  {sysData && (
                    <span className="text-xs text-muted-foreground">
                      {sysData.economy !== 'Unknown' && sysData.economy}
                      {sysData.secondEconomy && ` / ${sysData.secondEconomy}`}
                      {sysData.population > 0 && ` \u2022 Pop: ${formatNumber(sysData.population)}`}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {projects.map((project) => {
                    const totalRequired = project.commodities.reduce((s, c) => s + c.requiredQuantity, 0);
                    const totalProvided = project.commodities.reduce((s, c) => s + c.providedQuantity, 0);
                    const progress = totalRequired > 0 ? totalProvided / totalRequired : 0;
                    const remaining = totalRequired - totalProvided;
                    const estimatedTrips = cargoCapacity > 0 ? Math.ceil(remaining / cargoCapacity) : null;

                    return (
                      <Link
                        key={project.id}
                        to={`/projects/${project.id}`}
                        className="bg-card border border-border rounded-lg p-4 hover:border-primary/50 transition-colors"
                      >
                        <div className="flex items-start justify-between mb-2">
                          <h3 className="font-semibold text-foreground">{cleanProjectName(project.name)}</h3>
                          {project.stationType && (
                            <StationTypeIcon stationType={project.stationType} showLabel />
                          )}
                        </div>

                        <div className="mt-3">
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-muted-foreground">{formatPercent(progress)}</span>
                            <span className="text-muted-foreground">
                              <span className="font-bold text-foreground">{formatNumber(remaining)}t</span> remaining
                            </span>
                          </div>
                          <div className="w-full bg-muted rounded-full h-2">
                            <div
                              className="h-2 rounded-full transition-all"
                              style={{
                                width: `${Math.min(progress * 100, 100)}%`,
                                backgroundColor:
                                  progress >= 1
                                    ? 'var(--color-progress-complete)'
                                    : progress >= 0.75
                                    ? 'var(--color-progress-high)'
                                    : progress >= 0.25
                                    ? 'var(--color-progress-mid)'
                                    : 'var(--color-progress-low)',
                              }}
                            />
                          </div>
                        </div>

                        <div className="mt-3 flex justify-between text-xs text-muted-foreground">
                          <span>
                            {project.commodities.filter((c) => c.providedQuantity >= c.requiredQuantity).length} / {project.commodities.length} commodities
                          </span>
                          {estimatedTrips !== null && remaining > 0 && (
                            <span>
                              ~{estimatedTrips.toLocaleString()} trip{estimatedTrips !== 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
