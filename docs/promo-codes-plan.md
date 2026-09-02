# The repeat-guest offer (UNP-7)

Status: writing-tests

Plan approved: 2 Sep 2026, Allan wrote "plan-approved"

**Revised 2 Sep 2026** after UNP-19 (mandatory accounts) and UNP-20
(invite-a-guest) shipped. The 28 Aug typed-reference draft is superseded:
Allan chose the account-state design on 2 Sep ("yes lets use this
version!"). The offer is no longer a typed secret; it is state on the
signed-in account, derived from verified party membership. This deletes
the reference input, the advisory oracle endpoint, its rate limiting, the
alert threshold, the OpsAlert, and the per-stay revoke switch. The CP
research in section 2, the money seam in section 6 and the burn-timing
design in section 9 stand unchanged from the previous draft. Required
reading: `docs/referral-system-plan.md` section 5 (the money path) and
`docs/invite-a-guest-plan.md` (the membership seam this consumes).

---

## 1. The problem in plain language

The checkout's "Keeping in touch" step promises opted-in guests an
exclusive repeat-guest offer. Nothing behind that promise exists. This
feature makes it real: after a completed stay, everyone who was a
registered member of that party gets a fixed discount on a new booking
made within 31 days, applied automatically when they book signed in.
Marketing consent buys the email that reminds them about it; it never
gates the discount itself.

## 2. How Center Parcs actually does it (verified 27-28 Aug 2026)

- Accounts are mandatory at checkout (ours now too, UNP-19).
- The consent checkbox names the carrot: news and information "including
  our Repeat Guest offer with a GBP 50 discount off your next break".
  Consent delivers the offer; it does not create it.
- Redemption: enter the previous break's booking reference during
  checkout, within 31 days of departure. GBP 50 off per unit of
  accommodation on the NEW booking, max 3 units. Cannot combine with other
  offers; cannot be added to an existing booking (claim at creation only).
- **Eligibility is the party, not the booker**: "providing you were a
  registered member of the party, you have the booking reference number of
  the previous break and you are booking within 31 days of your last
  visit" (help centre).
- **The reference is not single-use**: "Anyone in your previous party can
  use this offer code for a new booking made within 31 days of departure"
  (offer terms). The 31-day window, not a use counter, is the cost
  limiter.
- CP publishes no per-reference use cap. Their controls are the window,
  the per-booking cap, and terms they can enforce against abuse.
- Their richer Come Back Soon perks (10% deposit, free amendments, day
  passes) are our UNP-18, out of scope.

### Where we deviate from CP, and why (Allan, 2 Sep 2026)

CP checks possession of a typed booking reference; we check verified
party membership on the signed-in account. Reasoning recorded from the
2 Sep discussion:

- CP's typed box likely predates their party-account system, and at
  their scale refusing an unregistered party member is a contact-centre
  cost. We have no such legacy and no support desk; the tighter check
  costs us nothing.
- The person who rebooks is almost always the lead booker. For them,
  account state is strictly better UX than digging a reference out of an
  old email: sign in and the discount is there.
- The typed-secret design needed an alert threshold, a revoke switch and
  an oracle-proofed advisory endpoint, machinery that assumes someone is
  watching a dashboard. Account state deletes all of it.
- The offer becomes the incentive that drives invite adoption: "everyone
  you invite gets KSh 5,000 off their next break too."

Accepted cost: a party member who physically stayed but was never
invited (or never accepted) gets nothing, and there is no override. The
lead guest, who always has the offer, can book for the group instead.

## 3. Decisions (Allan, 27-28 Aug interviews; revised 2 Sep)

1. **Mechanic**: account-state claim. A signed-in user who was a
   verified member of a qualifying stay sees the offer at the pay step
   and on their account page, and applies it with one click. No code
   minting, no code table, no typed reference, no entitlement email.
2. **Value**: KSh 5,000 off per lodge of the NEW booking, capped at 3
   lodges, so 5,000 to 15,000. Confirmed 28 Aug.
3. **Uses and window**: unlimited redemptions of one earning stay within
   **31 days of its departure**, exactly as CP. No per-stay use counter.
   The window plus the membership check are the cost limiters.
4. **The token is verified party membership**: the signed-in user either
   owns the earning stay's `BookingRecord` (`userId`), or holds a live
   accepted `BookingInvite` on it. Possession of the booking reference
   grants nothing.
5. **The manifest-at-departure rule** (2 Sep): an invite confers the
   offer only if the invite row was **created before the earning stay's
   departure**. Late acceptance is fine (invited before the trip,
   registered after); post-departure invites confer booking access only,
   never the offer. The party is whoever was on the manifest when the
   stay happened. Consequence: post-departure email churn can only
   destroy offers (revoking the old invitee), never mint new ones.
6. **No use cap, no alert, no revoke switch** (2 Sep, superseding the
   28 Aug alert design). The membership check bounds claimants
   structurally: at most the lead plus one live accepted invitee per
   adult seat. There is no leaked-reference exposure left to watch for.
7. **No stacking**: one discount instrument per booking. A repeat guest
   cannot use a referral code anyway (`not_first_stay` in
   `server/referral/validate.ts`), so the clash is structural, not UI.
   Referral credit (settled money) stays combinable; the KSh 500
   collectable floor arbitrates.
8. **Cancelling changes nothing.** A cancelled discounted booking creates
   no new entitlement and restores nothing; its redemption row stays as
   history and the refund math already absorbs the discount. The earning
   stay's window keeps running for everyone else regardless.
9. **Consent is notification only.** The post-stay reminder email goes to
   opted-in lead guests (`marketingEmail = true`); this feature is the
   first consumer of that flag. `marketingSms` stays captured and unused
   (no SMS sender exists; schema comment at `prisma/schema.prisma:419`).
   A guest who ticked SMS only keeps the offer and simply hears nothing.
   No consent check anywhere near redemption.
10. **The confirmation email names the offer and nudges invites** (2 Sep,
   closing the old open question): the pre-stay confirmation tells the
   lead guest the offer exists and that inviting party members before
   departure extends it to them, because under decision 5 that is the
   only time inviting still counts. Sent to everyone, not just consented
   guests, since eligibility is universal; consent gates only the
   post-stay reminder.
11. **The pay step names the amount** (2 Sep): "KSh 5,000 per lodge off",
   not a silently discounted total. CP names the figure at the consent
   checkbox already.

### Decisions made for you (flag list)

- **The window bounds when the NEW booking is made** (31 days from the
  earning stay's departure), not when the new stay happens; the new break
  can be any date the calendar sells.
- **Eligibility of the earning stay**: departed, fully paid, not
  cancelled, departure within 31 days. Deliberately absent from that
  list: "not already redeemed".
- **Eligibility reads `BookingInvite` directly, never
  `SessionGuest.invitedUserId`.** The offer needs the invite's
  `createdAt` for the manifest rule and its `revokedAt` for liveness;
  the mirror column carries neither. This follows UNP-20's own rule that
  access decisions consult the invite table only.
- **Multiple qualifying stays**: if a user has more than one earning
  stay in-window, the most recently departed one is used. The discount
  is identical either way; only the `earnedByRecordId` bookkeeping
  differs.
- **Apply is a click, not automatic.** The pay step shows the offer card
  with an Apply button; applying snapshots the discount onto the
  session, and it can be removed before payment. One instrument per
  booking stays a visible choice, not a silent default.
- **Any snapshot mismatch refuses, growth included** (2 Sep, test
  review): when the recomputed discount differs from the number the guest
  accepted, in either direction, the claim refuses and the totals
  re-render. A grown discount is offered again, never silently claimed;
  decision 11 promises the pay step names the amount, so the amount
  charged against must be the amount shown.
- **Discount floor**: after discount plus any referral credit, at least
  KSh 500 of the booking stays collectable (`lib/paymentPlan.ts`). A cap
  that bites is surfaced and re-confirmed, never silent.
- **Every redemption records its claimant** (`claimantUserId`, now
  always present since checkout requires sign-in).

## 4. Terms wording (guest-facing)

To sit on the terms page and be linked from the offer email and the pay
step:

> **Repeat Guest offer.** Book a new break within 31 days of departing
> your last break and save KSh 5,000 per lodge, up to a maximum of three
> lodges. The offer is available to the account that made the previous
> booking and to any party member who accepted an invitation to that
> break before its departure date. Sign in when booking and the offer is
> applied automatically at the point of booking. It cannot be added to an
> existing booking and cannot be used in conjunction with any other
> offer.

## 5. Out of scope

- Minted or shared promo code strings, campaigns, any code table.
- A typed booking-reference fallback for uninvited party members
  (deliberate deviation from CP, section 2).
- Come Back Soon perks (UNP-18). Sign-up prize draw (CP runs one; not
  filed).
- Account credit, campaign dashboards, extras-targeted discounts,
  schedulers, marketing email broadcasting.

## 6. The money seam (unchanged, inherited from the referral engine)

- The allowance-posting step inside `ensureRecord`
  (`server/booking/checkout.ts`) is extracted to take an **instrument**
  (referral or repeat-guest). Strictly after `assignUnits`, strictly
  before the folio re-read, as a Finance API allowance per folio.
- Idempotency key `up-repeat-<sessionId>-<slot>`, reason
  `UP-REPEAT-<earning record id>`, riding Apaleo's 24h dedup window.
- Split across N lodges pro-rata on the session's per-lodge snapshots,
  never live balances; last folio takes the exact remainder; whole-KES
  Math.round.
- The folio re-read absorbs the discount into everything downstream:
  total, per-lodge gross, 30% deposit, Pesapal order, balance payments,
  refund math. No downstream code learns the offer exists.
- Freeze rule: once a BookingRecord exists the session's offer fields are
  read-only, guarded at the route (409) and inside the session write
  (updateMany filtered on `booking: null`).
- The extraction is re-proven on referral alone (crash-replay test) before
  the second instrument is wired in.

## 7. Data model (Prisma, `prisma db push`)

**RepeatGuestRedemption**: `earnedByRecordId` (the earning stay; NOT
unique, many redemptions per stay by design), `sessionId`,
`bookingRecordId` (nullable until confirm, then **unique**: this is what
makes confirm idempotent under crash replay), `claimantUserId` (required),
`amount` (frozen KES granted), `status` (`PENDING` | `CONFIRMED` |
`RELEASED`), timestamps.

One redemption per NEW booking; an earning stay may be claimed many
times; a booking carries at most one claim.

**BookingRecord**: `offerEmailSentAt` (notification stamp). The 28 Aug
`offerRevokedAt` kill switch is deleted with the rest of the
typed-secret machinery.

**BookingSession**: repeat-offer snapshot fields alongside the referral
ones (earning record id, computed discount), frozen with the rest.

No campaign or code tables. Value, lodge cap and window are constants in
`lib/repeatOffer.ts` until a second offer type exists.

## 8. Invariants

1. A discount never exists without a folio allowance posted before the
   freezing re-read.
2. One NEW booking carries at most one redemption, ever, under any
   concurrency. An earning stay may be claimed many times inside its
   window.
3. Only a verified party member of the earning stay can hold or claim
   its offer: the record's owner, or a user with an accepted, unrevoked
   invite on it created before departure. Checked when surfaced and
   re-checked inside the claim.
4. At least KSh 500 of every booking remains collectable after discount
   plus credit.
5. Session offer fields never change after the BookingRecord exists.
6. A replayed or crashed checkout converges to the same totals as a clean
   one.
7. Consent state never affects redemption, only notification.
8. No downstream money code (deposit, balance, refund, Zoho export) reads
   the redemption table.

## 9. Failure modes and how they are survived

**Concurrent claims on the same earning stay**: expected and allowed, so
there is no race to lose in the normal case. The atomic work is narrow: a
conditional insert keyed on the NEW booking. Refusals come only from an
expired window or an eligibility check that stopped holding (stay
cancelled or membership revoked between surfacing and claim), and take
the honest path: snapshot cleared, totals re-render, guest re-reads
before paying. Silently proceeding undiscounted is forbidden.

**Burn timing**: nothing durable at apply. PENDING at checkout, CONFIRMED
in the same local step that records the booking. Dead checkouts leave
PENDING rows, swept by the ops route after 24h (Apaleo's dedup boundary).
Crash between claim and confirm replays through ensureRecord's recovery;
unique `bookingRecordId` plus the idempotency key make replay converge.

**Replay adopts, never re-litigates** (adversarial find, 2 Sep): a replay
that discovers a live PENDING redemption for this session adopts it as
the money truth, the same rule as referral's crashed-claim adoption in
`server/referral/checkout.ts`. Eligibility (window, membership, stay
state) is checked when the claim is FIRST created, never re-run against a
claim whose allowance may already sit on the folios. Without this, a
crash on day 31 replayed on day 32 would refuse the re-check while the
crashed allowance stays on the folio: a record born discounted with no
redemption row, violating invariant 1. The mid-funnel re-checks in this
section all describe the first claim, not replays.

**Window expires mid-funnel**: eligibility computed when the pay step
renders and re-checked at the claim, property-local time (+02:00
discipline). Honest cleanup path.

**Membership revoked mid-funnel**: the lead guest changes the invitee's
seat email while the invitee is mid-checkout with the offer applied. The
claim re-check catches it; same honest cleanup path as an expired
window.

**Identity changes mid-funnel**: user A applies their offer, signs out,
user B signs in and finishes the booking. The details route already
releases referral credit on an identity change; the offer snapshot is
cleared in the same place, so a discount never outlives the account that
earned it. The claim's own membership re-check is the backstop.

**Cancel-the-first-stay gaming**: structurally impossible. Only a
departed, fully-paid, uncancelled stay qualifies, so cancelling the
first holiday leaves nothing to redeem.

**Post-departure invite churn**: covered by decision 5. New invites
after departure carry no offer; revoking an old one strips it. Churn
monotonically shrinks the eligible set.

**Notification failures are low-stakes by design**: entitlement does not
depend on the email. The send claims `offerEmailSentAt` first, then calls
Resend (no-ops without a key); a failure leaves the stamp and the ops
overview lists stamped-but-possibly-unsent records for a manual decision.
Safe to run twice, reminders-style.

## 10. Flows

### Earn

Nothing to do. A stay that departs fully paid and uncancelled IS the
offer, for its verified party members.

### Notify

Two touches:

- **Pre-stay**: the booking confirmation email names the offer and tells
  the lead guest that party members invited before departure share it
  (decision 10). No new send; a section in the existing template.
- **Post-stay**: ops (or later a scheduler) hits
  `POST /api/ops/repeat-offers/run`: finds records departed inside the
  window, lead guest with `marketingEmail = true`, no send stamp; sends
  "You have KSh 5,000 per lodge off your next break, book by <date>,
  just sign in" via `server/email/repeatOffer.ts`. Stamp-first,
  run-twice-safe. No booking reference in the body; it is not the token
  any more.

### Spend

At the pay step, a signed-in eligible user sees the offer card: "KSh
5,000 per lodge off your next break, book by <date>", with an Apply
button. Applying snapshots the earning record id and computed discount
onto the session. Checkout re-checks eligibility inside the claim, posts
the allowance, freezes totals; the deposit is 30% of the discounted
amount. A later cancellation refunds correctly with zero offer-aware
code, and leaves the earning stay's window untouched for the rest of the
party. Signed-out or ineligible users see nothing; there is no input to
probe.

### Manage

Account page: an "Offer available" card while the signed-in user has a
qualifying stay inside its 31-day window (value, deadline), shown to
owners and accepted invitees alike, whether or not others have already
claimed. Ops: `/ops/repeat-offers` overview (in-window stays, notified,
redemption counts), admin-gated like `/ops/referrals`. No revoke button,
no alerts; the page is a read-out, not a control panel.

## 11. Files touched (expected)

- `prisma/schema.prisma`: RepeatGuestRedemption, `offerEmailSentAt`,
  session snapshot fields.
- `lib/repeatOffer.ts`: constants, window and discount math (pure,
  unit-tested).
- `server/repeatOffer/`: eligibility query (membership + stay checks),
  claim, notify job, ops queries.
- `server/booking/checkout.ts` + `server/referral/checkout.ts`: the
  instrument extraction; repeat-guest wired as the second instrument.
- `app/api/ops/repeat-offers/run/route.ts`, `app/ops/repeat-offers/page.tsx`.
- Pay step client + session route: eligibility surface, snapshot
  set/clear, freeze guard.
- Account page: offer card. `server/email/repeatOffer.ts` (template) and
  the offer section in `server/email/bookingConfirmation.ts`.
- Terms page: section 4 wording.

## 12. Acceptance check (end to end, deployed)

1. Complete and settle a booking with marketing ticked, a second adult
   invited (invite created pre-departure) who accepts; force departure
   state. Confirm the confirmation email carried the offer section.
2. Ops run: one offer email recorded for the lead (or listed unsent
   without a key); a second run changes nothing. The account pages of
   BOTH the lead and the accepted invitee show the offer card.
3. Lead books again signed in: offer card at pay names the amount,
   Apply produces the discount line, deposit = 30% of the discounted
   total, folio shows the allowance, totals agree everywhere.
4. Invitee signs in and makes their own separate booking: also
   discounted; two redemption rows against one earning stay, each
   recording its claimant.
5. An unrelated account sees no card anywhere; a stay outside the
   31-day window, cancelled, or unpaid produces no card; a forged
   direct API apply for a non-member is refused.
6. Invite a third address AFTER departure; that account, once accepted,
   can read the booking but gets no offer card and a direct apply is
   refused (manifest rule).
7. Cancel a discounted booking: refund math correct; the earning stay's
   window still works for another party member.
8. Replay test: kill checkout between claim and confirm, replay, totals
   identical, exactly one CONFIRMED redemption for that booking.
9. Consent off: offer card still shows and redemption still works; no
   reminder email sent.
10. Freeze guard: after the discounted booking's record exists, an apply
   or remove of the offer on that session answers 409 and the snapshot
   is unchanged (invariant 5).
11. Both instruments on one booking: a repeat discount plus referral
   credit on a cheap booking leaves exactly the KSh 500 floor
   collectable, never less (invariant 4, decision 7).

## 13. Open questions

None. The three 28 Aug questions closed on 2 Sep: confirmation email
mentions the offer (decision 10), pay step names the amount (decision
11), and the alert threshold died with the typed-secret design
(decision 6).
