import {
  buildInvoicePayload,
  buildInvoiceUpdatePayload,
  buildPaymentPayload,
  type FolioSnapshot,
} from "@/lib/zohoMap";

/**
 * The Zoho export outbox and pusher (UNP-5, docs/zoho-accounting-plan.md).
 * Schedulerless like the reminders: a best-effort drain fires right after a
 * payment queues a row, and the ops run endpoint handles retries. Every
 * drain processes ALL claimable rows oldest-first, so a stuck row is
 * retried on the next payment anywhere in the system.
 *
 * Everything here takes injected deps (store, Zoho, folio reader, clock);
 * the production assembly lives in wire.ts. Running a drain twice is free:
 * every push is idempotent by construction.
 */

export const MAX_ATTEMPTS = 5;
export const STALE_PUSHING_MS = 5 * 60 * 1000;

export type ExportRow = {
  id: string;
  bookingId: string;
  trackingId: string;
  status: "pending" | "pushing" | "done" | "failed";
  attempts: number;
  lastError: string | null;
  zohoInvoiceId: string | null;
  zohoPaymentId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Dumb storage; every decision belongs to the module, not the store. */
export type ExportStore = {
  insert(input: { bookingId: string; trackingId: string }): Promise<"inserted" | "duplicate">;
  /** Whatever rows might need work, in no promised order; done rows may leak through. */
  listOpen(): Promise<ExportRow[]>;
  /**
   * Conditional flip to pushing; false means another drain won. The
   * seenUpdatedAt guard is what makes the STALE reclaim exclusive too:
   * pushing -> pushing on status alone would let every racing drain "win".
   */
  claim(id: string, fromStatus: string, seenUpdatedAt: Date): Promise<boolean>;
  update(id: string, fields: Partial<ExportRow>): Promise<void>;
  /** The one-invoice-per-booking memory: an earlier done row's invoice id. */
  doneInvoiceIdForBooking(bookingId: string): Promise<string | null>;
};

export type ZohoApi = {
  findInvoiceByReference(reference: string): Promise<string | null>;
  createInvoice(payload: unknown): Promise<string>;
  updateInvoice(invoiceId: string, payload: unknown): Promise<void>;
  recordPayment(payload: unknown): Promise<string>;
  /** Optional idempotent sent transition, for invoices adopted mid-crash. */
  markSent?: (invoiceId: string) => Promise<void>;
  /** Optional payment memory on the Zoho side; absence means no lookup. */
  findPaymentByReference?: (reference: string) => Promise<string | null>;
};

/** Reads the booking's folios FRESH from Apaleo plus the payment being exported. */
export type BookingReader = (input: { bookingId: string; trackingId: string }) => Promise<{
  bookingReference: string;
  folios: FolioSnapshot[];
  payment: { amount: number; paidAtIso: string };
}>;

export type ExportDeps = {
  store: ExportStore;
  zoho: ZohoApi;
  readBooking: BookingReader;
  customerId: string;
  now: () => Date;
};

export async function queueExport(
  deps: ExportDeps,
  input: { bookingId: string; trackingId: string },
): Promise<"queued" | "duplicate"> {
  const result = await deps.store.insert(input);
  return result === "inserted" ? "queued" : "duplicate";
}

/**
 * May a drain take this row? Pending always; failed only when the ops
 * drain asks (failed means "automatic retries gave up, escalated to the
 * button"); done never; pushing only when stuck past the stale timeout,
 * which means the pusher that claimed it crashed mid-flight.
 */
export function isClaimable(
  row: ExportRow,
  opts: { includeFailed: boolean; now: Date },
): boolean {
  switch (row.status) {
    case "pending":
      return true;
    case "failed":
      return opts.includeFailed;
    case "pushing":
      return opts.now.getTime() - row.updatedAt.getTime() > STALE_PUSHING_MS;
    default:
      return false;
  }
}

/**
 * Drain every claimable row, oldest first. Oldest-first is a correctness
 * requirement, not a nicety: a booking's deposit row creates the invoice
 * its balance row attaches to. One broken row never blocks the rest.
 */
export async function drainExports(
  deps: ExportDeps,
  opts: { includeFailed?: boolean } = {},
): Promise<{ done: number; errored: number }> {
  const includeFailed = opts.includeFailed ?? false;
  const rows = (await deps.store.listOpen())
    .filter((row) => isClaimable(row, { includeFailed, now: deps.now() }))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  let done = 0;
  let errored = 0;
  // A booking's rows are strictly ordered (the deposit row creates the
  // invoice the balance row attaches to), and that ordering must survive
  // OVERLAPPING drains too: once one of a booking's rows is lost to another
  // drain or errors in this pass, its later rows wait for the next drain
  // rather than racing ahead and minting a second invoice.
  const blockedBookings = new Set<string>();
  for (const row of rows) {
    if (blockedBookings.has(row.bookingId)) continue;
    // The concurrency guard: only the drain that wins this conditional
    // flip proceeds; the loser skips the whole booking for this pass.
    if (!(await deps.store.claim(row.id, row.status, row.updatedAt))) {
      blockedBookings.add(row.bookingId);
      continue;
    }
    try {
      await pushOne(deps, row);
      done += 1;
    } catch (err) {
      errored += 1;
      blockedBookings.add(row.bookingId);
      const attempts = row.attempts + 1;
      try {
        await deps.store.update(row.id, {
          // Errors keep a row pending (retried by any later drain) until
          // MAX_ATTEMPTS, when it escalates to failed and the ops button.
          status: attempts >= MAX_ATTEMPTS ? "failed" : "pending",
          attempts,
          lastError: err instanceof Error ? err.message : String(err),
        });
      } catch (updateErr) {
        // The store itself is down. Leave the row in pushing (the stale
        // window reclaims it) and keep draining whatever still can be:
        // one broken row must not block the rest, even like this.
        console.error(
          "Zoho export row update failed",
          JSON.stringify({
            rowId: row.id,
            error: updateErr instanceof Error ? updateErr.message : String(updateErr),
          }),
        );
      }
    }
  }
  return { done, errored };
}

async function pushOne(deps: ExportDeps, row: ExportRow): Promise<void> {
  // Amounts come from the folio read at push time, never a local copy. If
  // this read fails the row stays pending; there is no fallback.
  const booking = await deps.readBooking({
    bookingId: row.bookingId,
    trackingId: row.trackingId,
  });
  const invoiceInput = {
    customerId: deps.customerId,
    bookingReference: booking.bookingReference,
    folios: booking.folios,
  };

  // One invoice per booking, ever. Three memories consulted in order of
  // trust: this row's own eagerly-saved id (a crashed earlier run), an
  // earlier done row for the booking, and finally Zoho itself by booking
  // reference (a crash before the eager save).
  let invoiceId =
    row.zohoInvoiceId ??
    (await deps.store.doneInvoiceIdForBooking(row.bookingId)) ??
    (await deps.zoho.findInvoiceByReference(booking.bookingReference));

  if (invoiceId) {
    // The invoice may predate folio changes, or be half-written by a
    // crashed push: sync it to the folio before applying money to it.
    await deps.store.update(row.id, { zohoInvoiceId: invoiceId });
    await deps.zoho.updateInvoice(
      invoiceId,
      buildInvoiceUpdatePayload(invoiceInput, `Folio update for payment ${row.trackingId}`),
    );
    // An adopted invoice can be a draft (crash between create and mark
    // sent); payments cannot be applied to drafts, and without this the
    // row would wedge deterministically through every retry.
    await deps.zoho.markSent?.(invoiceId);
  } else {
    invoiceId = await deps.zoho.createInvoice(buildInvoicePayload(invoiceInput));
    // Saved eagerly, BEFORE the payment: a crash between these two steps
    // must leave the id behind so the retry cannot create a duplicate.
    await deps.store.update(row.id, { zohoInvoiceId: invoiceId });
  }

  // Invariant 4's last line of defense: a crash after recordPayment but
  // before the row update below leaves the payment in Zoho with no local
  // trace. The retry must adopt it, never post it twice.
  const existingPaymentId = (await deps.zoho.findPaymentByReference?.(row.trackingId)) ?? null;
  if (existingPaymentId) {
    await deps.store.update(row.id, {
      status: "done",
      zohoPaymentId: existingPaymentId,
      lastError: null,
    });
    return;
  }

  const paymentId = await deps.zoho.recordPayment(
    buildPaymentPayload({
      customerId: deps.customerId,
      invoiceId,
      amount: booking.payment.amount,
      trackingId: row.trackingId,
      paidAtIso: booking.payment.paidAtIso,
    }),
  );
  await deps.store.update(row.id, { status: "done", zohoPaymentId: paymentId, lastError: null });
}

/**
 * Queue plus best-effort drain, for the payment flow. Swallows everything:
 * Zoho being down, slow, or rejecting must never surface into a settle.
 */
export async function queueAndPushInline(
  deps: ExportDeps,
  input: { bookingId: string; trackingId: string },
): Promise<void> {
  try {
    await queueExport(deps, input);
    await drainExports(deps);
  } catch (err) {
    console.error(
      "Zoho inline push failed",
      JSON.stringify({ ...input, error: err instanceof Error ? err.message : String(err) }),
    );
  }
}

/**
 * The one function the settle path calls. Simulator settles carry no
 * Pesapal tracking id and never export; the books track the Pesapal flow.
 */
export async function queueZohoExportAfterSettle(
  deps: ExportDeps,
  input: { bookingId: string; orderTrackingId: string | null },
): Promise<void> {
  if (!input.orderTrackingId) return;
  await queueAndPushInline(deps, {
    bookingId: input.bookingId,
    trackingId: input.orderTrackingId,
  });
}
