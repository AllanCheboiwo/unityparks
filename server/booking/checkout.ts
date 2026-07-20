import "server-only";
import {
  Prisma,
  type BookingRecord,
  type BookingReservation,
  type PesapalTransaction,
} from "@prisma/client";
import { prisma } from "../db";
import { createBooking, getFolioForReservation, type FolioSummary } from "../apaleo/bookings";
import {
  assignSpecificUnit,
  autoAssignUnit,
  removeReservationService,
  type UnitOption,
} from "../apaleo/units";
import { payFolio } from "../apaleo/payments";
import { ApaleoError } from "../apaleo/client";
import { getOrderStatus, submitOrder } from "../pesapal/orders";
import { paymentMatchesOrder } from "../pesapal/status";
import { PublicError } from "../api-helpers";
import { paymentsProvider } from "./provider";
import { getSession, parseChildrenAges, parseExtras } from "./session";
import { loadGuests } from "./guests";
import { sendBookingConfirmation } from "../email/bookingConfirmation";

type RecordWithReservations = BookingRecord & { reservations: BookingReservation[] };
type SessionForCheckout = NonNullable<Awaited<ReturnType<typeof getSession>>>;

/** Where the guest's browser (and Pesapal's IPN) finds us. */
function appBaseUrl(): string {
  return process.env.APP_BASE_URL ?? "http://localhost:3000";
}

export type CheckoutOutcome =
  | { kind: "paid"; record: BookingRecord }
  | { kind: "redirect"; redirectUrl: string };

/**
 * The "Buy now" moment. Reserve first, then collect, then record:
 *   1. create the booking in Apaleo - one booking, one reservation per lodge
 *   2. collect the money - Pesapal's hosted page (or the demo simulation)
 *   3. record it - pay each reservation's folio in Apaleo
 *
 * With the simulated provider all three happen in this one call, exactly as
 * the demo always has. With Pesapal this call ends at a redirect to their
 * payment page; confirmPesapalPayment() picks up steps 2-3 when the guest
 * (or the IPN) comes back. Re-entry is the same entry point: Buy now again
 * resumes wherever the last attempt stopped - a collected-but-unrecorded
 * payment settles, a pending order re-offers the same payment page, a
 * failed one gets a fresh order. Reservations are never re-created (per
 * session idempotency key) and folios are never re-paid (per-slot keys).
 *
 * Ordering rules that keep money truthful:
 *   - The BookingRecord lookup comes BEFORE the session-expiry gate. Once a
 *     real reservation exists, a retry must resume it - telling the guest to
 *     "search again" would orphan the reservations and invite double booking.
 *   - The record is created carrying every folio's real total, so a crash
 *     between payment and the final update can never leave a paid booking
 *     recorded at 0.
 *   - A Pesapal order is only ever trusted after our own GetTransactionStatus
 *     call says COMPLETED with the amount and currency we asked for. The
 *     browser redirect proves nothing.
 *   - The PesapalTransaction row flips to "completed" BEFORE the folio
 *     write-backs, so a crash between the two leaves a row saying "money
 *     collected, not yet recorded" - the resume paths finish the recording,
 *     never re-collect.
 */
export async function beginCheckout(sessionId: string): Promise<CheckoutOutcome> {
  const provider = paymentsProvider();
  // A forced PAYMENTS_PROVIDER=pesapal can bypass the presence checks, so
  // fail the config error here, BEFORE a reservation is created for nothing.
  const ipnId = process.env.PESAPAL_IPN_ID;
  if (provider === "pesapal" && !ipnId) {
    throw new Error("PESAPAL_IPN_ID is not set. Run: node scripts/register-pesapal-ipn.mjs");
  }

  const { record, session } = await ensureRecord(sessionId);
  if (record.status === "paid") return { kind: "paid", record };

  if (provider === "simulated") {
    const paid = await settleBooking(record, session, null, null);
    return { kind: "paid", record: paid };
  }

  const transactions = await prisma.pesapalTransaction.findMany({
    where: { recordId: record.id },
    orderBy: { createdAt: "desc" },
  });

  // A mismatch row means Pesapal reported collecting something other than
  // what we asked for. Folios stay untouched and Buy now stays closed until
  // a human resolves it - a fresh order on top would only bury the problem.
  if (transactions.some((t) => t.status === "mismatch")) {
    throw new PublicError(
      502,
      "The payment we received doesn't match your booking total. Please contact us before paying again.",
    );
  }

  // Finish any attempt where money was already collected but a crash stopped
  // the folio recording - never send that guest to pay again.
  const collected = transactions.find((t) => t.status === "completed");
  if (collected) {
    const paid = await settleBooking(record, session, collected.orderTrackingId, collected.amount);
    return { kind: "paid", record: paid };
  }

  // A live order may already be out there: ask Pesapal what happened to it.
  const open = transactions.find((t) => t.status === "pending" && t.orderTrackingId);
  if (open) {
    const status = await getOrderStatus(open.orderTrackingId!);
    if (status.outcome === "completed") {
      await confirmCollected(open, status);
      const paid = await settleBooking(record, session, open.orderTrackingId, open.amount);
      return { kind: "paid", record: paid };
    }
    if (status.outcome === "pending" && open.redirectUrl) {
      // Still waiting on the guest: same order, same payment page. Reusing
      // it keeps retries off the shared sandbox merchant's rate limits.
      return { kind: "redirect", redirectUrl: open.redirectUrl };
    }
    await prisma.pesapalTransaction.updateMany({
      where: { id: open.id, status: "pending" },
      data: {
        status: status.outcome === "pending" ? "superseded" : "failed",
        confirmationCode: status.confirmationCode,
        paymentMethod: status.paymentMethod,
        liveForRecordId: null,
      },
    });
  }

  return submitFreshOrder(record, session, ipnId!);
}

/**
 * Create the one live attempt and send its order to Pesapal. The unique
 * liveForRecordId column is the lock: when two requests race here, exactly
 * one row wins and the loser resolves against the winner instead of minting
 * a second payable order. Retired attempts (failed, superseded) have the
 * column cleared, so they never block a legitimate retry.
 */
async function submitFreshOrder(
  record: RecordWithReservations,
  session: SessionForCheckout,
  ipnId: string,
): Promise<CheckoutOutcome> {
  let transaction: PesapalTransaction | null = null;
  for (let attempt = 0; attempt < 2 && !transaction; attempt++) {
    try {
      transaction = await prisma.pesapalTransaction.create({
        data: {
          recordId: record.id,
          amount: record.totalGrossAmount,
          currency: record.currency,
          liveForRecordId: record.id,
        },
      });
    } catch (err) {
      const raced =
        err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
      if (!raced) throw err;

      const winner = await prisma.pesapalTransaction.findUnique({
        where: { liveForRecordId: record.id },
      });
      if (!winner) continue; // winner retired between our create and read: take its place

      if (winner.status === "completed") {
        // The racing confirm already collected money on the winner: record it.
        const paid = await settleBooking(record, session, winner.orderTrackingId, winner.amount);
        return { kind: "paid", record: paid };
      }
      if (winner.redirectUrl) {
        // The winner's order is live: this guest joins it.
        return { kind: "redirect", redirectUrl: winner.redirectUrl };
      }
      if (Date.now() - winner.createdAt.getTime() < 2 * 60_000) {
        // The winner is mid-SubmitOrderRequest in another request. Its
        // redirect will land there; this one just needs patience.
        throw new PublicError(
          409,
          "We're already setting up your payment. Give it a moment, then press the button again.",
        );
      }
      // A crashed attempt: no order URL ever landed and nobody is coming
      // back for it. Its merchant reference may or may not exist at Pesapal,
      // so it is dead to us either way - retire it and take its place.
      await prisma.pesapalTransaction.update({
        where: { id: winner.id },
        data: { status: "superseded", liveForRecordId: null },
      });
    }
  }
  if (!transaction) {
    throw new PublicError(
      409,
      "We're already setting up your payment. Give it a moment, then press the button again.",
    );
  }

  const order = await submitOrder({
    merchantReference: transaction.id,
    amount: transaction.amount,
    currency: transaction.currency,
    description: `Unity Parks break ${session.arrival} to ${session.departure}`,
    callbackUrl: `${appBaseUrl()}/api/payments/pesapal/callback`,
    notificationId: ipnId,
    billing: {
      firstName: session.guestFirstName!,
      lastName: session.guestLastName!,
      email: session.guestEmail!,
      phone: session.guestPhone ?? undefined,
    },
  });
  await prisma.pesapalTransaction.update({
    where: { id: transaction.id },
    data: { orderTrackingId: order.orderTrackingId, redirectUrl: order.redirectUrl },
  });

  return { kind: "redirect", redirectUrl: order.redirectUrl };
}

export type PesapalConfirmation = {
  outcome: "completed" | "pending" | "failed";
  record: BookingRecord;
};

/**
 * The other half of the Pesapal flow: the guest's browser came back to the
 * callback URL, or the IPN fired. Both land here, both are idempotent, and
 * a race between them is settled by Apaleo's idempotency keys (same key,
 * same payment). Only our own status read decides anything.
 */
export async function confirmPesapalPayment(
  orderTrackingId: string,
): Promise<PesapalConfirmation> {
  const transaction = await prisma.pesapalTransaction.findUnique({
    where: { orderTrackingId },
    include: { record: { include: { reservations: { orderBy: { slot: "asc" } } } } },
  });
  if (!transaction) throw new PublicError(404, "Unknown payment reference.");

  const record = transaction.record;

  // Already recorded as a mismatch: the fact is stored, the pay page holds
  // the guest, a human resolves it. "failed" keeps the callback off the
  // confirmation page and lets the IPN acknowledge without retry-looping.
  if (transaction.status === "mismatch") return { outcome: "failed", record };

  if (record.status === "paid") {
    return confirmAgainstPaidRecord(transaction, record);
  }

  // The shopping-session TTL must never block recording collected money, so
  // read the session row directly rather than through the expiry gate.
  const session = await prisma.bookingSession.findUnique({
    where: { id: record.sessionId },
    include: { lodges: { orderBy: { slot: "asc" } } },
  });
  if (!session) throw new PublicError(404, "Unknown payment reference.");

  // Money already confirmed collected on an earlier pass: just finish the
  // folio recording.
  if (transaction.status === "completed") {
    const paid = await settleBooking(record, session, orderTrackingId, transaction.amount);
    return { outcome: "completed", record: paid };
  }

  const status = await getOrderStatus(orderTrackingId);
  if (status.outcome === "completed") {
    await confirmCollected(transaction, status);
    const paid = await settleBooking(record, session, orderTrackingId, transaction.amount);
    return { outcome: "completed", record: paid };
  }
  if (status.outcome === "failed" || status.outcome === "reversed") {
    // Guard on "pending" so a concurrent confirm that already flipped this
    // row to completed can never be downgraded.
    await prisma.pesapalTransaction.updateMany({
      where: { id: transaction.id, status: "pending" },
      data: {
        status: "failed",
        confirmationCode: status.confirmationCode,
        paymentMethod: status.paymentMethod,
        liveForRecordId: null,
      },
    });
    return { outcome: "failed", record };
  }
  return { outcome: "pending", record };
}

/**
 * A confirmation arriving for a booking that is already paid. Never a blind
 * success: ask Pesapal what happened to THIS order, because two truths hide
 * here - a late payment on a stale order (money collected twice), and a
 * chargeback on the order that settled. Both are recorded loudly for a
 * human; neither touches the folios by itself.
 */
async function confirmAgainstPaidRecord(
  transaction: PesapalTransaction,
  record: BookingRecord,
): Promise<PesapalConfirmation> {
  const status = await getOrderStatus(transaction.orderTrackingId!);

  if (transaction.status === "completed") {
    // The order that settled the booking, revisited (IPN retry, reload).
    if (status.outcome === "reversed") {
      console.error(
        "Pesapal payment REVERSED after settlement",
        JSON.stringify({ transactionId: transaction.id, recordId: record.id }),
      );
      await prisma.pesapalTransaction.updateMany({
        where: { id: transaction.id, status: "completed" },
        data: { status: "reversed", liveForRecordId: null },
      });
    }
    return { outcome: "completed", record };
  }

  if (status.outcome === "completed") {
    // Money collected on an order that did NOT settle this booking: the
    // guest paid a stale payment page after another order already paid the
    // folios. Record the excess so reconciliation can refund it.
    console.error(
      "Pesapal EXCESS collection on paid booking",
      JSON.stringify({
        transactionId: transaction.id,
        recordId: record.id,
        amount: status.amount,
        confirmationCode: status.confirmationCode,
      }),
    );
    await prisma.pesapalTransaction.updateMany({
      where: { id: transaction.id, status: { in: ["pending", "failed", "superseded"] } },
      data: {
        status: "excess",
        confirmationCode: status.confirmationCode,
        paymentMethod: status.paymentMethod,
        liveForRecordId: null,
      },
    });
  }
  // Whatever this stale order says, the booking itself is honestly paid.
  return { outcome: "completed", record };
}

/**
 * Flip a transaction to "collected" after OUR status read said COMPLETED.
 * Refuses to record a payment that doesn't match what we asked Pesapal to
 * collect - that mismatch means a bug or tampering, and folios stay clean
 * until a human looks.
 */
async function confirmCollected(
  transaction: PesapalTransaction,
  status: { amount: number; currency: string | null; confirmationCode: string | null; paymentMethod: string | null },
): Promise<void> {
  if (!paymentMatchesOrder(transaction, status)) {
    console.error(
      "Pesapal amount MISMATCH",
      JSON.stringify({
        transactionId: transaction.id,
        expected: { amount: transaction.amount, currency: transaction.currency },
        reported: { amount: status.amount, currency: status.currency },
      }),
    );
    // The row itself carries the wedge, so it survives log rotation: Buy now
    // refuses while a mismatch row exists, and confirms answer "failed"
    // without retry-looping the IPN.
    await prisma.pesapalTransaction.updateMany({
      where: { id: transaction.id, status: "pending" },
      data: {
        status: "mismatch",
        confirmationCode: status.confirmationCode,
        paymentMethod: status.paymentMethod,
        liveForRecordId: null,
      },
    });
    throw new PublicError(
      502,
      "The payment we received doesn't match your booking total. Please contact us before paying again.",
    );
  }
  // liveForRecordId stays set: collected-but-unsettled is still the one live
  // attempt, and it keeps blocking fresh orders until settle records it.
  await prisma.pesapalTransaction.update({
    where: { id: transaction.id },
    data: {
      status: "completed",
      confirmationCode: status.confirmationCode,
      paymentMethod: status.paymentMethod,
    },
  });
}

/**
 * Step 1: make sure the Apaleo booking and our BookingRecord exist, creating
 * them on the first pass and resuming them on any retry.
 */
async function ensureRecord(sessionId: string): Promise<{
  record: RecordWithReservations;
  session: SessionForCheckout;
}> {
  const existing = await prisma.bookingRecord.findUnique({
    where: { sessionId },
    include: { reservations: { orderBy: { slot: "asc" } } },
  });

  // With a record in flight, shopping-session expiry no longer applies.
  const session = existing
    ? await prisma.bookingSession.findUnique({
        where: { id: sessionId },
        include: { lodges: { orderBy: { slot: "asc" } } },
      })
    : await getSession(sessionId);
  if (!session) {
    throw new PublicError(410, "Your booking session has expired. Please search again.");
  }
  if (existing) return { record: existing, session };

  if (
    session.lodges.length === 0 ||
    session.lodges.some((l) => !l.ratePlanId || !l.unitGroupCode)
  ) {
    throw new PublicError(400, "Choose a lodge for every part of your break.");
  }
  if (!session.guestFirstName || !session.guestLastName || !session.guestEmail) {
    throw new PublicError(400, "Guest details are missing.");
  }

  // The manifest names the whole party; Apaleo shows everyone but the lead
  // (already the primaryGuest) as additional guests on that lodge's
  // reservation. Rows without a last name stay local: Apaleo rejects them,
  // and the manifest card allows gaps.
  const manifest = await loadGuests(session.id);

  const { bookingId, reservationIds } = await createBooking({
    arrival: session.arrival,
    departure: session.departure,
    reservations: session.lodges.map((lodge) => ({
      adults: lodge.adults,
      childrenAges: parseChildrenAges(lodge),
      ratePlanId: lodge.ratePlanId!,
      // The location fee rides along as one more service, so Apaleo prices
      // it into the folio from birth like any extra.
      serviceIds: [
        ...parseExtras(lodge).map((e) => e.serviceId),
        ...(lodge.locationChoice === "unit" && lodge.locationServiceId
          ? [lodge.locationServiceId]
          : []),
      ],
      additionalGuests: manifest
        .filter((g) => g.slot === lodge.slot && !g.isLead && g.lastName)
        .map((g) => ({
          firstName: g.firstName ?? undefined,
          lastName: g.lastName!,
          email: g.email ?? undefined,
          birthDate: g.dateOfBirth ?? undefined,
        })),
    })),
    guest: {
      firstName: session.guestFirstName,
      lastName: session.guestLastName,
      email: session.guestEmail,
      phone: session.guestPhone ?? "",
    },
    vehiclePlate: session.vehiclePlate ?? undefined,
    idempotencyKey: `up-book-${session.id}`,
  });

  // Give every reservation its physical lodge while the folio can still
  // change: a dropped fee after the totals below are read would desync the
  // payment amount from the folio and wedge settlement.
  const assignments = await assignUnits(session, reservationIds);

  // One folio per reservation, read before the record exists so it is
  // born carrying the real total of every lodge.
  const folios: FolioSummary[] = [];
  for (const reservationId of reservationIds) {
    folios.push(await getFolioForReservation(reservationId));
  }
  const total = folios.reduce((sum, folio) => sum + Math.abs(folio.balance), 0);

  let record: RecordWithReservations;
  try {
    record = await prisma.bookingRecord.create({
      data: {
        sessionId: session.id,
        apaleoBookingId: bookingId,
        // Legacy mirror: slot 0's reservation and folio, for pages that
        // are not multi-lodge aware yet.
        apaleoReservationId: reservationIds[0],
        folioId: folios[0].folioId,
        totalGrossAmount: total,
        currency: folios[0].currency,
        // Ownership comes from the session row, never the cookie: a retry
        // can arrive logged-out and must still land under the account.
        userId: session.userId,
        reservations: {
          create: reservationIds.map((reservationId, slot) => ({
            slot,
            apaleoReservationId: reservationId,
            folioId: folios[slot].folioId,
            grossAmount: Math.abs(folios[slot].balance),
            currency: folios[slot].currency,
            assignedUnitId: assignments[slot].assignedUnitId,
            assignedUnitName: assignments[slot].assignedUnitName,
            locationFeeDropped: assignments[slot].locationFeeDropped,
          })),
        },
      },
      include: { reservations: { orderBy: { slot: "asc" } } },
    });
  } catch (err) {
    // Two tabs racing Buy now: the loser resumes the winner's record and
    // proceeds to payment instead of erroring.
    const raced =
      err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
        ? await prisma.bookingRecord.findUnique({
            where: { sessionId: session.id },
            include: { reservations: { orderBy: { slot: "asc" } } },
          })
        : null;
    if (!raced) throw err;
    record = raced;
  }

  // Stamp each lodge with its reservation, for manage and amend later. When
  // the fallback dropped a lodge's fee, clear it off the session too, so
  // every session-driven total (pay page after a failed payment, summaries)
  // matches the frozen record instead of resurrecting the removed fee. The
  // requested unit name stays: the confirmation's notice quotes it.
  for (const [slot, reservationId] of reservationIds.entries()) {
    await prisma.sessionLodge.updateMany({
      where: { sessionId: session.id, slot },
      data: {
        apaleoReservationId: reservationId,
        ...(assignments[slot].locationFeeDropped
          ? { locationFee: null, locationServiceId: null }
          : {}),
      },
    });
  }

  return { record, session };
}

type AssignmentOutcome = {
  assignedUnitId: string | null;
  assignedUnitName: string | null;
  locationFeeDropped: boolean;
};

/**
 * Give every reservation its physical lodge, honouring the location step.
 *
 * Two passes, specific choices first: a no-preference auto-assign must never
 * grab a unit a sibling lodge of this same break paid to pick (Apaleo cannot
 * know about a preference that is still only in our session).
 *
 * A specific choice Apaleo refuses as occupied (422: another guest's checkout
 * won the unit between selection and now) gets the Center Parcs fallback: a
 * comparable lodge in the same tier is auto-assigned and the location fee
 * service is removed from the folio, right here, before the folio totals are
 * read and frozen into the payment amount. Any other error (429 that outlived
 * its retries, 5xx) is rethrown: the attempt fails before the record exists
 * and a retry replays cleanly - a transient outage must not cost the guest a
 * pick they could have kept.
 *
 * Safe to re-run on a checkout retry: re-assigning the unit a reservation
 * already holds is a plain 200, and removing an already-removed service is
 * a 204 (both verified against the sandbox). One narrow non-goal: if a crash
 * lands between the fee removal and record creation AND the blocking guest
 * cancels inside that same window, a retry can win the unit with the fee
 * already gone - the guest is undercharged, never overcharged, so we accept
 * it rather than add an Apaleo read to every checkout.
 */
async function assignUnits(
  session: SessionForCheckout,
  reservationIds: string[],
): Promise<AssignmentOutcome[]> {
  const outcomes: AssignmentOutcome[] = new Array(reservationIds.length);

  // session.lodges is slot-ordered and reservations were created in that
  // order, so index N pairs lodge N with reservation N.
  const entries = [...reservationIds.entries()].map(([index, reservationId]) => ({
    index,
    reservationId,
    lodge: session.lodges[index],
  }));

  // Pass 1: everyone who paid to pick gets their unit (or the fallback).
  for (const { index, reservationId, lodge } of entries) {
    if (!(lodge.locationChoice === "unit" && lodge.locationUnitId)) continue;
    try {
      const unit = await assignSpecificUnit(reservationId, lodge.locationUnitId);
      outcomes[index] = {
        assignedUnitId: unit.id,
        assignedUnitName: unit.name,
        locationFeeDropped: false,
      };
    } catch (err) {
      // Only "unit occupied" triggers the fallback; everything else aborts
      // the attempt so a retry can keep the guest's choice.
      if (!(err instanceof ApaleoError && err.status === 422)) throw err;
      console.warn(
        "Chosen unit no longer assignable, applying fallback",
        JSON.stringify({ reservationId, unitId: lodge.locationUnitId }),
      );
      // Money first: the fee leaves the folio before anything else. If this
      // throws, the whole attempt fails BEFORE the record exists and a retry
      // replays cleanly - better than charging for a lost choice.
      if (lodge.locationServiceId) {
        await removeReservationService(reservationId, lodge.locationServiceId);
      }
      const fallback = await autoAssignSafely(reservationId);
      outcomes[index] = {
        assignedUnitId: fallback?.id ?? null,
        assignedUnitName: fallback?.name ?? null,
        locationFeeDropped: true,
      };
    }
  }

  // Pass 2: no-preference lodges take whatever is left, so the confirmation
  // can greet everyone with a real lodge number.
  for (const { index, reservationId, lodge } of entries) {
    if (lodge.locationChoice === "unit" && lodge.locationUnitId) continue;
    const unit = await autoAssignSafely(reservationId);
    outcomes[index] = {
      assignedUnitId: unit?.id ?? null,
      assignedUnitName: unit?.name ?? null,
      locationFeeDropped: false,
    };
  }

  return outcomes;
}

/**
 * Auto-assignment is a nicety, never worth failing a checkout over: with no
 * unit assigned, Apaleo simply picks one at check-in.
 */
async function autoAssignSafely(reservationId: string): Promise<UnitOption | null> {
  try {
    return await autoAssignUnit(reservationId);
  } catch (err) {
    if (!(err instanceof ApaleoError)) throw err;
    console.warn(
      "Auto-assign failed, leaving the unit for check-in",
      JSON.stringify({ reservationId, status: err.status }),
    );
    return null;
  }
}

/**
 * Steps 2+3 (recording): settle every reservation still owing, one folio at
 * a time. Already-paid children are skipped, so a retry never double-pays.
 * `pesapalTrackingId` rides the folio receipt so Apaleo's books point back
 * at the Pesapal order; null means the demo's simulated payment.
 *
 * `collectedTotal` is what Pesapal actually collected (null for simulated).
 * Folios can drift while an order sits unpaid - the window is however long
 * the guest dwells on the hosted page - so before recording anything we
 * check that what the folios ask for is still what the money covers.
 */
async function settleBooking(
  record: RecordWithReservations,
  session: { id: string; userId: string | null },
  pesapalTrackingId: string | null,
  collectedTotal: number | null,
): Promise<BookingRecord> {
  const folioByChild = new Map<string, FolioSummary>();
  if (collectedTotal != null) {
    let owedTotal = 0;
    for (const child of record.reservations) {
      if (child.paidAt) {
        // Already recorded on an earlier pass; it consumed its share.
        owedTotal += child.grossAmount;
        continue;
      }
      const folio = await getFolioForReservation(child.apaleoReservationId);
      folioByChild.set(child.id, folio);
      owedTotal += Math.abs(folio.balance);
    }
    if (Math.abs(owedTotal - collectedTotal) >= 0.01) {
      console.error(
        "Folio total no longer matches collected payment",
        JSON.stringify({ recordId: record.id, owedTotal, collectedTotal, pesapalTrackingId }),
      );
      throw new PublicError(
        502,
        "Your booking changed while the payment was in progress. Please contact us - do not pay again.",
      );
    }
  }

  for (const child of record.reservations) {
    if (child.paidAt) continue;

    const folio =
      folioByChild.get(child.id) ?? (await getFolioForReservation(child.apaleoReservationId));
    const owed = Math.abs(folio.balance);

    // owed is 0 if a previous attempt paid this folio but crashed before
    // the child update - then we just record the paid state.
    let paymentId: string | null = child.paymentId;
    if (owed > 0) {
      try {
        const payment = await payFolio({
          folioId: folio.folioId,
          amount: owed,
          currency: folio.currency,
          receipt: pesapalTrackingId
            ? `PSP-${pesapalTrackingId}`
            : `UP-${record.apaleoBookingId}-${child.slot + 1}`,
          idempotencyKey: `up-pay-${session.id}-${child.slot}`,
        });
        paymentId = payment.paymentId;
      } catch (err) {
        // A payment-stage Apaleo rejection is NOT a sold-out race - the
        // reservations are held. Tell the guest to simply retry; the loop
        // resumes from this child.
        if (err instanceof ApaleoError) {
          console.error("Folio payment failed", err.status, JSON.stringify(err.body)?.slice(0, 600));
          throw new PublicError(
            502,
            "Your lodge is reserved, but recording the payment failed. Press Buy now again to finish.",
          );
        }
        throw err;
      }
    }
    await prisma.bookingReservation.update({
      where: { id: child.id },
      // paymentId only when we have one: a racing settle (callback vs IPN)
      // that lost the payFolio to its twin must not blank the winner's id
      // with its own stale null.
      data: { paidAt: new Date(), paymentId: paymentId ?? undefined, folioId: folio.folioId },
    });
  }

  // Legacy mirror for the record-level payment column: slot 0's payment.
  const slotZero = await prisma.bookingReservation.findUnique({
    where: { recordId_slot: { recordId: record.id, slot: 0 } },
  });

  const paid = await prisma.bookingRecord.update({
    where: { id: record.id },
    data: {
      status: "paid",
      paidAt: new Date(),
      paymentId: slotZero?.paymentId ?? record.paymentId,
      // A record created on an earlier attempt (before the guest signed in
      // mid-funnel) picks the stamp up here; a paid record never re-enters.
      // undefined (not null) when both are empty: never overwrite a claim
      // adoption that landed on the row while this checkout was running.
      userId: record.userId ?? session.userId ?? undefined,
    },
  });

  await prisma.bookingSession.update({
    where: { id: session.id },
    data: { state: "completed" },
  });

  // Confirmation email, once per booking (the module owns the once-only
  // claim and swallows every failure - email never disturbs a paid booking).
  await sendBookingConfirmation(paid.id);

  return paid;
}
