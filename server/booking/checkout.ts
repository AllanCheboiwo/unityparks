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
import { getSession, parseChildrenAges, parseExtras, parseVehiclePlates } from "./session";
import { loadGuests } from "./guests";
import { sendBookingConfirmation } from "../email/bookingConfirmation";
import { sendBalanceReceipt } from "../email/balanceReceipt";
import {
  balanceDueDateFor,
  daysBetween,
  depositAmountFor,
  isDepositEligible,
} from "@/lib/paymentPlan";

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
 * What gets collected is the guest's choice when arrival is far enough out:
 * the 30% deposit or the full amount (lib/paymentPlan owns the numbers).
 * Later balance payments arrive through runPaymentAttempt from the Manage
 * endpoint; every payment, simulated included, is one PesapalTransaction
 * row, and settlePayment records it on the folios.
 *
 * With the simulated provider collect-and-record happen in this one call,
 * exactly as the demo always has. With Pesapal this call ends at a redirect
 * to their payment page; confirmPesapalPayment() picks up the rest when the
 * guest (or the IPN) comes back. Re-entry is the same entry point: Buy now
 * again resumes wherever the last attempt stopped - a collected-but-
 * unrecorded payment settles, a pending order re-offers the same payment
 * page, a failed one gets a fresh order. Reservations are never re-created
 * (per session idempotency key) and folios are never re-paid (per
 * transaction-and-slot keys).
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
export async function beginCheckout(
  sessionId: string,
  paymentChoice: "deposit" | "full" = "full",
): Promise<CheckoutOutcome> {
  const provider = paymentsProvider();
  // A forced PAYMENTS_PROVIDER=pesapal can bypass the presence checks, so
  // fail the config error here, BEFORE a reservation is created for nothing.
  const ipnId = process.env.PESAPAL_IPN_ID;
  if (provider === "pesapal" && !ipnId) {
    throw new Error("PESAPAL_IPN_ID is not set. Run: node scripts/register-pesapal-ipn.mjs");
  }

  const { record, session } = await ensureRecord(sessionId);
  // deposit_paid means the Buy-now moment already happened: the booking is
  // confirmed and top-ups go through the Manage endpoint, so checkout's only
  // job is to hand the guest their confirmation.
  if (record.status === "paid" || record.status === "deposit_paid") {
    return { kind: "paid", record };
  }
  // A cancelled booking must never mint a fresh payment order. Without this
  // a stale pay-page tab (or a bookmarked payment=failed retry) would resume
  // the cancelled record, collect real money, and land it as excess for a
  // manual refund while showing the guest a confirmation for a dead break.
  // The /pay route already gates on status; Buy now must too.
  if (record.status === "cancelled") {
    throw new PublicError(409, "This break was cancelled and can't be paid for. Start a new search to book again.");
  }

  // The deposit option only exists while the balance due date is still
  // ahead (57+ days out). The UI hides it otherwise; this recheck is belt
  // and braces against a hand-built request.
  const today = new Date().toISOString().slice(0, 10);
  const depositWanted =
    paymentChoice === "deposit" && isDepositEligible(daysBetween(today, session.arrival));
  const amount = depositWanted
    ? (record.depositAmount ?? depositAmountFor(record.totalGrossAmount))
    : record.totalGrossAmount;

  return runPaymentAttempt({ record, session, kind: "checkout", amount, ipnId: ipnId ?? null });
}

/** What a payment attempt needs from the session row. The full
 *  BookingSession satisfies this; the Manage endpoint loads it by
 *  record.sessionId. */
export type PaymentSession = {
  id: string;
  userId: string | null;
  arrival: string;
  departure: string;
  guestFirstName: string | null;
  guestLastName: string | null;
  guestEmail: string | null;
  guestPhone: string | null;
};

/**
 * One payment attempt for one amount, checkout and balance payments alike.
 * Resumes before it collects: money already collected but unrecorded is
 * settled first (never collect twice), an open order for the SAME amount is
 * re-offered (keeps retries off the shared sandbox merchant's rate limits),
 * and an open order for a DIFFERENT amount is superseded - the guest
 * changed their mind about what to pay, and re-offering the stale page
 * would collect the wrong number. If they pay the superseded page anyway,
 * the excess/wedge machinery records it loudly instead of corrupting folios.
 */
export async function runPaymentAttempt(params: {
  record: RecordWithReservations;
  session: PaymentSession;
  kind: "checkout" | "balance";
  amount: number;
  ipnId: string | null;
}): Promise<CheckoutOutcome> {
  const { record, session, amount } = params;

  const transactions = await prisma.pesapalTransaction.findMany({
    where: { recordId: record.id },
    orderBy: { createdAt: "desc" },
  });

  // A mismatch row means Pesapal reported collecting something other than
  // what we asked for. Folios stay untouched and payments stay closed until
  // a human resolves it - a fresh order on top would only bury the problem.
  if (transactions.some((t) => t.status === "mismatch")) {
    throw new PublicError(
      502,
      "The payment we received doesn't match your booking total. Please contact us before paying again.",
    );
  }

  // Finish any attempt where money was already collected but a crash stopped
  // the folio recording - never send that guest to pay again. Only a LIVE
  // completed row is that (liveForRecordId still set): settled transactions
  // keep status "completed" forever but are retired, and matching one here
  // would silently no-op every later balance payment.
  const collected = transactions.find(
    (t) => t.status === "completed" && t.liveForRecordId !== null,
  );
  if (collected) {
    const paid = await settlePayment(record, session, collected);
    return { kind: "paid", record: paid };
  }

  // A live order may already be out there: ask Pesapal what happened to it.
  const open = transactions.find((t) => t.status === "pending" && t.orderTrackingId);
  if (open) {
    const status = await getOrderStatus(open.orderTrackingId!);
    if (status.outcome === "completed") {
      // false means the money landed on a retired order and was recorded
      // as excess: fall through and mint a fresh attempt for this request.
      if (await confirmCollected(open, status)) {
        const paid = await settlePayment(record, session, open);
        return { kind: "paid", record: paid };
      }
    }
    if (
      status.outcome === "pending" &&
      open.redirectUrl &&
      Math.abs(open.amount - amount) < 0.01
    ) {
      // Still waiting on the guest: same order, same payment page.
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

  return submitFreshAttempt(params);
}

/**
 * Create the one live attempt and collect on it: hand it to Pesapal for a
 * real order, or (simulated provider) mark the money collected on the spot
 * and settle immediately. The unique liveForRecordId column is the lock:
 * when two requests race here, exactly one row wins and the loser resolves
 * against the winner instead of minting a second payable order. Retired
 * attempts (failed, superseded) have the column cleared, so they never
 * block a legitimate retry.
 */
async function submitFreshAttempt(params: {
  record: RecordWithReservations;
  session: PaymentSession;
  kind: "checkout" | "balance";
  amount: number;
  ipnId: string | null;
}): Promise<CheckoutOutcome> {
  const { record, session, kind, amount } = params;
  const simulated = paymentsProvider() === "simulated";
  // beginCheckout guards this before creating a reservation; this covers
  // the balance-payment path, where the reservation long exists.
  if (!simulated && !params.ipnId) {
    throw new Error("PESAPAL_IPN_ID is not set. Run: node scripts/register-pesapal-ipn.mjs");
  }

  let transaction: PesapalTransaction | null = null;
  for (let attempt = 0; attempt < 2 && !transaction; attempt++) {
    try {
      transaction = await prisma.pesapalTransaction.create({
        data: {
          recordId: record.id,
          amount,
          currency: record.currency,
          kind,
          liveForRecordId: record.id,
          // Simulated money is "collected" the moment the row exists, so a
          // crash before settle resumes through the same collected-but-
          // unrecorded path a real payment would.
          ...(simulated ? { status: "completed", paymentMethod: "Simulated" } : {}),
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
        // The racing attempt already collected money on the winner: record it.
        const paid = await settlePayment(record, session, winner);
        return { kind: "paid", record: paid };
      }
      if (winner.redirectUrl) {
        // The winner's order is live. Join it only when it collects the same
        // amount this request wants: joining a KES 500 page when this guest
        // asked to pay the full balance would collect the wrong number with
        // their consent. On a mismatch, wait rather than mislead.
        if (Math.abs(winner.amount - amount) < 0.01) {
          return { kind: "redirect", redirectUrl: winner.redirectUrl };
        }
        throw new PublicError(
          409,
          "We're already setting up a payment for this booking. Give it a moment, then try again.",
        );
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
      // back for it. Retire it and take its place - but GUARDED: if the
      // winner's own submitOrder just landed and stamped a redirectUrl (its
      // guarded stamp requires status still pending), this update misses and
      // we loop to re-read and join that now-live page, instead of blindly
      // superseding a page already handed to a guest and minting a second.
      const retired = await prisma.pesapalTransaction.updateMany({
        where: { id: winner.id, status: "pending", redirectUrl: null },
        data: { status: "superseded", liveForRecordId: null },
      });
      if (retired.count === 0) continue;
    }
  }
  if (!transaction) {
    throw new PublicError(
      409,
      "We're already setting up your payment. Give it a moment, then press the button again.",
    );
  }

  if (simulated) {
    const paid = await settlePayment(record, session, transaction);
    return { kind: "paid", record: paid };
  }

  const order = await submitOrder({
    merchantReference: transaction.id,
    amount: transaction.amount,
    currency: transaction.currency,
    description:
      kind === "balance"
        ? `Unity Parks balance payment, break ${session.arrival} to ${session.departure}`
        : `Unity Parks break ${session.arrival} to ${session.departure}`,
    callbackUrl: `${appBaseUrl()}/api/payments/pesapal/callback`,
    notificationId: params.ipnId!,
    billing: {
      firstName: session.guestFirstName!,
      lastName: session.guestLastName!,
      email: session.guestEmail!,
      phone: session.guestPhone ?? undefined,
    },
  });
  // Guarded stamp: if this row was superseded while submitOrder crawled
  // through sandbox rate-limit retries (a racing request decided nobody was
  // coming back for it), its payment page must never reach the guest - two
  // payable pages for one booking is exactly what the serializer forbids.
  // The tracking id is still recorded so a late payment on the dead order
  // resolves through the excess machinery instead of "unknown reference".
  const stamped = await prisma.pesapalTransaction.updateMany({
    where: { id: transaction.id, status: "pending" },
    data: { orderTrackingId: order.orderTrackingId, redirectUrl: order.redirectUrl },
  });
  if (stamped.count === 0) {
    await prisma.pesapalTransaction.updateMany({
      where: { id: transaction.id, orderTrackingId: null },
      data: { orderTrackingId: order.orderTrackingId },
    });
    throw new PublicError(
      409,
      "We're already setting up your payment. Give it a moment, then press the button again.",
    );
  }

  return { kind: "redirect", redirectUrl: order.redirectUrl };
}

export type PesapalConfirmation = {
  outcome: "completed" | "pending" | "failed";
  record: BookingRecord;
  /** "checkout" or "balance": the callback routes the guest by this. */
  kind: string;
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
  if (transaction.status === "mismatch") {
    return { outcome: "failed", record, kind: transaction.kind };
  }

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

  // Money already confirmed collected on an earlier pass: finish the folio
  // recording - but only for a LIVE row. A retired completed row (settled,
  // liveForRecordId cleared) is a done deal being revisited by an IPN retry
  // or a reloaded callback URL; re-settling it would run outside the
  // one-live-attempt serializer and fight a genuinely live settle.
  if (transaction.status === "completed") {
    if (transaction.liveForRecordId === null) {
      return { outcome: "completed", record, kind: transaction.kind };
    }
    const paid = await settlePayment(record, session, transaction);
    return { outcome: "completed", record: paid, kind: transaction.kind };
  }

  const status = await getOrderStatus(orderTrackingId);
  if (status.outcome === "completed") {
    if (!(await confirmCollected(transaction, status))) {
      // Money was paid onto a RETIRED order (superseded page paid late).
      // It is recorded as excess for a human; the booking is untouched.
      return { outcome: "failed", record, kind: transaction.kind };
    }
    const paid = await settlePayment(record, session, transaction);
    return { outcome: "completed", record: paid, kind: transaction.kind };
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
    return { outcome: "failed", record, kind: transaction.kind };
  }
  return { outcome: "pending", record, kind: transaction.kind };
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
    return { outcome: "completed", record, kind: transaction.kind };
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
  return { outcome: "completed", record, kind: transaction.kind };
}

/**
 * Flip a transaction to "collected" after OUR status read said COMPLETED.
 * Refuses to record a payment that doesn't match what we asked Pesapal to
 * collect - that mismatch means a bug or tampering, and folios stay clean
 * until a human looks. Returns false when the money landed on a RETIRED
 * order (recorded as excess); only a true return may proceed to settle.
 */
async function confirmCollected(
  transaction: PesapalTransaction,
  status: { amount: number; currency: string | null; confirmationCode: string | null; paymentMethod: string | null },
): Promise<boolean> {
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
  // Guarded flip: only a pending (or already-completed, for an idempotent
  // re-entry) row may become collected money. A row retired as superseded or
  // failed that later reports COMPLETED is a guest paying a dead payment
  // page - that money is excess for a human, never ordinary revenue. The
  // old backstop (confirmAgainstPaidRecord) only covers fully paid records,
  // which deposit bookings are not for weeks.
  const flipped = await prisma.pesapalTransaction.updateMany({
    where: { id: transaction.id, status: { in: ["pending", "completed"] } },
    data: {
      status: "completed",
      confirmationCode: status.confirmationCode,
      paymentMethod: status.paymentMethod,
    },
  });
  if (flipped.count === 1) return true;

  console.error(
    "Pesapal payment COMPLETED on a retired order",
    JSON.stringify({
      transactionId: transaction.id,
      recordId: transaction.recordId,
      amount: status.amount,
      confirmationCode: status.confirmationCode,
    }),
  );
  await prisma.pesapalTransaction.updateMany({
    where: { id: transaction.id, status: { in: ["superseded", "failed"] } },
    data: {
      status: "excess",
      confirmationCode: status.confirmationCode,
      paymentMethod: status.paymentMethod,
      liveForRecordId: null,
    },
  });
  return false;
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
      // The location fee rides along as one more service (count 1), so Apaleo
      // prices it into the folio from birth like any extra. Each extra carries
      // the guest's chosen quantity so Apaleo books that many.
      services: [
        ...parseExtras(lodge).map((e) => ({ serviceId: e.serviceId, count: e.count })),
        ...(lodge.locationChoice === "unit" && lodge.locationServiceId
          ? [{ serviceId: lodge.locationServiceId, count: 1 }]
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
    vehiclePlates: parseVehiclePlates(session),
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
        // The payment plan, stamped for every booking whether or not the
        // guest uses the deposit option: the cancellation policy withholds
        // this deposit at every tier, so it must exist on the record.
        depositAmount: depositAmountFor(total),
        balanceDueDate: balanceDueDateFor(session.arrival),
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
 * The recording step: settle one collected payment (a deposit, a balance
 * top-up, or payment in full) onto the reservation folios, then derive the
 * booking's paid state from what the folios now hold.
 *
 * Replay-safe by construction: any step can crash and the whole function
 * simply runs again, because
 *   - the split is computed from OUR bookkeeping (grossAmount minus
 *     paidAmount), which only changes inside the single DB transaction at
 *     the end, so every replay computes the identical split. Never split on
 *     live folio balances: a crash between two posts would change the basis
 *     on replay and re-split money that was already posted;
 *   - each folio post carries an idempotency key pinned to this transaction
 *     and slot, so Apaleo records each share exactly once;
 *   - paid state is then derived from folio balances, never incremented, so
 *     however many times this runs it converges on the same truth;
 *   - every decision runs on a FRESH record read, never the caller's
 *     snapshot, and the final status write refuses to touch a record that
 *     went cancelled mid-flight - a stale basis is how money gets
 *     double-posted and how a cancelled booking gets resurrected.
 */
async function settlePayment(
  callerRecord: RecordWithReservations,
  session: PaymentSession,
  callerTransaction: PesapalTransaction,
): Promise<BookingRecord> {
  const record =
    (await prisma.bookingRecord.findUnique({
      where: { id: callerRecord.id },
      include: { reservations: { orderBy: { slot: "asc" } } },
    })) ?? callerRecord;

  // Re-read the TRANSACTION fresh too, not just the record. The caller took
  // its snapshot before a getOrderStatus network call, so a twin settle
  // (callback vs IPN, or a Buy-now retry) can retire this very row inside
  // that window. A retired row (completed, liveForRecordId cleared) already
  // settled - proceeding would recompute against the moved basis and, worse,
  // the nothing-owed branch below would relabel the booking's own legitimate
  // payment as "excess". Treat it as the done deal it is.
  const transaction =
    (await prisma.pesapalTransaction.findUnique({ where: { id: callerTransaction.id } })) ??
    callerTransaction;
  if (transaction.status === "completed" && transaction.liveForRecordId === null) {
    return record;
  }

  // Money landing on a cancelled booking is a reconciliation case, never a
  // resurrection: record it loudly for a human, touch nothing. The
  // liveForRecordId guard keeps this from firing on a row a twin already
  // retired (that row's money is legitimately on the folios).
  if (record.status === "cancelled") {
    console.error(
      "Payment collected for a CANCELLED booking",
      JSON.stringify({
        transactionId: transaction.id,
        recordId: record.id,
        amount: transaction.amount,
      }),
    );
    await prisma.pesapalTransaction.updateMany({
      where: { id: transaction.id, status: "completed", liveForRecordId: { not: null } },
      data: { status: "excess", liveForRecordId: null },
    });
    return record;
  }

  // Legacy single-lodge records carry no child rows; mirror the shape from
  // the record columns so the loop stays the same, and write the outcome
  // back to the record only (there is no child row to update).
  const synthetic = record.reservations.length === 0;
  const children = (
    synthetic
      ? [
          {
            id: null as string | null,
            slot: 0,
            apaleoReservationId: record.apaleoReservationId,
            grossAmount: record.totalGrossAmount,
            paidAmount: record.paidAmount,
            paymentId: record.paymentId,
            paidAt: record.paidAt,
          },
        ]
      : record.reservations
  ).map((c) => ({
    id: "id" in c ? c.id : null,
    slot: c.slot,
    apaleoReservationId: c.apaleoReservationId,
    grossAmount: c.grossAmount,
    // Children from before the deposit feature store paidAmount 0 while
    // being fully settled; their paidAt stamp is the signal. Without this
    // fallback a legacy crashed settle would re-post a settled folio.
    paidAmount: c.paidAmount > 0 ? c.paidAmount : c.paidAt ? c.grossAmount : 0,
    paymentId: c.paymentId,
  }));

  // The split basis: what our own books say each folio still needs.
  const remaining = children.map((c) => Math.max(0, c.grossAmount - c.paidAmount));
  const totalRemaining = remaining.reduce((a, b) => a + b, 0);

  // Nothing owed: this payment arrived for an already-settled booking (a
  // double-click whose twin won, a stale order paid late). Posting it would
  // overpay the folios, so record it as excess for a human instead.
  if (totalRemaining <= 0.01) {
    console.error(
      "Payment collected with nothing outstanding",
      JSON.stringify({
        recordId: record.id,
        transactionId: transaction.id,
        amount: transaction.amount,
        paymentMethod: transaction.paymentMethod,
      }),
    );
    // liveForRecordId guard: only a still-live transaction is genuine excess
    // (a fresh double-click twin, a stale order paid late). A row already
    // retired here means a twin settled it and this is the same money on the
    // folios - flipping it to excess would invite a refund of real revenue.
    await prisma.pesapalTransaction.updateMany({
      where: { id: transaction.id, status: "completed", liveForRecordId: { not: null } },
      data: { status: "excess", liveForRecordId: null },
    });
    return record;
  }

  if (transaction.amount > totalRemaining + 0.01) {
    console.error(
      "Collected payment exceeds outstanding balance",
      JSON.stringify({
        recordId: record.id,
        transactionId: transaction.id,
        amount: transaction.amount,
        totalRemaining,
      }),
    );
    throw new PublicError(
      502,
      "Your booking changed while the payment was in progress. Please contact us - do not pay again.",
    );
  }

  // Deterministic shares: every owing child but the last takes its rounded
  // pro-rata slice, the last takes the exact remainder, so the shares sum
  // to the collected amount on every replay. Each share is clamped to what
  // the folio actually owes: a rounding overshoot would push the folio into
  // credit, which Math.abs() later misreads as a debit and wedges the
  // booking. (In the whole-KES sandbox no rounding or clamping ever bites;
  // this is defense for the day a rate carries cents.)
  const owing = children.map((_, i) => i).filter((i) => remaining[i] > 0.01);
  const shares = new Array<number>(children.length).fill(0);
  let allocated = 0;
  for (const [pos, i] of owing.entries()) {
    const raw =
      pos === owing.length - 1
        ? transaction.amount - allocated
        : Math.round((transaction.amount * remaining[i]) / totalRemaining);
    shares[i] = Math.min(raw, remaining[i]);
    allocated += shares[i];
  }

  // Folio sanity check before any money moves. Two readings are legitimate:
  // the untouched balance (this share not yet posted) and the post-crash
  // balance (this share posted by an earlier run of this same settle).
  // Anything else means something touched a folio behind our back, and the
  // folios stay clean until a human looks. A folio already showing the
  // post is remembered so the loop below does NOT post it again: Apaleo
  // dedupes by idempotency key for only 24h, so a resume a day later would
  // otherwise double-post - the folio reading, not the key, is the durable
  // guard.
  const folios = new Map<number, FolioSummary>();
  const alreadyDone = new Set<number>();
  for (const i of owing) {
    const folio = await getFolioForReservation(children[i].apaleoReservationId);
    const balance = Math.abs(folio.balance);
    const untouched = Math.abs(balance - remaining[i]) < 0.01;
    const alreadyPosted = Math.abs(balance - (remaining[i] - shares[i])) < 0.01;
    if (!untouched && !alreadyPosted) {
      console.error(
        "Folio drifted from local bookkeeping",
        JSON.stringify({
          recordId: record.id,
          transactionId: transaction.id,
          slot: children[i].slot,
          folioBalance: balance,
          remaining: remaining[i],
          share: shares[i],
        }),
      );
      throw new PublicError(
        502,
        "Your booking changed while the payment was in progress. Please contact us - do not pay again.",
      );
    }
    // alreadyPosted and untouched only coincide when the share is 0 (nothing
    // to post either way); when they differ, alreadyPosted means a crashed
    // run of THIS settle already put this share on the folio.
    if (alreadyPosted && !untouched) alreadyDone.add(i);
    folios.set(i, folio);
  }

  // Post every share not already on its folio. The idempotency key pins each
  // share to this transaction and slot; the alreadyDone skip is the durable
  // backstop for replays beyond Apaleo's 24h key window.
  for (const i of owing) {
    if (shares[i] <= 0 || alreadyDone.has(i)) continue;
    const child = children[i];
    const folio = folios.get(i)!;
    try {
      const payment = await payFolio({
        folioId: folio.folioId,
        amount: shares[i],
        currency: folio.currency,
        receipt: transaction.orderTrackingId
          ? `PSP-${transaction.orderTrackingId}`
          : `SIM-${transaction.id}`,
        idempotencyKey: `up-pay-${transaction.id}-${child.slot}`,
      });
      child.paymentId = payment.paymentId;
    } catch (err) {
      // A payment-stage Apaleo rejection is NOT a sold-out race - the
      // reservations are held. Tell the guest to simply retry; the resume
      // path picks up from the collected transaction.
      if (err instanceof ApaleoError) {
        console.error("Folio payment failed", err.status, JSON.stringify(err.body)?.slice(0, 600));
        throw new PublicError(
          502,
          transaction.kind === "balance"
            ? "Your payment was received but recording it failed. Try again from Manage my booking - you will not be charged twice."
            : "Your lodge is reserved, but recording the payment failed. Press Buy now again to finish.",
        );
      }
      throw err;
    }
  }

  // Derive the paid state from what the folios now hold, then apply every
  // DB write in ONE transaction. Atomicity is what keeps the split basis
  // honest: a crash before this block leaves the basis untouched (the
  // replay recomputes the identical shares), a crash after leaves
  // everything consistent. Partial child updates would poison the basis.
  const updates: { childId: string; paidAmount: number; paymentId: string | null; settled: boolean; folioId: string }[] = [];
  for (const i of owing) {
    if (shares[i] <= 0) continue;
    const child = children[i];
    const folio = await getFolioForReservation(child.apaleoReservationId);
    const balance = Math.abs(folio.balance);
    child.paidAmount = child.grossAmount - balance;
    if (child.id) {
      updates.push({
        childId: child.id,
        paidAmount: child.paidAmount,
        paymentId: child.paymentId,
        settled: balance < 0.01,
        folioId: folio.folioId,
      });
    }
  }

  const paidTotal = children.reduce((sum, c) => sum + c.paidAmount, 0);
  const fullyPaid = record.totalGrossAmount - paidTotal <= 0.01;

  const paid = await prisma.$transaction(async (tx) => {
    // Guarded, not blind: a cancel that committed while the folio posts
    // were in flight must win. Everywhere else in this file uses the same
    // guarded-updateMany shape; the status write is the one place a miss
    // would resurrect a cancelled booking as "paid".
    const flipped = await tx.bookingRecord.updateMany({
      where: { id: record.id, status: { notIn: ["cancelled"] } },
      data: {
        paidAmount: paidTotal,
        status: fullyPaid ? "paid" : "deposit_paid",
        ...(fullyPaid ? { paidAt: new Date() } : {}),
        // Legacy mirror for the record-level payment column: slot 0's payment.
        paymentId: children.find((c) => c.slot === 0)?.paymentId ?? record.paymentId ?? undefined,
        // A record created on an earlier attempt (before the guest signed in
        // mid-funnel) picks the stamp up here. undefined (not null) when both
        // are empty: never overwrite a claim adoption that landed on the row
        // while this payment was running.
        userId: record.userId ?? session.userId ?? undefined,
      },
    });
    if (flipped.count === 0) {
      // The booking went cancelled mid-settle. The folio money is real but
      // the booking must stay cancelled: mark the transaction excess for a
      // human and leave the record alone.
      await tx.pesapalTransaction.updateMany({
        where: { id: transaction.id, status: "completed" },
        data: { status: "excess", liveForRecordId: null },
      });
      return null;
    }
    for (const u of updates) {
      await tx.bookingReservation.update({
        where: { id: u.childId },
        // paymentId only when we have one: a racing settle (callback vs IPN)
        // that lost the payFolio to its twin must not blank the winner's id
        // with its own stale null.
        data: {
          paidAmount: u.paidAmount,
          paymentId: u.paymentId ?? undefined,
          folioId: u.folioId,
          ...(u.settled ? { paidAt: new Date() } : {}),
        },
      });
    }
    // The settled transaction stops being the one live attempt. Without
    // this it would block the guest's first balance payment forever (the
    // unique liveForRecordId column allows one live attempt per record).
    await tx.pesapalTransaction.update({
      where: { id: transaction.id },
      data: { liveForRecordId: null },
    });
    return tx.bookingRecord.findUniqueOrThrow({ where: { id: record.id } });
  });

  if (!paid) {
    console.error(
      "Payment collected for a booking cancelled MID-SETTLE",
      JSON.stringify({
        transactionId: transaction.id,
        recordId: record.id,
        amount: transaction.amount,
      }),
    );
    return prisma.bookingRecord.findUniqueOrThrow({ where: { id: record.id } });
  }

  if (transaction.kind === "checkout") {
    await prisma.bookingSession.update({
      where: { id: session.id },
      data: { state: "completed" },
    });
    // Confirmation email, once per booking (the module owns the once-only
    // claim and swallows every failure - email never disturbs a payment).
    await sendBookingConfirmation(paid.id);
  } else {
    await sendBalanceReceipt(transaction.id);
  }

  return paid;
}
