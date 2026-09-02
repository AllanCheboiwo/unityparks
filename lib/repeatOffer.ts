import { MIN_PART_PAYMENT, daysBetween } from "./paymentPlan";

/**
 * The repeat-guest offer, as pure functions. Client-safe (no server
 * imports, no Prisma) so the pay-step card, the account card and the money
 * code all read the SAME numbers. Spec: docs/promo-codes-plan.md.
 *
 * Value, lodge cap and window are constants until a second offer type
 * exists. The window bounds when the NEW booking is made, not when the new
 * stay happens: a stay counts strictly after its departure day, and the
 * last valid booking day is departure plus OFFER_WINDOW_DAYS inclusive.
 */

export const OFFER_PER_LODGE = 5000; // KES off per lodge of the new booking
export const OFFER_LODGE_CAP = 3; // lodges that can earn the discount
export const OFFER_WINDOW_DAYS = 31; // days after departure to book

/** KSh 5,000 per lodge of the NEW booking, at most three lodges. */
export function offerDiscountFor(lodgeCount: number): number {
  return Math.max(0, Math.min(lodgeCount, OFFER_LODGE_CAP)) * OFFER_PER_LODGE;
}

/** Departure plus 31 days: the last day isOfferWindowOpen accepts. */
export function offerDeadline(departureIso: string): string {
  const d = new Date(`${departureIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + OFFER_WINDOW_DAYS);
  return d.toISOString().slice(0, 10);
}

/** Open strictly after departure, through the deadline inclusive. */
export function isOfferWindowOpen(input: { departure: string; todayIso: string }): boolean {
  const days = daysBetween(input.departure, input.todayIso);
  return days > 0 && days <= OFFER_WINDOW_DAYS;
}

/** Cap so at least KSh 500 of the booking stays collectable. */
export function capOfferDiscount(input: { bookingTotal: number; discount: number }): number {
  const room = Math.floor(input.bookingTotal - MIN_PART_PAYMENT);
  return Math.max(0, Math.min(Math.floor(input.discount), room));
}
