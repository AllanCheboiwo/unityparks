/**
 * Party age bands — matching the search widget (and Center Parcs'):
 * children 6–17, toddlers 2–5, infants under 2. The funnel captures counts
 * per band; Apaleo prices and enforces occupancy by concrete ages, so each
 * band maps to a representative age. Real dates of birth arrive at the
 * guest-details step in the real build.
 */

const CHILD_AGE = 10;
const TODDLER_AGE = 3;
const INFANT_AGE = 1;

export function bandsToAges(counts: {
  children: number;
  toddlers: number;
  infants: number;
}): number[] {
  return [
    ...Array<number>(counts.children).fill(CHILD_AGE),
    ...Array<number>(counts.toddlers).fill(TODDLER_AGE),
    ...Array<number>(counts.infants).fill(INFANT_AGE),
  ];
}

/** "2 adults · 1 child · 2 toddlers" — derived back from the stored ages. */
export function partyLabel(adults: number, childrenAges: number[]): string {
  const count = (age: number) => childrenAges.filter((a) => a === age).length;
  const parts = [`${adults} ${adults === 1 ? "adult" : "adults"}`];
  const children = count(CHILD_AGE);
  const toddlers = count(TODDLER_AGE);
  const infants = count(INFANT_AGE);
  if (children) parts.push(`${children} ${children === 1 ? "child" : "children"}`);
  if (toddlers) parts.push(`${toddlers} ${toddlers === 1 ? "toddler" : "toddlers"}`);
  if (infants) parts.push(`${infants} ${infants === 1 ? "infant" : "infants"}`);
  return parts.join(" · ");
}
