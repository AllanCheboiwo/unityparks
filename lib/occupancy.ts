/**
 * Occupancy guidance mirrored from Center Parcs, used by the booking widget
 * to size the party sensibly. Apaleo still enforces true occupancy per unit
 * group (maxPersons and ages); this only steers the guest toward a lodge that
 * fits, it never overrides what the property allows.
 */

/** A lodge tops out at two infants in a cot, whatever the rest of the party. */
export const MAX_INFANTS = 2;

/** Our largest lodge has four bedrooms. */
export const MAX_BEDROOMS = 4;

/**
 * One bedroom for every two adults, plus one for every two children. Toddlers
 * and infants share those rooms rather than adding their own, so they do not
 * feature here. Always at least one bedroom.
 */
export function requiredBedrooms(adults: number, children: number): number {
  return Math.max(1, Math.ceil(adults / 2) + Math.ceil(children / 2));
}

/** Up to two toddlers share each bedroom, on top of the adults and children. */
export function maxToddlers(bedrooms: number): number {
  return bedrooms * 2;
}
