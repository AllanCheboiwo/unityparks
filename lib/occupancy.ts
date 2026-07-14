/**
 * Occupancy guidance mirrored from Center Parcs, used by the booking widget
 * to size the party sensibly. Apaleo still enforces true occupancy per unit
 * group (maxPersons and ages); this only steers the guest toward a lodge that
 * fits, it never overrides what the property allows.
 */

/**
 * A lodge sleeps eight, Center Parcs style. Adults, children and toddlers all
 * count toward this cap; infants under 2 do not (they sleep in a cot), which is
 * why the size below excludes them.
 */
export const MAX_PARTY = 8;

/** A lodge tops out at two infants in a cot, on top of the eight it sleeps. */
export const MAX_INFANTS = 2;

/** Our largest lodge has four bedrooms. */
export const MAX_BEDROOMS = 4;

/** The guests that count toward the eight-person cap (everyone but infants). */
export function countedGuests(adults: number, children: number, toddlers: number): number {
  return adults + children + toddlers;
}

/**
 * One bedroom for every two adults, plus one for every two children. Toddlers
 * and infants share those rooms rather than adding their own, so they do not
 * feature here. Always at least one bedroom.
 */
export function requiredBedrooms(adults: number, children: number): number {
  return Math.max(1, Math.ceil(adults / 2) + Math.ceil(children / 2));
}
