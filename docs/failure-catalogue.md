# Failure catalogue for the core money path (LO-14)

Status: shipped (batch path: docs only, no product code; interview and test freeze not applicable; merged via PR #36, 12 Sep 2026)
Linear: UNP-35
Branch: unp-35-failure-catalogue

One row per thing that can fail between a guest pressing Buy now and the
money landing in Apaleo, the inbox and Zoho. Every row was checked against
the code on 11 Sep 2026, and each cites the line it was checked at. A
second, independent pass re-verified every row and added sections 8 and 9.
The guides in docs/guides say what happens in plain words; this file says
where, and whether anyone finds out.

The catalogue decides which alerts, jobs and tests matter for the rest of
the D-9 order (LO-15 cron, LO-20 pay links, LO-1 refunds, LO-2 reminders).
Rows marked GAP have no automatic recovery and no durable signal today.
Each GAP is a Linear issue, listed at the end.

## How to read a row

- **Signal** is what a human sees: `alert` is an OpsAlert row plus the ops
  email; `sentry` is logError; `console` is Railway logs only; `none` is
  nothing. When a row says "console, sentry via callback/IPN" the error is
  console-only when the guest pressed Buy now, but the callback and IPN
  routes wrap the same call in logError.
- **Recovery** is `auto` when the next request, run or retry heals it with
  no person involved; `rerun` when a person or scheduler must trigger an
  idempotent step again; `manual` when a person must act outside the app;
  `none` when nothing heals it and nobody is told.
- **Human** is the action, if any.

Cross-cutting facts the rows rely on:

- Apaleo calls retry 429 twice and 5xx once, then throw ApaleoError
  (`server/apaleo/client.ts:71`). A fetch rejection, non-JSON body or token
  failure throws a plain Error instead, which handleRoute reports as a 500
  with logError rather than a 502.
- Apaleo idempotency keys dedupe for 24 hours only (`checkout.ts:1248`).
  Every "auto on retry" row that rests on a key holds inside that window.
  Only settle reads the folio as its durable guard (`:1252`); createBooking
  and refund do not, so a retry a day later can double-book or double-refund.
- Pesapal calls never retry; any transport or body error throws
  (`server/pesapal/client.ts:77`).
- Resend returns an error result on a non-2xx reply but throws on a
  transport failure (`server/email/resend.ts:34`). No API key means the send
  is skipped and the stamp kept.
- `handleRoute` (`server/api-helpers.ts:27`): a PublicError of any status
  is returned to the guest with no logError at all. Apaleo 422 becomes a
  409 sold-out with console.warn only. Other Apaleo errors, Pesapal errors
  and unknown errors get logError, then 502, 502 and 500.
- `raiseOpsAlert` writes one OpsAlert row and emails OPS_ALERT_EMAIL,
  swallowing its own failures (`server/ops/alerts.ts:15`).
- logError (Sentry) is called only in `server/api-helpers.ts`, the Pesapal
  callback and IPN routes, the amend route, register and session details.
  The money core in `server/booking`, `server/zoho` and `server/email` uses
  console only. UNP-34 tracks the sweep.
- Checkout sessions expire 30 minutes after the last step
  (`server/booking/session.ts:12`). After that ensureRecord throws 410
  (`checkout.ts:607`).
- No scheduler exists in the repo. Every run route is an external POST or
  an admin button (LO-15).

## 1. Booking creation (Apaleo reservation and record)

Entry: `app/api/session/[id]/checkout/route.ts:13` -> `beginCheckout`
(`server/booking/checkout.ts:95`) -> `ensureRecord` (`:591`).

| # | Failure | State left | Signal | Recovery | Human |
|---|---|---|---|---|---|
| 1.1 | PESAPAL_IPN_ID unset | Nothing created; 500 before any Apaleo write (`checkout.ts:102`) | sentry | manual | Set the variable. |
| 1.2 | Apaleo createBooking fails or times out | No record; idempotency key `up-book-<sessionId>` (`:687`) makes the retry safe for 24 hours | sentry (502) or console (422 sold-out -> 409) | auto on retry | None. |
| 1.3 | Chosen unit gone (422) | Location fee removed, auto-assign fallback (`:898`) | console | auto | None. |
| 1.4 | Crash between fee removal and record creation, and the blocking guest cancels in the window | Guest undercharged by the fee; documented accepted hole (`:865`) | none | manual | Nobody is told. See GAP-6. |
| 1.5 | Folio read, allowance post or record write fails after the reservation exists (`:693` to `:795`) | Apaleo reservation holding inventory, no BookingRecord. Retry re-runs under the `up-book` key while the session lives | sentry for thrown errors; none for the referral and repeat-offer 409s (`referral/checkout.ts:323`, `repeatOffer/checkout.ts:109`), which are PublicErrors | auto on retry, within 30 minutes | None if the guest retries. |
| 1.6 | Guest abandons after 1.5, or the session expires first | Reservation exists in Apaleo with no record and no way back: ensureRecord throws 410 (`:607`). No sweep looks for record-less reservations | none | none | Find and cancel it in Apaleo by hand. GAP-8. |
| 1.7 | Two tabs create the record at once | P2002 on `sessionId` adopts the winner (`:783`) | none | auto | None. |
| 1.8 | Referral or repeat-offer allowance posted, then the record write fails | Allowance sits on the folio; a retry inside 24 hours dedupes on the key (`:716`, `:727`), one after that posts it twice | sentry | auto on retry | Check the folio for a duplicate allowance if the retry was late. |

## 2. Pesapal checkout redirect

Entry: `runPaymentAttempt` (`checkout.ts:160`) -> `submitFreshAttempt` (`:240`).

| # | Failure | State left | Signal | Recovery | Human |
|---|---|---|---|---|---|
| 2.1 | Pesapal submitOrder fails | Pending row exists without a tracking id (`:258` before `:332`); for two minutes the next Buy now gets a 409 "give it a moment" (`:299`), after that it retires the row and starts fresh (`:313`) | sentry (502) | auto on retry | None. |
| 2.2 | Process dies after submitOrder replies, before the stamp (`:332` to `:355`) | Tracking id never stored anywhere. If the guest pays on that page, the IPN and callback find no row and throw 404 (`:393`); the IPN answers 500-in-body so Pesapal retries forever. Money collected, unlinkable to any row, never marked excess | alert `payment_unlinked` (sweep) | auto (retire + alert, UNP-46) | Look up the merchant reference (the row id, in the alert) on Pesapal's side and record the payment by hand. |
| 2.3 | Row superseded while submitOrder was slow | Guarded stamp misses; tracking id stored alone (`:360`) so a late payment lands as excess (row 3.7), guest gets a 409 | none now, console when the dead order pays | auto | Refund the excess if the guest paid on the dead page. |
| 2.4 | Guest opens two payment pages | `liveForRecordId` unique mutex; same amount joins, different amount 409 (`:286`) | none | auto | None. |
| 2.5 | Guest returns with an open pending row | Re-checked against Pesapal (`:200`); settled, re-offered or retired | none | auto | None. |
| 2.6 | getOrderStatus fails on that re-check | PesapalError reaches handleRoute, which tells the guest "Nothing was charged, please try again" (`api-helpers.ts:55`). The open order may already be paid, so the message can be wrong | sentry | auto on retry | None. The handleRoute comment assumes this path is submit-only; it is not. |
| 2.7 | Any mismatch row on the record | Every new attempt refused with 502 (`:177`) | console at creation, none after | manual | Investigate, refund, and clear the row by hand. GAP-2. |

## 3. Callback and IPN

Entries: `app/api/payments/pesapal/callback/route.ts:13`,
`app/api/payments/pesapal/ipn/route.ts:45`, both -> `confirmPesapalPayment`
(`checkout.ts:386`).

| # | Failure | State left | Signal | Recovery | Human |
|---|---|---|---|---|---|
| 3.1 | Guest closes the browser on Pesapal's page | IPN confirms; if no IPN, the next Buy now re-checks (row 2.5) | none | auto | None. |
| 3.2 | IPN delivery fails or is never registered | Payment recorded only when the guest returns | none | auto within 30 min (sweep, UNP-46) | None. |
| 3.3 | Callback throws | logError, guest redirected to `?payment=error` (`callback/route.ts:47`) | sentry | auto on retry | None. |
| 3.4 | IPN throws | logError, reply body status 500 so Pesapal retries (`ipn/route.ts:33`) | sentry | auto | None. HTTP status is still 200, so an uptime monitor sees nothing. |
| 3.5 | IPN called by anyone with a guessed tracking id | No auth check. Unknown ids throw 404 (`:393`), one logError per request. Known ids re-ask Pesapal for truth; downstream guarded | sentry, one event per probe | auto | None for money. Abuse is Sentry noise and Pesapal calls, not theft. GAP-4. |
| 3.6 | Pesapal reports a different amount or currency | Row flipped to mismatch (`:523`); 502 via Buy now, `?payment=error` via callback | console, sentry via callback/IPN | manual | Refund or reconcile by hand. GAP-2. |
| 3.7 | Paid order was already retired (superseded or failed) | Row flipped to excess (`:566`, `:488` for paid records) | console | manual | Refund the excess. GAP-2. |
| 3.8 | Chargeback after full payment | Row flipped to reversed (`:471`); booking stays paid | console | manual | Decide whether to cancel and chase. GAP-2. |
| 3.9 | Chargeback on a deposit-only booking | Not detected; `confirmAgainstPaidRecord` runs only for `paid` records (`:404`), and a deposit_paid record's settled row returns at `:422` without asking Pesapal | none | manual | Notice it in Pesapal's own dashboard. GAP-3. |

## 4. Folio post (settle)

Entry: `settlePayment` (`checkout.ts:1104`).

| # | Failure | State left | Signal | Recovery | Human |
|---|---|---|---|---|---|
| 4.1 | Money lands on a cancelled booking | Row -> excess, nothing posted (`:1133`). Via the callback the guest is still redirected to the confirmation page (`callback/route.ts:32`) | console | manual | Refund. GAP-2. |
| 4.2 | Money lands with nothing outstanding | Row -> excess (`:1186`) | console | manual | Refund. GAP-2. |
| 4.3 | Amount exceeds what is owed | 502, row stays completed, nothing posted (`:1207`) | console, sentry via callback/IPN | manual | Investigate and refund the difference. GAP-2. |
| 4.4 | Folio changed behind our back | 502, alert `folio_drift` (`:1270`) | alert | manual | Reconcile the folio, then let the guest retry or post by hand. |
| 4.5 | Apaleo payFolio fails on one slot | Completed slots keyed `up-pay-<txn>-<slot>` (`:1303`), and the folio re-read (`:1256`) skips them on retry even past 24 hours; 502 to guest | console for ApaleoError, sentry via callback/IPN; a plain fetch error is rethrown (`:1319`) and reaches Sentry on every path | auto on retry (guest, callback or IPN) | None, unless the guest never returns and no IPN arrives (row 3.2). |
| 4.6 | Postgres transaction fails after the folio post | Folios paid, record still unpaid; retry re-reads folios as already-posted and writes the record | sentry | auto on retry | None. |
| 4.7 | Booking cancelled between folio post and record write | Record stays cancelled, row -> excess (`:1373`, console at `:1444`) | console | manual | Refund the posted money from the cancelled folio. GAP-2. |
| 4.8 | Referral earn flip races with a twin settle | `skipDuplicates` ledger insert, guarded flip (`:1407`) | none | auto | None. |
| 4.9 | Zoho push after settle fails | Deliberately unawaited (`:1482`); see section 10 | console | auto (outbox) | None. |

## 5. Confirmation and receipt emails

Entries: `server/email/bookingConfirmation.ts:50`, `balanceReceipt.ts`,
`extrasReceipt.ts`, `bookingCancellation.ts`, `referralReward.ts`.

| # | Failure | State left | Signal | Recovery | Human |
|---|---|---|---|---|---|
| 5.1 | Resend replies non-2xx | Stamp released (`bookingConfirmation.ts:200`), but nothing re-sends it: a twin settle returns early (`checkout.ts:1125`) and no scheduler touches confirmations | console | none | Nobody is told. GAP-1. |
| 5.2 | Resend transport throws (DNS, reset) | Stamp stays set; outer catch only logs (`:209`). Same in balanceReceipt `:122`, bookingCancellation `:156`, extrasReceipt `:158`, referralReward `:137`. Email permanently lost | console | none | GAP-1. |
| 5.3 | Crash between record write and send | Stamp never claimed; a Buy now retry returns at `:112` without sending. No resend button | none | none | GAP-1. |
| 5.4 | RESEND_API_KEY unset | Send skipped, stamp kept by design (`resend.ts:29`) | console | manual | Set the variable. Emails from before it was set are lost. |
| 5.5 | Duplicate send from a twin settle | Claim-first guarded update (`:54`) | none | auto | None. |
| 5.6 | Repeat-offer email fails | Stamp kept on both a refused send and a throw, by design (`server/email/repeatOffer.ts:116`); the ops overview owns failed sends | console | manual | Resend from /ops/repeat-offers. |

## 6. Reminder emails

Entry: `app/api/ops/reminders/run/route.ts:13` -> `runBalanceReminders`
(`server/booking/reminders.ts:72`).

| # | Failure | State left | Signal | Recovery | Human |
|---|---|---|---|---|---|
| 6.1 | Nobody triggers the run | No reminders go out at all; no scheduler in repo | none | rerun | Press the button or set up cron. LO-15. |
| 6.2 | Send fails, either reply or throw | Stamp released in both paths (`balanceReminder.ts:148`, `:163`); next run retries | console | auto on next run | None. This is the correct pattern the emails in section 5 lack. |
| 6.3 | Booking paid between listing and sending | Status filter inside the claim (`:47`) blocks the send | none | auto | None. |
| 6.4 | Overdue and never paid | Nothing auto-cancels by design (`reminders.ts:12`); reminder link goes to /manage (`balanceReminder.ts:73`), no deep pay link (LO-20) | none | manual | Decide whether to cancel. LO-2. |

## 7. Cancellation and refund

Entry: `app/api/booking/[bookingId]/cancel/route.ts:43` -> `cancelBooking`
(`server/booking/cancellation.ts:145`).

| # | Failure | State left | Signal | Recovery | Human |
|---|---|---|---|---|---|
| 7.1 | Apaleo cancel or refundFolio fails on one lodge | Earlier lodges done, record not yet cancelled; steps idempotent (`cancel.ts:11` reads status first, refund key `up-refund-<record>-<slot>`). No try/catch in `cancelBooking` (`:201`), so the error reaches handleRoute: ApaleoError -> logError + 502; a 422 -> the sold-out 409 message with console.warn only | sentry (422: console) | auto on retry, within 24 hours | If the guest gives up, a person re-runs the cancel the same day. A re-run after 24 hours has no folio backstop and can refund a slot twice. GAP-9. |
| 7.2 | Refund recorded but never sent | Folio carries a refund line, no Pesapal refund exists anywhere in `server/pesapal`. Email says money was refunded | none | manual | Refund through Pesapal by hand. UNP-30, LO-1. |
| 7.3 | Balance payment lands mid-cancel | Alert `mid_cancel_drift` (`:258`) | alert | manual | Refund the difference. |
| 7.4 | Payment lands after cancel | Row -> excess (row 4.1) | console | manual | GAP-2. |
| 7.5 | Extras order in flight during cancel | `cancelBooking` never reads ExtrasOrder, so the add continues. Its settle guard `status: record.status` misses (`extras.ts:661`) and throws a PublicError that the add rethrows without resolving (`:525`). The order stays live with its payFolio (`:507`) already on the cancelled folio. Only the next extras visit after the 5-minute grace rolls the services back (`:775`); nothing refunds the payFolio and `verifyFolioRestored` is not called on that branch | console (`:669`, `:776`) | auto for the services, none for the money | Refund the extras charge from the cancelled folio by hand. GAP-2. |
| 7.6 | Cancellation not exported to Zoho | Invoice stands with no credit note | none | manual | Credit note by hand in Zoho. UNP-13. |
| 7.7 | Cancellation email fails | Same as 5.2 | console | none | GAP-1. |
| 7.8 | Ops releases a referral spend (`referral/ops.ts:174`) | Record flipped to cancelled (`:204`), then each Apaleo reservation cancelled with failures swallowed (`:224`). A failure leaves a live reservation on a cancelled record; no email, no Zoho | console | manual | Cancel the reservation in Apaleo. |
| 7.9 | Referral payout batch marked paid (`referral/ops.ts:274`) | Database only; the transfer happens outside the app. A batch marked paid without a transfer has no signal, by design | none | manual | The person running the batch owns the transfer. |

## 8. Post-booking extras (ExtrasOrder)

Entry: `app/api/booking/[bookingId]/extras` -> `addManageExtras`
(`server/booking/extras.ts:369`) -> `settleExtrasOrder` (`:621`). Recovery:
`recoverStaleExtrasOrder` (`:830`), lazy, called from the extras page, the
pay route (`pay/route.ts:56`) and the amend route (`amend/route.ts:77`).

| # | Failure | State left | Signal | Recovery | Human |
|---|---|---|---|---|---|
| 8.1 | Live Pesapal attempt on the booking | Add refused 409 (`:387`) | none | auto | None. |
| 8.2 | Folio pre-check disagrees with bookkeeping | 502 (`:429`), no alert, unlike settle's folio_drift | console | manual | Reconcile the folio. GAP-2. |
| 8.3 | Concurrent add, or an order younger than 5 minutes | 409 (`:457`, `:836`) | none | auto | None. |
| 8.4 | Activity hold refused | Order retired, 409 (`:343`) | none | auto | None. |
| 8.5 | bookReservationService fails mid-apply | Catch (`:524`) -> `resolveOrder` rolls back (`:817`) -> 502 "nothing was charged". If resolution itself throws (`:542`) the order stays live for 8.8 | console | auto | None. |
| 8.6 | Folio delta differs from the quote | Rollback, `verifyFolioRestored` logs if off baseline (`:589`), 409 | console | auto | Check the folio if the log fires. GAP-2. |
| 8.7 | payFolio response lost (charge now) | Catch -> `resolveOrder` finds the folio settled and counts at target (`:797`) and completes the order | console | auto | None. |
| 8.8 | Process dies between payFolio and settleExtrasOrder | Order live, folio charged, record totals stale. Recovery runs only on the next extras visit, balance payment or amend. A paid booking whose guest never reopens extras keeps a folio charge the books do not know; the cancellation refund basis ignores it | none | auto within 30 min (sweep runs recovery, UNP-46) | None. |
| 8.9 | Record left the payable states mid-order | Row 7.5 | console | partial | GAP-2. |
| 8.10 | Charge-now extras never reach Zoho | `extras.ts` imports nothing from `server/zoho`; `pushZohoAfterSettle` is called only from settlePayment (`checkout.ts:1479`). A charge-now extra on a paid booking adds folio revenue and a folio payment that no invoice reflects. On-balance extras reach Zoho only through a later balance payment's push-time folio read (`wire.ts:92`) | none | manual | Add to the Zoho invoice by hand. GAP-10. |

## 9. Date amendment

Entry: `app/api/booking/[bookingId]/amend/route.ts`. Moves reservations in
Apaleo and collects a price difference with `payFolio` (`:222`).

| # | Failure | State left | Signal | Recovery | Human |
|---|---|---|---|---|---|
| 9.1 | Move fails, rollback succeeds | Booking unchanged (`:209`) | sentry | auto | None. |
| 9.2 | Move fails, rollback fails | Break part-moved (`:190`, `:194`); no alert row, no ops page shows it | sentry | manual | Fix the reservations in Apaleo. GAP-2. |
| 9.3 | payFolio for the price difference fails | Runs after the move succeeded, outside the rollback try (`:222`), so the break is moved but the difference is uncollected and the record is not yet updated. Key `up-amend-<record>-<slot>-<arrival>`; ApaleoError -> handleRoute 502 with logError. No alert row | sentry | auto on retry within 24 hours | Check the folio if the guest does not retry. GAP-2. |
| 9.4 | Amend races an activities add | UNP-26 | none | manual | UNP-26. |

## 10. Zoho outbox drain

Entries: `pushZohoAfterSettle` (`server/zoho/wire.ts:168`),
`app/api/ops/zoho/run/route.ts:12` -> `runZohoExports`.

| # | Failure | State left | Signal | Recovery | Human |
|---|---|---|---|---|---|
| 10.1 | Zoho env missing | `zohoDeps()` throws before the outbox row is written (`wire.ts:177`); the catch only logs. No row, no `zoho_export_lost` alert, nothing to re-queue later. The drain button 500s too | console | none | Set the env, then create the missing invoices by hand. GAP-11. |
| 10.2 | Token refresh fails | Row exists, attempts counted (`export.ts:167`) | console | auto (retry) | None unless it hits 10.4. |
| 10.3 | Push fails under 5 attempts | Row back to pending (`export.ts:171`); next inline push or drain retries | console | auto | None. |
| 10.4 | Push fails 5 times | Row -> failed, alert `zoho_export_failed` once (`:190`) | alert | rerun | Fix the cause, run the ops drain; failed rows are only reclaimed by an ops run (`:110`). |
| 10.5 | Row stuck in pushing after a crash | Reclaimed after 5 minutes (`STALE_PUSHING_MS`), but only when a later drain runs (`:119`) | none | auto if there is traffic | Press the drain if the queue is quiet. |
| 10.6 | Outbox INSERT itself lost | Alert `zoho_export_lost` (`:296`) | alert | manual | Create the invoice by hand. |
| 10.7 | Balance row pushed before its deposit invoice exists | Oldest-first drain plus `blockedBookings` (`:148`) prevents a second invoice | none | auto | None. |
| 10.8 | Nobody presses the drain | Failed rows never retry; the run route has no scheduler secret (`zoho/run/route.ts:14`) unlike the other four | none | auto daily (scheduled drain, UNP-46) | None. |
| 10.9 | Simulated demo payment | Never queued by design (`wire.ts:175`) | none | n/a | None. |

## 11. Alert inbox and runs

| # | Failure | State left | Signal | Recovery | Human |
|---|---|---|---|---|---|
| 11.1 | OPS_ALERT_EMAIL unset, or Resend refuses the alert email | Alert row written. A non-2xx reply is discarded without a log (`alerts.ts:38` only catches rejections); a throw is logged | none (non-2xx), console (throw) | manual | Check /ops/alerts by hand. |
| 11.2 | Alert kinds other than folio_drift and mid_cancel_drift | Rendered as raw kind on `/ops/alerts` (`app/(site)/ops/alerts/page.tsx:25`) | alert | n/a | Read the raw kind. LO-21 ops home. |
| 11.3 | Run route secret unset | Falls through to requireAdmin, a JSON 401; never opens the route | none | n/a | None. |
| 11.4 | Health route green while Pesapal or Apaleo is down | By design; health checks Postgres only | none | n/a | Vendor outages show as 502s in Sentry. |

## Gaps: rows without an answer

Each is a Linear issue filed from UNP-35 on 11 Sep 2026. The register
(docs/lean-operations.md) already covers UNP-30 (refunds, LO-1), UNP-13
(credit notes), UNP-26 (amend vs activities), UNP-34 (logError sweep),
LO-15 (cron), LO-20 (pay links), LO-21 (ops home); those are
cross-referenced, not duplicated.

| Gap | Rows | Issue | Summary |
|---|---|---|---|
| GAP-1 | 5.1, 5.2, 5.3, 7.7 | UNP-36 | Guest emails are lost silently: transport throws keep the stamp, reply errors release it but nothing retries, and there is no resend. Fix the catch to release the stamp like balanceReminder does, and add a resend path. |
| GAP-2 | 2.7, 3.6, 3.7, 3.8, 4.1, 4.2, 4.3, 4.7, 7.4, 7.5, 8.2, 8.6, 8.9, 9.2, 9.3 | UNP-37 | Money states that need a human (mismatch, excess, reversed, over-collection, extras drift, part-moved amend) are console or Sentry only. Raise an OpsAlert for each so the inbox shows them. |
| GAP-3 | 3.9 | UNP-38 | Chargeback on a deposit-only booking is undetected. |
| GAP-4 | 3.5 | UNP-39 | IPN route accepts any caller. Pre-check the tracking id before calling Pesapal or Sentry, and rate limit. |
| GAP-5 | 2.2, 3.2, 4.5, 8.8 | UNP-40, closed by UNP-46 | Collected but unrecorded payments have no sweep. Pending rows with a tracking id can be re-checked; a payment whose tracking id was never stored (2.2) can only be found from Pesapal's side by merchant reference. The same sweep should run extras recovery for live orders. |
| GAP-6 | 1.4 | none | Accepted and documented in code. Revisit only if a real case appears. |
| GAP-7 | 10.8 | UNP-41, closed by UNP-46 | Zoho run route needs the same bearer-secret path as the other run routes so LO-15 can schedule it. |
| GAP-8 | 1.5, 1.6 | UNP-42 | Apaleo reservations with no BookingRecord hold inventory forever once the session expires. Needs a sweep, or a cancel in the failure path. |
| GAP-9 | 7.1 | UNP-43 | Cancel re-run after 24 hours can refund a slot twice, and an Apaleo 422 on cancel shows the sold-out message. LO-1 should absorb this. |
| GAP-10 | 8.10 | UNP-44 | Charge-now extras never reach Zoho. |
| GAP-11 | 10.1 | UNP-45 | Missing Zoho env drops the export with no row and no alert, and nothing can re-queue it. |

## What this changes for the D-9 order

- LO-15 cron must schedule three things: reminders, the Zoho drain (after
  GAP-7), and the sweep from GAP-5 once it exists, which also covers stale
  extras orders (8.8) and, with GAP-8, record-less reservations.
- LO-1 refunds should raise its own alert kind on a failed Pesapal refund,
  close row 7.2 and take GAP-9. It should not ship before GAP-2, or its
  failures would be console-only like the rest.
- LO-17 Playwright should cover rows 3.1, 4.5 and 7.1 (interrupted flows
  that heal on retry), because those are the guarantees the money path
  actually rests on.
- Zoho reconciliation (UNP-12, UNP-14) should include charge-now extras
  (GAP-10) or the books will drift on every bike hire.
