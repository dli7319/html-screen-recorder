/**
 * Display formatting for the live recording stats. Pure functions, so the exact
 * output the user sees is pinned by tests rather than eyeballed.
 */

/**
 * Human-readable byte count using 1024-based steps, which is what people expect
 * from a file they are about to download.
 *
 *   0        -> "0 B"
 *   842      -> "842 B"
 *   12_845   -> "12.5 KB"
 *   5_242_880 -> "5.0 MB"
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );

  // Bytes stay integral; everything else gets one decimal.
  if (exponent === 0) return `${Math.round(bytes)} ${units[0]}`;

  const value = bytes / Math.pow(1024, exponent);
  return `${value.toFixed(1)} ${units[exponent]}`;
}

/**
 * Elapsed time as `mm:ss`, or `h:mm:ss` once an hour is passed. Minutes are not
 * wrapped at 60, so a long take reads its true length instead of restarting.
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);

  const pad = (n: number) => n.toString().padStart(2, '0');

  return hours > 0
    ? `${hours}:${pad(totalMinutes % 60)}:${pad(seconds)}`
    : `${pad(totalMinutes)}:${pad(seconds)}`;
}

/**
 * `Expires in 30 days` and friends, for a take cache retention window.
 *
 * Rounded to the nearest unit rather than floored: a fresh take is 29.999
 * days from expiry, and flooring would brand-new clips "Expires in 29 days"
 * next to a note promising 30 - the display would look wrong on its best
 * day. Rounding is never off by more than half a unit, and past the window
 * this reads "Expired" rather than pretending time is left.
 */
export function formatExpiry(remainingMs: number): string {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return 'Expired';

  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;

  const phrase = (value: number, unit: string) =>
    `Expires in ${value} ${unit}${value === 1 ? '' : 's'}`;

  if (remainingMs >= DAY) return phrase(Math.round(remainingMs / DAY), 'day');
  if (remainingMs >= HOUR)
    return phrase(Math.round(remainingMs / HOUR), 'hour');
  // The bottom rung stays at one: "Expires in 0 minutes" reads as expired.
  return phrase(Math.max(1, Math.round(remainingMs / MINUTE)), 'minute');
}
