# Lean operations: running Unity Parks with one to three people

Status: LIVING REFERENCE. Started 8 Sep 2026 from Allan's notes after the
contractor conversation of Fri 4 Sep 2026. Update it whenever a concern is
added, a decision is made, or an item ships. Every concern has an id (LO-n)
so chat, Linear issues, and commits can point at it.

## Purpose

The client wants the platform to run with the smallest possible team:
roughly one technologist (changes, patches), one support person, and one
accounts person who is not on our team but works through our screens. At the
scale discussed (about 200 units, 25k to 50k bookings a year, 100k to 200k
guests) that is only possible if nothing needs a person to notice it.

This document is the register of every process that could pull a person in,
what the system does about it today, what we propose, and what a human is
left doing afterwards. It also holds the decisions Allan still has to make.

## The demo test

The platform is being shown to investors alongside the financial model. The
test for every item below is not "how many features" but: can one person
demonstrate a booking, a payment, a cancellation with a refund, an overdue
reminder, and the ops inbox in ten minutes, and does every step look
finished. Streamline first, then add features. Anything that cannot be
shown in that walkthrough is a lower priority than anything that can.

## The one design rule

Every money, date, or guest event ends in exactly one of three places:

1. Done automatically, with a trail.
2. In the ops inbox, with a reason and a button.
3. In a message to the guest asking them to self-serve from a link.

Nothing else exists. No process may end as a console error, an email to the
technologist, or a note someone has to remember.

Corollaries that follow from it:

- Automation is only allowed where the action is idempotent and reversible
  or policy-defined. Cancelling money a guest still intends to pay is a
  policy decision, written once, not a human decision per booking.
- Every automated process reports its exceptions to the same place
  (OpsAlert). One inbox, not one page per subsystem.
- Every alert carries a kind, a booking id, and an allowed set of actions.
  That shape lets a person work it today and an AI agent work parts of it
  later without a redesign.
- Scale does not create ops work. Exceptions without a trail do. At 50k
  bookings a year (about 140 a day) even a 3% exception rate is four or five
  inbox items a day, cleared in minutes if each is a click.

## Staffing target, stated honestly

One person is realistic for the digital side only if:

- the inbox is the only daily task, and
- money movement (refunds, payouts) is executed by the app and merely
  checked by a person, and
- guests self-serve every common change (pay balance, cancel, move dates).

Two people is the safe target: one technologist who also works the inbox,
one accounts person checking reconciliation and payouts. Support becomes a
shared inbox plus a chatbot for lookups, not a headcount.

## Concern register

Each row: what could pull a person in, what happens today, the proposal,
and what a human still does afterwards. "Human touch" is the target.

### Money

**LO-1 Refunds on cancellation do not move money.**
Today: cancellation computes the refund by tier, posts a refund line to the
Apaleo folio, marks the record cancelled, emails the guest. Nothing sends
money back to the guest. The folio says refunded; the card or M-Pesa wallet
is untouched. This is an unrecorded manual step. Worse, the cancellation
email already tells the guest "we have refunded X to your original payment
method". Filed as UNP-30 (High) on 8 Sep 2026.
Proposal: every cancellation with a refund above zero creates a refund row
(amount, Pesapal tracking id, state). The app calls the Pesapal refund API
itself. Failure or amount mismatch files an OpsAlert. The same
cancellation pushes a credit note to Zoho Books against the booking's
invoice, tagged with the Pesapal tracking id, so a reduced Pesapal payout
can be matched to the booking. Money movement, in plain terms: Pesapal
holds guest payments and pays the bank in batches minus fees; the bank is
the only place money truly sits; Apaleo and Zoho are records. Zoho's bank
feed is a setting, not code; our job is to make the Zoho side complete
(invoice, payment, credit note per booking).
First step: one call to the Pesapal sandbox refund endpoint to learn
whether the sandbox completes refunds or leaves them pending.
Human touch: none on success. Reviews only Pesapal rejections.
Decision needed: D-2 (app-initiated vs person presses send).

**LO-2 Overdue deposit balances.**
Today: guest pays from Manage my booking, no stored cards, no auto-charge.
Reminder emails exist ("due soon" inside 14 days, "overdue" after) but only
run when an admin presses a button or an external scheduler calls the run
endpoint. Auto-cancel deliberately unbuilt.
Proposal: a fixed ladder, all automatic once cron runs daily:
  due in 14 days, due in 3 days, overdue day 1, overdue day 7, final notice
  "your dates will be released on <date>", then auto-release at the grace
  limit. Release is treated as a guest cancellation on that day, so the
  existing tier rule applies (deposit kept; at 14 days overdue that is the
  half-refund tier for any money beyond the deposit). Add SMS or WhatsApp
  alongside email with the pay link, because that is the device the guest
  pays from (M-Pesa via Pesapal). Optional small incentive in the final
  notice if the client wants one.
Human touch: one daily list of bookings entering the final 48 hours, with a
"hold 7 more days" button for guests who have been in touch. No outbound
calls. Measure the paid-before-release rate; add a single human call for
high-value bookings only if the data says the final notice is not enough.
Decision needed: D-1 (grace period), D-5 (SMS provider), D-6 (incentive).

**LO-3 Chargebacks and reversals on deposit or balance payments.**
Today: the reversal detector runs only for fully paid records. A Pesapal
REVERSED on a settled deposit is not detected (documented limitation in
deposit-and-cancellation-plan.md).
How we learn of a reversal: two ways, belt and braces. Pesapal already
calls our registered IPN address when a transaction's status changes; we
keep that listener and let it trigger a status re-check. Whether Pesapal
fires it for reversals is unverified, so the daily cron also re-checks
every settled payment inside the chargeback window. Neither path is
trusted alone.
Proposal: extend the detector to deposit_paid records. On any reversal
the booking goes to a "payment reversed" hold: check-in blocked, no
further automation runs on it, the Apaleo folio shows the reversal, and
an OpsAlert carries the booking, the amount, and which payment it was.
Cases, all handled by the same hold:
  - fully paid, whole payment reversed: hold, nothing owed to the guest.
  - fully paid, one balance part reversed: hold; paid state recomputed
    from the folio, so the booking drops back to deposit_paid and the
    memories counter no longer counts it.
  - deposit only, reversed: hold; there is no money behind the lodge.
  - refund already sent, then the original payment reversed: hold; the
    guest has been paid twice; a person recovers it.
Never auto-cancel on a reversal: chargebacks are disputes, and the
business can win them. A person decides after the dispute window, using
the ordinary cancel (deposit kept) or a "reversal upheld, release lodge"
button.
Human touch: reviews each reversal (rare, and always needs judgment).

**LO-4 Reconciliation for the accounts person.**
Who reviews: the accountant, in our ops inbox (needs the accounts role
from D-11), for exceptions only. Zoho stays their book of record. Two
screens is inherent: ours says what is missing, Zoho holds the books.
Today: inventory reconcile exists (files inventory_drift alerts). Folio
drift alerts fire on two paths. No daily money reconciliation across
Pesapal, folios, booking records, and the Zoho outbox.
Proposal: a daily reconcile run that compares Pesapal transactions, folio
postings, BookingRecord paid amounts, and ZohoExport rows, and files one
OpsAlert per difference. Reports, never fixes.
Note for the demo: simulated payments settle onto the Apaleo folio like
real ones but never reach the Zoho outbox (it is keyed on a Pesapal
tracking id). Reconciliation must treat them as expected differences.
Human touch: the accounts person reads one list. Zero items means the books
are right.

**LO-26 eTIMS (KRA electronic tax invoices).**
Today: nothing. Invoices are created in Zoho Books by our export; nothing
sends them to KRA.
Proposal: use Zoho Books' Kenya edition, which transmits invoices to eTIMS
itself. Our job is to make each invoice eTIMS-ready: item lines with the
right tax codes, VAT split, and the buyer's KRA PIN when the guest gives
one (an optional field at checkout, most guests will not). Credit notes
(LO-1, LO-24) go the same way. Nothing to build on our side beyond the
fields; the accountant switches it on in Zoho.
Human touch: none once configured.
Decision needed: D-19.

**LO-5 Zoho export failures.**
Today: outbox with inline retries; rows past MAX_ATTEMPTS wait for an admin
to press the drain button on /ops/zoho.
Proposal: cron drains daily; a row still failed after the drain files an
OpsAlert. Fold the page into the inbox.
Human touch: only rows Zoho keeps rejecting.

**LO-6 Referral and influencer payouts.**
Today: admin downloads a payout CSV, hand-runs M-Pesa or bank transfers,
marks the batch paid. KRA PIN collected by the accountant by hand.
Proposal, in two steps. First, collect the payout fields at onboarding
so the CSV is complete. Collected today: name, email, phone, code, an
unused per-person commission rate. Needed, all optional until payouts
are real (D-7): legal name as on ID, national ID or passport number, KRA
PIN (withholding tax on commission is deducted and remitted against it),
M-Pesa number or bank name, branch and account, and a payout consent
date. The accountant confirms the tax fields. Second, when the client is ready, pay
batches through Pesapal or M-Pesa B2C from the app, with the mark-paid
becoming automatic on provider confirmation. Until then the CSV and mark-
paid stay, but the batch appears in the inbox on a monthly schedule so
nobody has to remember.
Human touch: approves a batch once a month. Later, only reviews failed
transfers.
Decision needed: D-7 (automated payouts, and when).

**LO-7 Post-checkout extras and activities refunds.**
Today: extras and activity charges sit on the folio and follow the booking
cancellation. Not verified: what a guest gets back when they cancel one
extra or activity while keeping the stay.
Proposal: covered by the failure catalogue (LO-14). Policy to write: extras
cancellable free until N days before arrival, activities follow their own
slot rules.
Human touch: none if the policy is coded.

**LO-24 VAT on refunds.**
Today: the Zoho payload carries VAT on the invoice (commission config also
notes 16% VAT). Nothing reverses VAT on a refund because nothing reaches
Zoho on cancellation.
Proposal: the credit note in LO-1 carries the same VAT split as the
invoice, so the tax reverses with the money. No new rule, just the credit
note done properly. The accountant checks the VAT return; the app does the
arithmetic.
Human touch: none beyond the normal VAT return.

### Dates and guest changes

**LO-25 Change requests for high-value or unusual cases.**
Today: nothing. A guest who paid in full and cannot attend has only the
cancel button and the tiers.
Proposal: a "request a change" form on Manage my booking: reason, wanted
dates or outcome, free text. It files an OpsAlert (kind: change_request)
with the booking attached. A person reviews it against a short written
policy (for example: full transfer to new dates for a first request on a
booking above a threshold) and acts with the rebook-and-transfer flow from
LO-8. Always human. The form must not become a side door for things the
guest can do alone: the page first offers the buttons that apply (pay,
cancel with the quote, move dates), and the form appears only after
"none of these fits", with a reason category the guest must pick. This is the flexibility that keeps a high-value guest
and it cannot be safely automated, because sincerity cannot be judged by
a bot.
Note on D-10: a 48-hour cooling-off does not catch the "wrong year" case.
A guest who typed 2027 for 2026 will not notice until reminders fail to
arrive. The change-request form is the catch for that; cooling-off stays
useful for the ordinary next-day regret.
Human touch: one review per request. Expected volume: low.

**LO-8 Changing dates, including the "booked 2027 by mistake" case.**
Today: no date-change feature. The guest's only route is cancel and rebook,
which loses the deposit.
Proposal: rebook and transfer, not a true amendment. Guest picks new dates
in Manage my booking. We create the new booking and cancel the old one with
the paid amount carried as credit instead of the tier refund. Inside a grace
window after the original booking (48 hours proposed) the carry-over is in
full. Outside it, the deposit follows the guest to the new booking and the
normal tiers apply only to the difference. Extras and activities are
re-offered on the new booking and re-checked against date-bound inventory;
anything unavailable is refunded inside the same transfer.
Guest-facing requirement (Allan, 8 Sep): before confirming, the guest sees
one plain summary and nothing moves until they accept it. Four lines: what
you paid on the old booking; what carries over to the new one (and, after
the 48-hour window, what the tiers keep); what the new stay costs; what
you pay now, or what comes back to you. Same four lines in the
confirmation email. The guest must never wonder why they paid more.
Human touch: only transfers where money must go back and Pesapal refuses.
Decided: D-3 (button plus rule, the D-15 form catches the rest), D-10.

**LO-9 Guest data corrections (name, email, party size).**
Today: email normalisation script exists; no guest self-serve for details.
Proposal: editable fields in Manage my booking for anything that does not
change price. Anything that changes price goes through LO-8.
Human touch: none.

**LO-10 No-shows and same-day cancellations.**
Today: the policy says "not cancellable online, call the team" at 0 days.
Proposal: keep it. Same-day is rare and always needs a person. Give the
support person a one-click "record no-show" that closes the booking and
posts nothing, so the folio and record agree.
Human touch: one click per case.

**LO-11 Invite-a-guest and party changes.**
Today: shipped (UNP-20). Verify in the failure catalogue that an invitee who
never accepts does not block anything at check-in.
Human touch: none expected.

### Support and communication

**LO-12 Tickets and inbound support.**
Today: OpsAlert plus per-subsystem pages; no guest-facing ticket path;
support would arrive as email.
Proposal: the inbox first, inside the app. Every alert kind carries allowed
actions. Start with a human working it; then let an AI agent handle kinds
that are pure lookups ("where is my receipt", "how much do I owe") from the
booking record, escalating everything else. Zoho Desk becomes a bridge
later if the client wants email support in a familiar tool. Never two
queues.
Human touch: works the residue the agent escalates.
Decision needed: D-4.

**LO-13 Reminder and support channel.**
Today: email only.
Proposal: SMS first (Africa's Talking or Twilio), WhatsApp Business later.
An inbound WhatsApp chatbot answering from the booking record is the
highest-value automation for support once LO-12's shape exists.
Decision needed: D-5.

**LO-23 Help chatbot, grounded in our own documentation.**
Today: nothing. Support questions would arrive as email.
How these work (Cloudbeds and similar): retrieval-augmented generation.
A knowledge base of articles, each with a title and URL; a retrieval step
that picks the relevant articles for a question; and a prompt built as
instruction + retrieved articles (labelled with their URLs) + the question.
The model answers only from what it was given and cites the URL. If
nothing matches it says so. Links come from the labels, not from browsing.
Proposal: our guides (LO-22) are small enough to send whole with every
question, so no search index is needed at first; prompt caching keeps the
repeated guide text cheap. Build in two stages:
  1. Public, pre-sales chatbot on the site. Answers from the guides and
     site content only. No login, no guest data. Also a completeness test
     for the guides: every unanswerable question is a missing guide.
  2. Signed-in, booking-aware chatbot. Reads the guest's own booking record
     through narrowly scoped tools, answers "how much do I owe", offers the
     pay link or the date-change flow. The inbound half of LO-12. Only
     after the inbox and guides exist.
Human touch: none for questions the guides cover. Unanswered questions
become an OpsAlert (kind: support_question) for a person, and a note for
the guide author.
Cost and abuse: the price per question against cached guides on a small
hosted model is a fraction of a cent; the risk is volume. Controls: a
per-visitor hourly limit, a daily spend ceiling that switches the bot off
and shows a contact form, short answers. Self-hosting an open-source model
is not worth it: it would be a fourth job for the technologist for no
saving at this volume.
Depends on: LO-22 guides written first.

### Platform and engineering

**LO-14 Failure catalogue for the core money path.**
Booking, Pesapal, IPN, folio post, confirmation, Zoho. One row per failure:
what breaks, what state is left, whether recovery is automatic, what the
human does otherwise. Every row without an answer becomes a Linear issue.
This is the "edge cases of core functionality" work and it decides which
alerts, tests, and jobs matter. Do this before building anything above.

**LO-15 Scheduling.** Shipped 12 Sep 2026 (UNP-46, docs/scheduling-plan.md).
Today: six run endpoints (payment sweep, reminders, repeat offers, Zoho
drain, inventory reconcile, inventory sweep), each idempotent, each with a
bearer secret. A GitHub Actions workflow calls the payment sweep every 30
minutes and the other five once a day at 06:00 Nairobi. No queue, no jobs
table; the Actions log is the run history. The payment sweep (UNP-40) is
new: it asks Pesapal about live attempts nobody told us about, retires and
reports attempts that lost their reference, and runs recovery on stale
extras orders. A Sentry cron monitor on the sweep reports a run that never
happened; a daily run that fires and fails is emailed by GitHub.
Human touch: a `payment_unlinked` alert means looking up the merchant
reference on Pesapal's side and recording the payment by hand.

**LO-20 Reminder emails do not deep-link to payment.**
Today: the balance reminder links to /manage, which redirects to /account.
The guest signs in, finds the booking, clicks pay, and is sent to Pesapal's
hosted page. Four steps between the nudge and the money.
Proposal: a signed, expiring link in every reminder (and SMS) that opens
that booking's pay screen directly, asking for sign-in only when there is
no session. Same link in the final notice. Pesapal's hosted page stays; we
do not embed card entry.
Human touch: none. This is the single biggest lever on the paid-before-
release rate in LO-2.

**LO-21 Ops entry and navigation.**
Today: no ops home page. Each ops page checks the isAdmin flag on an
ordinary guest account and 404s otherwise. Admins reach it by typing the
URL. Deliberate for the demo; wrong for a support person.
Proposal, in two steps. Now: one /ops home page with a menu (inbox first),
and a visible "Operations" link in the account menu for admin accounts
only. After the demo: a separate staff sign-in that is not a guest account,
with roles (technologist, support, accounts) so the accounts person sees
reconciliation and payouts and nothing else.
Human touch: none; this is about not making the human's day worse.

**LO-22 Documentation in two tiers, one home.**
Today: docs/ is a flat folder mixing feature plans, analyses, four Word
files, and walkthroughs. Everything is written for developers. The
contractor has been writing separate notes elsewhere and emailing them.
Proposal: two tiers by reader, both in this repo. Done 8 Sep 2026 as
UNP-29.
  docs/guides/       plain language, no code, for Allan, the contractor,
                     and later support and accounts staff. One guide per
                     flow (booking, payments, cancellation and refunds,
                     referrals, the repeat-guest offer, how the
                     systems fit together). Each ends with "what a person
                     does". Doubles as the operations handbook.
  docs/ (top level)  the engineering tier: plans, workflow, review
                     records, this register. Detailed, for developers.
                     Left at top level on purpose: about sixty code
                     comments and the feature skill point at docs/<plan>.
  docs/archive/      the old Word files and Center Parcs analyses.
  docs/README.md     the index for both tiers.
Rules: a feature is not done until its guide exists; a guide may only say
what the code actually does; this register sits at docs/ top level and is
the agenda for every contractor meeting (the open decisions table).
Home: GitHub only. Add the contractor as a collaborator. No Google
Workspace or emailed attachments; a second home means two versions of the
truth. Notes from the contractor arrive as a pull request against docs/ or
a Linear issue comment. A document that must reach someone without GitHub
(an investor) is exported as a PDF from the guide, never maintained apart.
Human touch: none; this reduces meeting time and stops the email trail.
Decision needed: D-12.

**LO-16 Observability, minimal.**
Today: five files log with console.error; no health route; no error
tracker; no alerting.
Proposal: Sentry for exceptions; /api/health for Railway; booking record id
on every log line; one email or Slack notification when a cron run fails or
the unresolved alert count rises above zero. Not a monitoring platform;
that would be a fourth person's job.
Human touch: reads one notification.

**LO-17 End-to-end tests on the golden paths.**
Today: vitest unit tests cover the money math; nothing proves the whole
path after a deploy.
Proposal: Playwright on four or five paths (search, book, pay in sandbox,
cancel, invite a guest, promo code), run on pull requests. Keep the number
small and green.
Human touch: none; a red run blocks merge.

**LO-18 Deploy and database steps.**
Today: Allan pushes Railway and runs db push by hand; Apaleo reprovision
and seeds are manual after some merges.
Proposal: keep manual for the demo (deliberate, see CLAUDE.md). Record each
required post-merge step as a Linear issue comment so nothing is forgotten.
Revisit after the demo.

**LO-19 Activities layer.**
Parked on purpose. UNP-6 merges as is; follow-ups stay in Backlog until the
core path above is clean.

## The tier flaw Allan found (8 Sep)

Industry practice (Center Parcs UK, hotels): the cancellation fee is a
percentage of the total stay, rising towards arrival, owed whether or not
it has been paid; what is held is kept and the rest is billed or charged
to a card. We store no cards and never chase, so our fee can only come
out of money already held. That inverts the incentive: the deposit-only
guest loses the least, the guest who paid early loses the most.

Options:
- Copy the industry fully and bill the shortfall. Fair on paper, but it
  means invoicing guests who have walked away, which is the collecting
  the client does not want.
- Deposit is the only penalty until 21 days before arrival; everything
  above it comes back in full on cancel or release. Inside 21 days, no
  refund. Two tiers. Fair between guests, rewards early payment, one
  sentence to explain. Costs little: inside 21 days everyone still
  holding a booking is fully paid (balance due at 56 days, release at
  42), so late-cancellation protection is unchanged. Recommended.

Allan's decision, 8 Sep: the two-tier shape, with 21 days as a changeable
number. Reasoning recorded: 56 days is when money comes in (cash flow),
21 is when a freed lodge stops being resellable (real loss). Taking more
at 56 would be keeping payment for a lodge that is then resold. Whether
21 is the right number depends on how far ahead guests book; measure the
lead time after launch and adjust. Until the client agrees and the
feature ships, the four tiers in the deposit plan stand.

## Refund policy: what is automatic and what is reviewed

Automatic, because the policy already decides it and the same rule applies
to everyone (that is what makes it fair):
- self-service cancellation refunds by tier (LO-1);
- cooling-off refunds if D-10 is adopted;
- credit carried over in a rebook-and-transfer (LO-8), including refund
  of the difference when the new stay is cheaper;
- deposit kept on auto-release (LO-2), which is a refund of zero;
- refunds of unavailable extras or activities inside a transfer.

Reviewed by a person, because judgment is involved or money disagrees:
- change requests outside the policy (LO-25);
- chargebacks and reversals (LO-3);
- any refund where Pesapal's answer or the folio does not match our
  computed amount;
- any refund above a threshold the client sets (D-18).

## Decisions Allan has to make

| Id | Decision | Recommendation | Status |
|---|---|---|---|
| D-1 | Grace period after balance due date before auto-release | 14 days overdue (that is 42 days before arrival, the half-refund tier) | decided (8 Sep) |
| D-2 | Refunds sent by the app via Pesapal API, or a person presses send per refund | App sends; person reviews rejections, folio mismatches, and amounts above D-18 only | decided (8 Sep) |
| D-3 | Date change as rebook-and-transfer with a 48-hour full-credit window | Yes. Button plus rule; the D-15 form catches the rest; four-line transfer summary before confirm | decided (8 Sep) |
| D-4 | Tickets inside the app first, Zoho Desk later | Yes | decided (8 Sep) |
| D-5 | SMS provider for reminders (Africa's Talking or Twilio), WhatsApp later | Africa's Talking for Kenya | decided (8 Sep) |
| D-6 | Incentive in the final reminder notice | Client's call; cheap extra or none. Ask the client whether they want an incentive at all | deferred |
| D-7 | Automated referral payouts via M-Pesa B2C, and when | After the demo; onboarding fields first. Add the payout fields at onboarding now, optional, see LO-6 | decided (8 Sep) |
| D-8 | Outbound reminder calls | No; measure first | decided (8 Sep) |
| D-10 | Cooling-off period: full refund, deposit included, if the guest cancels within 24 or 48 hours of booking | 48 hours for next-day regret; the wrong-year case is caught by LO-25, not by this. Cooling-off is separate from the LO-8 transfer window | decided (8 Sep) |
| D-15 | Change-request form on Manage my booking, always human-reviewed, with a short written policy for transfers | Yes. The form must not accept what the buttons already do, see LO-25 | decided (8 Sep) |
| D-16 | Hosting: stay on Railway through the demo; revisit at launch (Railway is fine at this scale; moving is a day's work with agents) | Stay | decided (8 Sep) |
| D-18 | Refund review threshold: refunds above this amount wait for a person even when the policy computed them | Client's call; suggest KES 100,000. Threshold changeable later | decided (8 Sep) |
| D-19 | eTIMS through Zoho Books Kenya edition, with an optional KRA PIN field at checkout | Yes; accountant configures Zoho, we add the field | decided (8 Sep) |
| D-20 | Cancellation policy: within 48 hours of booking everything back (D-10); more than 21 days before arrival, deposit lost and everything above it back in full; 21 days or less, nothing back. No scale in between. The 21 is a single changeable number, revisited with real booking lead-time data six months after launch | Allan agrees 8 Sep; needs the client's agreement since it changes the published policy, then a full-path feature (refund maths, terms page, emails) | agreed, pending client |
| D-17 | Error tracking: Sentry alongside Railway logs (logs are a scroll; Sentry groups errors, attaches the booking id, and notifies) | Yes, at deploy | decided (8 Sep) |
| D-11 | Separate staff sign-in with roles, or keep the admin flag on guest accounts | Admin flag plus /ops home page for the demo; staff sign-in after | decided (8 Sep) |
| D-13 | Help chatbot: public pre-sales first, booking-aware second, both grounded only in our guides | Yes; after the guides exist. Issue filed for stage 1 | decided (8 Sep) |
| D-14 | Chatbot cost controls: per-visitor limit, daily spend ceiling with a contact-form fallback, hosted small model, no self-hosting | Yes | decided (8 Sep) |
| D-12 | Documentation home and structure: GitHub only, docs/guides + docs/archive, engineering plans stay at docs/ top level, contractor added as collaborator | Done 8 Sep 2026 (UNP-29); adding the contractor to the repo is Allan's step | decided |
| D-9 | Order of work | LO-14 catalogue, then LO-15 cron, then LO-20, LO-1, LO-2, LO-16, LO-17, LO-21, then LO-8 | decided (8 Sep) |
| D-9a | LO-16 pulled to the front of the D-9 order on 10 Sep 2026 (UNP-33). It depends on nothing and catches the failures LO-14, LO-15 and LO-1 will introduce. The rest of the order stands | Allan, 10 Sep | decided |
| D-15 | Scheduler: GitHub Actions, not Railway cron, so the schedule survives a move off Railway. Payment sweep every 30 minutes, the rest daily | Allan, 12 Sep (UNP-46) | decided |
| D-16 | A run that never happens is a Sentry cron monitor miss (one free monitor, on the sweep), not an OpsAlert. OpsAlert rows are for things a human acts on inside the business, not the scheduler's own health | Allan, 12 Sep (UNP-46) | decided |

## Policy clarifications recorded from chat

- The deposit is never refunded, at any point after booking, unless D-10
  introduces a cooling-off period. The refund percentages apply only to
  money paid beyond the deposit. A guest who paid only the deposit receives
  nothing back at any tier.
- Non-payers are never charged anything further. The deposit is the
  cancellation fee and is already held. On auto-release the lodge returns to
  sale, the deposit is kept, and nothing is chased. We never pursue money we
  do not hold.
- Sentry (or equivalent) is in scope; it is for the technologist, not the
  guest, and it is what turns "a guest emailed" into "we saw it first".

## Change log

- 8 Sep 2026 (tiers): the tier flaw section and D-20 added.
- 8 Sep 2026 (decisions): Allan decided D-1, D-4, D-5, D-7 to D-11,
  D-13 to D-19; D-2 leaning yes; D-3 open; D-6 deferred to the client.
- 8 Sep 2026 (later): LO-26 eTIMS, D-19, reversal listening notes.
- 8 Sep 2026 (late): LO-24 VAT on refunds, LO-25 change requests,
  D-15 to D-17; UNP-31 walkthrough project filed.
- 8 Sep 2026 (night): UNP-29 filed; guides and archive folders created;
  D-12 decided; D-14 chatbot cost controls added.
- 8 Sep 2026 (evening): added LO-23 help chatbot and D-13.
- 8 Sep 2026 (later still): added the demo test, LO-22 documentation
  tiers, D-12.
- 8 Sep 2026 (later): added LO-20 deep pay links, LO-21 ops entry, D-10
  cooling-off, D-11 staff sign-in, and the policy clarifications section.

- 8 Sep 2026: created from the contractor feedback session.
