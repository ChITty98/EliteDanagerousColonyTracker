import { Link } from 'react-router-dom';
import { useGalleryStore } from '@/store/galleryStore';
import { getSystemTierFromPoints, getTierProgressFromPoints, formatPopulation, type TierInfo } from './tierUtils';

interface InstallationCounts {
  orbitalStations: number;
  orbitalOutposts: number;
  surfacePorts: number;
  surfaceOutposts: number;
  settlements: number;
  installations: number;
}

export interface SystemCardData {
  systemName: string;
  economy?: string;
  secondEconomy?: string;
  population?: number;
  scoutScore: number | null;
  totalInstalled: number;
  installationCounts: InstallationCounts;
  t2Points: number;
  t3Points: number;
  stationsActive: number;
  stationsCompleted: number;
  isManual: boolean;
  lastCompletedAt: string | null;
  lastVisited: string | null;
  allProjects: { id: string }[];
  visitCount?: number;
}

interface SystemAdvancementCardProps {
  system: SystemCardData;
  tonnage: number;
  bodyCount?: number;
  distFromSol?: number;
  distFromHome?: number;
  homeSystemName?: string;
  onRemoveManual?: () => void;
  isCurrentSystem?: boolean;
}

function scoreColorClass(score: number): string {
  if (score >= 100) return 'text-yellow-300';
  if (score >= 60) return 'text-progress-complete';
  if (score >= 30) return 'text-sky-400';
  return 'text-muted-foreground';
}

function tierGlowStyle(tier: number): React.CSSProperties {
  switch (tier) {
    case 4: return { boxShadow: '0 0 20px rgba(245, 158, 11, 0.25), 0 0 40px rgba(245, 158, 11, 0.1)' };
    case 3: return { boxShadow: '0 0 15px rgba(139, 92, 246, 0.2), 0 0 30px rgba(139, 92, 246, 0.08)' };
    case 2: return { boxShadow: '0 0 12px rgba(16, 185, 129, 0.15), 0 0 25px rgba(16, 185, 129, 0.06)' };
    default: return {};
  }
}

function populationBadge(pop: number | undefined): { label: string; color: string } | null {
  if (!pop) return null;
  if (pop >= 1_000_000) return { label: '\u{1F451} 1M+', color: 'text-amber-400 bg-amber-500/15' };
  if (pop >= 500_000) return { label: '\u2B50 500K+', color: 'text-yellow-400 bg-yellow-500/15' };
  if (pop >= 100_000) return { label: '\u{1F31F} 100K+', color: 'text-sky-400 bg-sky-500/15' };
  return null;
}

const INSTALLATION_PARTS: { key: keyof InstallationCounts; icon: string; label: string }[] = [
  { key: 'orbitalStations', icon: '\u{1F6F0}', label: 'Orbital Station' },
  { key: 'orbitalOutposts', icon: '\u{1F4E1}', label: 'Orbital Outpost' },
  { key: 'surfacePorts', icon: '\u{1FA90}', label: 'Surface Port' },
  { key: 'surfaceOutposts', icon: '\u{1F3D7}', label: 'Surface Outpost' },
  { key: 'settlements', icon: '\u{1F3D8}', label: 'Settlement' },
  { key: 'installations', icon: '\u2699', label: 'Installation' },
];

export function SystemAdvancementCard({ system, tonnage, bodyCount, distFromSol, distFromHome, homeSystemName, onRemoveManual, isCurrentSystem }: SystemAdvancementCardProps) {
  const tier = getSystemTierFromPoints(system.totalInstalled, system.t2Points, system.t3Points);
  const progress = getTierProgressFromPoints(system.totalInstalled, system.t2Points, system.t3Points);
  const popBadge = populationBadge(system.population);

  // Hero image from gallery (first image for this system — check all keys starting with "system:Name")
  const galleryImages = useGalleryStore((s) => s.images);
  const heroImage = (() => {
    const prefix = `system:${system.systemName}`;
    for (const [key, imgs] of Object.entries(galleryImages)) {
      if (key.startsWith(prefix) && imgs.length > 0) return imgs[0];
    }
    return null;
  })();

  return (
    <Link
      to={`/systems/${encodeURIComponent(system.systemName)}`}
      className={`block rounded-xl border-2 ${tier.borderClass} ${tier.bgGradient} p-4 hover:brightness-110 transition-all group relative overflow-hidden`}
      style={tierGlowStyle(tier.tier)}
    >
      {/* Hero image background */}
      {heroImage && (
        <div
          className="absolute inset-0 opacity-15 bg-cover bg-center pointer-events-none"
          style={{ backgroundImage: `url(${heroImage.url || `/api/images/${heroImage.id}`})` }}
        />
      )}

      {/* Header: tier badge + name + score */}
      <div className="flex items-start justify-between mb-3 relative">
        <div className="flex items-center gap-2.5">
          <TierBadge tier={tier} />
          <div>
            <h4 className="font-bold text-foreground text-sm group-hover:text-primary transition-colors flex items-center gap-1.5">
              {system.systemName}
              {isCurrentSystem && (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-cyan-500/20 text-[10px] text-cyan-400 font-medium" title="You are here">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                  HERE
                </span>
              )}
            </h4>
            {system.economy && (
              <p className="text-xs text-muted-foreground">
                {system.economy}
                {system.secondEconomy && ` / ${system.secondEconomy}`}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {system.scoutScore !== null ? (
            <span className={`text-lg font-bold ${system.scoutScore === 0 ? 'text-muted-foreground' : scoreColorClass(system.scoutScore)}`} title={system.scoutScore === 0 ? 'No qualifying bodies for colonization' : undefined}>
              {system.scoutScore}
            </span>
          ) : (
            <span className="text-lg font-bold text-muted-foreground" title="Not scored yet — click Score Colonies">?</span>
          )}
          {onRemoveManual && system.isManual && system.allProjects.length === 0 && (
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (confirm('Remove this manual entry?')) onRemoveManual(); }}
              className="text-xs text-destructive/50 hover:text-destructive transition-colors ml-1"
              title="Remove manual entry"
            >
              {'\u2715'}
            </button>
          )}
        </div>
      </div>

      {/* Population + visits */}
      <div className="flex items-center justify-between text-xs text-muted-foreground mb-2 relative">
        <span className="flex items-center gap-1.5">
          Population: <span className="text-foreground font-medium">{formatPopulation(system.population)}</span>
          {popBadge && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${popBadge.color}`}>
              {popBadge.label}
            </span>
          )}
        </span>
        <div className="flex items-center gap-3">
          {system.visitCount != null && system.visitCount > 0 && (
            <span title={`Jumped into this system ${system.visitCount} time${system.visitCount !== 1 ? 's' : ''}`}>
              {'\u{1F6EC}'} <span className="text-foreground font-medium">{system.visitCount}</span>
            </span>
          )}
          {bodyCount != null && bodyCount > 0 && (
            <span>Bodies: <span className="text-foreground font-medium">{bodyCount}</span></span>
          )}
        </div>
      </div>

      {/* Installation icons */}
      <div className="flex flex-wrap gap-2 items-center mb-3 relative">
        {INSTALLATION_PARTS.map(({ key, icon, label }) => {
          const count = system.installationCounts[key];
          if (count === 0) return null;
          return (
            <span
              key={key}
              className="inline-flex items-center gap-0.5 text-xs text-muted-foreground"
              title={`${count} ${label}${count > 1 ? 's' : ''}`}
            >
              <span>{icon}</span>
              <span>{count}</span>
            </span>
          );
        })}
        {system.stationsActive > 0 && (
          <span className="inline-flex items-center gap-0.5 text-xs text-primary" title={`${system.stationsActive} under construction`}>
            <span>{'\u{1F6A7}'}</span>
            <span>{system.stationsActive}</span>
          </span>
        )}
        {system.totalInstalled === 0 && system.stationsActive === 0 && system.isManual && (
          <span className="text-xs text-muted-foreground">Manually added</span>
        )}
      </div>

      {/* T2/T3 points */}
      {(system.t2Points > 0 || system.t3Points > 0) && (
        <div className="flex items-center gap-3 text-xs mb-2 relative">
          {system.t2Points > 0 && (
            <span className="text-orange-400" title={`${system.t2Points} Tier 2 points`}>
              {'\u{1F7E0}'} T2: {system.t2Points}
            </span>
          )}
          {system.t3Points > 0 && (
            <span className="text-green-400" title={`${system.t3Points} Tier 3 points`}>
              {'\u{1F7E2}'} T3: {system.t3Points}
            </span>
          )}
        </div>
      )}

      {/* Tier progress bar */}
      <div className="mb-2 relative">
        <div className="flex justify-between text-xs mb-1">
          <span className="text-muted-foreground">
            {progress.isMaxTier ? (
              <span className="text-amber-400 font-bold">{tier.icon} Max Tier {'\u{1F451}'}</span>
            ) : (
              <>{system.totalInstalled}/{progress.nextThreshold} to {progress.nextLabel}</>
            )}
          </span>
          <span className="text-muted-foreground font-medium">Tier {tier.tier}: {tier.label}</span>
        </div>
        <div className="w-full bg-muted/50 rounded-full h-1.5">
          <div
            className="h-1.5 rounded-full transition-all"
            style={{
              width: `${Math.min(progress.progress * 100, 100)}%`,
              background: progress.isMaxTier
                ? 'linear-gradient(90deg, #f59e0b, #f97316)'
                : 'var(--color-secondary)',
            }}
          />
        </div>
      </div>

      {/* Distance info */}
      {(distFromSol != null || distFromHome != null) && (
        <div className="flex gap-3 text-[10px] text-muted-foreground/70 mb-1 relative">
          {distFromSol != null && <span>{distFromSol.toFixed(1)}ly from Sol</span>}
          {distFromHome != null && homeSystemName && <span>{distFromHome.toFixed(1)}ly from {homeSystemName}</span>}
        </div>
      )}

      {/* Bottom stats */}
      <div className="flex justify-between text-xs text-muted-foreground pt-1 border-t border-border/30 relative">
        <span>
          Hauled: <span className="text-foreground font-medium">
            {tonnage >= 1_000 ? `${(tonnage / 1_000).toFixed(1)}K t` : `${tonnage.toLocaleString()} t`}
          </span>
        </span>
        {system.lastVisited && (
          <span title={`Last visited: ${new Date(system.lastVisited).toLocaleString()}`}>
            Visited: {new Date(system.lastVisited).toLocaleDateString()}
          </span>
        )}
      </div>
    </Link>
  );
}

function TierBadge({ tier }: { tier: TierInfo }) {
  const isMax = tier.tier === 4;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-bold ${tier.badgeBg} ${tier.badgeText} ${
        isMax ? 'ring-2 ring-amber-400/40' : ''
      }`}
      style={isMax ? { boxShadow: '0 0 8px rgba(245, 158, 11, 0.3)' } : undefined}
    >
      <span className="text-sm">{tier.icon}</span>
      <span>{tier.tier}</span>
    </span>
  );
}
