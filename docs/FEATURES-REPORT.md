# Unity Parks functionality report

*Where we stand against the Center Parcs experience: what is built and backed
by Apaleo, what Apaleo can still give us without new vendors, and what needs
an integration of its own (like the Pesapal one). Supersedes the 7 July
parity checklist. Date: 7 August 2026, written on the `referral-system`
branch (referral engine committed and E2E-verified, awaiting the Railway
database push, seed, and merge).*

---

## 1. Everything Unity Parks has today

The full inventory of the site as it stands on the `referral-system` branch
(everything on `main` plus the referral engine).

**Search and selection**
- Booking widget: village, dates, lodges, guests chips with anchored panels
- Two-month turnover calendar, Friday/Monday starts only, 3/4/7-night breaks
- Whole-month search: price per valid arrival date, cheapest preselected,
  month price strip on the results page
- Multi-lodge breaks (1 to 3 lodges), each lodge with its own party
- Live availability and whole-break per-lodge pricing for all 4 tiers
- Scarcity messaging, sold-out and too-small reasons, bedrooms filter
- 100-day booking horizon

**Checkout**
- Location step: pick the exact lodge for a fee, or free no-preference
- Little Extras: 5 extras with live pricing and correct per-unit labels
- Your Details: lead guest, adult check, vehicle plate, marketing consent,
  terms acceptance, the account email check, and the referral code box
  (prefilled from /r/ links, validated live)
- Guest Details: named manifest per lodge, skippable, add later from Manage
- Payment: 30% deposit or full when the break is 57+ days out, full only
  inside 8 weeks; apply vested referral credit; Pesapal handoff, then
  confirmation with the real booking reference

**Accounts**
- Register standalone or inline during checkout (one checkbox + password)
- Sign in, sign out, email-status check, password reset by emailed link
- Past bookings adopted onto a new account by email match
- Account page: the guest's breaks plus the referral card (code, share
  link, credit to spend, credit on the way, reward history)

**Manage my booking**
- Find a booking by reference and email, no account needed
- View details and the live folio balance
- Move the whole break to new turnover dates (all lodges together)
- Pay the outstanding balance in full, or part payments of KES 500+
- Cancel with tiered refunds (the 30% deposit is never refunded)
- Add or edit guest names after booking
- Add extras after booking (built 7 Aug): charged at once on paid bookings,
  folded into the outstanding balance on deposit bookings, receipt emailed

**Referral programme** (two tracks, one engine)
- /r/CODE links set a 30-day cookie; the code stamps every new search
- Referred guests get KSh 5,000 off, posted to the Apaleo folio as an
  allowance before totals freeze, so deposits, part payments, refunds and
  receipts all absorb the discount with no referral awareness downstream
- Clients claim a code from the account page and earn KSh 5,000 resort
  credit per referred stay; credit vests after departure, expires after a
  year, and is spendable at the pay step
- Influencers earn commission (4% default, per-influencer override), paid
  out monthly by hand from a CSV export
- Ops console at /ops/referrals: participants, velocity flags, revoke and
  reinstate, locked-credit release, payout batches with a database backstop
- No cron anywhere: vesting, expiry, and restoration are derived at read
  time from an append-only ledger

**Transactional email** (Resend)
- Booking confirmation, balance receipt, cancellation, password reset,
  referral reward, ops velocity alert
- Each guest email sends exactly once (idempotency stamps on the owning
  row); without RESEND_API_KEY sends are skipped and logged, never failed

**Brand**
- Full Center Parcs-style visual system (docs/DESIGN.md)
- The memories counter: 1 memory = 1 guest, 1 stay, paid (party size, any
  length of stay). Homepage band, footer line, confirmation moment. Goal: a
  billion.

Also in flight on other branches: the Payload CMS pilot (homepage
CMS-driven on `payload-cms`, first admin still to be created), and the
first set of real photography sitting untracked in `media/` (landed 30
July) waiting for that work.

---

## 2. Fully implemented, working, backed by Apaleo

Verified in the sandbox (UPNV property): the funnel walked end to end in
the browser on 17 July, the deposit and cancellation rebuild on 23 July,
the referral engine E2E-verified (including the /r/ cookie path) on 6
August.

| Feature | How Apaleo backs it |
|---|---|
| Live pricing and availability | Stay offers per unit group and rate plan, priced per lodge |
| Fri/Mon turnover rule | Enforced by the rate slices themselves, re-validated server-side, invalid dates get recovery chips |
| Whole-month search | Read-side fan-out of offers across each valid arrival day |
| Multi-lodge breaks | One Apaleo booking holding several reservations |
| Extras | Real Apaleo services with live service-offer pricing (early check-in, welcome pack, firewood and BBQ, cycle hire, spa pass) |
| Location step | LOCATION service fee snapshot, live free-unit list, specific unit assigned (idempotent) or auto-assigned, fee dropped if the unit is lost to a concurrent booking |
| Booking creation | Real bookings with reservations, services and folios |
| Payment settle | Pesapal capture first, then the amount posted pro-rata across the lodge folios; every settle validates live folio balances against local bookkeeping; confirmation only renders once the folio says paid |
| Deposit + balance schedule | 30% deposit choice at 57+ days, balance due 8 weeks before arrival, guest-initiated part payments from Manage (spec: docs/deposit-and-cancellation-plan.md) |
| Cancel my booking | Tiered refunds of the amount paid beyond the non-refundable deposit (100/50/25/0 percent at 57+/42-56/21-41/under-21 days), idempotent Apaleo cancel plus folio refund per lodge, cancellation email, cancelled states across Manage and Account |
| Amend dates | Quote every lodge first, amend one by one with rollback, settle any price difference on the folio |
| Referral discount and credit | Posted as Finance API allowances on each lodge folio before totals freeze; the referral ledger itself lives in our Postgres (spec: docs/referral-system-plan.md) |
| Cancellation policy display | Policy attached to the rate plans, shown on lodge cards |

Non-Apaleo but done and live: Pesapal sandbox payments (card and M-Pesa
sims), accounts and sessions in our Postgres, Railway deployment, the
guest manifest, transactional email via Resend, the referral ledger and
ops console, the memories counter.

---

## 3. Not built yet, achievable with Apaleo alone

No new vendors. Split by how much sandbox work each needs.

**Pure orchestration, zero new Apaleo modelling**

| Feature | Shape of the work |
|---|---|
| Promo / repeat-guest codes | The referral engine shipped the hard parts (code capture, validation, folio allowances, no stacking). A general promo layer would reuse the same allowance seam with its own config |
| Basket hold | Apaleo has no soft holds. Our own timed hold with re-validation at pay (we already re-check at pay time) |

**Needs sandbox provisioning (the careful, slow kind)**

| Feature | Modelling needed |
|---|---|
| Dog-friendly lodges | Pet-friendly unit groups carved from existing tiers, own rate plans and restrictions, plus a per-night dog service. Roughly half a day, watch the rate-write budget |
| Adapted lodges | Same pattern, or informational-only via unit attributes |
| Flex cancellation cover | A per-lodge service for the fee; refund logic is ours |
| More villages | A full new property each: unit groups, units, rate plans, rates, services. Realistic but the slowest item here; the provisioning script with --services-only helps |

---

## 4. Needs an integration of its own (like Pesapal)

| Feature | Integration | Notes |
|---|---|---|
| Transactional email | Resend (done) | Confirmation, balance receipt, extras receipt, cancellation, password reset, referral reward, velocity alerts, balance reminders all live. What remains is the 12-week window opening email, which belongs to the pre-arrival engine |
| SMS notifications | Africa's Talking (natural for Kenya) or Twilio | Arrival reminders, gate codes |
| Newsletter | Any email marketing provider | The footer form is decorative today. The cheapest real version: store sign-ups in our own Postgres and export |
| Live chat | Crisp, Intercom | CP has a chat bubble on every page |
| Reviews | Own DB, or a Trustpilot-style widget | CP's "unforgettable moments" wall |
| ANPR gate | Hardware/venue system | We already capture the plate; the gate is a physical integration |
| Real photography and video | Content production, not software | First real set arrived 30 July (media/, untracked); the Payload CMS branch is the natural home for serving it. The SVG placeholder set was built to be swapped file-for-file |

**Where Apaleo is a poor fit by design.** Time-slot inventory: activities
with per-slot capacity, spa treatments, restaurant tables, grocery ordering.
Apaleo has no concept of time slots. The realistic build is our own
scheduling tables in Postgres (we own the stack for it already), with
charges posted to the Apaleo folio so the guest still gets one bill. A
booking SaaS could substitute, but it is not required.

---

## 5. Suggested order

1. **Newsletter capture and small conversion anchors** (per-person-per-night
   price line): small, real wins.
2. **Dogs and adapted lodges**: inventory breadth, needs careful sandbox
   provisioning.
3. **Activities scheduling layer**: the big own-build, start small with one
   activity type and per-day (not per-slot) capacity.
4. **More villages**: only when content and photography exist to justify it.

The previous first three items shipped on 7 August. Lodge detail pages:
/lodges/[code] for all four tiers (intro, gallery, what's included, room by
room, a schematic floor plan, cross-links), wired from the homepage
showcase, all content in content/lodges.ts. Post-booking extras: the
book-service wrapper (verified set-count semantics), an ExtrasOrder ledger
with crash recovery, both payment-state money paths, a receipt email, and
the Manage card. Balance reminders: "due soon" inside 14 days of the due
date and "overdue" after it, each stamped once-only, triggered from
/ops/reminders or by an external scheduler bearing REMINDERS_RUN_SECRET;
auto-cancel of overdue bookings stays a deliberate human decision.

---

## 6. The full Center Parcs feature checklist

Every guest-facing feature Center Parcs has, compiled from our research docs
(site walkthrough, booking design walkthrough, system analysis) and a live
walk of centerparcs.co.uk on 17 July 2026. Checked = Unity Parks has it
working. "(partial)" notes say what part is missing. Physical on-village
facilities (the pool itself, restaurants as venues) are out of scope; this
list is the digital experience.

### Discovery and content
- [x] Homepage with hero, booking widget, seasonal campaigns, FAQ
- [x] FAQ accordion (partial: on the homepage, not a full help centre)
- [ ] Mega-menu navigation with grouped sub-headings and campaign slot
- [ ] Village pages, one per village, with map and character content
- [x] Lodge-type detail pages: photo galleries, floor plans, what's included
      (built 7 Aug; partial: gallery shares placeholder photos across tiers,
      floor plans are schematic diagrams)
- [ ] Seasonal campaign landing pages (autumn, Winter Wonderland, summer)
- [ ] Activity and experience marketing pages (200+ activities)
- [ ] Spa (Aqua Sana) marketing and treatment pages
- [ ] Guest reviews wall
- [ ] Gift cards (buy and redeem)
- [ ] Blog / village news
- [ ] Help centre with searchable articles
- [ ] Ireland site / locale toggle

### Booking widget and search
- [x] Persistent four-chip booking widget (village, dates, lodges, guests)
- [x] Turnover-rule calendar, only valid break starts selectable
- [x] 3 / 4 / 7-night break shapes, default 4
- [ ] 2 / 5 / 6 / 8-night festive specials with named codes (PRXM-style)
- [x] Whole-month search with per-date pricing
- [x] Multi-lodge booking, 1 to 3 lodges, each with its own party
- [x] "More than 3 lodges, call our team" routing
- [x] Party steppers with age bands and per-lodge bedrooms
- [ ] Select up to 2 villages in one search
- [ ] Dog-friendly option with fee
- [ ] Adapted / accessible lodge option

### Results and lodge selection
- [x] Accommodation tiers as cards, cheapest first, per-lodge pricing
- [x] Live availability with scarcity messaging and sold-out reasons
- [x] Price-calendar view of nearby dates (our month strip)
- [x] Cancellation policy shown on cards
- [ ] Per-person-per-night secondary price anchor
- [ ] Staggered access-time ladder by tier (1pm to 4pm) as an upgrade cue
- [x] Location step: pick the exact lodge for a fee, or free no-preference
- [ ] Area-level location choice (near pool, quiet zone) at a smaller fee
- [ ] Interactive village map with selectable lodge plots (ours is
      illustrative, selection is via cards)
- [ ] Guaranteed neighbouring lodges for multi-lodge bookings
- [x] Floor plans per lodge (partial: schematic diagrams on the detail
      pages, not architectural plans)

### Checkout
- [x] Enhancements page with add-on cards and running total
- [x] Early check-in, grocery pack, BBQ and firewood, cycle hire, spa pass
- [ ] Gym pass, fire logs, seasonal packs (Christmas tree) as extras
- [ ] Flex cancellation cover product
- [x] Lead booker details with adult check and marketing consent
- [x] Account creation inline in checkout (one checkbox)
- [x] Guest manifest, skippable, editable later
- [ ] Invited guests get an email and limited booking access
- [x] Vehicle plate capture (partial: one plate, CP allows several)
- [x] Referral code box at Guest Details (partial: referral codes only, no
      general promo codes yet)
- [x] Terms acceptance and final review
- [x] Session resumability, expiry notices, completed-session guards
- [ ] Timed basket hold with visible countdown and expiry modal

### Payment
- [x] Real PSP integration (Pesapal sandbox: card and M-Pesa simulations)
- [x] Payment settled onto the booking folio (Apaleo)
- [x] Confirmation page with real booking reference and itemised receipt
- [x] Deposit now, balance due 8 weeks before arrival (built 23 Jul, see docs/deposit-and-cancellation-plan.md; reminder emails built 7 Aug)
- [x] Referral credit applied at the pay step (vested balance, KES 500 floor)
- [ ] Wallet checkout (Click to Pay) and 3DS surfaced in our own UI
- [x] Confirmation email (Resend, sent once when the folio settles)

### Accounts and identity
- [x] Register, sign in, sign out
- [x] Email-status check during checkout
- [x] Past bookings adopted onto a new account by email
- [x] Account page listing breaks
- [x] Password reset (emailed one-hour single-use link via Resend)
- [ ] Passkeys (WebAuthn) and social sign-in
- [ ] Consent management centre

### Manage my booking and post-booking
- [x] Find a booking by reference and email without an account
- [x] View booking details and folio balance
- [x] Move the break to new turnover dates (rule re-enforced)
- [x] Add or edit guest names after booking
- [x] Self-serve cancellation with tiered charges (rebuilt 23 Jul on the
      8-week anchor: 100/50/25/0 percent of the amount paid beyond the
      non-refundable deposit at 57+/42-56/21-41/under-21 days; Apaleo
      cancel + folio refund + email)
- [x] Balance and part payments from Manage (KES 500 minimum, no stranded
      slivers)
- [x] Add extras after booking (charged at once when paid in full, folded
      into the balance on deposit bookings, receipt emailed)
- [ ] Shared itinerary across guests

### The 12-week pre-arrival window
- [ ] Window opening at 12 weeks with notification
- [ ] Activity booking with time slots and per-slot capacity
- [ ] Activity package bundle discounts
- [ ] Restaurant table reservations with per-person deposits
- [ ] Spa treatment booking
- [ ] Grocery ordering to the lodge (ParcMarket)
- [ ] Free cancellation of activities up to 24 hours before
- [ ] Per-item basket holds in the pre-arrival flow

### Communications and support
- [x] Transactional email (partial: confirmation, balance receipt, extras
      receipt, cancellation, password reset, referral reward and balance
      reminders live; the 12-week window-opening email still to come)
- [ ] Marketing email programme
- [x] Newsletter sign-up (partial: form exists, not wired to anything)
- [ ] Live chat bubble on every page
- [ ] Customer service platform integration
- [ ] Mobile apps (iOS and Android) wrapping My Booking

### Unity Parks only (no Center Parcs equivalent)
- [x] The memories counter: real paid guests, one per stay, counting toward a billion
- [x] ANPR gate story via plate capture at booking
- [x] Two-track referral programme (client resort credit and influencer
      commission) with /r/ share links, an append-only ledger, and an ops
      console with payout batches

Tally: roughly 48 of 87 checklist items done. The whole core booking spine
(search to paid confirmation to manage, extras before and after booking),
the payment plan, and the referral programme are complete; what remains is
mostly content depth, scheduled communications, and the pre-arrival
ancillary engine.
