# Unity Parks functionality report

*Where we stand against the Center Parcs experience: what is built and backed
by Apaleo, what Apaleo can still give us without new vendors, and what needs
an integration of its own (like the Pesapal one). Supersedes the 7 July
parity checklist. Date: 17 July 2026.*

---

## 1. Everything Unity Parks has today

The full inventory of the site as it stands on the `cp-restyle` branch.

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
  terms acceptance, and the account email check
- Guest Details: named manifest per lodge, skippable, add later from Manage
- Payment: Pesapal handoff, then confirmation with the real booking reference

**Accounts**
- Register standalone or inline during checkout (one checkbox + password)
- Sign in, sign out, email-status check
- Past bookings adopted onto a new account by email match
- Account page listing the guest's breaks

**Manage my booking**
- Find a booking by reference and email, no account needed
- View details and folio balance
- Move the whole break to new turnover dates (all lodges together)
- Add or edit guest names after booking

**Brand**
- Full Center Parcs-style visual system (docs/DESIGN.md)
- The memories counter: 1 memory = 1 guest, 1 night, paid. Homepage band,
  footer line, confirmation moment. Goal: a billion.

---

## 2. Fully implemented, working, backed by Apaleo

Verified in the sandbox (UPNV property) and, for the funnel, walked
end to end in the browser on 17 July.

| Feature | How Apaleo backs it |
|---|---|
| Live pricing and availability | Stay offers per unit group and rate plan, priced per lodge |
| Fri/Mon turnover rule | Enforced by the rate slices themselves, re-validated server-side, invalid dates get recovery chips |
| Whole-month search | Read-side fan-out of offers across each valid arrival day |
| Multi-lodge breaks | One Apaleo booking holding several reservations |
| Extras | Real Apaleo services with live service-offer pricing (early check-in, welcome pack, firewood and BBQ, cycle hire, spa pass) |
| Location step | LOCATION service fee snapshot, live free-unit list, specific unit assigned (idempotent) or auto-assigned, fee dropped if the unit is lost to a concurrent booking |
| Booking creation | Real bookings with reservations, services and folios |
| Payment settle | Pesapal capture first, then the total posted to the Apaleo folio; confirmation only renders once the folio says paid |
| Amend dates | Quote every lodge first, amend one by one with rollback, settle any price difference on the folio |
| Cancellation policy display | Policy attached to the rate plans, shown on lodge cards |

Non-Apaleo but done and live: Pesapal sandbox payments (card and M-Pesa
sims), accounts and sessions in our Postgres, Railway deployment, the
guest manifest, the memories counter.

---

## 3. Not built yet, achievable with Apaleo alone

No new vendors. Split by how much sandbox work each needs.

**Pure orchestration, zero new Apaleo modelling**

| Feature | Shape of the work |
|---|---|
| Cancel my booking | Built 18 Jul: tiered quote (100/50/0 percent by days to arrival), idempotent Apaleo cancel + folio refund per lodge, cancellation email, cancelled states across Manage and Account |
| Add extras post-booking | Amend the reservation's services, settle the difference. The 12-week pre-arrival upsell window in miniature |
| Deposit + balance schedule | Rate plans already carry 30% prepayment terms. Take the deposit via the Pesapal flow we have, track the balance in our DB. The reminder emails belong to section 4 |
| Promo / repeat-guest codes | Discounted rate plans per tier; our layer gates which offers are shown by code |
| Basket hold | Apaleo has no soft holds. Our own timed hold with re-validation at pay (we already re-check at pay time) |
| Lodge detail pages | Pure content: galleries, floor plans, what's included. No Apaleo at all |

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
| Transactional email | Resend, Postmark or SES | Confirmation emails, balance reminders, 12-week window opening. The single most impactful missing integration: today the confirmation exists only on screen |
| SMS notifications | Africa's Talking (natural for Kenya) or Twilio | Arrival reminders, gate codes |
| Newsletter | Any email marketing provider | The footer form is decorative today |
| Password reset | Built (rides on the Resend integration) | Emailed link, one hour, single use, signs out everywhere |
| Live chat | Crisp, Intercom | CP has a chat bubble on every page |
| Reviews | Own DB, or a Trustpilot-style widget | CP's "unforgettable moments" wall |
| ANPR gate | Hardware/venue system | We already capture the plate; the gate is a physical integration |
| Real photography and video | Content production, not software | The SVG placeholder set was built to be swapped file-for-file |

**Where Apaleo is a poor fit by design.** Time-slot inventory: activities
with per-slot capacity, spa treatments, restaurant tables, grocery ordering.
Apaleo has no concept of time slots. The realistic build is our own
scheduling tables in Postgres (we own the stack for it already), with
charges posted to the Apaleo folio so the guest still gets one bill. A
booking SaaS could substitute, but it is not required.

---

## 5. Suggested order

1. **Cancel my booking**: zero modelling, completes the manage story.
2. **Transactional email**: first real integration after payments; makes
   bookings feel real and unlocks password reset and balance reminders.
3. **Post-booking extras + deposit/balance schedule**: turns the 12-week
   window into an upsell engine using only what we have.
4. **Dogs and adapted lodges**: inventory breadth, half a day each.
5. **Activities scheduling layer**: the big own-build, start small with one
   activity type and per-day (not per-slot) capacity.
6. **More villages**: only when content and photography exist to justify it.

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
- [ ] Lodge-type detail pages: photo galleries, floor plans, what's included
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
- [ ] Floor plans per lodge

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
- [ ] Repeat-guest / promo code box
- [x] Terms acceptance and final review
- [x] Session resumability, expiry notices, completed-session guards
- [ ] Timed basket hold with visible countdown and expiry modal

### Payment
- [x] Real PSP integration (Pesapal sandbox: card and M-Pesa simulations)
- [x] Payment settled onto the booking folio (Apaleo)
- [x] Confirmation page with real booking reference and itemised receipt
- [ ] Deposit now, balance due 10 weeks before arrival, reminders
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
- [x] Self-serve cancellation with tiered charges (full refund 28+ days,
      half 8 to 27, none within 7; Apaleo cancel + folio refund + email)
- [ ] Add extras after booking
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
- [x] Transactional email (partial: Resend wired, confirmation email live;
      reminders and window-opening emails still to come)
- [ ] Marketing email programme
- [x] Newsletter sign-up (partial: form exists, not wired to anything)
- [ ] Live chat bubble on every page
- [ ] Customer service platform integration
- [ ] Mobile apps (iOS and Android) wrapping My Booking

### Unity Parks only (no Center Parcs equivalent)
- [x] The memories counter: real guest-nights counting toward a billion
- [x] ANPR gate story via plate capture at booking

Tally: roughly 40 of 90 checklist items done. The whole core booking spine
(search to paid confirmation to manage) is complete; what remains is mostly
content depth, communications, and the pre-arrival ancillary engine.
