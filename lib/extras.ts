import type { ExtraSnapshotDto } from "./types";

/**
 * Pure math for the post-booking add-extras engine: server/booking/extras.ts,
 * its API route, and the Manage card's unit checks. Client-safe (no server
 * imports). The checkout extras page still keeps its own small display
 * helpers and renders numbers straight off its offers.
 */

/** Checkout's stepper cap, reused as the total-per-service cap post-booking. */
export const MAX_EXTRA_QTY = 8;

/** One line of a lodge's extras snapshot (session JSON) or an addition -
 *  the same shape the session stores and the API returns. */
export type ExtraLine = ExtraSnapshotDto;

/**
 * Per-unit price of a service offer: Apaleo's default-count total divided by
 * its count (a 2-adult CYCLE offer of 4800 for count 2 is 2400 a bike).
 * Exact for our services because the total is count times a per-unit rate.
 */
export function extraUnitPrice(offer: { totalGrossAmount: number; count: number }): number {
  return Math.round(offer.totalGrossAmount / Math.max(1, offer.count));
}

/** Quantity items are per-person services; Room-priced ones are one-offs. */
export function isQuantityExtra(offer: { pricingUnit: string }): boolean {
  return offer.pricingUnit.startsWith("Person");
}

export type AdditionRequest = { serviceId: string; count: number };

export type PricedAddition = {
  serviceId: string;
  code: string;
  name: string;
  pricingUnit: string;
  /** Count already on the reservation (absolute, per service date). */
  previousCount: number;
  /** How many more the guest is adding. */
  addCount: number;
  /** previousCount + addCount: what book-service must SET. */
  targetCount: number;
  /** The quoted price for the added quantity alone. */
  amount: number;
};

export type PriceAdditionsResult =
  | { ok: true; additions: PricedAddition[]; total: number }
  | { ok: false; reason: string };

/**
 * Validate and price a set of requested additions against the live offers
 * and what the reservation already holds. Every number the guest is charged
 * comes from here, computed server-side from Apaleo's own offer totals -
 * client-sent amounts are never trusted.
 */
export function priceAdditions(
  offers: Array<{
    serviceId: string;
    code: string;
    name: string;
    pricingUnit: string;
    count: number;
    totalGrossAmount: number;
  }>,
  owned: Array<{ serviceId: string; count: number }>,
  requests: AdditionRequest[],
  options: {
    /** Service ids whose quantity was already capped by the inventory
     *  validator (UNP-6): the stepper cap does not apply to them. */
    uncapped?: ReadonlySet<string>;
  } = {},
): PriceAdditionsResult {
  if (requests.length === 0) {
    return { ok: false, reason: "Pick at least one extra to add." };
  }
  const seen = new Set<string>();
  const ownedById = new Map(owned.map((o) => [o.serviceId, o.count]));
  const additions: PricedAddition[] = [];

  for (const request of requests) {
    if (seen.has(request.serviceId)) {
      return { ok: false, reason: "Each extra can only appear once per request." };
    }
    seen.add(request.serviceId);

    if (!Number.isInteger(request.count) || request.count < 1) {
      return { ok: false, reason: "Quantities must be whole numbers of at least one." };
    }
    const offer = offers.find((o) => o.serviceId === request.serviceId);
    if (!offer) {
      return { ok: false, reason: "One of those extras isn't available for this stay." };
    }

    const previousCount = ownedById.get(request.serviceId) ?? 0;
    if (isQuantityExtra(offer)) {
      if (!options.uncapped?.has(offer.serviceId) && previousCount + request.count > MAX_EXTRA_QTY) {
        return {
          ok: false,
          reason: `You can have at most ${MAX_EXTRA_QTY} of each extra per lodge.`,
        };
      }
    } else {
      // One-offs: you either have it or you don't, same as checkout.
      if (previousCount > 0) {
        return { ok: false, reason: `${offer.name} is already on this lodge.` };
      }
      if (request.count !== 1) {
        return { ok: false, reason: `${offer.name} can only be added once.` };
      }
    }

    additions.push({
      serviceId: offer.serviceId,
      code: offer.code,
      name: offer.name,
      pricingUnit: offer.pricingUnit,
      previousCount,
      addCount: request.count,
      targetCount: previousCount + request.count,
      amount: extraUnitPrice(offer) * request.count,
    });
  }

  return {
    ok: true,
    additions,
    total: additions.reduce((sum, a) => sum + a.amount, 0),
  };
}

/**
 * Fold priced additions into a lodge's extras snapshot so summaries and the
 * confirmation page keep telling the truth after a post-booking add. Existing
 * lines grow; new services append. Never mutates its inputs.
 */
export function mergeExtras(existing: ExtraLine[], additions: PricedAddition[]): ExtraLine[] {
  const merged = existing.map((line) => ({ ...line }));
  for (const addition of additions) {
    const line = merged.find((l) => l.serviceId === addition.serviceId);
    if (line) {
      line.count += addition.addCount;
      line.grossAmount += addition.amount;
    } else {
      merged.push({
        serviceId: addition.serviceId,
        code: addition.code,
        name: addition.name,
        count: addition.addCount,
        grossAmount: addition.amount,
      });
    }
  }
  return merged;
}
