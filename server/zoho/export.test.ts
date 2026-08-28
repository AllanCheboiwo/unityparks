import { describe, expect, it } from "vitest";
import {
  MAX_ATTEMPTS,
  STALE_PUSHING_MS,
  drainExports,
  isClaimable,
  queueAndPushInline,
  queueExport,
  queueZohoExportAfterSettle,
  type BookingReader,
  type ExportDeps,
  type ExportRow,
  type ExportStore,
  type ZohoApi,
} from "./export";
import { buildInvoicePayload, buildPaymentPayload } from "@/lib/zohoMap";

/**
 * Frozen suite for UNP-5 (docs/zoho-accounting-plan.md): the outbox and the
 * pusher. The store fake below is deliberately dumb storage; every decision
 * (what to claim, when to give up, which invoice to reuse) belongs to the
 * module under test, so these tests fail when that logic is broken and not
 * otherwise.
 */

const NOW = new Date("2026-08-26T12:00:00.000Z");

class FakeStore implements ExportStore {
  rows: ExportRow[] = [];
  private seq = 0;

  constructor(private readonly clock: () => Date = () => new Date()) {}

  async insert(input: { bookingId: string; trackingId: string }) {
    if (this.rows.some((r) => r.trackingId === input.trackingId)) {
      return "duplicate" as const;
    }
    this.seq += 1;
    this.rows.push({
      id: `row-${this.seq}`,
      bookingId: input.bookingId,
      trackingId: input.trackingId,
      status: "pending",
      attempts: 0,
      lastError: null,
      zohoInvoiceId: null,
      zohoPaymentId: null,
      createdAt: new Date(NOW.getTime() + this.seq * 1000),
      updatedAt: new Date(NOW.getTime() + this.seq * 1000),
    });
    return "inserted" as const;
  }

  async listOpen() {
    // Deliberately unhelpful storage: every row (done included), newest
    // first. Filtering, ordering and claiming are the module's job, and
    // these tests must fail if it leaves them to the store.
    return [...this.rows].reverse();
  }

  async claim(id: string, fromStatus: string) {
    const row = this.rows.find((r) => r.id === id);
    if (!row || row.status !== fromStatus) return false;
    row.status = "pushing";
    row.updatedAt = this.clock();
    return true;
  }

  async update(id: string, fields: Partial<ExportRow>) {
    const row = this.rows.find((r) => r.id === id);
    if (!row) throw new Error(`no row ${id}`);
    Object.assign(row, fields, { updatedAt: this.clock() });
  }

  async doneInvoiceIdForBooking(bookingId: string) {
    const done = this.rows.find(
      (r) => r.bookingId === bookingId && r.status === "done" && r.zohoInvoiceId,
    );
    return done?.zohoInvoiceId ?? null;
  }

  row(id: string): ExportRow {
    const row = this.rows.find((r) => r.id === id);
    if (!row) throw new Error(`no row ${id}`);
    return row;
  }
}

type ZohoCall =
  | { kind: "find"; reference: string }
  | { kind: "create"; payload: any }
  | { kind: "update"; invoiceId: string; payload: any }
  | { kind: "payment"; payload: any };

class FakeZoho implements ZohoApi {
  calls: ZohoCall[] = [];
  invoicesByReference = new Map<string, string>();
  failNextCreate = false;
  failNextPayment = false;
  down = false;
  private seq = 0;

  async findInvoiceByReference(reference: string) {
    if (this.down) throw new Error("Zoho is unreachable");
    this.calls.push({ kind: "find", reference });
    return this.invoicesByReference.get(reference) ?? null;
  }

  async createInvoice(payload: any) {
    if (this.down) throw new Error("Zoho is unreachable");
    if (this.failNextCreate) {
      this.failNextCreate = false;
      throw new Error("Zoho rejected the invoice");
    }
    this.calls.push({ kind: "create", payload });
    this.seq += 1;
    const id = `zoho-inv-${this.seq}`;
    this.invoicesByReference.set(payload.reference_number, id);
    return id;
  }

  async updateInvoice(invoiceId: string, payload: any) {
    if (this.down) throw new Error("Zoho is unreachable");
    this.calls.push({ kind: "update", invoiceId, payload });
  }

  async recordPayment(payload: any) {
    if (this.down) throw new Error("Zoho is unreachable");
    if (this.failNextPayment) {
      this.failNextPayment = false;
      throw new Error("Zoho rejected the payment");
    }
    this.calls.push({ kind: "payment", payload });
    this.seq += 1;
    return `zoho-pay-${this.seq}`;
  }

  creates() {
    return this.calls.filter((c) => c.kind === "create");
  }
  payments() {
    return this.calls.filter((c) => c.kind === "payment") as Array<{
      kind: "payment";
      payload: any;
    }>;
  }
}

type BookingData = Awaited<ReturnType<BookingReader>>;

function bookingData(overrides: Partial<BookingData> = {}): BookingData {
  return {
    bookingReference: "APALEO-BK-1",
    folios: [
      {
        slot: 0,
        currency: "KES",
        charges: [{ description: "Accommodation", amount: 45_000 }],
        allowances: [],
      },
    ],
    payment: { amount: 13_500, paidAtIso: "2026-08-26T11:59:00.000Z" },
    ...overrides,
  };
}

function makeDeps(overrides: Partial<ExportDeps> = {}) {
  const store = new FakeStore(() => NOW);
  const zoho = new FakeZoho();
  const bookings = new Map<string, BookingData>();
  const failFolioReads = { on: false };
  const readBooking: BookingReader = async ({ bookingId }) => {
    if (failFolioReads.on) throw new Error("Apaleo folio read failed");
    const data = bookings.get(bookingId);
    if (!data) throw new Error(`no booking ${bookingId}`);
    return data;
  };
  const deps: ExportDeps = {
    store,
    zoho,
    readBooking,
    customerId: "zoho-cust-1",
    now: () => NOW,
    ...overrides,
  };
  return { deps, store, zoho, bookings, failFolioReads };
}

describe("queueExport", () => {
  it("queues one row per tracking id; a duplicate Pesapal confirmation is a no-op", async () => {
    const { deps, store, zoho, bookings } = makeDeps();
    bookings.set("bk-1", bookingData());
    expect(await queueExport(deps, { bookingId: "bk-1", trackingId: "track-1" })).toBe("queued");
    expect(await queueExport(deps, { bookingId: "bk-1", trackingId: "track-1" })).toBe(
      "duplicate",
    );
    expect(store.rows).toHaveLength(1);

    // The tail of edge case 1: drain and observe exactly one Zoho payment.
    await drainExports(deps);
    expect(zoho.payments()).toHaveLength(1);
  });
});

describe("drainExports, happy paths", () => {
  it("first payment creates the invoice, records the payment, and saves both ids", async () => {
    const { deps, store, zoho, bookings } = makeDeps();
    bookings.set("bk-1", bookingData());
    await queueExport(deps, { bookingId: "bk-1", trackingId: "track-1" });

    const result = await drainExports(deps);

    expect(result).toEqual({ done: 1, errored: 0 });
    const row = store.row("row-1");
    expect(row.status).toBe("done");
    expect(row.zohoInvoiceId).toBe("zoho-inv-1");
    expect(row.zohoPaymentId).toMatch(/^zoho-pay-/);
    expect(zoho.creates()).toHaveLength(1);
    expect(zoho.payments()[0].payload.reference_number).toBe("track-1");
    // The money itself: the drain must send exactly what the mappers build
    // from the folio and the payment, wrong amounts must fail here.
    expect((zoho.creates()[0] as any).payload).toEqual(
      buildInvoicePayload({
        customerId: "zoho-cust-1",
        bookingReference: "APALEO-BK-1",
        folios: bookingData().folios,
      }),
    );
    expect(zoho.payments()[0].payload).toEqual(
      buildPaymentPayload({
        customerId: "zoho-cust-1",
        invoiceId: "zoho-inv-1",
        amount: 13_500,
        trackingId: "track-1",
        paidAtIso: "2026-08-26T11:59:00.000Z",
      }),
    );
  });

  it("a second payment on a booking reuses its invoice and adds a payment, never a second invoice", async () => {
    const { deps, store, zoho, bookings } = makeDeps();
    bookings.set("bk-1", bookingData());
    await queueExport(deps, { bookingId: "bk-1", trackingId: "track-deposit" });
    await drainExports(deps);

    await queueExport(deps, { bookingId: "bk-1", trackingId: "track-balance" });
    await drainExports(deps);

    expect(zoho.creates()).toHaveLength(1);
    expect(zoho.payments()).toHaveLength(2);
    expect(store.row("row-2").zohoInvoiceId).toBe(store.row("row-1").zohoInvoiceId);
  });

  it("reads the folio at push time, so a charge added between payments lands on the invoice", async () => {
    const { deps, zoho, bookings } = makeDeps();
    bookings.set("bk-1", bookingData());
    await queueExport(deps, { bookingId: "bk-1", trackingId: "track-deposit" });
    await drainExports(deps);

    bookings.set(
      "bk-1",
      bookingData({
        folios: [
          {
            slot: 0,
            currency: "KES",
            charges: [
              { description: "Accommodation", amount: 45_000 },
              { description: "Bike hire", amount: 3_000 },
            ],
            allowances: [],
          },
        ],
      }),
    );
    await queueExport(deps, { bookingId: "bk-1", trackingId: "track-balance" });
    await drainExports(deps);

    const updates = zoho.calls.filter((c) => c.kind === "update") as Array<{
      kind: "update";
      payload: any;
    }>;
    expect(updates).toHaveLength(1);
    expect(updates[0].payload.line_items.map((l: any) => l.name)).toContain("Bike hire");
  });

  it("pushes pending rows oldest first", async () => {
    const { deps, zoho, bookings } = makeDeps();
    bookings.set("bk-1", bookingData({ bookingReference: "APALEO-BK-1" }));
    bookings.set("bk-2", bookingData({ bookingReference: "APALEO-BK-2" }));
    await queueExport(deps, { bookingId: "bk-1", trackingId: "track-1" });
    await queueExport(deps, { bookingId: "bk-2", trackingId: "track-2" });

    await drainExports(deps);

    expect(zoho.creates().map((c: any) => c.payload.reference_number)).toEqual([
      "APALEO-BK-1",
      "APALEO-BK-2",
    ]);
  });

  it("every invoice update carries a human-readable reason", async () => {
    const { deps, zoho, bookings } = makeDeps();
    bookings.set("bk-1", bookingData());
    await queueExport(deps, { bookingId: "bk-1", trackingId: "track-deposit" });
    await drainExports(deps);
    await queueExport(deps, { bookingId: "bk-1", trackingId: "track-balance" });
    await drainExports(deps);

    const update = zoho.calls.find((c) => c.kind === "update") as any;
    expect(typeof update.payload.reason).toBe("string");
    expect(update.payload.reason.length).toBeGreaterThan(0);
  });

  it("a done row is never touched again, by inline or ops drains", async () => {
    const { deps, zoho, bookings } = makeDeps();
    bookings.set("bk-1", bookingData());
    await queueExport(deps, { bookingId: "bk-1", trackingId: "track-1" });
    await drainExports(deps);
    const callsWhenDone = zoho.calls.length;

    expect(await drainExports(deps)).toEqual({ done: 0, errored: 0 });
    expect(await drainExports(deps, { includeFailed: true })).toEqual({ done: 0, errored: 0 });
    expect(zoho.calls.length).toBe(callsWhenDone);
  });

  it("an empty queue drains to nothing and touches nothing", async () => {
    const { deps, zoho } = makeDeps();
    expect(await drainExports(deps)).toEqual({ done: 0, errored: 0 });
    expect(zoho.calls).toHaveLength(0);
  });
});

describe("drainExports, failure paths", () => {
  it("a Zoho outage leaves the row pending with attempts and the error, and later heals", async () => {
    const { deps, store, zoho, bookings } = makeDeps();
    bookings.set("bk-1", bookingData());
    await queueExport(deps, { bookingId: "bk-1", trackingId: "track-1" });

    zoho.down = true;
    const failed = await drainExports(deps);
    expect(failed).toEqual({ done: 0, errored: 1 });
    const row = store.row("row-1");
    expect(row.status).toBe("pending");
    expect(row.attempts).toBe(1);
    expect(row.lastError).toMatch(/unreachable/);

    zoho.down = false;
    const healed = await drainExports(deps);
    expect(healed).toEqual({ done: 1, errored: 0 });
    expect(store.row("row-1").status).toBe("done");
  });

  it("an Apaleo folio read failure leaves the row pending and pushes nothing to Zoho", async () => {
    const { deps, store, zoho, bookings, failFolioReads } = makeDeps();
    bookings.set("bk-1", bookingData());
    await queueExport(deps, { bookingId: "bk-1", trackingId: "track-1" });

    failFolioReads.on = true;
    await drainExports(deps);

    expect(store.row("row-1").status).toBe("pending");
    expect(store.row("row-1").lastError).toMatch(/folio/i);
    expect(zoho.calls).toHaveLength(0);
  });

  it("gives up after MAX_ATTEMPTS and flips the row to failed", async () => {
    const { deps, store, bookings, failFolioReads } = makeDeps();
    bookings.set("bk-1", bookingData());
    await queueExport(deps, { bookingId: "bk-1", trackingId: "track-1" });

    failFolioReads.on = true;
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      await drainExports(deps);
    }

    const row = store.row("row-1");
    expect(row.attempts).toBe(MAX_ATTEMPTS);
    expect(row.status).toBe("failed");
  });

  it("inline drains skip failed rows; the ops drain retries them", async () => {
    const { deps, store, bookings, failFolioReads } = makeDeps();
    bookings.set("bk-1", bookingData());
    await queueExport(deps, { bookingId: "bk-1", trackingId: "track-1" });
    failFolioReads.on = true;
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      await drainExports(deps);
    }
    expect(store.row("row-1").status).toBe("failed");

    failFolioReads.on = false;
    await drainExports(deps);
    expect(store.row("row-1").status).toBe("failed");

    const result = await drainExports(deps, { includeFailed: true });
    expect(result).toEqual({ done: 1, errored: 0 });
    expect(store.row("row-1").status).toBe("done");
  });

  it("one broken row does not block the rest of the queue", async () => {
    const { deps, store, bookings } = makeDeps();
    bookings.set("bk-2", bookingData({ bookingReference: "APALEO-BK-2" }));
    await queueExport(deps, { bookingId: "bk-1", trackingId: "track-1" });
    await queueExport(deps, { bookingId: "bk-2", trackingId: "track-2" });

    const result = await drainExports(deps);

    expect(result).toEqual({ done: 1, errored: 1 });
    expect(store.row("row-1").status).toBe("pending");
    expect(store.row("row-2").status).toBe("done");
  });
});

describe("drainExports, crash recovery", () => {
  it("saves the invoice id eagerly, so a crash before the payment cannot duplicate the invoice", async () => {
    const { deps, store, zoho, bookings } = makeDeps();
    bookings.set("bk-1", bookingData());
    await queueExport(deps, { bookingId: "bk-1", trackingId: "track-1" });

    zoho.failNextPayment = true;
    await drainExports(deps);
    const row = store.row("row-1");
    expect(row.status).toBe("pending");
    expect(row.zohoInvoiceId).toBe("zoho-inv-1");

    // Only the stored id may prevent the duplicate: wipe Zoho's search so an
    // implementation leaning on find-by-reference re-creates and fails here.
    zoho.invoicesByReference.clear();

    await drainExports(deps);
    expect(zoho.creates()).toHaveLength(1);
    expect(store.row("row-1").status).toBe("done");
  });

  it("adopts an invoice Zoho already holds for the booking reference instead of creating a duplicate", async () => {
    const { deps, store, zoho, bookings } = makeDeps();
    bookings.set("bk-1", bookingData({ bookingReference: "APALEO-BK-1" }));
    zoho.invoicesByReference.set("APALEO-BK-1", "zoho-inv-preexisting");
    await queueExport(deps, { bookingId: "bk-1", trackingId: "track-1" });

    await drainExports(deps);

    expect(zoho.creates()).toHaveLength(0);
    expect(store.row("row-1").zohoInvoiceId).toBe("zoho-inv-preexisting");
    expect(store.row("row-1").status).toBe("done");
    // The crashed push that left this invoice behind may have half-written
    // it: adoption must sync it to the current folio before paying.
    const update = zoho.calls.find((c) => c.kind === "update") as any;
    expect(update.invoiceId).toBe("zoho-inv-preexisting");
    const { reason, ...rest } = update.payload;
    expect(typeof reason).toBe("string");
    expect(reason.length).toBeGreaterThan(0);
    expect(rest).toEqual(
      buildInvoicePayload({
        customerId: "zoho-cust-1",
        bookingReference: "APALEO-BK-1",
        folios: bookingData().folios,
      }),
    );
  });

  it("reclaims a row stuck in pushing past the stale timeout and completes it without a duplicate invoice", async () => {
    const { deps, store, zoho, bookings } = makeDeps();
    bookings.set("bk-1", bookingData());
    // A pusher crashed mid-flight elsewhere: row claimed, invoice created
    // and its id saved, then silence for longer than the stale window.
    store.rows.push({
      id: "row-stuck",
      bookingId: "bk-1",
      trackingId: "track-stuck",
      status: "pushing",
      attempts: 1,
      lastError: null,
      zohoInvoiceId: "zoho-inv-crashed",
      zohoPaymentId: null,
      createdAt: new Date(NOW.getTime() - STALE_PUSHING_MS - 60_000),
      updatedAt: new Date(NOW.getTime() - STALE_PUSHING_MS - 1),
    });

    const result = await drainExports(deps);

    expect(result).toEqual({ done: 1, errored: 0 });
    expect(store.row("row-stuck").status).toBe("done");
    expect(zoho.creates()).toHaveLength(0);
    expect(zoho.payments()).toHaveLength(1);
    expect(zoho.payments()[0].payload.invoices[0].invoice_id).toBe("zoho-inv-crashed");
  });

  it("leaves a freshly pushing row to the drain that owns it", async () => {
    const { deps, store, zoho, bookings } = makeDeps();
    bookings.set("bk-1", bookingData());
    store.rows.push({
      id: "row-live",
      bookingId: "bk-1",
      trackingId: "track-live",
      status: "pushing",
      attempts: 1,
      lastError: null,
      zohoInvoiceId: null,
      zohoPaymentId: null,
      createdAt: NOW,
      updatedAt: NOW,
    });

    const result = await drainExports(deps);

    expect(result).toEqual({ done: 0, errored: 0 });
    expect(store.row("row-live").status).toBe("pushing");
    expect(zoho.calls).toHaveLength(0);
  });
});

describe("overlapping drains", () => {
  it("exactly one of two overlapping drains wins a row; Zoho sees each push once", async () => {
    const { deps, zoho, bookings } = makeDeps();
    bookings.set("bk-1", bookingData());
    await queueExport(deps, { bookingId: "bk-1", trackingId: "track-1" });

    const [a, b] = await Promise.all([drainExports(deps), drainExports(deps)]);

    expect(a.done + b.done).toBe(1);
    expect(zoho.payments()).toHaveLength(1);
  });
});

describe("isClaimable", () => {
  const base: ExportRow = {
    id: "row-x",
    bookingId: "bk-1",
    trackingId: "track-x",
    status: "pending",
    attempts: 0,
    lastError: null,
    zohoInvoiceId: null,
    zohoPaymentId: null,
    createdAt: NOW,
    updatedAt: NOW,
  };

  it("claims pending rows", () => {
    expect(isClaimable(base, { includeFailed: false, now: NOW })).toBe(true);
  });

  it("never claims done rows", () => {
    expect(
      isClaimable({ ...base, status: "done" }, { includeFailed: true, now: NOW }),
    ).toBe(false);
  });

  it("claims failed rows only when the ops drain asks for them", () => {
    const failed = { ...base, status: "failed" as const };
    expect(isClaimable(failed, { includeFailed: false, now: NOW })).toBe(false);
    expect(isClaimable(failed, { includeFailed: true, now: NOW })).toBe(true);
  });

  it("leaves a freshly pushing row alone but reclaims one stuck past the stale timeout", () => {
    const fresh = { ...base, status: "pushing" as const, updatedAt: NOW };
    expect(isClaimable(fresh, { includeFailed: false, now: NOW })).toBe(false);

    const stale = {
      ...base,
      status: "pushing" as const,
      updatedAt: new Date(NOW.getTime() - STALE_PUSHING_MS - 1),
    };
    expect(isClaimable(stale, { includeFailed: false, now: NOW })).toBe(true);
  });
});

describe("queueAndPushInline", () => {
  it("swallows every failure; a Zoho outage never surfaces into the payment flow", async () => {
    const { deps, store, zoho, bookings } = makeDeps();
    bookings.set("bk-1", bookingData());
    zoho.down = true;

    await expect(
      queueAndPushInline(deps, { bookingId: "bk-1", trackingId: "track-1" }),
    ).resolves.toBeUndefined();

    const row = store.row("row-1");
    expect(row.status).toBe("pending");
    expect(row.attempts).toBe(1);
  });

  it("drains the whole pending backlog, not just its own row", async () => {
    const { deps, store, zoho, bookings } = makeDeps();
    bookings.set("bk-1", bookingData({ bookingReference: "APALEO-BK-1" }));
    bookings.set("bk-2", bookingData({ bookingReference: "APALEO-BK-2" }));

    zoho.down = true;
    await queueAndPushInline(deps, { bookingId: "bk-1", trackingId: "track-1" });
    zoho.down = false;
    await queueAndPushInline(deps, { bookingId: "bk-2", trackingId: "track-2" });

    expect(store.row("row-1").status).toBe("done");
    expect(store.row("row-2").status).toBe("done");
  });
});

describe("queueZohoExportAfterSettle", () => {
  it("queues the settled payment by its Pesapal tracking id and drains inline", async () => {
    const { deps, store, zoho, bookings } = makeDeps();
    bookings.set("bk-1", bookingData());

    await queueZohoExportAfterSettle(deps, { bookingId: "bk-1", orderTrackingId: "track-1" });

    expect(store.rows).toHaveLength(1);
    expect(store.rows[0].trackingId).toBe("track-1");
    expect(store.rows[0].status).toBe("done");
    expect(zoho.payments()).toHaveLength(1);
  });

  it("ignores simulator settles, which carry no Pesapal tracking id", async () => {
    const { deps, store, zoho } = makeDeps();

    await queueZohoExportAfterSettle(deps, { bookingId: "bk-1", orderTrackingId: null });

    expect(store.rows).toHaveLength(0);
    expect(zoho.calls).toHaveLength(0);
  });

  it("never throws into the settle path, even when the store itself is broken", async () => {
    const { deps } = makeDeps();
    deps.store.insert = async () => {
      throw new Error("db down");
    };

    await expect(
      queueZohoExportAfterSettle(deps, { bookingId: "bk-1", orderTrackingId: "track-1" }),
    ).resolves.toBeUndefined();
  });
});
