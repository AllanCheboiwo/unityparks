# Failure catalogue for the core money path (LO-14)

Status: in-review (batch path: docs only, no product code; interview and test freeze not applicable)
Linear: UNP-35
Branch: unp-35-failure-catalogue

One row per thing that can fail between a guest pressing Buy now and the
money landing in Apaleo, the inbox and Zoho. Every row was checked against
the code on 12 Sep 2026, and each cites the line it was checked at. The
guides in docs/guides say what happens in plain words; this file says
where, and whether anyone finds out.

The catalogue decides which alerts, jobs and tests matter for the rest of
the D-9 order (LO-15 cron, LO-20 pay links, LO-1 refunds, LO-2 reminders).
Rows marked GAP have no automatic recovery and no durable signal today.
Each GAP is a Linear issue, listed at the end.

## How to read a row

- **Signal** is what a human sees: `alert` is an OpsAlert row plus the ops
  email; `sentry` is logError; `console` is Railway logs only; `none` is
  nothing.
- **Recovery** is `auto` when the next request, run or retry heals it with
  no person involved; `rerun` when a person or scheduler must trigger an
  idempotent step again; `manual` when a person must act outside the app.
- **Human** is the action, if any.

Cross-cutting facts the rows rely on:

- Apaleo calls retry 429 twice and 5xx once, then throw
  (`server/apaleo/client.ts:71`). Posts carry an idempotency key when the
  caller supplies one.
- Pesapal calls never retry; any transport or body error throws
  (`server/pesapal/client.ts:77`).
- Resend returns an error result on a non-2xx reply but throws on a
  transport failure (`server/email/resend.ts:34`). No API key means the send
  is skipped and the stamp kept.
- `handleRoute` turns Apaleo 422 into a 409 sold-out, other Apaleo errors
  into 502, Pesapal errors into 502 "nothing was charged", everything else
  into 500 with logError (`server/api-helpers.ts:27`).
- `raiseOpsAlert` writes one OpsAlert row and emails OPS_ALERT_EMAIL,
  swallowing its own failures (`server/ops/alerts.ts:15`).
- logError (Sentry) is called only in `server/api-helpers.ts`, the Pesapal
  callback and IPN routes, and three non-money routes. The money core in
  `server/booking`, `server/zoho` and `server/email` uses console only.
  UNP-34 tracks the sweep.
- No scheduler exists in the repo. Every run route is an external POST or
  an admin button (LO-15).

## 1. Booking creation (Apaleo reservation and record)

Entry: `app/api/session/[id]/checkout/route.ts:13` -> `beginCheckout`
(`server/booking/checkout.ts:95`) -> `ensureRecord` (`:591`).

| # | Failure | State left | Signal | Recovery | Human |
|---|---|---|---|---|---|
| 1.1 | PESAPAL_IPN_ID unset | Nothing created; 500 before any Apaleo write (`checkout.ts:102`) | sentry | manual | Set the variable. |
| 1.2 | Apaleo createBooking fails or times out | No record; idempotency key `up-book-<sessionId>` (`:687`) makes the retry safe | sentry (502) or console (422 sold-out -> 409) | auto on retry | None. |
| 1.3 | Chosen unit gone (422) | Location fee removed, auto-assign fallback (`:898`) | console | auto | None. |
| 1.4 | Crash between fee removal and record creation, and the blocking guest cancels in the window | Guest undercharged by the fee; documented accepted hole (`:865`) | none | manual | Nobody is told. See GAP-6. |
| 1.5 | Folio read fails after reservation exists | Reservation exists, no record; retry re-reads and adopts via `up-book` key | sentry | auto on retry | None. |
| 1.6 | Two tabs create the record at once | P2002 on `sessionId` adopts the winner (`:783`) | none | auto | None. |
| 1.7 | Referral or repeat-offer allowance post fails | Reservation exists, record not yet created; retry re-runs the post (`:716`, `:727`) | sentry | auto on retry | Check the folio for a duplicate allowance if the retry was after a partial post. |

## 2. Pesapal checkout redirect

Entry: `runPaymentAttempt` (`checkout.ts:160`) -> `submitFreshAttempt` (`:240`).

| # | Failure | State left | Signal | Recovery | Human |
|---|---|---|---|---|---|
| 2.1 | Pesapal submitOrder fails | Pending row exists without a tracking id (`:258` before `:332`); next Buy now retires it after two minutes (`:299`) and starts fresh | sentry (502) | auto on retry | None. |
| 2.2 | Crash after submitOrder, before stamping the tracking id | Row pending, tracking id lost; Pesapal may still collect. Guarded stamp misses -> id stored alone (`:360`) so a late payment lands as excess, not unknown | console | auto | Refund the excess if the guest paid on the orphaned page. |
| 2.3 | Guest opens two payment pages | `liveForRecordId` unique mutex; same amount joins, different amount 409 (`:286`) | none | auto | None. |
| 2.4 | Guest returns with an open pending row | Re-checked against Pesapal (`:200`); settled, re-offered or retired | none | auto | None. |
| 2.5 | Any mismatch row on the record | Every new attempt refused with 502 (`:177`) | console at creation, none after | manual | Investigate, refund, and clear the row by hand. See GAP-2. |

## 3. Callback and IPN

Entries: `app/api/payments/pesapal/callback/route.ts:13`,
`app/api/payments/pesapal/ipn/route.ts:45`, both -> `confirmPesapalPayment`
(`checkout.ts:386`).

| # | Failure | State left | Signal | Recovery | Human |
|---|---|---|---|---|---|
| 3.1 | Guest closes the browser on Pesapal's page | IPN confirms; if no IPN, the next Buy now re-checks (row 2.4) | none | auto | None. |
| 3.2 | IPN delivery fails or is never registered | Payment recorded only when the guest returns | none | auto on guest return, else stuck | Nobody is told a payment is unrecorded. See GAP-5. |
| 3.3 | Callback throws | logError, guest redirected to `?payment=error` (`callback/route.ts:47`) | sentry | auto on retry | None. |
| 3.4 | IPN throws | logError, reply body status 500 so Pesapal retries (`ipn/route.ts:33`) | sentry | auto | None. HTTP status is still 200, so an uptime monitor sees nothing. |
| 3.5 | IPN called by anyone with a guessed tracking id | Handler re-asks Pesapal for truth; downstream guarded. No auth check | none | auto | None for money. Abuse is probing and load, not theft. GAP-4. |
| 3.6 | Pesapal reports a different amount or currency | Row flipped to mismatch, 502 to guest (`:523`) | console | manual | Refund or reconcile by hand. GAP-2. |
| 3.7 | Paid order was already retired (superseded or failed) | Row flipped to excess (`:566`) | console | manual | Refund the excess. GAP-2. |
| 3.8 | Chargeback after full payment | Row flipped to reversed (`:471`); booking stays paid | console | manual | Decide whether to cancel and chase. GAP-2. |
| 3.9 | Chargeback on a deposit-only booking | Not detected; `confirmAgainstPaidRecord` runs only for `paid` records (`:463`) | none | manual | Notice it in Pesapal's own dashboard. GAP-3. |

## 4. Folio post (settle)

Entry: `settlePayment` (`checkout.ts:1104`).

| # | Failure | State left | Signal | Recovery | Human |
|---|---|---|---|---|---|
| 4.1 | Money lands on a cancelled booking | Row -> excess, nothing posted (`:1133`) | console | manual | Refund. GAP-2. |
| 4.2 | Money lands with nothing outstanding | Row -> excess (`:1186`) | console | manual | Refund. GAP-2. |
| 4.3 | Amount exceeds what is owed | 502, row stays completed, nothing posted (`:1207`) | console | manual | Investigate and refund the difference. GAP-2. |
| 4.4 | Folio changed behind our back | 502, alert `folio_drift` (`:1270`) | alert | manual | Reconcile the folio, then let the guest retry or post by hand. |
| 4.5 | Apaleo payFolio fails on one slot | Completed slots keyed `up-pay-<txn>-<slot>` (`:1303`), retry skips them; 502 to guest | console | auto on retry (guest, callback or IPN) | None, unless the guest never returns and no IPN arrives (row 3.2). |
| 4.6 | Postgres transaction fails after the folio post | Folios paid, record still unpaid; retry re-reads folios as already-posted (`:1256`) and writes the record | sentry | auto on retry | None. |
| 4.7 | Booking cancelled between folio post and record write | Record stays cancelled, row -> excess (`:1373`) | console | manual | Refund the posted money from the cancelled folio. GAP-2. |
| 4.8 | Referral earn flip races with a twin settle | `skipDuplicates` ledger insert, guarded flip (`:1407`) | none | auto | None. |
| 4.9 | Zoho push after settle fails | Deliberately unawaited (`:1482`); see section 8 | console | auto (outbox) | None. |

## 5. Confirmation and receipt emails

Entries: `server/email/bookingConfirmation.ts:50`, `balanceReceipt.ts`,
`extrasReceipt.ts`, `bookingCancellation.ts`, `referralReward.ts`.

| # | Failure | State left | Signal | Recovery | Human |
|---|---|---|---|---|---|
| 5.1 | Resend replies non-2xx | Stamp released (`bookingConfirmation.ts:200`), but nothing re-sends it: no scheduler touches confirmations | console | none | Nobody is told. GAP-1. |
| 5.2 | Resend transport throws (DNS, reset) | Stamp stays set; outer catch only logs (`:209`). Same in balanceReceipt `:122`, bookingCancellation `:156`, extrasReceipt `:159`, referralReward `:138`. Email permanently lost | console | none | GAP-1. |
| 5.3 | Crash between record write and send | Stamp never claimed, email never sent; no resend button (guide, how-payments-work) | none | none | GAP-1. |
| 5.4 | RESEND_API_KEY unset | Send skipped, stamp kept by design | console | manual | Set the variable. Emails from before it was set are lost. |
| 5.5 | Duplicate send from a twin settle | Claim-first guarded update (`:54`) | none | auto | None. |

## 6. Reminder emails

Entry: `app/api/ops/reminders/run/route.ts:13` -> `runBalanceReminders`
(`server/booking/reminders.ts:72`).

| # | Failure | State left | Signal | Recovery | Human |
|---|---|---|---|---|---|
| 6.1 | Nobody triggers the run | No reminders go out at all; no scheduler in repo | none | rerun | Press the button or set up cron. LO-15. |
| 6.2 | Send fails, either reply or throw | Stamp released in both paths (`balanceReminder.ts:148`, `:163`); next run retries | console | auto on next run | None. This is the correct pattern the emails in section 5 lack. |
| 6.3 | Booking paid between listing and sending | Status filter inside the claim (`:47`) blocks the send | none | auto | None. |
| 6.4 | Overdue and never paid | Nothing auto-cancels by design (`reminders.ts:12`); reminder link goes to /manage, no deep pay link (LO-20) | none | manual | Decide whether to cancel. LO-2. |

## 7. Cancellation and refund

Entry: `app/api/booking/[bookingId]/cancel/route.ts:43` -> `cancelBooking`
(`server/booking/cancellation.ts:145`).

| # | Failure | State left | Signal | Recovery | Human |
|---|---|---|---|---|---|
| 7.1 | Apaleo cancel or refundFolio fails on one lodge | Earlier lodges done, record not yet cancelled; every step idempotent (`cancel.ts:11`, key `up-refund-<record>-<slot>`), 502 to guest | console (502) | auto on retry | None. If the guest gives up, a person re-runs the cancel. |
| 7.2 | Refund recorded but never sent | Folio carries a refund line, no Pesapal refund exists anywhere in `server/pesapal`. Email says money was refunded | none | manual | Refund through Pesapal by hand. UNP-30, LO-1. |
| 7.3 | Balance payment lands mid-cancel | Alert `mid_cancel_drift` (`:258`) | alert | manual | Refund the difference. |
| 7.4 | Payment lands after cancel | Row -> excess (row 4.1) | console | manual | GAP-2. |
| 7.5 | Extras order in flight during cancel | Order rolled back and failed; charge may sit on the cancelled folio (`extras.ts:588` verifies and logs) | console | manual | Check the folio. GAP-2. |
| 7.6 | Cancellation not exported to Zoho | Invoice stands with no credit note | none | manual | Credit note by hand in Zoho. UNP-13. |
| 7.7 | Cancellation email fails | Same as 5.2 | console | none | GAP-1. |

## 8. Zoho outbox drain

Entries: `pushZohoAfterSettle` (`server/zoho/wire.ts:168`),
`app/api/ops/zoho/run/route.ts:12` -> `runZohoExports`.

| # | Failure | State left | Signal | Recovery | Human |
|---|---|---|---|---|---|
| 8.1 | Zoho env missing or token refresh fails | Row stays pending, attempts counted | console | rerun | Fix credentials, press the drain button. |
| 8.2 | Push fails under 5 attempts | Row back to pending (`export.ts:171`); next inline push or drain retries | console | auto | None. |
| 8.3 | Push fails 5 times | Row -> failed, alert `zoho_export_failed` once (`:190`) | alert | rerun | Fix the cause, run the ops drain; failed rows are only reclaimed by an ops run (`:110`). |
| 8.4 | Row stuck in pushing after a crash | Reclaimed after 5 minutes (`STALE_PUSHING_MS`) | none | auto | None. |
| 8.5 | Outbox INSERT itself lost | Alert `zoho_export_lost` (`:296`) | alert | manual | Create the invoice by hand. |
| 8.6 | Balance row pushed before its deposit invoice exists | Oldest-first drain plus `blockedBookings` (`:148`) prevents a second invoice | none | auto | None. |
| 8.7 | Nobody presses the drain | Failed rows never retry; the run route has no scheduler secret (`zoho/run/route.ts:14`) unlike the other four | none | rerun | GAP-7, then LO-15. |
| 8.8 | Simulated demo payment | Never queued by design (`wire.ts:175`) | none | n/a | None. |

## 9. Alert inbox and runs

| # | Failure | State left | Signal | Recovery | Human |
|---|---|---|---|---|---|
| 9.1 | OPS_ALERT_EMAIL unset or send fails | Alert row written, no email (`alerts.ts:32`) | none | manual | Check /ops/alerts by hand. |
| 9.2 | Alert kinds other than folio_drift and mid_cancel_drift | Rendered as raw kind on `/ops/alerts` (`app/(site)/ops/alerts/page.tsx:25`) | alert | n/a | Read the raw kind. LO-21 ops home. |
| 9.3 | Run route secret unset | Falls through to admin login, never opens the route | none | n/a | None. |
| 9.4 | Health route green while Pesapal or Apaleo is down | By design; health checks Postgres only | none | n/a | Vendor outages show as 502s in Sentry. |

## Gaps: rows without an answer

Each is a Linear issue filed from UNP-35 on 12 Sep 2026. The register
(docs/lean-operations.md) already covers UNP-30 (refunds, LO-1), UNP-13
(credit notes), UNP-34 (logError sweep), LO-15 (cron), LO-20 (pay links),
LO-21 (ops home); those are cross-referenced, not duplicated.

| Gap | Rows | Issue | Summary |
|---|---|---|---|
| GAP-1 | 5.1, 5.2, 5.3, 7.7 | UNP-36 | Guest emails are lost silently: transport throws keep the stamp, reply errors release it but nothing retries, and there is no resend. Fix the catch to release the stamp like balanceReminder does, and add a resend path. |
| GAP-2 | 2.5, 3.6, 3.7, 3.8, 4.1, 4.2, 4.3, 4.7, 7.4, 7.5 | UNP-37 | Money states that need a human (mismatch, excess, reversed, over-collection, extras rollback drift) are console.error only. Raise an OpsAlert for each so the inbox shows them. |
| GAP-3 | 3.9 | UNP-38 | Chargeback on a deposit-only booking is undetected. |
| GAP-4 | 3.5 | UNP-39 | IPN route accepts any caller. Rate limit it, or verify the tracking id belongs to a known transaction before calling Pesapal. |
| GAP-5 | 3.2, 4.5 | UNP-40 | A collected but unrecorded payment has no sweep: if the IPN never arrives and the guest never returns, nobody knows. A periodic status check of pending rows with a tracking id closes it. |
| GAP-6 | 1.4 | none | Accepted and documented in code. Revisit only if a real case appears. |
| GAP-7 | 8.7 | UNP-41 | Zoho run route needs the same bearer-secret path as the other run routes so LO-15 can schedule it. |

## What this changes for the D-9 order

- LO-15 cron must schedule three things: reminders, the Zoho drain (after
  GAP-7), and the pending-payment sweep from GAP-5 once it exists.
- LO-1 refunds should raise its own alert kind on a failed Pesapal refund
  and close row 7.2. It should not ship before GAP-2, or its failures
  would be console-only like the rest.
- LO-17 Playwright should cover rows 3.1, 4.5 and 7.1 (interrupted flows
  that heal on retry), because those are the guarantees the money path
  actually rests on.
