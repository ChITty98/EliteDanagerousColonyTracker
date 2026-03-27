import { getStationTypeInfo } from '@/data/stationTypes';

interface StationTypeIconProps {
  stationType: string;
  /** Show the short label next to the icon */
  showLabel?: boolean;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Renders a station type icon with a hover tooltip showing the full name.
 */
export function StationTypeIcon({ stationType, showLabel = false, className = '' }: StationTypeIconProps) {
  const info = getStationTypeInfo(stationType);

  return (
    <span className={`inline-flex items-center gap-1 ${className}`} title={info.label}>
      <span className="text-base leading-none">{info.icon}</span>
      {showLabel && <span className="text-xs text-muted-foreground">{info.shortLabel}</span>}
    </span>
  );
}
