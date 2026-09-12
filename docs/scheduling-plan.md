# Scheduling (LO-15)

Status: implementing
Linear: UNP-46
Branch: unp-46-scheduling

Tests approved: 12 Sep 2026, commit bce61ed, Allan wrote "can you execute thisworflow assuming i approve evry stage! i ma tired and i want to get this done!" (walkthrough of the tests skipped on the same instruction; the suite is described in the PR).
Test change approved: 12 Sep 2026, commit fda1a04, reason: tsc rejected the untyped alert fake in sweep.test.ts (mock.calls typed as an empty tuple); the fake's parameter is now typed from SweepDeps. No assertion changed. Approved under Allan's blanket instruction quoted below.
Plan approved: 12 Sep 2026, Allan wrote "can you execute thisworflow assuming i approve evry stage! i ma tired and i want to get this done!" (grilling cut short on Allan's call: his answers to the four questions were recorded in chat, two unknown, one right, one corrected; gate treated as approved on his instruction).

Interview done in chat on 12 Sep 2026 (four questions, answers recorded
under "Decisions from the interview"). Full path: the payment sweep calls
Pesapal and moves money onto folios.

## Problem

Five run endpoints exist and every one is a button. Nothing runs unless a
person presses it. The failure catalogue (docs/failure-catalogue.md, GAP-5
and GAP-7) showed two consequences that matter for money:

- A payment Pesapal collected but never told us about (IPN lost, guest
  closed the tab) stays a pending row forever. Nobody is told.
- Failed Zoho rows are only reclaimed by the ops button, and the Zoho run
  route has no scheduler path at all.

This feature adds the scheduler, the sweep the catalogue asked for, and a
way to notice when the scheduler itself stops.

## Decisions from the interview

| Question | Allan's answer | Consequence |
|---|---|---|
| Scheduler | GitHub Actions, so the schedule survives a move off Railway | Workflow file in the repo, secrets in GitHub |
| Scope | Build UNP-41 and UNP-40 inside this feature | Zoho bearer secret; new payment sweep route |
| Cadence | Payment sweep every 30 minutes (15 first, changed to 30 on 12 Sep), the rest daily | Two jobs in one workflow |
| Dead cron | Help me understand; Sentry? | One free Sentry Cron Monitor on the sweep, check-in from the workflow |

## Out of scope

- UNP-42, Apaleo reservations with no BookingRecord. Its own feature.
- UNP-37, alerts for mismatch, excess, reversed and over-collection rows.
  The sweep leaves those rows exactly as the confirm code leaves them.
- Any queue, jobs table or run-history table. The Actions log is the run
  history.
- Reminder deep links (LO-20), refunds (LO-1), the reminder ladder (LO-2).
- Resending a lost email (UNP-36).

## What ships

### 1. Zoho run route accepts a bearer secret (UNP-41)

`app/api/ops/zoho/run/route.ts` gets the identical check the other four
run routes use: `ZOHO_RUN_SECRET` set and matching the Authorization
header opens the route; otherwise fall through to `requireAdmin()`. The
ops button keeps working unchanged.

### 2. Payment sweep (UNP-40)

New module `server/booking/sweep.ts` exporting `runPaymentSweep()`, and a
new route `app/api/ops/payments/sweep/route.ts` guarded by
`PAYMENTS_RUN_SECRET` or an admin session, same shape as inventory/sweep.

The sweep looks at every PesapalTransaction that is still LIVE
(`liveForRecordId` set) and old enough that the guest is no longer likely
mid-payment, and does one of three things:

| Row | Action | Why it is safe |
|---|---|---|
| status pending, tracking id set | `confirmPesapalPayment(orderTrackingId)` | The IPN and callback call the same function. A completed order settles the folios, a failed or reversed one retires the row, a pending one is left alone. Idempotent by construction (checkout.ts:386). |
| status completed, tracking id set | `confirmPesapalPayment(orderTrackingId)` | Money collected, settle crashed (rows 4.5, 4.6). The function resumes settle for a live completed row (checkout.ts:425). |
| status pending, tracking id null | Retire to superseded (guarded on status pending AND tracking id null) and raise an OpsAlert `payment_unlinked` | Row 2.2: the process died between Pesapal's reply and our stamp. Nothing on our side can find that order; Pesapal's dashboard can, by merchant reference, which is the row id. The guard mirrors submitFreshAttempt's own retire (checkout.ts:315) so a stamp landing at the same instant wins. Retiring is what the guest's next Buy now would do anyway. The alert is the whole point: a human checks Pesapal for that reference. |

Age window: rows created more than 15 minutes ago and less than 7 days
ago. The lower bound keeps the sweep off orders a guest is paying right
now (harmless if it hit them, but each check is a call to a shared
sandbox merchant that rate-limits). The upper bound stops the sweep
polling abandoned orders forever; a 7-day-old pending order is abandoned.
Both are constants in the module.

Then extras: every live ExtrasOrder (`liveForRecordId` set) older than the
engine's own in-flight grace (5 minutes, extras.ts:99) gets
`recoverStaleExtrasOrder(record)` with the record loaded the way the pay
route loads it (session with lodges, reservations). Row 8.8: a paid
booking whose guest never reopens extras otherwise keeps a folio charge
the books do not know about.

Every row is processed on its own. An error on one row is logged with
`logError` (tagged with the record id and route), counted, and the sweep
moves on. A Pesapal outage therefore produces N Sentry events and a
summary with `errored: N`, never a half-run.

Summary returned as JSON and logged on one console line:

```
{ checked, settled, retired, stillPending, unlinked, extrasRecovered, errored }
```

`settled` counts rows whose confirm returned completed, `retired` counts
failed or reversed outcomes, `unlinked` counts the alerted rows.

### 3. The workflow

`.github/workflows/scheduled-runs.yml`, two jobs, plus `workflow_dispatch`
so either job can be run by hand from the Actions tab.

**payment-sweep**, cron `*/30 * * * *`:
1. POST `$APP_BASE_URL/api/ops/payments/sweep` with the bearer.

**daily**, cron `0 3 * * *` (06:00 Nairobi), steps in this order, each
step runs even if an earlier one failed, the job fails if any did:
1. POST inventory/sweep
2. POST inventory/reconcile
3. POST reminders/run
4. POST repeat-offers/run
5. POST zoho/run

Each step is one `curl --fail --silent --show-error --max-time 300` with
the Authorization header, printing the JSON summary so the Actions log is
the run history. A non-2xx answer fails the step.

GitHub variables and secrets (Allan sets these once in the repo settings):

| Name | Kind | Value |
|---|---|---|
| APP_BASE_URL | variable | the Railway URL, no trailing slash |
| REMINDERS_RUN_SECRET | secret | same value as Railway |
| REPEAT_OFFERS_RUN_SECRET | secret | same value as Railway |
| INVENTORY_RUN_SECRET | secret | same value as Railway |
| ZOHO_RUN_SECRET | secret | new, also set on Railway |
| PAYMENTS_RUN_SECRET | secret | new, also set on Railway |
| SENTRY_CRON_SWEEP_URL | secret | check-in URL of the sweep monitor |

Two GitHub facts the design lives with:

- Scheduled runs drift. GitHub queues them and busy periods delay them by
  minutes, occasionally longer. Nothing here depends on exact timing, and
  every endpoint is idempotent, so a late or doubled run costs nothing.
- GitHub disables scheduled workflows after 60 days with no commit on the
  default branch, and emails a warning first. The Sentry monitor (below)
  catches it on the day it happens.

### 4. Noticing a run that never happened

Sentry cannot report the absence of a request; it only hears from code
that runs. Sentry Cron Monitors are the feature for the absence case: a
monitor knows the schedule, each run sends a check-in, and Sentry opens an
issue (and emails, same alert rule as errors) when a check-in is missed,
reports an error, or runs too long. Every Sentry plan includes one monitor
free; extra monitors are USD 0.78 per month each.

One monitor, the free one, created in the Sentry UI by Allan:
`payment-sweep`, every 30 minutes, check-in margin 10 minutes (covers
GitHub's drift). The daily job has no monitor. Both jobs live in one
workflow file, so everything that stops a cron silently (workflow
disabled, the 60-day rule, a GitHub outage) stops both, and the sweep
monitor reports it. A daily job that fires and fails is emailed by GitHub
itself, to whoever last edited the workflow. A second monitor (USD 0.78 a
month) can be added later if that ever proves too thin.

The workflow does the check-in, not the app: a step at the start of the
sweep job sends `status=in_progress`, a final step sends `status=ok` or
`status=error` depending on the job's result. That way one missing signal
means any of "cron did not fire", "workflow disabled", "app unreachable"
or "endpoint failed", which is exactly the list a person needs to check.
The app stays unaware of cron monitors, and the ops buttons never touch
them.

This replaces the register's "a failed run files an OpsAlert". A run that
starts and throws already reaches Sentry through handleRoute (UNP-33); a
run that never starts reaches Sentry through the monitor. OpsAlert rows
are for things a human must act on inside the business (an unlinked
payment), not for the scheduler's own health.

### 5. Docs

- Register: LO-15 entry rewritten to what shipped; decisions D-15
  (GitHub Actions, not Railway cron) and D-16 (Sentry monitors replace the
  failed-run OpsAlert) added.
- Failure catalogue: rows 2.2, 3.2, 4.5, 8.8 and 10.8 get their new
  recovery column; GAP-5 and GAP-7 marked closed by UNP-46.
- README env list: ZOHO_RUN_SECRET, PAYMENTS_RUN_SECRET.
- Ops guide entry for the `payment_unlinked` alert: open Pesapal's
  merchant dashboard, search the reference in the alert, record the
  payment by hand if it exists.

## Data model

No schema change. The sweep reads and writes columns that exist. The new
OpsAlert kind is a string, as the model intends.

## Files touched

- `app/api/ops/zoho/run/route.ts` (bearer check)
- `server/booking/sweep.ts` (new)
- `app/api/ops/payments/sweep/route.ts` (new)
- `.github/workflows/scheduled-runs.yml` (new)
- `docs/lean-operations.md`, `docs/failure-catalogue.md`, `README.md`,
  `docs/guides/...` (docs)
- Tests: `server/booking/sweep.test.ts`, `app/api/ops/zoho/run/route.test.ts`,
  `app/api/ops/payments/sweep/route.test.ts`

## Invariants

- The sweep never creates a Pesapal order and never sends a guest anywhere.
- The sweep never changes a row that is not live (`liveForRecordId` null).
- The sweep never touches a row younger than the lower bound.
- The only state change the sweep makes on its own authority is the
  unlinked retire; every other change is made by `confirmPesapalPayment`
  or `recoverStaleExtrasOrder`, the same code the guest paths run.
- One row's failure never stops the others.
- A run route with its secret unset is admin-only, never open (catalogue
  row 11.3 stays true).
- Running any job twice in a row changes nothing the second time.

## Edge cases

- Guest pays at minute 20, the sweep and the IPN both confirm: the
  existing callback/IPN race, already settled by Apaleo idempotency keys
  and the live-row guard in settlePayment.
- Pending row for a cancelled booking that turns out paid: settlePayment's
  cancelled branch records it as excess and shouts (row 4.7). Unchanged.
- A mismatch row is not live (liveForRecordId cleared) so the sweep never
  sees it. Correct: a human owns it.
- Sandbox rate limit hits getOrderStatus mid-sweep: that row errors, the
  rest continue, the next tick retries.
- Unlinked row whose stamp lands between our read and our retire: the
  guarded updateMany matches zero rows, no alert, the next tick confirms
  it normally.
- Extras order within grace: filtered by age before the call, and the 409
  PublicError is caught and counted if the window is crossed mid-run.
- The daily job and the sweep overlap on a slow day: every endpoint is
  idempotent, overlap is free (the register already promises this).
- Repo turned private: Actions minutes are billed, 2,000 free per month on
  the Free plan, each job rounded up to a whole minute. The 30-minute
  sweep is about 1,450 job-minutes a month plus 30 for the daily job, so
  it stays free. (At 15 minutes it would be about 2,900; that is why 30.)

## Failure modes

| Failure | What happens | Who finds out |
|---|---|---|
| Workflow does not fire (disabled, GitHub outage) | No sweep check-in | Sentry missed check-in, email |
| App unreachable | curl fails, job fails | Sweep: Sentry error check-in. Daily: GitHub failure email |
| One endpoint 500s | Step fails, others still run, job red | The route's own logError in Sentry, plus the error check-in (sweep) or GitHub's failure email (daily) |
| Sweep hits Pesapal outage | Every row errors, summary errored: N | Sentry events per row |
| Secret rotated on Railway but not GitHub | 401, step fails | Error check-in (sweep) or GitHub failure email (daily) |
| Sentry check-in URL wrong | Monitor sees nothing | Missed check-in on the first window after setup, which the acceptance check exercises on purpose |

## Acceptance check (after merge and Railway deploy)

1. Railway: set ZOHO_RUN_SECRET and PAYMENTS_RUN_SECRET. GitHub: set the
   variables and secrets in the table. Sentry: create the sweep monitor.
2. Actions tab: run `daily` by hand. Every step green, each prints a JSON
   summary.
3. Run `payment-sweep` by hand. Green, summary printed, ok check-in.
4. Prove the sweep does work: on the Railway app, start a checkout, pay
   on Pesapal's sandbox page, then close the tab without returning. Wait
   for the next half hour. The booking flips to paid and the
   confirmation email arrives with no guest action. The sweep summary in
   the Actions log shows `settled: 1`.
5. Prove the dead-cron alarm: disable the workflow in the Actions tab.
   Within one window plus margin Sentry opens a missed check-in issue and
   emails. Re-enable the workflow; the next run resolves it.

## Decisions made for you

1. The sweep retires an unlinked pending row (no tracking id) to
   superseded after alerting, rather than only alerting. Reason: alerting
   on every tick needs a dedupe mechanism; the status flip is the
   dedupe, and it is the same flip the guest's next Buy now performs.
2. Check-ins come from the workflow, not from the app. Reason: one
   monitor instead of five, the app stays unaware of Sentry crons, and a
   missing check-in covers "app down" as well as "cron dead".
3. One monitor, the free one, on the sweep only (Allan, 12 Sep: no paid
   monitor). The daily job relies on the shared workflow file plus
   GitHub's own failure email.
4. Sweep window 15 minutes to 7 days, both constants. Not configurable
   through env.
5. Sweep every 30 minutes (Allan, 12 Sep), daily at 03:00 UTC (06:00 Nairobi) so reminder emails land in the
   morning and the Zoho drain runs before anyone looks at the books.
6. The daily job runs all five steps even when one fails, and goes red at
   the end. Reason: a reminders failure must not stop the Zoho drain.
7. No run-history table. The Actions log and Sentry are the history.

## Open questions

- Should `payment-sweep` also be a button on the ops page? The route
  accepts an admin session, so it is one form away. Leaning no until
  LO-21 ops home.
