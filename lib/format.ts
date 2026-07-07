/** Client-safe formatting helpers (no server imports). */

export function formatKes(amount: number): string {
  return `KES ${Math.round(amount).toLocaleString("en-KE")}`;
}

/** "Friday 10 July 2026" - long form used across the funnel. */
export function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function nightsLabel(nights: number): string {
  if (nights === 3) return "3-night weekend break";
  if (nights === 4) return "4-night midweek break";
  if (nights === 7) return "7-night week break";
  return `${nights}-night break`;
}
