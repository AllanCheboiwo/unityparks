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

    confirm: async (orderTrackingId) => {
      const result = await confirmPesapalPayment(orderTrackingId);
      return { outcome: result.outcome };
    },

    // Same guard as submitFreshAttempt's own retire: a stamp landing this
    // instant flips orderTrackingId first, and this update then misses.
    retireUnlinked: async (transactionId) => {
      const result = await prisma.pesapalTransaction.updateMany({
        where: { id: transactionId, status: "pending", orderTrackingId: null },
        data: { status: "superseded", liveForRecordId: null },
      });
      return result.count === 1;
    },

    alert: (input) => raiseOpsAlert(input),

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

    // The log helper tags Sentry with ids only; the extra ids ride in the
    // message so they stay searchable without widening the tag set.
    logError: (message, err, context) => {
      const { route, recordId, ...rest } = context;
      logError(`${message} ${JSON.stringify(rest)}`, err, {
        route: typeof route === "string" ? route : undefined,
        bookingId: typeof recordId === "string" ? recordId : null,
      });
    },
  };
}

export function runPaymentSweep(): Promise<SweepSummary> {
  return sweep(sweepDeps());
}
