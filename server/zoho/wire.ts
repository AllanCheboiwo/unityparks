import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { getFolioDetails } from "../apaleo/bookings";
import { raiseOpsAlert } from "../ops/alerts";
import { createZohoBooksApi, createZohoClient } from "./client";
import {
  drainExports,
  queueZohoExportAfterSettle,
  type BookingReader,
  type ExportDeps,
  type ExportRow,
  type ExportStore,
} from "./export";

/**
 * Production assembly of the export module's injected deps (UNP-5): the
 * Prisma-backed outbox store, the env-configured Zoho client, and the
 * booking reader that pulls folios fresh from Apaleo. The module itself
 * never touches env or Prisma; everything meets here.
 */

const store: ExportStore = {
  async insert(input) {
    try {
      await prisma.zohoExport.create({ data: input });
      return "inserted";
    } catch (err) {
      // The unique trackingId IS the duplicate-confirmation guard; a
      // constraint hit is the designed no-op, not an error.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return "duplicate";
      }
      throw err;
    }
  },

  async listOpen() {
    const rows = await prisma.zohoExport.findMany({
      where: { status: { not: "done" } },
      orderBy: { createdAt: "asc" },
    });
    return rows as ExportRow[];
  },

  async claim(id, fromStatus, seenUpdatedAt) {
    // The conditional flip that lets overlapping drains coexist. The
    // updatedAt predicate is load-bearing for stale reclaims: the winner's
    // write bumps @updatedAt, so a racing reclaimer's snapshot no longer
    // matches and it loses, exactly like a status mismatch. @updatedAt
    // also restarts the stale clock for the new owner.
    const result = await prisma.zohoExport.updateMany({
      where: { id, status: fromStatus, updatedAt: seenUpdatedAt },
      data: { status: "pushing" },
    });
    return result.count === 1;
  },

  async update(id, fields) {
    await prisma.zohoExport.update({ where: { id }, data: fields });
  },

  async doneInvoiceIdForBooking(bookingId) {
    const row = await prisma.zohoExport.findFirst({
      where: { bookingId, status: "done", zohoInvoiceId: { not: null } },
    });
    return row?.zohoInvoiceId ?? null;
  },
};

const readBooking: BookingReader = async ({ bookingId, trackingId }) => {
  const record = await prisma.bookingRecord.findUnique({
    where: { id: bookingId },
    include: { reservations: { orderBy: { slot: "asc" } } },
  });
  if (!record) throw new Error(`No booking record ${bookingId}`);

  const transaction = await prisma.pesapalTransaction.findUnique({
    where: { orderTrackingId: trackingId },
  });
  if (!transaction) throw new Error(`No Pesapal transaction for tracking id ${trackingId}`);

  // The export row's createdAt is the confirmation moment, and unlike the
  // transaction's updatedAt it never moves again: the payment date in the
  // books stays stable across retries.
  const exportRow = await prisma.zohoExport.findUnique({ where: { trackingId } });

  // Legacy single-lodge records carry no child rows; same synthetic shape
  // as settlePayment uses.
  const children =
    record.reservations.length > 0
      ? record.reservations
      : [{ slot: 0, apaleoReservationId: record.apaleoReservationId }];

  const folios = [];
  for (const child of children) {
    const details = await getFolioDetails(child.apaleoReservationId);
    folios.push({
      slot: child.slot,
      currency: details.currency,
      charges: details.charges,
      allowances: details.allowances,
    });
  }

  return {
    bookingReference: record.apaleoBookingId,
    folios,
    payment: {
      amount: transaction.amount,
      paidAtIso: (exportRow?.createdAt ?? transaction.updatedAt).toISOString(),
    },
  };
};

/** Throws on missing env; callers on the payment path must catch. */
export function zohoDeps(): ExportDeps {
  const clientId = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;
  const refreshToken = process.env.ZOHO_REFRESH_TOKEN;
  const orgId = process.env.ZOHO_ORG_ID;
  const customerId = process.env.ZOHO_CUSTOMER_ID;
  if (!clientId || !clientSecret || !refreshToken || !orgId || !customerId) {
    throw new Error(
      "Missing Zoho env (ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_REFRESH_TOKEN / " +
        "ZOHO_ORG_ID / ZOHO_CUSTOMER_ID). Run scripts/setup-zoho.mjs for the customer id.",
    );
  }
  const zoho = createZohoBooksApi(
    createZohoClient({ clientId, clientSecret, refreshToken, orgId }),
  );
  return {
    store,
    zoho,
    readBooking,
    customerId,
    now: () => new Date(),
    // The durable escalation channel the rest of ops already watches;
    // raiseOpsAlert swallows its own failures.
    alert: raiseOpsAlert,
  };
}

/**
 * What settlePayment calls, fire-and-forget. Deps assembly happens inside
 * the try: unconfigured Zoho env degrades to a logged line, never a broken
 * payment flow.
 */
export async function pushZohoAfterSettle(input: {
  bookingId: string;
  orderTrackingId: string | null;
}): Promise<void> {
  try {
    await queueZohoExportAfterSettle(zohoDeps(), input);
  } catch (err) {
    console.error(
      "Zoho export skipped",
      JSON.stringify({ ...input, error: err instanceof Error ? err.message : String(err) }),
    );
  }
}

/** The ops drain: pending AND failed, errors surfaced to the route. */
export function runZohoExports(): Promise<{ done: number; errored: number }> {
  return drainExports(zohoDeps(), { includeFailed: true });
}
