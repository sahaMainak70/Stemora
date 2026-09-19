export function formatSeconds(seconds: number | null | undefined): string {
  const safe = Number.isFinite(seconds)
    ? Math.max(0, Math.floor(seconds as number))
    : 0;
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}