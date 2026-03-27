/**
 * Tier classification for colonized systems based on installation count.
 */

export interface TierInfo {
  tier: number;
  label: string;
  icon: string;
  borderClass: string;
  bgGradient: string;
  badgeBg: string;
  badgeText: string;
}

const TIERS: TierInfo[] = [
  {
    tier: 1,
    label: 'Outpost',
    icon: '\u{1F3D7}\u{FE0F}',
    borderClass: 'border-slate-500/40',
    bgGradient: 'bg-gradient-to-br from-slate-800/40 to-slate-900/60',
    badgeBg: 'bg-slate-700',
    badgeText: 'text-slate-200',
  },
  {
    tier: 2,
    label: 'Settlement',
    icon: '\u{1F3D8}\u{FE0F}',
    borderClass: 'border-emerald-400/50',
    bgGradient: 'bg-gradient-to-br from-emerald-900/30 to-emerald-950/40',
    badgeBg: 'bg-emerald-600',
    badgeText: 'text-emerald-50',
  },
  {
    tier: 3,
    label: 'Colony',
    icon: '\u{1F306}',
    borderClass: 'border-violet-400/60',
    bgGradient: 'bg-gradient-to-br from-violet-900/30 to-indigo-950/40',
    badgeBg: 'bg-violet-600',
    badgeText: 'text-violet-50',
  },
  {
    tier: 4,
    label: 'Hub',
    icon: '\u{1F3D9}\u{FE0F}',
    borderClass: 'border-amber-400/70',
    bgGradient: 'bg-gradient-to-br from-amber-900/30 to-orange-950/40',
    badgeBg: 'bg-gradient-to-r from-amber-500 to-orange-500',
    badgeText: 'text-white',
  },
];

const TIER_THRESHOLDS = [1, 3, 5, 8]; // min installations for each tier

export function getSystemTier(totalInstalled: number): TierInfo {
  if (totalInstalled >= 8) return TIERS[3];
  if (totalInstalled >= 5) return TIERS[2];
  if (totalInstalled >= 3) return TIERS[1];
  return TIERS[0];
}

export interface TierProgress {
  current: number;
  nextThreshold: number;
  nextLabel: string;
  progress: number; // 0–1
  isMaxTier: boolean;
}

export function getTierProgress(totalInstalled: number): TierProgress {
  if (totalInstalled >= 8) {
    return { current: totalInstalled, nextThreshold: 8, nextLabel: 'Hub', progress: 1, isMaxTier: true };
  }
  const nextIdx = totalInstalled >= 5 ? 3 : totalInstalled >= 3 ? 2 : totalInstalled >= 1 ? 1 : 0;
  const prevThreshold = nextIdx > 0 ? TIER_THRESHOLDS[nextIdx - 1] : 0;
  const nextThreshold = TIER_THRESHOLDS[nextIdx];
  const progress = Math.min(1, (totalInstalled - prevThreshold) / (nextThreshold - prevThreshold));
  return {
    current: totalInstalled,
    nextThreshold,
    nextLabel: TIERS[nextIdx].label,
    progress,
    isMaxTier: false,
  };
}

/**
 * Get system tier from T2/T3 point totals.
 * Tier 2 (Settlement) requires T2 points > 0.
 * Tier 3 (Colony) requires T3 points > 0.
 * Tier 4 (Hub) requires both significant T2 and T3 points.
 * Falls back to installation-count-based tier when points are 0 (untyped installations).
 */
export function getSystemTierFromPoints(
  totalInstalled: number,
  t2Total: number,
  t3Total: number
): TierInfo {
  // If we have point data, use it
  if (t2Total > 0 || t3Total > 0) {
    if (t2Total >= 4 && t3Total >= 4) return TIERS[3]; // Hub
    if (t3Total >= 1) return TIERS[2]; // Colony
    if (t2Total >= 1) return TIERS[1]; // Settlement
    return TIERS[0]; // Outpost
  }
  // Fallback to count-based
  return getSystemTier(totalInstalled);
}

export function getTierProgressFromPoints(
  totalInstalled: number,
  t2Total: number,
  t3Total: number
): TierProgress & { t2Total: number; t3Total: number } {
  const tier = getSystemTierFromPoints(totalInstalled, t2Total, t3Total);
  let nextLabel: string;
  let progress: number;
  let isMaxTier = false;

  if (tier.tier >= 4) {
    nextLabel = 'Hub';
    progress = 1;
    isMaxTier = true;
  } else if (tier.tier === 3) {
    nextLabel = 'Hub';
    progress = Math.min(1, (t2Total + t3Total) / 8);
  } else if (tier.tier === 2) {
    nextLabel = 'Colony';
    progress = t3Total > 0 ? 1 : Math.min(0.9, t2Total / 4);
  } else {
    nextLabel = 'Settlement';
    progress = t2Total > 0 ? 1 : Math.min(0.9, totalInstalled / 3);
  }

  return {
    current: totalInstalled,
    nextThreshold: tier.tier >= 4 ? totalInstalled : totalInstalled + 1,
    nextLabel,
    progress,
    isMaxTier,
    t2Total,
    t3Total,
  };
}

/** Format population with K/M suffix — integers only */
export function formatPopulation(pop: number | undefined): string {
  if (pop == null || pop === 0) return '\u2014';
  if (pop >= 1_000_000) return `${Math.round(pop / 1_000_000)}M`;
  if (pop >= 1_000) return `${Math.round(pop / 1_000)}K`;
  return pop.toLocaleString();
}
