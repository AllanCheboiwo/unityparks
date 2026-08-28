# The repeat-guest offer (UNP-7)

Status: grilling

**PARKED 28 Aug 2026, mid-grill, by Allan's decision.** Build order is now
UNP-19 (mandatory accounts), then UNP-20 (invite guests), then this. Do not
resume from this status and write tests: sections 3.4, 3.5, 3.10 and 10
(claiming, identity, surfaces) assume neither prerequisite exists and must
be revised against what actually ships. The CP research in section 2, the
terms wording in section 4, and the money seam in section 6 stand
regardless. Rationale: with accounts and party membership real, the offer
becomes account state rather than a typed secret, which deletes the revoke
switch, the alert threshold, the oracle-proof endpoint and the leaked
reference exposure.

Spec redrafted 28 Aug 2026 after Allan walked Center Parcs' real checkout
and we pivoted to their mechanic: no minted codes, the guest's previous
booking reference IS the claim, usable by the whole party inside a short
window. The 27 Aug minted-code draft is superseded; its money-seam
sections survive because that part is proven and unchanged. Required
reading: `docs/referral-system-plan.md` section 5 (the money path).

---

## 1. The problem in plain language

The checkout's "Keeping in touch" step promises opted-in guests an
exclusive repeat-guest offer. Nothing behind that promise exists. This
feature makes it real, copying Center Parcs faithfully: after a completed
stay, anyone who was on that break gets a fixed discount on a new booking
made within 31 days, claimed by typing the booking reference of the stay
they just finished. Marketing consent buys the email that tells them about
it; it never gates the discount itself.

## 2. How Center Parcs actually does it (verified 27-28 Aug 2026)

- Accounts are mandatory at checkout (filed as UNP-19 for us; this spec
  works either way).
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
  (offer terms). The earning stay behaves as a short-lived shared claim,
  and the 31-day window, not a use counter, is the cost limiter. This is
  why the window is so short: the two choices are a package.
- **Party membership is checkable for CP because of invite-a-guest**: the
  booker enters party members' email addresses, they are prompted to
  create accounts, and the booking links to them with a shared itinerary.
  Our equivalent seam is dormant (`SessionGuest.email`, `invitedUserId`),
  which is now UNP-20.
- CP publishes no per-reference use cap. Their controls are the window,
  the per-booking cap, and terms they can enforce against abuse.
- Their richer Come Back Soon perks (10% deposit, free amendments, day
  passes) are our UNP-18, out of scope.

## 3. Decisions (Allan, 27-28 Aug interviews)

1. **Mechanic**: CP-faithful booking-reference claim. No code minting, no
   code table, no entitlement email.
2. **Value**: KSh 5,000 off per lodge of the NEW booking, capped at 3
   lodges, so 5,000 to 15,000. Confirmed 28 Aug.
3. **Uses and window**: unlimited uses of an earning stay's reference
   within **31 days of its departure**, exactly as CP. No per-stay use
   counter. The window is the cost limiter.
4. **The token is possession of the reference.** That is what CP checks at
   the redemption box. The "you must have been a member of the party" rule
   lives in our terms, enforceable against abuse, not in checkout logic we
   cannot yet support.
5. **Party verification deferred to UNP-20, deliberately.** Party guest
   email is optional today, so gating redemption on a captured contact
   would refuse most legitimate party members and break the CP behaviour
   chosen here. Identity is used for notification and surfacing only, never
   as a redemption gate. When UNP-20 ships, tightening is one check added
   at the claim: the redemption row already records who claimed.
6. **No hard use cap; alert instead of block** (28 Aug). CP publishes no
   cap, and a hard stop would refuse a legitimate eleventh party member.
   So: an `OpsAlert` fires when one stay passes 10 redemptions, and a
   manual per-stay kill switch exists for a reference being farmed. Loud,
   reversible, and faithful.
7. **No stacking**: one discount instrument per booking. A repeat guest
   cannot use a referral code anyway (`not_first_stay` in
   `server/referral/validate.ts`), so the clash is structural, not UI.
   Referral credit (settled money) stays combinable; the KSh 500
   collectable floor arbitrates.
8. **Cancelling changes nothing.** A cancelled discounted booking creates
   no new entitlement and restores nothing; its redemption row stays as
   history and the refund math already absorbs the discount. The earning
   stay's window keeps running for everyone else regardless.
9. **Consent is notification only.** The post-stay email goes to opted-in
   lead guests with linked accounts. No consent check at redemption.
   Eligibility for the send is `marketingEmail = true` only:
   `marketingSms` is captured but unusable (no SMS sender exists; the
   schema comment at `prisma/schema.prisma:419` records that neither flag
   has ever been consumed). This feature is the first consumer of
   `marketingEmail`. A guest who ticked SMS only keeps the offer and simply
   hears nothing.
10. **Anonymous guests can redeem**: possession of the reference is the
   claim, account or not. Moot once UNP-19 lands.

### Decisions made for you (flag list)

- **The window bounds when the NEW booking is made** (31 days from the
  earning stay's departure), not when the new stay happens; the new break
  can be any date the calendar sells.
- **The reference is `apaleoBookingId`**, the string the confirmation
  email already prints as "Booking reference". No new identifier.
- **Eligibility of the earning stay**: departed, fully paid, not
  cancelled, departure within 31 days. Checked advisorily when typed and
  again at the claim. Deliberately absent from that list: "not already
  redeemed".
- **Every redemption records its claimant** (userId when signed in, lead
  guest contact always), though claimant identity gates nothing in v1.
  This is what makes the UNP-20 tightening a one-line check and what makes
  abuse legible in ops today.
- **The reference travels, and that is accepted.** It is printed in every
  confirmation email, so a forwarded email is a usable claim. It is CP's
  own exposure; the window is short, the value is capped per booking, and
  every redemption is still a real paid break.
- **Discount floor**: after discount plus any referral credit, at least
  KSh 500 of the booking stays collectable (`lib/paymentPlan.ts`). A cap
  that bites is surfaced and re-confirmed, never silent.

## 4. Terms wording (guest-facing, CP-shaped)

To sit on the terms page and be linked from the offer email and the pay
step. Adapted from CP's own phrasing:

> **Repeat Guest offer.** Book a new break within 31 days of departing
> your last break and save KSh 5,000 per lodge, up to a maximum of three
> lodges, when booked under the same booking reference. Anyone who was a
> registered member of your previous party can use the offer, provided
> they have that break's booking reference and book within 31 days of
> departure. The offer is applied at the point of booking and cannot be
> added to an existing booking. It cannot be used in conjunction with any
> other offer. Unity Parks may withdraw an offer where a booking reference
> is shared outside the party it belongs to.

That last sentence is ours, not CP's: it is what makes decision 6's kill
switch legitimate rather than arbitrary.

## 5. Out of scope

- Minted or shared promo code strings, campaigns, any code table.
- Come Back Soon perks (UNP-18). Mandatory accounts (UNP-19).
  Invite-a-guest (UNP-20). Sign-up prize draw (CP runs one; not filed).
- Account credit, campaign dashboards, extras-targeted discounts,
  schedulers, marketing email broadcasting.

## 6. The money seam (unchanged, inherited from the referral engine)

- The allowance-posting step inside `ensureRecord`
  (`server/booking/checkout.ts`) is extracted to take an **instrument**
  (referral or repeat-guest). Strictly after `assignUnits`, strictly
  before the folio re-read, as a Finance API allowance per folio.
- Idempotency key `up-repeat-<sessionId>-<slot>`, reason
  `UP-REPEAT-<reference>`, riding Apaleo's 24h dedup window.
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
makes confirm idempotent under crash replay), `claimantUserId` (nullable),
`claimantEmail`, `amount` (frozen KES granted), `status` (`PENDING` |
`CONFIRMED` | `RELEASED`), timestamps.

The uniqueness moved: one redemption per NEW booking, not one per earning
stay. A stay may be claimed many times; a booking carries at most one
claim.

**BookingRecord**: `offerEmailSentAt` (notification stamp) and
`offerRevokedAt` (decision 6's kill switch). Nothing else changes.

**BookingSession**: repeat-offer snapshot fields alongside the referral
ones (earning reference, computed discount), frozen with the rest.

No campaign or code tables. Value, lodge cap, window and alert threshold
are constants in `lib/repeatOffer.ts` until a second offer type exists.

## 8. Invariants

1. A discount never exists without a folio allowance posted before the
   freezing re-read.
2. One NEW booking carries at most one redemption, ever, under any
   concurrency. An earning stay may be claimed many times inside its
   window.
3. At least KSh 500 of every booking remains collectable after discount
   plus credit.
4. Session offer fields never change after the BookingRecord exists.
5. A replayed or crashed checkout converges to the same totals as a clean
   one.
6. Consent state never affects redemption, only notification.
7. No downstream money code (deposit, balance, refund, Zoho export) reads
   the redemption table.

## 9. Failure modes and how they are survived

**Concurrent claims on the same reference**: expected and allowed, so
there is no race to lose in the normal case. The atomic work is narrow: a
conditional insert keyed on the NEW booking. Refusals come only from an
expired window, a revoked offer, or an ineligible earning stay, and take
the honest path: snapshot cleared, totals re-render, guest re-reads before
paying. Silently proceeding undiscounted is forbidden.

**Burn timing**: nothing durable at typing. PENDING at checkout, CONFIRMED
in the same local step that records the booking. Dead checkouts leave
PENDING rows, swept by the ops route after 24h (Apaleo's dedup boundary).
Crash between claim and confirm replays through ensureRecord's recovery;
unique `bookingRecordId` plus the idempotency key make replay converge.

**Window expires mid-funnel**: checked at typing and re-checked at the
claim, property-local time (+02:00 discipline). Honest cleanup path.

**A reference posted publicly**: no hard block (decision 6). The
redemption count per stay is watched; passing 10 raises an `OpsAlert`, and
a human can set `offerRevokedAt` on that stay, which refuses further
claims with a clear message. The advisory endpoint is rate-limited per
session and returns one generic "not valid" for unknown, expired and
revoked references alike, so it cannot be walked as a reference oracle.
UNP-20 closes the underlying gap properly.

**Cancel-the-first-stay gaming** (the contractor's worry): structurally
impossible. Only a departed, fully-paid, uncancelled stay qualifies, so
cancelling the first holiday leaves nothing to redeem.

**Notification failures are low-stakes by design**: entitlement does not
depend on the email. The send claims `offerEmailSentAt` first, then calls
Resend (no-ops without a key); a failure leaves the stamp and the ops
overview lists stamped-but-possibly-unsent records for a manual decision.
Safe to run twice, reminders-style.

## 10. Flows

### Earn

Nothing to do. A stay that departs fully paid and uncancelled IS the
offer, for everyone who was on it.

### Notify

Ops (or later a scheduler) hits `POST /api/ops/repeat-offers/run`: finds
records departed inside the window, lead guest linked to a user with
`marketingEmail = true`, no send stamp; sends "You have KSh 5,000 per
lodge off your next break, book by <date>, your reference is <ref>" via
`server/email/repeatOffer.ts`. Stamp-first, run-twice-safe.

### Spend

At the pay step, "Been with us before?" accepts a booking reference (the
existing referral box grows a second accepted format, routed by shape).
Advisory line shows the discount. Checkout claims, re-checks window,
eligibility and revocation, posts the allowance, freezes totals; the
deposit is 30% of the discounted amount. A later cancellation refunds
correctly with zero offer-aware code, and leaves the earning stay's window
untouched for the rest of the party.

### Manage

Account page: an "Offer available" card while the signed-in user has a
stay inside its 31-day window (value, deadline, the reference), shown
whether or not others have already claimed it. Ops:
`/ops/repeat-offers` overview (in-window stays, notified, redemption
counts, alerts, revoke button), admin-gated like `/ops/referrals`.

## 11. Files touched (expected)

- `prisma/schema.prisma`: RepeatGuestRedemption, two BookingRecord stamps,
  session snapshot fields.
- `lib/repeatOffer.ts`: constants, eligibility and discount math (pure,
  unit-tested).
- `server/repeatOffer/`: validate, claim, notify job, ops queries.
- `server/booking/checkout.ts` + `server/referral/checkout.ts`: the
  instrument extraction; repeat-guest wired as the second instrument.
- `app/api/ops/repeat-offers/run/route.ts`, `app/ops/repeat-offers/page.tsx`.
- Pay step client + session route: snapshot set/clear, freeze guard,
  reference input routing.
- Account page: offer card. `server/email/repeatOffer.ts` (template 8).
- Terms page: section 4 wording.

## 12. Acceptance check (end to end, deployed)

1. Complete and settle a booking with marketing ticked and an account;
   force departure state.
2. Ops run: one offer email recorded (or listed unsent without a key); the
   account page shows the offer card. A second run changes nothing.
3. Book again typing the old reference: discount line at pay, deposit =
   30% of the discounted total, folio shows the allowance, totals agree
   everywhere.
4. Type the same reference in a second, unrelated booking: also
   discounted, two redemption rows against one stay, each recording its
   claimant.
5. A reference from a cancelled or unpaid stay, or outside the 31-day
   window: generic "not valid" advisory, refusal at the claim.
6. Drive one stay past the alert threshold: an OpsAlert exists, claims
   still succeed; then revoke that stay and confirm the next claim refuses
   honestly.
7. Cancel a discounted booking: refund math correct; the earning stay's
   window still works for another party member.
8. Replay test: kill checkout between claim and confirm, replay, totals
   identical, exactly one CONFIRMED redemption for that booking.
9. Consent off: redemption still works; no email sent.

## 13. Open questions

- Should the booking confirmation email mention the offer when consent is
  ticked, or keep it a post-stay surprise?
- The alert threshold (proposed 10 redemptions on one stay).
- Whether the pay-step copy names the amount, now that the checkout carrot
  does.
