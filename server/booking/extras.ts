import "server-only";
import type {
  BookingRecord,
  BookingReservation,
  BookingSession,
  ExtrasOrder,
  SessionLodge,
} from "@prisma/client";
import { prisma } from "../db";
import { PublicError } from "../api-helpers";
import { getExtraOffers } from "../apaleo/offers";
import { getReservation } from "../apaleo/amend";
import { getFolioForReservation } from "../apaleo/bookings";
import { payFolio } from "../apaleo/payments";
import { bookReservationService, getReservationServices } from "../apaleo/services";
import { LOCATION_SERVICE_CODE, removeReservationService } from "../apaleo/units";
import { parseExtras } from "./session";
import {
  extraUnitPrice,
  isQuantityExtra,
  MAX_EXTRA_QTY,
  mergeExtras,
  priceAdditions,
  type AdditionRequest,
  type PricedAddition,
} from "@/lib/extras";
import { sendExtrasReceipt } from "../email/extrasReceipt";

/**
 * Add extras to a booked break, the promise the checkout extras page makes.
 * The money rules follow the two payment states that allow changes:
 *
 *  - "charge_now" (status paid): the new charge settles on the folio at
 *    once, the same simulated-money move the amend route makes for a price
 *    difference. totalGrossAmount and paidAmount grow together, so the
 *    booking stays fully paid.
 *  - "on_balance" (status deposit_paid): the charge folds into the
 *    outstanding balance; the existing pay route collects it later. The
 *    frozen snapshots (record.totalGrossAmount, child grossAmount) grow by
 *    the same folio delta, which is exactly what keeps settlePayment's
 *    folio-drift check happy.
 *
 * Every operation is an ExtrasOrder row created BEFORE the first Apaleo
 * write. book-service sets counts absolutely (see server/apaleo/services.ts),
 * so a crashed order can always be finished or exactly undone from the
 * counts stored on the row.
 */

export type RecordForExtras = BookingRecord & {
  session: BookingSession & { lodges: SessionLodge[] };
  reservations: BookingReservation[];
};

export type ManageExtraOffer = {
  serviceId: string;
  code: string;
  name: string;
  description: string;
  pricingUnit: string;
  unitPrice: number;
  currency: string;
  ownedCount: number;
  maxAdd: number;
};

export type ManageExtrasQuote = {
  kind: "charge_now" | "on_balance";
  lodges: Array<{ slot: number; extras: ManageExtraOffer[] }>;
};

/** How long a live order is assumed genuinely in flight before recovery may
 *  reclaim it. Generous on purpose: the Apaleo client retries 429s honouring
 *  Retry-After, so a slow original request must finish (or truly die) before
 *  a refresh may roll its work back under it. */
const IN_FLIGHT_GRACE_MS = 5 * 60 * 1000;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The gates every extras call shares. Throws the guest-facing refusal, or
 * returns how money will be handled for this booking.
 */
export function assertExtrasAllowed(record: RecordForExtras): "charge_now" | "on_balance" {
  if (record.status === "cancelled") {
    throw new PublicError(409, "This break is cancelled, so extras can't be added.");
  }
  if (record.status === "paid") {
    if (record.session.arrival <= todayIso()) {
      throw new PublicError(
        409,
        "Extras can be added up to the day before arrival. Speak to the village team when you arrive.",
      );
    }
    return "charge_now";
  }
  if (record.status === "deposit_paid") {
    if (record.session.arrival <= todayIso()) {
      throw new PublicError(
        409,
        "Extras can be added up to the day before arrival. Speak to the village team when you arrive.",
      );
    }
    return "on_balance";
  }
  throw new PublicError(409, "Finish paying for your break before adding extras.");
}

type LodgeSlot = {
  slot: number;
  reservationId: string;
  child: BookingReservation | null;
  sessionLodge: SessionLodge | null;
};

/** One entry per lodge, child rows first, legacy single-lodge fallback after
 *  (the same shape the amend route walks). */
function lodgeSlots(record: RecordForExtras): LodgeSlot[] {
  const bySlot = (slot: number) =>
    record.session.lodges.find((l) => l.slot === slot) ?? null;
  if (record.reservations.length > 0) {
    return record.reservations.map((r) => ({
      slot: r.slot,
      reservationId: r.apaleoReservationId,
      child: r,
      sessionLodge: bySlot(r.slot),
    }));
  }
  return [
    {
      slot: 0,
      reservationId: record.apaleoReservationId,
      child: null,
      sessionLodge: bySlot(0),
    },
  ];
}

function requireSlot(record: RecordForExtras, slot: number): LodgeSlot {
  const found = lodgeSlots(record).find((l) => l.slot === slot);
  if (!found) throw new PublicError(400, "That lodge isn't part of this booking.");
  return found;
}

/**
 * Live offers and owned counts for one lodge. Reservation truth (rate plan,
 * dates, party) is read live from Apaleo rather than our snapshots, so a
 * moved break prices its extras for the dates it actually has.
 */
async function quoteSlot(lodge: LodgeSlot): Promise<ManageExtraOffer[]> {
  const reservation = await getReservation(lodge.reservationId);
  const [offers, owned] = await Promise.all([
    getExtraOffers({
      ratePlanId: reservation.ratePlan.id,
      arrival: reservation.arrival.slice(0, 10),
      departure: reservation.departure.slice(0, 10),
      adults: reservation.adults,
      childrenAges: reservation.childrenAges,
    }),
    getReservationServices(lodge.reservationId),
  ]);
  const ownedById = new Map(owned.map((o) => [o.serviceId, o.count]));

  return offers
    .filter((offer) => offer.code !== LOCATION_SERVICE_CODE)
    .map((offer) => {
      const ownedCount = ownedById.get(offer.serviceId) ?? 0;
      const maxAdd = isQuantityExtra(offer)
        ? Math.max(0, MAX_EXTRA_QTY - ownedCount)
        : ownedCount > 0
          ? 0
          : 1;
      return {
        serviceId: offer.serviceId,
        code: offer.code,
        name: offer.name,
        description: offer.description,
        pricingUnit: offer.pricingUnit,
        unitPrice: extraUnitPrice(offer),
        currency: offer.currency,
        ownedCount,
        maxAdd,
      };
    });
}

export async function quoteManageExtras(record: RecordForExtras): Promise<ManageExtrasQuote> {
  // Recovery first, gates second: a crashed order on a booking that has
  // since cancelled must still get resolved, and the gates would refuse
  // before recovery ever ran.
  await recoverStaleExtrasOrder(record);
  const kind = assertExtrasAllowed(record);
  const lodges = [];
  for (const lodge of lodgeSlots(record)) {
    lodges.push({ slot: lodge.slot, extras: await quoteSlot(lodge) });
  }
  return { kind, lodges };
}

export type AddExtrasOutcome = {
  kind: "charge_now" | "on_balance";
  /** The folio delta, which is what was charged (charge_now) or added to the
   *  balance (on_balance). */
  amount: number;
  totalGrossAmount: number;
  paidAmount: number;
};

export async function addManageExtras(
  record: RecordForExtras,
  slot: number,
  requests: AdditionRequest[],
): Promise<AddExtrasOutcome> {
  // Same ordering as the quote: recovery must be reachable whatever state
  // the record has drifted into.
  await recoverStaleExtrasOrder(record);
  const kind = assertExtrasAllowed(record);
  const lodge = requireSlot(record, slot);

  // The payment path's serializer: a live Pesapal attempt (pending, or
  // collected but not yet settled) means the folio is about to move under
  // us, and settlePayment derives paid amounts from folio balances. Neither
  // engine can see mid-flight charges from the other, so extras wait. The
  // pay route holds the mirror check against a live ExtrasOrder. Advisory,
  // not transactional: the residual millisecond window surfaces as the
  // settle engine's loud folio-drift wedge, never as silent money.
  const livePayment = await prisma.pesapalTransaction.findFirst({
    where: { liveForRecordId: record.id },
    select: { id: true },
  });
  if (livePayment) {
    throw new PublicError(
      409,
      "A payment for this booking is still going through. Give it a moment and try again.",
    );
  }

  // Price authoritatively from live offers; the client only ever sent
  // service ids and counts.
  const offers = await quoteSlot(lodge);
  const owned = offers.map((o) => ({ serviceId: o.serviceId, count: o.ownedCount }));
  const priced = priceAdditions(
    offers.map((o) => ({
      serviceId: o.serviceId,
      code: o.code,
      name: o.name,
      pricingUnit: o.pricingUnit,
      // priceAdditions recomputes the unit price from a count and total.
      count: 1,
      totalGrossAmount: o.unitPrice,
    })),
    owned,
    requests,
  );
  if (!priced.ok) throw new PublicError(400, priced.reason);

  // The folio must read exactly as bookkeeping expects before we touch it.
  // For a paid booking that is settled (0); for a deposit-paid booking it is
  // minus what is still owed on this lodge. Anything else means something
  // else has touched the folio and a human should look before more money moves.
  const before = await getFolioForReservation(lodge.reservationId);
  const expectedBefore =
    kind === "charge_now"
      ? 0
      : -((lodge.child?.grossAmount ?? record.totalGrossAmount) -
          (lodge.child?.paidAmount ?? record.paidAmount));
  if (Math.abs(before.balance - expectedBefore) > 0.01) {
    console.error(
      "Extras refused: folio does not match bookkeeping",
      record.apaleoBookingId,
      { slot, balance: before.balance, expectedBefore },
    );
    throw new PublicError(
      502,
      "This booking's bill needs a human look before extras can be added. Call our team on +254 700 000 000.",
    );
  }

  // The order row exists before any Apaleo write; the unique liveForRecordId
  // turns a concurrent second add into a refusal instead of a double booking.
  let order: ExtrasOrder;
  try {
    order = await prisma.extrasOrder.create({
      data: {
        recordId: record.id,
        slot,
        additions: JSON.stringify(priced.additions),
        expectedDelta: priced.total,
        currency: before.currency,
        kind,
        liveForRecordId: record.id,
      },
    });
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "P2002") {
      throw new PublicError(
        409,
        "Another change to this booking is still going through. Give it a moment and try again.",
      );
    }
    throw err;
  }

  // Apply: set each service to its absolute target. A crash from here on
  // leaves the order row for recovery.
  const applied: PricedAddition[] = [];
  try {
    for (const addition of priced.additions) {
      await bookReservationService({
        reservationId: lodge.reservationId,
        serviceId: addition.serviceId,
        count: addition.targetCount,
        idempotencyKey: `up-extras-${order.id}-${addition.serviceId}`,
      });
      applied.push(addition);
    }

    const after = await getFolioForReservation(lodge.reservationId);
    const actualDelta = Math.abs(after.balance) - Math.abs(before.balance);

    // The folio is the priced truth; the quote is what the guest approved.
    // They disagree only if service rates changed mid-request - undo and ask
    // the guest to look at fresh prices rather than charge a surprise.
    if (Math.abs(actualDelta - priced.total) > 1) {
      console.error(
        "Extras rolled back: folio delta diverged from quote",
        record.apaleoBookingId,
        { slot, actualDelta, expected: priced.total },
      );
      await rollbackAdditions(lodge.reservationId, applied, order.id);
      await verifyFolioRestored(lodge.reservationId, before.balance, order.id);
      await retireOrder(order.id, "failed", null);
      throw new PublicError(
        409,
        "Prices for extras just changed, so nothing was added or charged. Reload and try again.",
      );
    }

    if (kind === "charge_now") {
      await payFolio({
        folioId: after.folioId,
        amount: Math.abs(after.balance),
        currency: after.currency,
        receipt: `UP-${record.apaleoBookingId}-EXTRAS-${slot + 1}`,
        idempotencyKey: `up-extras-pay-${order.id}`,
      });
    }

    const updated = await settleExtrasOrder(record, lodge, order.id, priced.additions, actualDelta, kind);
    void sendExtrasReceipt(order.id);
    return {
      kind,
      amount: actualDelta,
      totalGrossAmount: updated.totalGrossAmount,
      paidAmount: updated.paidAmount,
    };
  } catch (err) {
    if (err instanceof PublicError) throw err;
    // Unknown failure mid-apply: resolve from the folio's truth rather than
    // assume. A payment whose response was lost completes; anything else
    // rolls back so the folio matches the books again. If resolution itself
    // fails the order stays live and recovery finishes the job next visit.
    console.error("Extras add failed, resolving from folio truth", record.apaleoBookingId, err);
    try {
      const resolved = await resolveOrder(record, lodge, order, priced.additions);
      if (resolved.status === "settled") {
        void sendExtrasReceipt(order.id);
        return {
          kind,
          amount: order.expectedDelta,
          totalGrossAmount: resolved.totalGrossAmount,
          paidAmount: resolved.paidAmount,
        };
      }
    } catch (resolveErr) {
      console.error("Extras resolution failed, order left for recovery", order.id, resolveErr);
    }
    throw new PublicError(
      502,
      "We couldn't add those extras, so nothing was charged. Please try again.",
    );
  }
}

/** Set every applied service back to its previous count (removing ones that
 *  weren't there at all). Exact because book-service sets counts absolutely,
 *  and idempotent because removal answers 204 for already-gone services. */
async function rollbackAdditions(
  reservationId: string,
  additions: PricedAddition[],
  orderId: string,
): Promise<void> {
  for (const addition of additions) {
    if (addition.previousCount > 0) {
      await bookReservationService({
        reservationId,
        serviceId: addition.serviceId,
        count: addition.previousCount,
        idempotencyKey: `up-extras-undo-${orderId}-${addition.serviceId}`,
      });
    } else {
      await removeReservationService(reservationId, addition.serviceId);
    }
  }
}

/**
 * After a rollback the folio must read exactly what it read before the
 * order started. When it doesn't, money moved that our books don't know
 * about (a mid-request rate change repricing surviving services, an amend
 * sweeping our transient charge, a slow payment landing late) - nothing
 * here can fix that, but it must never be silent.
 */
async function verifyFolioRestored(
  reservationId: string,
  expectedBalance: number,
  orderId: string,
): Promise<void> {
  try {
    const folio = await getFolioForReservation(reservationId);
    if (Math.abs(folio.balance - expectedBalance) > 0.01) {
      console.error(
        "Extras rollback left the folio off its baseline - human look needed",
        { orderId, reservationId, balance: folio.balance, expectedBalance },
      );
    }
  } catch (err) {
    console.error("Extras rollback verification could not read the folio", orderId, err);
  }
}

async function retireOrder(
  orderId: string,
  status: "failed" | "settled",
  chargedDelta: number | null,
): Promise<number> {
  const flipped = await prisma.extrasOrder.updateMany({
    where: { id: orderId, status: "created" },
    data: { status, chargedDelta, liveForRecordId: null },
  });
  return flipped.count;
}

/**
 * The bookkeeping half, one transaction: the order retires, the frozen money
 * snapshots grow by the observed folio delta, and the session's extras
 * snapshot keeps telling the truth on summaries. Guarded flips throughout so
 * a racing recovery can never double-apply.
 */
async function settleExtrasOrder(
  record: RecordForExtras,
  lodge: LodgeSlot,
  orderId: string,
  additions: PricedAddition[],
  actualDelta: number,
  kind: "charge_now" | "on_balance",
): Promise<{ totalGrossAmount: number; paidAmount: number }> {
  return prisma.$transaction(async (tx) => {
    const flipped = await tx.extrasOrder.updateMany({
      where: { id: orderId, status: "created" },
      data: { status: "settled", chargedDelta: actualDelta, liveForRecordId: null },
    });
    if (flipped.count === 0) {
      throw new PublicError(409, "This change was already processed. Reload to see your extras.");
    }

    // The record must still be in the state the money move assumed; a
    // cancellation racing this exact window is a human matter, loudly.
    const recordUpdated = await tx.bookingRecord.updateMany({
      where: { id: record.id, status: record.status },
      data: {
        totalGrossAmount: { increment: actualDelta },
        ...(kind === "charge_now" ? { paidAmount: { increment: actualDelta } } : {}),
      },
    });
    if (recordUpdated.count === 0) {
      console.error(
        "Extras settle found the record in a different state",
        record.apaleoBookingId,
        { orderId, expectedStatus: record.status },
      );
      throw new PublicError(
        502,
        "Your booking changed while we were adding extras. Call our team on +254 700 000 000.",
      );
    }

    if (lodge.child) {
      await tx.bookingReservation.update({
        where: { id: lodge.child.id },
        data: {
          grossAmount: { increment: actualDelta },
          ...(kind === "charge_now" ? { paidAmount: { increment: actualDelta } } : {}),
        },
      });
    }

    if (lodge.sessionLodge) {
      const merged = mergeExtras(parseExtras(lodge.sessionLodge), additions);
      await tx.sessionLodge.update({
        where: { id: lodge.sessionLodge.id },
        data: { extras: JSON.stringify(merged) },
      });
      if (lodge.slot === 0) {
        // Legacy slot-0 mirror, the same rule setExtras follows.
        await tx.bookingSession.update({
          where: { id: record.sessionId },
          data: { extras: JSON.stringify(merged) },
        });
      }
    }

    const fresh = await tx.bookingRecord.findUniqueOrThrow({
      where: { id: record.id },
      select: { totalGrossAmount: true, paidAmount: true },
    });
    return fresh;
  });
}

/**
 * Decide a live order's ending from the folio's and reservation's truth,
 * never from assumptions about where a crash happened:
 *
 *  - charge_now order, folio settled, counts at target: the payment landed
 *    and only the bookkeeping was lost; finish it.
 *  - charge_now order, folio settled, counts at previous: nothing net
 *    happened; retire the order.
 *  - anything else: set every count back to previous (exact, because
 *    book-service sets counts absolutely; idempotent, because removal
 *    answers 204 for already-gone services) and retire the order.
 */
async function resolveOrder(
  record: RecordForExtras,
  lodge: LodgeSlot,
  order: ExtrasOrder,
  additions: PricedAddition[],
): Promise<
  | { status: "settled"; totalGrossAmount: number; paidAmount: number }
  | { status: "failed" }
> {
  // A record that left the payable states mid-order (a racing cancellation)
  // must never have money settled onto it. Roll the services back, retire
  // the order, and shout: if the order's payFolio landed, that money now
  // sits on the cancelled folio outside the refund math, a human matter.
  if (record.status !== "paid" && record.status !== "deposit_paid") {
    console.error(
      "Extras order found its record in a non-payable state - rolling back, human look needed",
      { orderId: order.id, recordStatus: record.status, booking: record.apaleoBookingId },
    );
    await rollbackAdditions(lodge.reservationId, additions, order.id);
    await retireOrder(order.id, "failed", null);
    return { status: "failed" };
  }

  const [folio, services] = await Promise.all([
    getFolioForReservation(lodge.reservationId),
    getReservationServices(lodge.reservationId),
  ]);
  const countById = new Map(services.map((s) => [s.serviceId, s.count]));
  const atTarget = additions.every(
    (a) => (countById.get(a.serviceId) ?? 0) === a.targetCount,
  );
  const atPrevious = additions.every(
    (a) => (countById.get(a.serviceId) ?? 0) === a.previousCount,
  );

  if (order.kind === "charge_now" && Math.abs(folio.balance) <= 0.01) {
    if (atTarget) {
      console.log("Extras order completing from folio truth", order.id);
      const totals = await settleExtrasOrder(
        record,
        lodge,
        order.id,
        additions,
        order.expectedDelta,
        "charge_now",
      );
      return { status: "settled", ...totals };
    }
    if (atPrevious) {
      console.log("Extras order retired as a no-op", order.id);
      await retireOrder(order.id, "failed", null);
      return { status: "failed" };
    }
  }

  console.log("Extras order rolling back", order.id);
  await rollbackAdditions(lodge.reservationId, additions, order.id);
  const baseline =
    order.kind === "charge_now"
      ? 0
      : -((lodge.child?.grossAmount ?? record.totalGrossAmount) -
          (lodge.child?.paidAmount ?? record.paidAmount));
  await verifyFolioRestored(lodge.reservationId, baseline, order.id);
  await retireOrder(order.id, "failed", null);
  return { status: "failed" };
}

/** Self-healing for a crashed operation, run before any quote or add. */
export async function recoverStaleExtrasOrder(record: RecordForExtras): Promise<void> {
  const order = await prisma.extrasOrder.findUnique({
    where: { liveForRecordId: record.id },
  });
  if (!order) return;

  if (Date.now() - order.createdAt.getTime() < IN_FLIGHT_GRACE_MS) {
    throw new PublicError(
      409,
      "Another change to this booking is still going through. Give it a moment and try again.",
    );
  }

  const additions = JSON.parse(order.additions) as PricedAddition[];
  const lodge = lodgeSlots(record).find((l) => l.slot === order.slot);
  if (!lodge) {
    console.error("Extras recovery found no lodge for order", order.id, order.slot);
    await retireOrder(order.id, "failed", null);
    return;
  }

  const resolved = await resolveOrder(record, lodge, order, additions);
  if (resolved.status === "settled") void sendExtrasReceipt(order.id);
}
