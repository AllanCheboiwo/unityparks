# Promo codes: implementation plan

Status: agreed direction, not yet scheduled. Written 20 Aug 2026 after the
client feedback round. Round 1 ships only the "phase 1" copy carrot in the
Keeping in touch section (a promise of an exclusive repeat-guest offer);
this document is the plan for making that promise real, plus the general
promo-code machinery it rides on. Deferred for the same reason as the
inventory plan: it touches the money path, and the money path in this
codebase has sharp, well-documented edges that punish improvisation.

Required reading: `docs/referral-system-plan.md`, especially section 5
(the money path). Promo codes are, on the money side, a sibling of the
referral discount and inherit its hardest-won rules verbatim. This
document does not restate that section's full reasoning; it cites it.

---

## 1. What this is and what it does for us

A promo code is a token a guest types at the pay step that reduces the
price of the booking. Two consumers, in order:

1. **The repeat-guest offer** (the client's keep-in-touch carrot, item 9).
   Center Parcs' pattern: guests who opt into marketing receive, after
   their break, an exclusive offer (currently GBP 50 off the next break).
   Ours: after departure, every opted-in lead guest gets an email with a
   single-use personal code for their next booking. This closes the loop
   the checkout copy opens, turns the marketing checkbox into something
   with observable value, and gives the demo a repeat-visit story.
2. **General campaigns** later (a launch discount, an agent code, a
   rainy-season push). The machinery is identical; only who mints the
   code and how many people may use it differ.

What it is not: account credit. Center Parcs does not bank money on the
account and neither do we. A code is a claim on a discount at booking
time, nothing more. (Referral credit already exists and is a different
instrument with its own vesting rules; see stacking, section 5.5.)

## 2. The mental model in one paragraph

A **campaign** defines a discount (percent or fixed KES, validity window,
redemption limits). A **code** is a string that points at a campaign,
either shared (many guests, capped total uses) or minted (single-use,
tied to the person or stay that earned it). A **redemption** is a
lifecycle, not an event: validated when typed, priced into the session,
frozen into the booking at checkout, `CONFIRMED` only when the booking
exists, `RELEASED` if the checkout dies. The one iron rule, inherited
from the referral engine: the discount exists on the Apaleo folio
**before** the balance re-read that freezes the booking's totals, and can
never, under any circumstances, be posted later.

## 3. The money seam: exactly where the referral discount lives

The referral plan proved this seam in the sandbox and documented why any
other placement corrupts money (referral plan 5.1 and 5.2). Promo codes
reuse it wholesale:

- The discount is posted inside `ensureRecord`
  (`server/booking/checkout.ts`), strictly after `assignUnits`, strictly
  before the folio re-read, as a Finance API **allowance** per folio.
- Idempotency key `up-promo-<sessionId>-<slot>`, reason
  `UP-PROMO-<code>`, riding Apaleo's 24h dedup window, exactly parallel
  to `up-allow-<sessionId>-<slot>` / `UP-REFERRAL-<code>`.
- The split across N lodges is pro-rata on the **session's per-lodge
  snapshots**, never live folio balances, last folio takes the exact
  remainder. The referral plan records precisely why a live-balance basis
  defeats idempotent replay; we do not relearn that lesson.
- Whole-KES rounding via `Math.round`, and the same floor: at least
  KSh 500 of the booking stays collectable (`lib/paymentPlan.ts`). A cap
  that bites is surfaced and re-confirmed, never applied quietly.
- The folio re-read then absorbs the discount into everything downstream
  automatically (total, per-lodge gross, 30% deposit, Pesapal order,
  balance payments, cancellation refund math). No downstream code learns
  promo codes exist. This is the entire reason the allowance approach
  exists and the entire reason a "just adjust the total in the UI"
  shortcut is forbidden.
- The freeze rule applies identically: once a `BookingRecord` exists, the
  session's promo fields are read-only, guarded both at the route (409)
  and inside the session write (`updateMany` filtered on
  `booking: null`), mirroring `setReferralOnSession`.

The practical consequence: most of the promo money path is not new code
but a generalization of the referral step, and the build should read as
"extract the allowance-posting step to take an instrument, referral or
promo" rather than a copy-paste sibling.

## 4. Data model

Three tables, prose sketch:

**PromoCampaign.** `name`, `discountType` (`PERCENT` | `FIXED`), `value`
(percent points or whole KES), `validFrom` / `validUntil` (property-local
dates), `maxRedemptions` (nullable = unlimited), `perUserLimit` (default
1), `minBookingAmount` (nullable), `active`. Also `redeemedCount`, a
counter guarded exactly like ResourceDay in the inventory plan: the cap
is enforced by an atomic conditional increment, not by counting rows at
read time.

**PromoCode.** `campaignId`, `code` (unique, uppercase), `singleUse`
(bool), `mintedForUserId` (nullable), `earnedByRecordId` (nullable: the
completed stay that earned a repeat-guest code, unique together with the
offer type so one stay can never mint twice), timestamps. Shared campaign
codes are one row used by many; minted codes are one row per guest.

**PromoRedemption.** `codeId`, `sessionId`, `bookingRecordId` (nullable
until confirm, then unique), `amount` (the frozen KES actually granted),
`status` (`PENDING` | `CONFIRMED` | `RELEASED`), timestamps. The unique
`bookingRecordId` makes confirm idempotent under crash-replay.

## 5. The problems this must survive, and how

### 5.1 Double redemption of a single-use code

Failure: one code, two browser sessions, both validate while the code is
unused, both check out, the code discounts two bookings.

Mitigation: validation at typing time is advisory only (friendly, fast,
non-binding). The binding moment is inside checkout, immediately before
the allowance posts: an atomic claim, a conditional update that flips the
code's redemption to `CONFIRMED` only if no other `CONFIRMED` redemption
exists for it (single-use), and increments the campaign counter only
while under `maxRedemptions`. Loser of the race gets the same honest
refusal path the referral engine uses when a code dies mid-funnel
(referral plan 5.2: checkout fails with a clear message, the session's
promo snapshot is cleared, every totals surface re-renders honestly).
Proceeding silently undiscounted is forbidden: the guest would pay more
than every screen showed.

### 5.2 Burn timing: never burn at entry, never strand a burn

Failure A: code marked used when typed; guest abandons; code is wasted
and the guest who earned it is furious. Failure B: code burned, Apaleo
create fails, booking never exists, code gone.

Mitigation: the lifecycle. Typing creates nothing durable beyond the
session snapshot. Checkout creates `PENDING`, claims atomically (5.1),
posts the allowance, and the redemption is `CONFIRMED` in the same local
step that records the booking. A dead checkout leaves `PENDING` rows,
which are released by the same lazy rule everywhere else in this
codebase: a `PENDING` older than the checkout's own recovery horizon
(24h, the Apaleo dedup boundary the referral plan already adopted) is
treated as free by the claim check and swept by an ops route. Crash
between claim and confirm replays through `ensureRecord`'s existing
recovery, and the unique `bookingRecordId` plus the idempotency key on
the allowance make the replay converge instead of double-discounting.

### 5.3 Idempotent replays of the money post

Covered by construction (section 3): deterministic split basis from
session snapshots, deterministic idempotency keys, Apaleo dedup. The
test for this is the same adversarial test the referral engine passed:
kill the checkout between any two calls and replay; totals must come out
identical.

### 5.4 Money correctness downstream

Failure: deposit computed on the undiscounted total, refunds computed on
the discounted one, or vice versa; a cancelled discounted booking
refunding money never paid.

Mitigation: none needed beyond placement, which is the point of the
seam. Because the allowance lands before the freezing re-read, the 30%
deposit is 30% of the discounted total and `computeRefund` works from
`paidAmount` / `depositAmount` that already absorbed it. The forbidden
thing is any post-freeze adjustment, including an admin "fixing" a
missed code after the fact; the referral plan documents how that wedges
or corrupts in every booking state, and it applies here unchanged.

### 5.5 Stacking with the referral instrument

Failure: promo plus referral discount plus referral credit compound into
a booking below the collectable floor, or into arithmetic nobody can
explain to a guest.

Mitigation, v1 policy, deliberately blunt: **a booking carries at most
one discount instrument: a referral code or a promo code, never both.**
The pay step offers one entry surface; entering a promo where a referral
is stamped (or the reverse) asks the guest to swap, showing both values
so the choice is informed. Referral *credit* (earned, vested KES from
past referrals) remains combinable with either, because credit is
settled money, not a discount, and the existing combined-fit check
(discount plus credit must leave KSh 500 collectable) already arbitrates
the total. If the client later wants stacking, it is a policy change at
one choke point, not a rewrite.

### 5.6 Guessability and abuse

Failure: brute-forced codes, one guest farming a shared campaign code
across accounts, the validation endpoint used as an oracle.

Mitigation: minted codes are `UP-` plus 8 random characters from an
unambiguous alphabet (no 0/O/1/I), roughly 40 bits, unguessable in
practice at our scale. Shared campaign codes are human-chosen and
protected by limits instead: `perUserLimit` enforced against the
booker's user id and email, `maxRedemptions` on the campaign,
`minBookingAmount` where the client wants it. The validation endpoint is
rate-limited per session and returns a single generic "not valid" for
unknown, expired, exhausted, and foreign codes alike (no oracle).
Minted codes additionally bind to `mintedForUserId` and refuse other
accounts. This posture matches the referral engine's fraud section:
cheap structural limits, loud logging, no ambition of perfection.

### 5.7 The repeat-guest mint: exactly once per stay

Failure: the post-stay job runs twice and a guest gets two codes, or a
guest with three lodges gets three, or an opted-out guest gets one.

Mitigation: the mint is keyed to the BookingRecord, not the email send:
`earnedByRecordId` unique per offer type means the second run's insert
loses and moves on, the schedulerless-and-safe-to-run-twice property the
reminders module already established. Eligibility computed at mint time:
booking completed (departed, paid, not cancelled), lead guest has
`marketingEmail = true` **at that moment** (consent is account state and
the account's current answer wins, same rule the details step follows),
one code per record regardless of lodge count.

### 5.8 Sending the email

Failure: minted but never sent, sent twice, or send failures silently
eating offers.

Mitigation: mint and send are separate steps with the stamp on the mint
(5.7). The send follows the reminders pattern exactly: claim a
`sentAt` stamp first, then send via Resend (`server/email/resend.ts`,
which already no-ops without an API key); a send failure leaves the
stamp, and the ops overview lists minted-but-unsent codes for a manual
re-send decision rather than auto-retrying into double-send territory.
New template `server/email/promoOffer.ts` alongside the existing seven.
The whole thing is driven by `POST /api/ops/promos/run` plus an
overview, mirroring `app/api/ops/reminders/run` in shape and admin
gating; nothing depends on a scheduler existing.

### 5.9 Expiry and time zones

Codes and campaigns expire on property-local dates, evaluated with the
same helpers as everything else (+02:00 discipline). A repeat-guest code
gets a generous validity (placeholder: 6 months from mint) so the offer
is a gift, not a countdown trick. Expiry is checked at validation and
again at the atomic claim, so a code expiring mid-funnel refuses at
checkout with the honest-cleanup path rather than booking stale math.

## 6. The repeat-guest flow, end to end

1. Guest books, ticks the marketing checkbox (round 1's copy now names
   the offer). Stay happens. Booking reaches its departed, fully-paid
   state.
2. Someone (or an external scheduler) hits `POST /api/ops/promos/run`.
   The job finds eligible records with no mint stamp, mints one
   single-use code per record bound to the lead guest's user, then sends
   the offer email, claiming the send stamp first. Running it twice
   changes nothing.
3. Months later the guest books again, types the code at the pay step
   (same surface as the referral box), sees the discount line, checks
   out. The atomic claim confirms the redemption, the allowance lands,
   the frozen totals absorb it, the deposit is 30% of less.
4. Cancellation of that discounted booking refunds correctly with zero
   promo-aware code, because nothing downstream knows promos exist.
   Policy note: the code is spent even if the booking is later
   cancelled, v1. Restoring codes on cancellation is a one-line policy
   change at the release hook if the client wants it; default is spent,
   because restoration invites cancel-rebook gaming of expiring offers.

## 7. UI surfaces

- **Pay step**: one "Got a code?" entry (promo or referral autodetected
  by prefix or lookup), advisory discount line, swap dialog for the
  stacking rule (5.5). The existing referral box evolves rather than
  gaining a twin.
- **Account page**: "Your offers" list of minted, unspent, unexpired
  codes with values and expiry dates. Small, but it makes the carrot
  visible between stays.
- **Ops**: campaign list with counters, mint/send run button and
  overview, minted-but-unsent alert list. Same admin gating as
  `/ops/referrals`.
- **Email**: the offer email, plus one line in the booking confirmation
  when marketing is ticked ("your repeat-guest offer will land after
  your stay") if the client wants the loop advertised; open question.

## 8. Costs and tradeoffs we accept

- **No stacking in v1.** One instrument per booking, guest picks the
  better one with full information. Simple to explain, simple to test,
  one choke point to change later.
- **Codes, not credit.** No stored value, no liability ledger, matching
  the reference product.
- **Spent stays spent** on cancellation (v1), with the seam noted for
  reversal.
- **Manual-or-scheduled runs**, not a daemon: identical operational
  posture to reminders, at the cost of someone (or Railway cron, open
  question) needing to hit the route for offers to flow.
- **Advisory validation can lie kindly** for the seconds between typing
  and claiming; the claim is the truth and the refusal path is honest.
  Accepted to keep the typing UX instant.
- **Generalizing the referral allowance step** is a small refactor of
  working money code and needs its adversarial replay test re-run for
  both instruments. That cost is the price of not maintaining two
  divergent copies of the most dangerous code path in the repo.
- **Minimal campaign admin**: campaigns are seeded or created through a
  bare ops form; a marketing-grade campaign manager is out of scope.

## 9. Build order sketch

1. Schema (three tables), code generation and validation helpers, unit
   tests on the atomic claim under concurrency.
2. Extract the referral allowance step in `ensureRecord` to take an
   instrument; re-run the crash-replay tests on referral alone before
   touching promos.
3. Wire promo as the second instrument: session snapshot fields, pay
   route, freeze guard, honest-refusal cleanup, stacking swap.
4. Repeat-guest mint job plus offer email plus ops route and overview.
5. Account page offers list; pay step UI polish.
6. Campaign ops surface; seed a test campaign; docs sweep.

## 10. Open questions to grill before building

- Offer value and shape: fixed KES (client to pick; the Center Parcs
  analogue is a flat amount) or percent? Fixed is easier to explain and
  to cap.
- Repeat-guest code validity length (placeholder 6 months).
- Advertise the offer in the booking confirmation email or keep it a
  post-stay surprise?
- Restore codes when a discounted booking cancels, or stay spent (v1
  default: spent)?
- Does Railway get a scheduler hitting the ops routes, or do reminders
  and promos share a manual run cadence for the demo?
- Should shared campaign codes be in scope for the first build at all,
  or does the repeat-guest minted path ship alone first? (Recommended:
  minted path first; campaigns are a strict superset and can wait.)
- Whether the copy carrot in round 1 should name a number before this
  ships (risk: promising "KSh 2,000 off" months before the machinery
  exists). Recommended: name the mechanism, not the amount, until this
  plan is built.
