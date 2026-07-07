/**
 * Unity Parks business rules — pure functions, no I/O.
 *
 * The one rule that defines the product: stays may only START and END on a
 * turnover day (Friday or Monday), because those are the days staff flip the
 * lodges. Apaleo enforces this too (restriction calendar), but we validate
 * here first so guests get a clear message instead of an empty result, and
 * so the rule holds even if the calendar job ever lags.
 */

const FRIDAY = 5;
const MONDAY = 1;

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** Parse an ISO date (YYYY-MM-DD) as UTC so weekday math is timezone-proof. */
function parseIsoDate(iso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function isTurnoverDay(iso: string): boolean {
  const d = parseIsoDate(iso);
  if (!d) return false;
  const day = d.getUTCDay();
  return day === FRIDAY || day === MONDAY;
}

export function dayName(iso: string): string {
  const d = parseIsoDate(iso);
  return d ? DAY_NAMES[d.getUTCDay()] : "Invalid date";
}

export function nightsBetween(arrival: string, departure: string): number {
  const a = parseIsoDate(arrival);
  const b = parseIsoDate(departure);
  if (!a || !b) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export type StayValidation =
  | { ok: true; nights: number }
  | { ok: false; reason: string };

export function validateStay(arrival: string, departure: string): StayValidation {
  if (!parseIsoDate(arrival) || !parseIsoDate(departure)) {
    return { ok: false, reason: "Please choose valid dates." };
  }
  const nights = nightsBetween(arrival, departure);
  if (nights <= 0) {
    return { ok: false, reason: "Departure must be after arrival." };
  }
  if (!isTurnoverDay(arrival)) {
    return {
      ok: false,
      reason: `Breaks start on a Friday or Monday — ${dayName(arrival)} arrivals aren't available.`,
    };
  }
  if (!isTurnoverDay(departure)) {
    return {
      ok: false,
      reason: `Breaks end on a Friday or Monday — ${dayName(departure)} departures aren't available.`,
    };
  }
  return { ok: true, nights };
}

/**
 * The checkout total is the sum of the Apaleo amounts we snapshotted —
 * the engine never computes a price of its own.
 */
export function computeTotal(
  stayGrossAmount: number,
  extras: Array<{ grossAmount: number }>,
): number {
  return extras.reduce((sum, e) => sum + e.grossAmount, stayGrossAmount);
}

export function formatKes(amount: number): string {
  return `KES ${Math.round(amount).toLocaleString("en-KE")}`;
}
