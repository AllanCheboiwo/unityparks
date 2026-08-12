# Deposit, payment schedule and cancellation policy: implementation plan

Status: BUILT, 23 Jul 2026 (all eight steps, same day the plan was written).
This document remains the policy and architecture reference. Two details
changed during the build and are corrected inline below: the folio sanity
check accepts two legitimate readings (untouched, or already posted by a
crashed run of the same settle), and every DB write of a settle lands in one
prisma.$transaction so a crash can never leave a partial basis.

A post-build adversarial review (same day) hardened the race surface beyond
the original spec; these are now part of the design:
- settlePayment and cancelBooking each RE-READ the record fresh at entry and
  never trust the route's snapshot; settle's final status write is a guarded
  updateMany that refuses a record gone cancelled mid-settle (transaction
  marked excess instead), and cancel logs loudly if paidAmount moved while
  its Apaleo loop ran.
- A settle whose fresh basis shows nothing outstanding marks its transaction
  excess instead of posting (double-click and stale-order protection).
- Retired transactions (status completed, liveForRecordId null) are never
  re-settled: both resume scans and confirmPesapalPayment skip them.
- confirmCollected's success flip is guarded; money completing on a
  superseded order becomes excess, never ordinary revenue.
- A superseded slow winner never hands out its payment page (guarded
  orderTrackingId stamp, 409 instead).
- Legacy children (paidAt set, paidAmount 0) count as fully paid in the
  split basis, so a pre-feature crashed settle cannot be double-posted.
- /pay validates and collects against the exact unrounded remainder.

A second review pass (after the fixes above) caught three regressions those
fixes had introduced and hardened the replay surface further; all now in code:
- settlePayment re-reads the TRANSACTION fresh too, not just the record, and
  returns untouched when it finds the row already settled-and-retired. Both
  excess-marking updateMany guards require liveForRecordId not null. Without
  this, two settles of the SAME transaction (callback vs IPN) had the loser
  relabel the booking's own legitimate payment as "excess".
- beginCheckout refuses a cancelled record (409) instead of minting a fresh
  full-price order a stale pay-tab could collect.
- settlePayment skips re-posting a folio whose reading shows the share is
  already there (a crashed run of this same settle): the folio reading, not
  Apaleo's 24h idempotency key, is the durable double-post guard.
- Every folio share is clamped to what the folio owes, and the last share is
  the exact unrounded remainder, so a future cents-carrying rate cannot
  overshoot a folio into credit or strand a sub-KES sliver.
- submitFreshAttempt's loser guards its retire of a stale winner (never
  supersedes a page already handed out) and compares amounts before joining
  a winner's payment page (never collects the wrong number with consent).
- cancelBooking's drift diagnostic is wrapped so it can never 500 a
  cancellation that already succeeded and drop the cancellation email.

## Known limitations (deferred, tracked as tasks)

These are narrow, need infrastructure beyond a demo, or exercise paths this
sandbox does not (no real chargebacks, whole-KES rates). Documented rather
than built:
- Cancel refund shares are recomputed on each entry, so a cancel that
  crashes mid-Apaleo-loop and is retried across a refund-tier day boundary
  (or after a balance settle moved paidAmount) can post a share under the
  same up-refund key that no longer matches the recorded refundAmount.
  Proper fix: persist the frozen per-child shares before the first refund.
- A chargeback (Pesapal REVERSED) on a settled DEPOSIT or balance payment is
  not detected: the retired-transaction skip returns without asking Pesapal.
  The reversal detector only runs for fully "paid" records. Deposit bookings
  sit below that bar for weeks.
- A crash in the gap between the settle $transaction commit and the
  post-commit email send permanently drops that one confirmation/receipt
  email (every resume path short-circuits before reaching it).

Decided with Allan on 23 Jul 2026. The policy mirrors Center Parcs UK but with
an 8-week anchor instead of their 10 weeks.

## Ground rules for the executor

- Boring, explainable code. Match the style of the files you touch (heavy
  doc comments explaining WHY, idempotency keys on every money movement,
  once-only gates via guarded `updateMany`).
- No em dashes anywhere. Not in code, comments, copy, or commit messages.
  Use periods, commas, hyphens. British English in guest-facing copy.
- Database changes go out with `npx prisma db push` against the local dev
  database only (brew postgresql@15, database `unity_parks_dev`). NEVER run
  `prisma migrate`. Never touch the Railway database; Allan pushes that
  himself.
- Apaleo owns inventory and money movements. We own the commercial rules.
  Never invent an amount locally that a folio could tell us.
- Money amounts are whole KES (round with `Math.round`). Comparisons against
  folio balances use a 0.01 tolerance, same as `settleBooking` does today.
- Out of scope for this plan (phase 2, do not build): reminder emails,
  auto-cancel of overdue bookings, any scheduler or jobs table. Overdue is
  display-only, derived at read time.
  - Phase 2 update, 7 Aug 2026: reminder emails are BUILT, still with no
    scheduler. "Due soon" goes out inside the 14 days up to the due date,
    "overdue" after it, each claimed once-only on the record
    (reminderUpcomingEmailAt / reminderOverdueEmailAt). The trigger is
    POST /api/ops/reminders/run: an admin button on /ops/reminders, or an
    external scheduler presenting the REMINDERS_RUN_SECRET bearer.
    Auto-cancel stays unbuilt on purpose: cancelling money a guest still
    intends to pay is a human decision, and the cancellation engine is
    already there for when a human makes it.

## The policy (source of truth)

One anchor drives everything: **the balance due date, 56 days (8 weeks)
before arrival**. Payment schedule and cancellation tiers both hang off it.

### Payment schedule

| When the guest books | What they pay at checkout |
|---|---|
| 57 or more days before arrival | Choice: 30% deposit, or full amount |
| 56 days or fewer before arrival | Full amount only |

- Deposit = 30% of the booking total, rounded to whole KES.
- Balance due date = arrival minus 56 days (ISO date).
- Between booking and arrival the guest can pay toward the balance any time
  from Manage my booking: "Pay outstanding balance" or a custom amount.
- Custom amounts: minimum KES 500, and a payment must either clear the
  balance exactly or leave at least KES 500 outstanding (so the remainder is
  always payable later).
- No stored cards, no auto-charge, ever. All payments are guest-initiated.
- Overdue (today past `balanceDueDate` with money still owed) is a derived
  display state, never a stored status.

### Cancellation tiers

The deposit is never refundable, at any tier, including bookings that were
paid in full upfront (the deposit is defined as 30% of the total for every
booking, whether or not the guest used the deposit option). Refund
percentages apply to the amount actually paid beyond the deposit.

| Days to arrival when cancelling | Refund |
|---|---|
| 57 or more | 100% of (paid minus deposit) |
| 42 to 56 | 50% of (paid minus deposit) |
| 21 to 41 | 25% of (paid minus deposit) |
| 1 to 20 | Nothing |
| 0 or negative (arrival day onwards) | Not cancellable online, call the team |

Guest-facing wording of the same table: "Cancel more than 8 weeks before
arrival and we refund everything except your deposit. 6 to 8 weeks before:
half of the balance you have paid. 3 to 6 weeks: a quarter. Less than 3
weeks: no refund. Deposits are non-refundable."

Alignment property to preserve: a guest is never holding a fully-paid
booking while still inside the deposit-only cancellation window. The day the
balance falls due (day 56) is the day penalties start climbing.

### Memories counter

Unchanged. A memory counts only when a booking reaches status `paid`
(fully paid). `deposit_paid` bookings do not count. `server/memories.ts`
already filters on `status: "paid"` and needs no change; do not touch it.

## Architecture overview (read before coding)

Today: one payment per booking. `beginCheckout` collects the full total
(via Pesapal or the simulated provider), `settleBooking` pays every folio in
full, `status` goes `created -> paid`.

After this plan: a booking can receive many payments. Every payment attempt,
simulated included, is a `PesapalTransaction` row with an `amount` and a
`kind` ("checkout" for the Buy-now payment, "balance" for later top-ups). A
generalised `settlePayment` distributes one collected amount across the
lodge folios pro rata. The split is computed from our own bookkeeping
(`grossAmount - paidAmount`, stable across replays of the same transaction)
while the resulting paid state is derived from the folios afterwards, so
every crash recovery is "run it again": idempotent posts, deterministic
split, derivation reads the truth. `status` becomes
`created -> deposit_paid -> paid` (or `created -> paid` directly when the
guest pays in full).

The existing serializer (`liveForRecordId` unique column) already guarantees
one live payment attempt per booking at a time and is reused unchanged for
balance payments.

---

## Step 1: shared policy module + tests

New file `lib/paymentPlan.ts`. Client-safe (no server imports, no Prisma), so
both React components and server code use the same numbers. Contents:

```ts
export const DEPOSIT_PERCENT = 30;
export const BALANCE_DUE_DAYS = 56;
export const MIN_PART_PAYMENT = 500; // KES

export function depositAmountFor(total: number): number; // round(total * 0.3)
export function balanceDueDateFor(arrivalIso: string): string; // arrival - 56 days, ISO date
export function daysBetween(todayIso: string, arrivalIso: string): number; // whole days, UTC
export function isDepositEligible(daysToArrival: number): boolean; // daysToArrival > BALANCE_DUE_DAYS

// Cancellation tiers. 100 at 57+, 50 at 42..56, 25 at 21..41, else 0.
export function refundPercentFor(daysToArrival: number): number;

// The whole refund computation as a pure function so it is testable
// without a database. effectivePaid and deposit semantics per the policy.
export function computeRefund(input: {
  total: number;
  paidAmount: number;   // 0 for legacy rows, see fallback rule below
  depositAmount: number | null; // null for legacy rows
  daysToArrival: number;
}): { refundPercent: number; depositKept: number; refundAmount: number; keptAmount: number };

// Part-payment validation: amount === outstanding, or
// (amount >= MIN_PART_PAYMENT && outstanding - amount >= MIN_PART_PAYMENT).
export function isValidPartPayment(amount: number, outstanding: number): boolean;
```

`computeRefund` rules: `deposit = depositAmount ?? Math.round(total * DEPOSIT_PERCENT / 100)`
(the fallback covers records created before this feature).
`refundBase = max(0, paidAmount - deposit)`. `refundAmount = round(refundBase * pct / 100)`.
`keptAmount = paidAmount - refundAmount`.

New file `lib/paymentPlan.test.ts` (vitest, mirror the style of
`server/booking/rules.test.ts`). Must cover at minimum:

- `balanceDueDateFor("2026-10-30")` is `"2026-09-04"`.
- Eligibility boundary: 57 days eligible, 56 not.
- Tier boundaries: 57 -> 100, 56 -> 50, 42 -> 50, 41 -> 25, 21 -> 25, 20 -> 0, 1 -> 0.
- `computeRefund` with deposit-only paid (paidAmount == deposit) refunds 0 at every tier.
- `computeRefund` legacy fallback: `depositAmount: null` derives 30%.
- Rounding: total 99_999 gives deposit 30_000.
- `isValidPartPayment`: exact-outstanding always valid; 499 invalid; payment
  leaving 300 outstanding invalid; payment leaving 500 outstanding valid.

Done when: `npx vitest run lib/paymentPlan.test.ts` passes.

## Step 2: schema changes

Edit `prisma/schema.prisma`:

`BookingRecord` gains (place near the existing status/paidAt block, with a
comment in the file's voice):

```prisma
  // Payment plan. Set at record creation for every new booking: the deposit
  // is 30% of the total and the balance falls due 56 days before arrival,
  // whether or not the guest used the deposit option. Null on records from
  // before the feature; readers fall back to computing 30% on the fly.
  depositAmount  Float?
  balanceDueDate String? // ISO YYYY-MM-DD, arrival minus 56 days
  // Sum of the children's paidAmount, derived from folio balances at settle
  // time. 0 on legacy rows; a legacy "paid" record is read as fully paid.
  paidAmount     Float   @default(0)
```

Update the `status` comment to `created | deposit_paid | paid | failed | cancelled`.

`BookingReservation` gains:

```prisma
  // Money recorded on this folio so far, derived (grossAmount minus the
  // folio balance) after each settle. paidAt stays "fully paid" only.
  paidAmount Float @default(0)
```

`PesapalTransaction` gains:

```prisma
  // What this payment is for: "checkout" (the Buy-now payment, deposit or
  // full) or "balance" (a later top-up from Manage my booking). Decides the
  // callback redirect and which email the settle sends.
  kind String @default("checkout")
  // Once-only stamp for the balance-payment receipt email, same discipline
  // as BookingRecord.confirmationEmailAt.
  receiptEmailAt DateTime?
```

Run `npx prisma db push` against local dev, then `npx prisma generate`.

Done when: db push succeeds and `npx tsc --noEmit` (or the project's build)
still passes.

## Step 3: settle refactor in `server/booking/checkout.ts`

This is the heart. Work carefully and keep every existing comment that still
tells the truth.

### 3a. Simulated payments become transactions too

In `beginCheckout`, the simulated branch must create a `PesapalTransaction`
row (kind from the caller, `status: "completed"`, `paymentMethod: "Simulated"`,
`orderTrackingId: null`, amount = the amount being collected, and
`liveForRecordId: record.id` claimed the same way `submitFreshOrder` does,
including the race handling) and then call the new `settlePayment`. This
unifies bookkeeping: every payment, simulated or real, is one transaction row,
and idempotency keys derive from the transaction id.

### 3b. `beginCheckout(sessionId, paymentChoice)`

New signature: `beginCheckout(sessionId: string, paymentChoice: "deposit" | "full")`.

- `ensureRecord` changes: after computing `total` from the folios, also
  compute `depositAmount = depositAmountFor(total)` and
  `balanceDueDate = balanceDueDateFor(session.arrival)` and store both on the
  record at creation. Every new record gets them, regardless of choice.
- Server-side eligibility: `deposit` is honoured only when
  `isDepositEligible(daysBetween(todayIso, session.arrival))`. Otherwise
  silently treat as `full` (the UI hides the option, this is belt and braces).
- Early return: if `record.status` is `"deposit_paid"` or `"paid"`, return
  `{ kind: "paid", record }` (the Buy-now moment is over; top-ups happen via
  the Manage endpoint). The PayClient already routes this to the confirmation
  page.
- Amount for a fresh order: `deposit` ->
  `record.depositAmount ?? depositAmountFor(record.totalGrossAmount)` (the
  fallback covers records created before this feature that resume checkout
  after deploy), `full` -> `record.totalGrossAmount`. Snapshot it on the
  transaction row as today.
- Resume paths: completed-but-unsettled and the mismatch wedge stay exactly
  as they are. The open-pending-order path gains one rule: if the open
  order's `amount` does not match the amount the current choice asks for
  (the guest abandoned a deposit order and now wants to pay in full, or the
  reverse), flip it to `superseded` (guarded on `status: "pending"`, clear
  `liveForRecordId`) and submit a fresh order instead of re-offering the
  stale payment page. If the guest later pays the superseded page anyway,
  the existing excess/wedge machinery is the backstop: it records the money
  loudly for a human instead of corrupting the folios.

### 3c. Replace `settleBooking` with `settlePayment`

`settlePayment(record, session, transaction)` where `transaction` is the
completed `PesapalTransaction` (simulated ones included). Semantics, in
order:

1. Cancelled guard: if `record.status === "cancelled"`, do NOT touch the
   folios. Flip the transaction to `excess` (guarded updateMany from
   `completed`), clear `liveForRecordId`, `console.error` loudly with ids,
   and return the record unchanged. Money landing on a cancelled booking is
   a reconciliation case, never a resurrection of the booking.
2. Children: same legacy fallback as `cancelBooking` (synthesise a slot-0
   child from the record columns when `record.reservations` is empty). A
   synthetic child has no row to update later: apply its updates to the
   record columns only.
3. Compute the split basis from OUR bookkeeping, never the live folio:
   `remaining_i = child.grossAmount - child.paidAmount`,
   `totalRemaining = sum(remaining_i)`. These DB values only change at the
   END of a successful settle (step 9), so a replay of this same transaction
   always computes the same split. Do NOT split on live folio balances: a
   crash between two payFolio posts changes the balances, so a replay would
   compute a different split while reusing the same idempotency keys, and
   money would be recorded twice.
4. Over-collection guard: if `transaction.amount > totalRemaining + 0.01`,
   log "Collected payment exceeds outstanding balance" with ids and throw
   the existing 502 PublicError ("Your booking changed while the payment was
   in progress. Please contact us - do not pay again."). Collecting less
   than the total is normal now (that is what a deposit is).
5. Folio sanity check (replaces today's equality check), AFTER computing the
   shares: read the folio of every child with `remaining_i > 0`. TWO
   readings are legitimate: `abs(balance) == remaining_i` (untouched) and
   `abs(balance) == remaining_i - share_i` (this share already posted by an
   earlier run of this same settle that crashed before its DB writes).
   Anything else means something touched the folio behind our back: log
   "Folio drifted from local bookkeeping" and throw the same 502 wedge
   before any money is posted.
6. Split `transaction.amount` pro rata on `remaining_i`:
   `share_i = round(amount * remaining_i / totalRemaining)`, then fix
   rounding drift by adjusting the LAST nonzero share so the sum equals
   `amount` exactly. Skip children with `share_i == 0`.
7. Post each share with `payFolio`, idempotency key
   `up-pay-${transaction.id}-${child.slot}` (per transaction, not per
   session: a booking now sees many payments). Keep the existing ApaleoError
   handling and "press Buy now again" messaging for checkout-kind payments;
   for balance-kind use "Your payment was received but recording it failed.
   Try again from Manage my booking, you will not be charged twice."
8. Re-read each touched folio and derive:
   `child.paidAmount = child.grossAmount - abs(newBalance)`, and
   `child.paidAt = now` only when the new balance is 0 (keep the existing
   "never blank the winner's paymentId" guard). Deriving from the folio
   makes replays converge: payFolio is idempotent per key, so however many
   times this runs, the folio holds each share exactly once and the
   derivation reads the same truth.
9. Apply EVERY DB write in one prisma.$transaction: the child updates, the
   record update (`paidAmount = sum(children paidAmount)`, for the legacy
   synthetic child written straight to the record;
   `status = outstanding <= 0.01 ? "paid" : "deposit_paid"`; `paidAt` only
   when fully paid; the existing userId adoption logic unchanged), and the
   transaction retirement (`liveForRecordId: null`, without which a settled
   checkout transaction would block the guest's first balance payment
   forever). Atomicity is what keeps the split basis honest: a partial set
   of child updates would change `remaining_i` on the next replay and
   re-split money that was already posted.
11. `session.state = "completed"` only for checkout-kind transactions.
12. Emails: checkout kind -> `sendBookingConfirmation(record.id)` (step 6
    extends it with balance lines). Balance kind ->
    `sendBalanceReceipt(transaction.id)` (new module, step 6).

Callers to update: `beginCheckout` (all four call sites),
`confirmPesapalPayment` (both call sites). `confirmPesapalPayment` also has a
`record.status === "paid"` early path (`confirmAgainstPaidRecord`); that
check stays exactly `"paid"`: a `deposit_paid` record with a completed
transaction must proceed to settle, not be treated as already done. Verify
`confirmAgainstPaidRecord`'s excess-collection logging still makes sense (it
does: money landing on a FULLY paid booking is still excess).

Done when: with the simulated provider, a booking more than 57 days out can
be created with `payment: "deposit"` and lands in `deposit_paid` with 30%
recorded on the folios (check the Apaleo folio balances), and a
`payment: "full"` booking lands in `paid` exactly as before.

## Step 4: checkout route and the balance-payment endpoint

### 4a. `app/api/session/[id]/checkout/route.ts`

Accept an optional JSON body `{ payment?: "deposit" | "full" }`, default
`"full"`, reject other values with a 400. Pass it to `beginCheckout`.

### 4b. New route `app/api/booking/[bookingId]/pay/route.ts`

Mirror the structure of `cancel/route.ts` (same `loadRecord`, same
`assertBookingAccess` proof handling). POST only: there is no GET here. The
balance state (total, paid, due date) rides the existing booking GET (step
7e) so there is exactly one read path, and the clients derive outstanding
and overdue with `lib/paymentPlan`.

- `POST` body `{ amount?: number }`, absent meaning "the whole outstanding".
  `outstanding = totalGrossAmount - paidAmount`. Validation order: record
  exists, access proof, `status === "deposit_paid"`
  (400 otherwise: "This booking has no outstanding balance." for paid,
  "This booking is not payable." for the rest), amount is a whole number and
  `isValidPartPayment(amount, outstanding)` (400 with the rule spelled out).
  Then:
  - Simulated provider: create the completed transaction (kind "balance")
    and `settlePayment` inline, return `{ status: record.status }`.
  - Pesapal: run the same machinery as `beginCheckout`'s Pesapal path but
    with `kind: "balance"` and the requested amount: mismatch wedge check,
    resume a completed-unsettled transaction, re-offer an open pending
    order's redirectUrl, else submit a fresh order. Return
    `{ status: "redirect", redirectUrl }`.
  Extract the shared attempt machinery from `beginCheckout` into a helper
  rather than copying it (`runPaymentAttempt(record, session, kind, amount, ipnId)`
  returning the same union type). Keep the extraction mechanical: the
  existing comments move with the code.

### 4c. Callback redirect by kind

`app/api/payments/pesapal/callback/route.ts` currently sends every completed
payment to the confirmation page. Change: look at the settled transaction's
`kind`. `checkout` -> confirmation page (unchanged, including the ?session=
proof). `balance` -> `/manage/${bookingId}?session=${sessionId}&payment=success`
(reuse the existing failure/pending param convention the pay page uses, but
target the manage page: `payment=failed` and `payment=pending` land back on
manage too for balance-kind transactions). Check the IPN route needs no
change (it only confirms, never redirects).

Done when: with the simulated provider, POST to `/pay` with a part amount
moves `paidAmount` up and leaves status `deposit_paid`; paying the exact
outstanding flips the record to `paid`.

## Step 5: cancellation rewrite

`server/booking/cancellation.ts`:

- Delete the local `FULL_REFUND_DAYS`/`HALF_REFUND_DAYS`/`refundPercentFor`
  and import from `lib/paymentPlan` instead.
- Rewrite the file header comment with the new tier table.
- `quoteCancellation`:
  - Cancellable statuses are now `"paid"` and `"deposit_paid"` (update the
    not-cancellable reason copy to "Only paid or deposit-paid bookings...").
  - `effectivePaid = record.paidAmount > 0 ? record.paidAmount : (record.status === "paid" ? record.totalGrossAmount : 0)`
    (the legacy fallback).
  - Call `computeRefund({ total, paidAmount: effectivePaid, depositAmount: record.depositAmount, daysToArrival })`.
  - Extend `CancellationQuote` with `paidAmount` and `depositKept` so the UI
    can explain the deposit line. Keep every existing field so the manage
    page keeps working while it is being updated.
- `cancelBooking`:
  - The guarded flip becomes `status: { in: ["paid", "deposit_paid"] }`.
  - Per-child refunds: a child's effective paid is
    `child.paidAmount > 0 ? child.paidAmount : (record.status === "paid" ? child.grossAmount : 0)`.
    Child refund share = `round(quote.refundAmount * childPaid / totalEffectivePaid)`
    with the last-nonzero-share rounding corrector (same pattern as settle).
    Skip zero shares. Idempotency keys unchanged
    (`up-refund-${record.id}-${child.slot}`).
  - The recorded `refundAmount` is the sum of the shares actually posted,
    as today.
- `app/api/booking/[bookingId]/cancel/route.ts` needs no change (it already
  just proxies quote/execute).

Done when: unit tests from step 1 pass, and a simulated `deposit_paid`
booking cancelled 60+ days out refunds 0 (deposit kept) while a fully paid
one cancelled 60+ days out refunds total minus deposit.

## Step 6: emails

- `server/email/bookingConfirmation.ts`: when the record is not fully paid,
  add lines (text and HTML): amount paid today, outstanding balance, and
  "Your balance of KES X is due by DATE. Pay any time from Manage my
  booking." Fully paid confirmations are unchanged.
- New `server/email/balanceReceipt.ts`, modelled line-for-line on
  `bookingCancellation.ts`: once-only claim on
  `PesapalTransaction.receiptEmailAt`, subject
  "Payment received · {reference}", body with amount received, total paid so
  far, outstanding (or "Your break is now paid in full." when zero) and the
  due date when a balance remains. Same swallow-all-failures discipline:
  email must never disturb a settled payment.
- `bookingCancellation.ts` copy: the refund lines already speak in amounts,
  but the "kept" maths reads from `totalGrossAmount`. Change `kept` to
  `paidAmount - refunded` using the same legacy fallback as the quote (a
  cancelled record stores `refundAmount`; add `paidAmount` to the email's
  record read). Add the line "Deposits are non-refundable." when a deposit
  was kept.

Done when: simulated deposit checkout sends a confirmation mentioning the
due date; a simulated balance payment sends one receipt (and only one on
retries, check `receiptEmailAt`).

## Step 7: UI

### 7a. PayClient (`app/checkout/pay/PayClient.tsx`)

- Compute `daysToArrival` from `session.arrival` with `lib/paymentPlan`
  helpers and today's date; when eligible, render a radio group above the
  pay button: "Pay in full · KES {total}" (default) and "Pay 30% deposit ·
  KES {depositAmountFor(total)} today". Under the deposit option, small
  text: "The remaining KES {total - deposit} is due by {formatDate(balanceDueDateFor(arrival))}.
  Pay any time from Manage my booking." Note in a code comment that the
  display amount is advisory: the server recomputes from folio totals, which
  can differ if a location fee is dropped at checkout.
- The button label uses the chosen amount. POST body becomes
  `JSON.stringify({ payment: choice })`.
- The "One payment covers your whole break" copy: keep for full, swap for a
  deposit-appropriate sentence when the deposit option is selected.

### 7b. ManageClient (`app/manage/[bookingId]/ManageClient.tsx`)

- In `load()`, the quote fetch condition `result.data.status === "paid"`
  must become `status === "paid" || status === "deposit_paid"`, or the
  cancel card silently disappears for deposit bookings.
- Balance state comes straight off the booking payload (7e) plus
  `lib/paymentPlan`: `outstanding = totalGrossAmount - paidAmount`,
  `overdue = outstanding > 0 && today > balanceDueDate`. Render the balance
  card only when `status === "deposit_paid"`.
- New card "Your balance", placed above the cancel card: rows for total,
  paid so far, outstanding, due date; an overdue banner (bronze border, mist
  background, "Your balance was due on DATE. Pay now to keep your break.")
  when overdue.
- Two actions: "Pay outstanding balance · KES X" (primary) and a custom
  amount input with a "Pay this amount" outline button. Client-validate with
  `isValidPartPayment` and surface the rule as helper text ("Minimum KES
  500, and a part payment must leave at least KES 500 to pay later, or clear
  the balance exactly."). POST to `/api/booking/{id}/pay{proofQuery}`;
  redirect responses navigate with `window.location.assign`, non-redirect
  responses `load()` again.
- Handle the `?payment=` return params like the pay page does (success
  banner, pending, failed).
- Update the cancellation policy sentence to the guest-facing wording from
  the policy section, and when the quote includes a kept deposit, show
  "Your KES X deposit is non-refundable." inside the quote box.
- The status pill: `deposit_paid` shows "Deposit paid · KES X outstanding"
  (bronze outline style), plus the folio pill logic already present.

### 7c. ConfirmationClient (`app/confirmation/[bookingId]/ConfirmationClient.tsx`)

- `status === "deposit_paid"` renders the celebration as normal (the booking
  IS confirmed) with the pill reading "Deposit paid" instead of "Paid in
  full", plus a mist panel: "Balance of KES X due by DATE" with a link to
  the manage page.

### 7d. Account page (`app/account/page.tsx`)

- Badge for `deposit_paid`: bronze outline, "Deposit paid". When
  `balanceDueDate` is past and the record is still `deposit_paid`, the badge
  reads "Balance overdue" (red-tinted: `border border-[#b3261e] text-[#b3261e]`).
- Under the price, for `deposit_paid` rows: small text
  "KES X still to pay · due {date}".

### 7e. API payload (`app/api/booking/[bookingId]/route.ts` and `lib/types.ts`)

Add `depositAmount`, `balanceDueDate`, `paidAmount` to the GET response and
to the `BookingConfirmation` type, with one legacy fallback applied
server-side: report `paidAmount = totalGrossAmount` when
`status === "paid"` and the stored `paidAmount` is 0 (records from before
this feature), so no client ever computes a phantom outstanding balance on
an old booking. Everything else the clients derive with `lib/paymentPlan`.

### 7f. Amend route (`app/api/booking/[bookingId]/amend/route.ts`)

Keep the `status !== "paid"` guard (moving a break stays a fully-paid-only
feature: a move re-prices the folio and would desync the payment plan) but
change the refusal message for `deposit_paid`: "Pay your remaining balance
first, then move your break."

Done when: the full simulated walkthrough in the Verification section works
end to end in the browser.

## Step 8: docs and copy sweep

- `docs/DESIGN.md`: already updated with the policy copy section (done in
  the same session that wrote this plan). Verify it matches what you built.
- `docs/FEATURES-REPORT.md` and `docs/Center Parcs Parity Checklist.md`:
  flip the deposit/balance rows to built once shipped, with a one-line
  description and date, following the style of the "Cancel my booking" row.
- Grep for the old policy copy ("28 or more days", "8 to 27") across the
  repo; the only expected hit is ManageClient (fixed in 7b) but a stray in
  content/ or emails must be caught.

## Verification (manual, simulated provider, local dev)

Run through in the browser with `PAYMENTS_PROVIDER=simulated`:

1. Book a break with arrival more than 57 days out, choose the deposit
   option. Confirmation page shows "Deposit paid" and the due-date panel.
   Account list shows the bronze badge. Apaleo folio shows a payment of
   exactly the deposit.
2. Manage page: balance card shows correct paid/outstanding. Pay a custom
   KES 500. Outstanding drops, receipt email logged, status still
   deposit_paid.
3. Try to pay an amount leaving KES 300 outstanding: refused with the rule.
4. Pay the outstanding balance. Status flips to paid, pill goes green,
   memories counter moves (homepage), folio settles to 0.
5. Book another deposit booking, cancel it from Manage. Refund 0, deposit
   kept, cancellation email says the deposit is non-refundable. Folio shows
   no refund posting.
6. Book a full-payment booking 60+ days out, cancel. Refund = total minus
   deposit; folio refund postings match per lodge.
7. Book with arrival inside 56 days: no deposit option appears; POST with
   `payment: "deposit"` forced via curl still collects the full amount.
8. Multi-lodge deposit booking: deposit splits pro rata across both folios
   and the rounding corrector keeps the sum exact.
9. `npx vitest run` green, build green.

With Pesapal (sandbox, one pass, optional locally, required before Railway):
deposit checkout redirects to the hosted page, card sim completes, callback
lands on confirmation; balance payment from Manage redirects and returns to
Manage with the success banner. Remember the sandbox quirks: an INVALID
status means pending, and the shared merchant rate-limits order submissions
(the reuse-open-order path exists for exactly this).

## Execution order recap

1. `lib/paymentPlan.ts` + tests
2. Schema + db push
3. Settle refactor + beginCheckout choice
4. Checkout route body + /pay endpoint + callback kinds
5. Cancellation rewrite
6. Emails
7. UI (PayClient, ManageClient, ConfirmationClient, account, types, amend copy)
8. Docs sweep + full verification

Steps 1 and 2 are safe to land alone. Step 3 must land with 4a (the route
passes the choice) but the app remains fully working after each step because
the default choice is "full", which reproduces today's behaviour exactly.
