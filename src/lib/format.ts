/** Small display helpers, kept together so units read the same everywhere. */

/** "4h 12m", "38m", "45s" — the coarsest unit that still says something. */
export function duration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function percent(fraction: number): string {
  return `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
}

/** Words per minute actually achieved, or the configured estimate. */
export function effectiveWpm(measured: number | null, baseWpm: number, rate: number): number {
  return measured && measured > 40 ? measured : baseWpm * rate;
}
