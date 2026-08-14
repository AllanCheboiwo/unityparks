/**
 * Lead-booker rules, as pure functions. Client-safe (no server imports, no
 * Prisma) so the details form and the details route read the SAME rule, in
 * the spirit of lib/paymentPlan.ts: the form can never promise something the
 * server then refuses, and the phased form can never let a guest past a step
 * the submit would reject.
 */

/**
 * True when someone born on dob is 18 or older on the arrival date. Pure ISO
 * string arithmetic - no timezones to get wrong. Both arguments are
 * YYYY-MM-DD; a blank or malformed dob is not an adult.
 */
export function adultAtArrival(dob: string, arrivalIso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return false;
  const cutoff = `${Number(arrivalIso.slice(0, 4)) - 18}${arrivalIso.slice(4)}`;
  return dob <= cutoff;
}

/**
 * The phone rule the form gates a step on: enough digits to be a real
 * number, counted without the punctuation people type. The server's own
 * check is a length check on the joined string, which this always satisfies.
 */
export function isUsablePhone(number: string): boolean {
  return number.replace(/\D/g, "").length >= 7;
}
