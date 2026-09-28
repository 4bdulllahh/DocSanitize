/** Parse a time typed as seconds ("90", "1.5") or clock time ("1:30", "1:02:03.5"); null if it isn't one. */
export function parseTime(text: string): number | null {
  const t = text.trim().replace(",", ".");
  if (!/^\d+(:\d+){0,2}(\.\d+)?$/.test(t)) return null;
  const parts = t.split(":");
  const seconds = Number(parts.pop());
  const [hours, minutes] = parts.length === 2 ? parts.map(Number) : [0, Number(parts[0] ?? 0)];
  if (parts.length > 0 && seconds >= 60) return null;
  if (parts.length === 2 && minutes >= 60) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

/** "0:05", "1:02", "1:02:03"; with decimals, "0:05.3". */
export function formatTime(seconds: number, decimals = 0): string {
  const scale = 10 ** decimals;
  const total = Math.max(0, Math.round(seconds * scale) / scale);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total - hours * 3600 - minutes * 60;
  const secs = rest.toFixed(decimals).padStart(decimals ? decimals + 3 : 2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${secs}` : `${minutes}:${secs}`;
}
