import "server-only";
import { prisma } from "../db";
import { logError } from "@/lib/log";
import { raiseOpsAlert } from "../ops/alerts";
import { confirmPesapalPayment } from "./checkout";
import { recoverStaleExtrasOrder } from "./extras";
import { runPaymentSweep as sweep, type SweepDeps, type SweepSummary } from "./sweep";

/**
 * Binds the payment sweep to Prisma, the checkout confirm path, the extras
 * engine and the alert inbox (UNP-46). sweep.ts holds every decision; this
 * file only fetches and forwards.
 */
export function sweepDeps(): SweepDeps {
  return {
    listLiveTransactions: () =>
      prisma.pesapalTransaction.findMany({
        where: { liveForRecordId: { not: null }, status: { in: ["pending", "completed"] } },
        select: { id: true, recordId: true, status: true, orderTrackingId: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      }),

    confirm: confirmPesapalPayment,

    // Guarded on the reference column itself: a stamp landing this instant
    // writes orderTrackingId first, and this update then misses. (The
    // checkout's own retire guards on redirectUrl instead, because it is
    // reclaiming a crashed attempt for a new order, not judging whether a
    // Pesapal reference exists.)
    retireUnlinked: async (transactionId) => {
      const result = await prisma.pesapalTransaction.updateMany({
        where: { id: transactionId, status: "pending", orderTrackingId: null },
        data: { status: "superseded", liveForRecordId: null },
      });
      return result.count === 1;
    },

    alert: raiseOpsAlert,

    listLiveExtrasOrders: () =>
      prisma.extrasOrder.findMany({
        where: { liveForRecordId: { not: null } },
        select: { id: true, recordId: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      }),

    // Loaded the way the pay and amend routes load it, so the extras
    // engine sees the same record shape it sees from a guest.
    recoverExtras: async (recordId) => {
      const record = await prisma.bookingRecord.findUnique({
        where: { id: recordId },
        include: {
          session: { include: { lodges: { orderBy: { slot: "asc" } } } },
          reservations: { orderBy: { slot: "asc" } },
        },
      });
      if (!record) return;
      await recoverStaleExtrasOrder(record);
    },

    // The message stays constant so Sentry groups one outage into one
    // issue; the record id is the tag, and it identifies the row because
    // a record has at most one live attempt and one live extras order.
    logError: (message, err, context) => {
      const { route, recordId } = context;
      logError(message, err, {
        route: typeof route === "string" ? route : undefined,
        bookingId: typeof recordId === "string" ? recordId : null,
      });
    },

    now: () => new Date(),
  };
}

export function runPaymentSweep(): Promise<SweepSummary> {
  return sweep(sweepDeps());
}
