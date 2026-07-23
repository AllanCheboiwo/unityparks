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

/** "Fri 10 Jul" - chip-sized date used by the results price strip. */
export function formatShortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** Age-band display names, matching the search widget's bands. */
export const BAND_LABELS: Record<string, string> = {
  adult: "Adult",
  child: "Child (6-17)",
  toddler: "Toddler (2-5)",
  infant: "Infant (under 2)",
};

export function nightsLabel(nights: number): string {
  if (nights === 3) return "3-night weekend break";
  if (nights === 4) return "4-night midweek break";
  if (nights === 7) return "7-night week break";
  return `${nights}-night break`;
}

/** Known car registrations, uppercased; "" entries ("don't know") dropped. */
export function knownPlates(plates: string[]): string[] {
  return plates.map((p) => p.trim().toUpperCase()).filter(Boolean);
}

/** A short recap phrase for a lead-guest line: "plate KDA 123A" or
 *  "plates KDA 123A, KBZ 456B". Empty when no plate is known. */
export function plateList(plates: string[]): string {
  const known = knownPlates(plates);
  if (!known.length) return "";
  return `${known.length === 1 ? "plate" : "plates"} ${known.join(", ")}`;
}
