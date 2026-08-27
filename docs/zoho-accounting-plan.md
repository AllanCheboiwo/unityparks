# Zoho Books accounting export (UNP-5)

Status: writing-tests

Plan approved: 26 Aug 2026, Allan wrote "plan approved!"

Export booking money into Zoho Books so bookkeeping is visible outside the PMS. One-way sync, folio as source of truth, Zoho Books free plan (Kenya org, KES), branch `unp-5-zoho-accounting`, Linear issue UNP-5.

## Problem

Money lives in Apaleo folios and Pesapal, both operational systems. There is no accounting view: nothing an accountant (or the demo audience) can open to see invoices, payments received, and balances due. We push each paying booking into Zoho Books as an invoice with payments recorded against it.

## Out of scope

- Two-way sync. Nothing typed into Zoho ever flows back. (Never.)
- Backfill of bookings that predate the feature. Go-forward only. (Never.)
- Custom chart of accounts; Zoho defaults are fine. (Never.)
- Nightly reconcile sweep for manual Apaleo folio edits after final payment: UNP-12.
- Refunds and cancellations as credit notes: UNP-13.
- Pesapal settlement reconciliation: UNP-14.
- VAT (16%) configuration: UNP-15.

## The shape

```
Pesapal confirms a payment (confirmPesapalPayment, already idempotent)
        |
        v
ZohoExport outbox row written in our DB (pending)
        |
        v
pusher (module, schedulerless): reads the Apaleo folio fresh,
builds/updates the Zoho invoice, records the payment
        |            \
        v             v
   done (zoho ids   failed (attempts + last error kept,
   stored on row)   retried next run, visible on ops page)
```

The pusher runs when asked, like reminders: an attempt fires right after a row is queued (best effort, never blocks or fails the payment flow), and an ops route `POST /api/ops/zoho/run` handles retries and manual runs. Every run, inline or ops, drains ALL pending rows oldest-first, so a stuck row is retried on the next payment anywhere in the system. Oldest-first is a correctness requirement: a booking's deposit row creates the invoice its balance row attaches to. Running it twice is free; every push is idempotent.

Done rows are never deleted: the row's unique trackingId IS the idempotency guard. A late duplicate Pesapal delivery must find the existing row and die on the unique constraint; deleting on success would let the duplicate re-insert and double-post the payment. The inline push selects status = pending only; the ops run endpoint retries pending AND failed (failed means "automatic retries gave up, escalated to the button", not "permanent"). Done rows are never touched again.

Concurrency guard: drains can overlap (two payments confirming at once both fire inline pushes). Before pushing a row, a drain claims it with a conditional update (pending -> pushing, only if still pending); only the winner proceeds. A row stuck in pushing longer than 5 minutes (crashed pusher) is treated as pending by the next drain.

Duplicate-invoice guard: before creating an invoice, the pusher searches Zoho by booking reference and adopts an existing one. Together with saving zohoInvoiceId eagerly, this makes a crash between "Zoho created the invoice" and "we saved the id" harmless.

## Inputs, outputs, invariants

Inputs: a confirmed Pesapal payment (tracking id, merchant reference, amount) and the booking's Apaleo folio read at export time.

Outputs in Zoho Books: one Customer ("Unity Parks Online Guest", shared by all invoices), one Invoice per booking, one Customer Payment per confirmed Pesapal payment.

Invariants:

1. A booking appears in Zoho only after its first successful payment. No payment, no trace.
2. Once a booking is in, its invoice mirrors the full folio: every charge (accommodation, location fee, extras), paid or not, and referral discounts as a discount line. Invoice total always equals folio charge total.
3. One invoice per booking, ever. Later payments update the same invoice and add payments.
4. One Zoho payment per Pesapal tracking id, ever. Duplicate confirmations (IPN + callback race, Pesapal retries) create nothing new.
5. Amounts come from the folio read at push time, never from our local copy. If the folio read fails, the export stays pending; we do not fall back.
6. Zoho being down, slow, or rejecting never affects the guest payment flow, the folio, or the booking record. Failures only ever mean "pending row stays pending".
7. No guest PII reaches Zoho. Invoice carries the booking reference and Pesapal tracking id as references, nothing else about the person.
8. Whole KES throughout, matching lib/paymentPlan.ts conventions.

## Data model

New Prisma model (prisma db push, never migrate):

```
model ZohoExport {
  id            String   @id @default(cuid())
  bookingId     String            // our BookingRecord id
  trackingId    String   @unique  // Pesapal tracking id; the idempotency key
  status        String   @default("pending") // pending | pushing | done | failed
  attempts      Int      @default(0)
  lastError     String?
  zohoInvoiceId String?           // set once the invoice exists
  zohoPaymentId String?           // set once the payment is recorded
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}
```

`trackingId @unique` is what makes duplicate Pesapal confirmations free: the second insert is a no-op. `zohoInvoiceId` doubles as the one-invoice-per-booking memory: before creating an invoice the pusher looks for any earlier done row for the same bookingId and reuses its invoice.

`failed` means "gave up after MAX_ATTEMPTS (5)"; until then rows stay `pending` through errors. The ops run endpoint retries both.

## Zoho side

- Auth: Zoho self client (OAuth). `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_ORG_ID` in env. Access tokens fetched and cached in memory, refreshed on expiry, same pattern as server/apaleo/client.ts and server/pesapal/client.ts.
- API: Zoho Books REST v3 (invoices, customerpayments, contacts). The generic customer is created once by a setup script and its id stored in env (`ZOHO_CUSTOMER_ID`) to keep the runtime path free of lookups.
- The Zoho Books MCP is the agent's verification window only; app code never touches it.

## Files touched

New:

- `server/zoho/client.ts`. Token refresh + fetch wrapper.
- `server/zoho/export.ts`. The pusher: queue, push one, push all pending.
- `lib/zohoMap.ts`. Pure functions mapping a folio (charges, discounts, payments) to Zoho invoice/payment payloads. All money math lives here, testable without network.
- `lib/zohoMap.test.ts`. Frozen suite.
- `server/zoho/export.test.ts`. Outbox behavior with mocked Zoho/Apaleo clients.
- `app/api/ops/zoho/run/route.ts`. Push-all-pending, ops-gated like the other ops routes.
- `app/ops/zoho/page.tsx`. Table of export rows and their statuses, retry button.
- `scripts/setup-zoho.mjs`. One-time: create the generic customer, print the env values.

Changed:

- `prisma/schema.prisma`. The ZohoExport model.
- `server/booking/checkout.ts`. Inside `confirmPesapalPayment`, after a completed settle: queue the export row and fire a best-effort push. A few lines.
- `server/apaleo/bookings.ts` (or a sibling). Extend the folio read to return charge lines, not just balance.

## Edge cases (each becomes a test)

1. Duplicate Pesapal confirmation for the same trackingId: second queue attempt is a no-op, no second Zoho payment.
2. Second payment on a booking (balance after deposit): same invoice updated, second payment recorded, no second invoice.
3. Charge added to the folio between deposit and balance payment: appears on the invoice after the balance push.
4. Referral discount on the folio: discount line on the invoice; invoice total still equals folio total.
5. Zoho unreachable at push time: row stays pending with attempts+1 and lastError; payment flow unaffected; later run succeeds.
6. Apaleo folio read fails at push time: same as 5, nothing pushed, no fallback to local amounts.
7. Row at MAX_ATTEMPTS: status failed, surfaced on ops page, manual retry still possible.
8. Zoho access token expired: refreshed transparently, push succeeds.
9. Push crash after invoice created but before payment recorded: re-run records the payment against the existing invoice, no duplicate invoice (zohoInvoiceId saved eagerly).
10. Booking with no ZohoExport rows (never paid): nothing exists in Zoho.
11. Two drains overlap on the same pending row: exactly one wins the claim; the other skips it. No double payment in Zoho.
12. Row stuck in pushing past the stale timeout (pusher crashed mid-flight): next drain reclaims and completes it; lookup-before-create prevents a duplicate invoice.

## Failure modes

- Zoho free plan invoice cap (1,000/year): far above demo volume; if hit, pushes fail visibly on the ops page, nothing breaks.
- Zoho rate limits: pusher is sequential, low volume; 429s land as retryable errors.
- Refresh token revoked: every push fails with a clear lastError; fix is re-running the self-client setup and updating env.

## Acceptance check (end to end, on Railway)

1. Book a lodge 57+ days out, pay the 30% deposit through the Pesapal card sim.
2. Open Zoho Books: one invoice for the booking reference, full folio total, deposit payment recorded, balance due visible.
3. Pay the balance from the manage-booking page.
4. Zoho: same invoice, second payment, balance zero.
5. Ops page shows both exports done; run endpoint returns nothing to do.
6. Confirm the Zoho contact list holds only "Unity Parks Online Guest", no guest names or emails.

## Decisions made for you

1. Outbox pattern with schedulerless pusher (matches reminders) rather than a cron or direct synchronous push.
2. Idempotency key is the Pesapal tracking id, and it is the outbox unique constraint.
3. MAX_ATTEMPTS = 5 before a row is marked failed.
4. Generic customer id lives in env via a setup script, not looked up at runtime.
5. Money mapping isolated in pure `lib/zohoMap.ts` (paymentPlan.ts precedent).
6. Ops UI is a plain table with a retry button, gated like /ops/referrals.
7. Best-effort inline push right after queueing, so the demo shows near-instant Zoho updates without a scheduler.

## Open questions

- Verify on the live Zoho org that line items on a partially paid invoice can be updated via API. Docs point to yes: API updates to sent/open invoices are allowed but require a mandatory `reason` field (error 110701 without it), and the frozen-transaction rule only covers payments taken through a Zoho-side card processor, which ours never are (Pesapal collects outside Zoho, we record manually). Check happens at setup time, before tests are frozen. If somehow no, the mapping needs a rethink (void-and-recreate or invoice-per-payment), which reopens the plan. Mapping consequence already adopted: every invoice update sends a reason string.

## Interview notes (26 Aug 2026)

- Trigger: Pesapal payment confirmation queues an export (outbox row in our DB); a job pushes to Zoho. Decoupled so Zoho problems never affect the payment flow.
- Amounts are read from the Apaleo folio at export time, not from our local copy. Folio is the money source of truth.
- Zoho shape: one Invoice per booking (accommodation, location fee, extras, referral discount line), Customer Payments recorded against it per Pesapal payment, tracking ID as reference.
- A booking enters Zoho only after its first successful payment; once in, the invoice mirrors the full folio including unpaid charges (balance due is visible).
- Second payment updates the existing invoice and adds a payment; never a second invoice.
- One generic Zoho customer for all invoices; no guest PII leaves our system. Booking reference on the invoice.
- Failures: outbox retries; stuck exports visible on an ops page. Idempotent against duplicate Pesapal confirmations.
- Go-forward only, no backfill. Currency KES, Zoho Books free plan, Kenya org.
- App talks to Zoho Books REST API via self-client OAuth (refresh token in env). The Zoho MCP is only the agent's verification window.
- Phase 2 (deferred): UNP-12 reconcile sweep, UNP-13 credit notes, UNP-14 settlement reconciliation, UNP-15 VAT.
- Never: two-way sync, backfill, custom chart of accounts.
- Prerequisite on Allan: create the Zoho Books account (free plan, Kenya, KES) and a self client for OAuth.
