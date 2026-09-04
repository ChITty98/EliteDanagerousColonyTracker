interface SummaryStatsBannerProps {
  totalSystems: number;
  totalStations: number;
  totalPopulation: number;
  totalTonnage: number;
  totalHours: number;
  activeBuilds: number;
  /** Lifetime mission rewards from the journal scan. Hidden until the scan has produced one. */
  missionEarnings?: number;
}

interface StatDef {
  key: string;
  icon: string;
  label: string;
  tooltip?: string;
  format: (v: number) => string;
  hideIfZero?: boolean;
}

const stats: StatDef[] = [
  { key: 'systems', icon: '\u{1F30D}', label: 'Systems Colonized', format: (v: number) => v.toLocaleString() },
  { key: 'population', icon: '\u{1F465}', label: 'Total Population', format: (v: number) => { if (v >= 1_000_000) return `${Math.round(v / 1_000_000)}M`; if (v >= 1_000) return `${Math.round(v / 1_000)}K`; return v.toLocaleString(); }, hideIfZero: true },
  { key: 'stations', icon: '\u{1F6F0}', label: 'Stations Built', format: (v: number) => v.toLocaleString() },
  { key: 'tonnage', icon: '\u{1F4E6}', label: 'Tonnage Hauled', format: (v: number) => { if (v >= 1_000_000) return `${Math.round(v / 1_000_000)}M t`; if (v >= 1_000) return `${Math.round(v / 1_000)}K t`; return `${v.toLocaleString()} t`; } },
  { key: 'hours', icon: '\u23F1', label: 'Session Hours', tooltip: 'Time tracked in hauling sessions (not total game time)', format: (v: number) => Math.round(v).toLocaleString(), hideIfZero: true },
  { key: 'active', icon: '\u{1F6A7}', label: 'Active Builds', format: (v: number) => v.toLocaleString() },
  // Lifetime mission rewards. Belongs here rather than on Architect's Domain — it is an activity
  // metric like population and tonnage, not a fact about the territory itself.
  {
    key: 'missions', icon: '\u{1F4B0}', label: 'Mission Earnings',
    tooltip: 'Lifetime rewards from completed missions, across all systems',
    format: (v: number) => (v >= 1_000_000_000 ? `${(v / 1_000_000_000).toFixed(2)}B` : v >= 1_000_000 ? `${Math.round(v / 1_000_000)}M` : v >= 1_000 ? `${Math.round(v / 1_000)}K` : v.toLocaleString()),
    hideIfZero: true,
  },
];

export function SummaryStatsBanner({ totalSystems, totalStations, totalPopulation, totalTonnage, totalHours, activeBuilds, missionEarnings = 0 }: SummaryStatsBannerProps) {
  const values: Record<string, number> = {
    systems: totalSystems,
    population: totalPopulation,
    stations: totalStations,
    tonnage: totalTonnage,
    hours: totalHours,
    active: activeBuilds,
    missions: missionEarnings,
  };

  const visibleStats = stats.filter((stat) => !(stat.hideIfZero && values[stat.key] === 0));
  const colClass = visibleStats.length <= 4 ? 'grid-cols-2 md:grid-cols-4' : visibleStats.length <= 5 ? 'grid-cols-2 md:grid-cols-5' : visibleStats.length <= 6 ? 'grid-cols-3 md:grid-cols-6' : 'grid-cols-3 md:grid-cols-4 lg:grid-cols-7';

  return (
    <div className="mb-8 p-4 rounded-xl bg-gradient-to-br from-card via-card to-muted/30 border border-border/50">
      <div className={`grid ${colClass} gap-4`}>
        {visibleStats.map((stat) => {
          const val = values[stat.key];
          return (
            <div
              key={stat.key}
              className="flex flex-col items-center text-center p-3 rounded-lg bg-muted/20 hover:bg-muted/30 transition-colors"
              title={stat.tooltip}
            >
              <span className="text-2xl mb-1">{stat.icon}</span>
              <span className="text-2xl md:text-3xl font-bold text-foreground tracking-tight">
                {stat.format(val)}
              </span>
              <span className="text-xs text-muted-foreground mt-1">{stat.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
