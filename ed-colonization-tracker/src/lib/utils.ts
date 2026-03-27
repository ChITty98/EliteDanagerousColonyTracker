export function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

export function formatNumber(n: number): string {
  return n.toLocaleString();
}

export function formatPercent(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for non-secure contexts (HTTP network access on iOS/Safari)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * Clean raw journal strings that contain ED localization tokens.
 * e.g. "$EXT_PANEL_ColonisationShip;" → "Colonisation Ship"
 *      "$station_name;" → "Station Name"
 *      "Normal text" → "Normal text" (unchanged)
 */
export function cleanJournalString(raw: string): string {
  if (!raw) return raw;
  // Strip leading $ and trailing ;, remove common prefixes
  let cleaned = raw;
  // Handle $TOKEN; format — strip $ and ;, then humanize the token
  cleaned = cleaned.replace(/\$([^;]+);/g, (_match, token: string) => {
    // Remove common prefixes
    let label = token;
    const prefixes = ['EXT_PANEL_', 'ext_panel_', 'station_', 'system_'];
    for (const prefix of prefixes) {
      if (label.startsWith(prefix)) {
        label = label.slice(prefix.length);
        break;
      }
    }
    // Convert CamelCase or underscore_case to spaces
    label = label
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/_/g, ' ')
      .trim();
    // Title case
    return label.replace(/\b\w/g, (c) => c.toUpperCase());
  });
  return cleaned;
}

/**
 * Clean a project/depot name that may contain journal tokens.
 * Replaces raw tokens inline and cleans up the result.
 */
export function cleanProjectName(name: string): string {
  return cleanJournalString(name).replace(/\s+/g, ' ').trim();
}

/**
 * Strip construction signal prefixes to get the clean station name.
 * E.g. "Planetary Construction Site: Ngidi Prospecting Exchange" → "Ngidi Prospecting Exchange"
 *      "Orbital Construction Site: Volpe Radiante Horizon" → "Volpe Radiante Horizon"
 */
export function stripConstructionPrefix(signalName: string): string {
  return signalName
    .replace(/^(Planetary|Orbital|Surface|Space)\s+Construction\s+Site:\s*/i, '')
    .trim();
}

/**
 * Infer station type from a construction signal prefix.
 */
export function inferStationTypeFromSignal(signalName: string): string {
  const lower = signalName.toLowerCase();
  if (lower.startsWith('planetary')) return 'CraterPort';
  if (lower.startsWith('orbital')) return 'Coriolis';
  if (lower.startsWith('surface')) return 'CraterOutpost';
  return 'Unknown';
}

/**
 * Format an ISO date string as a relative time label.
 * e.g. "2d ago", "3w ago", "1mo ago", "2y ago"
 */
export function formatRelativeTime(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < 1) return '<1d ago';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

/**
 * Return a Tailwind text color class based on data freshness.
 * green (<7d), yellow (7-30d), orange (30-90d), red (>90d)
 */
export function freshnessColor(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  if (diffDays < 7) return 'text-green-400';
  if (diffDays <= 30) return 'text-yellow-400';
  if (diffDays <= 90) return 'text-orange-400';
  return 'text-red-400';
}
