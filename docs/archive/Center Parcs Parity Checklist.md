# Center Parcs Parity Checklist

*What the Unity Parks demo already does, and what remains to get as close as practical to the real Center Parcs booking experience. Grounded in `centre-parcs-booking-design-walkthrough.md` and `center-parcs-analysis.md`. Date: 7 July 2026. Demo: Friday 10 July 2026.*

---

## Part 1. Done and verified (as of 7 July 2026)

### Booking widget (CP's "single most important component")
- Four-chip stepper: village, dates, lodges, guests, with anchored panels
- Two-month turnover calendar spread, only valid break-start days selectable
- 3/4/7-night break chips, default 4 (CP's break-duration rule)
- Party steppers with age bands: adults, children 6-17, toddlers 2-5, infants under 2 (representative ages passed to Apaleo)
- Bedrooms preference filter
- CP-faithful handling of unsupported options: greyed with a "real build" tag, never hidden (whole-month search, 2-3 lodges, dogs, adapted lodge, other villages)

### The turnover rule (the demo centrepiece)
- Friday/Monday arrivals and departures genuinely enforced by the Apaleo rate slices, not just the UI
- Invalid dates refused server-side with recovery chips (a Tuesday arrival gets alternatives, not an error)
- Rule re-validated on booking amendments

### Availability and lodge selection
- Live availability and whole-break pricing for all 4 tiers (priced per lodge, not per person, same as CP)
- Scarcity messaging ("Only N left"), sold-out and too-small reasons shown
- Cancellation policy displayed on cards
- Bedroom preference filtering

### Enhancements page
- 5 extras with live Apaleo pricing: early check-in, grocery welcome pack, firewood and BBQ pack, cycle hire, spa day pass
- Correct pricing-unit labels (per lodge vs per person, per stay vs per night)
- Running total bar, step is skippable

### Details, payment, confirmation
- Lead guest form with validation, vehicle registration plate (ANPR story)
- Simulated payment: checkout total posted to the Apaleo folio as a manual "Other" payment
- Confirmation with real Apaleo booking reference, folio-settled badge, itemised receipt, "what happens next" copy

### Manage my booking
- Look up a booking, see details and folio balance
- Move the whole break to new turnover dates, night count preserved, rule enforced (Wednesday refused)

### Plumbing that matches CP's session mechanics
- Checkout session resumability, completed-session guards, expiry notices, honest error statuses, date-horizon caps

---

## Part 2. Remaining for Center Parcs parity

Ordered roughly by funnel position. "Apaleo modelling" says what (if anything) must be provisioned in the sandbox; "own layer" means our orchestration/DB does the work and Apaleo only carries charges.

### A. Search and booking widget

| Feature | What Center Parcs does | Apaleo modelling needed |
|---|---|---|
| Whole-month search | Price-per-break calendar, lowest price on each valid arrival date | None. Read-side offers fan-out across the ~8 valid arrival days per month. Window already priced to ~4 Nov 2026 |
| Multi-lodge (2-3) | One booking, several lodges, shared party | None. An Apaleo booking already holds multiple reservations |
| Dog-friendly lodges | Bookable filter plus dog fee | New pet-friendly unit groups carved from existing tiers, each with own rate plan/rates/restrictions, plus a per-lodge daily dog service |
| Adapted lodges | Bookable accessibility filter | Same pattern as dogs: dedicated unit group, or informational-only via attributes |
| More villages | 5 UK villages to choose from | Full new property per village: unit groups, units, rate plans, rates, services. Careful half-day each (rate-write budget, manual bookingPeriod) |

### B. Lodge selection and configuration

| Feature | What Center Parcs does | Apaleo modelling needed |
|---|---|---|
| Lodge detail content | Photo galleries, floor plans, feature lists, "what's included" | None. Pure content work (placeholder branding is a known decision; real photos drop in later) |
| Location selection | Paid upgrade to pick lodge area (waterside, near the pool) on a village map | Either location-band unit groups (heavy) or a location-preference service fee plus manual unit assignment (light). Recommend the service-fee route |

### C. Guests, account, basket

| Feature | What Center Parcs does | Apaleo modelling needed |
|---|---|---|
| Full guest manifest | Every guest named, children's DOBs, invited guests get limited booking access | None in Apaleo (it only needs counts/ages). Own DB stores the manifest |
| Guest accounts / login | My Center Parcs account, passkeys, shared itinerary | None. Out of demo scope (explicit decision); real build needs a CIAM |
| Multiple vehicles | Several plates per booking for ANPR | None. Own DB, plate list instead of single field |
| Basket hold | Inventory held for a timed window during checkout | Apaleo has no soft holds. Own-layer hold with re-validation at pay time (we already re-check at pay) |

### D. Checkout and payment

| Feature | What Center Parcs does | Apaleo modelling needed |
|---|---|---|
| Deposit + balance schedule | Deposit at booking, balance due ~10 weeks before arrival, reminder emails | Built 23 Jul with an 8-week anchor (spec: deposit-and-cancellation-plan.md); reminder emails need scheduled jobs (phase 2) |
| Repeat-guest / promo code | Code box unlocks discounted pricing | Discounted rate plans per tier; code-gating mechanism needs sandbox verification |
| "Flex" cancellation cover | Paid add-on that relaxes cancellation charges | A per-lodge service for the fee; refund logic is own layer |
| Real payment (Pesapal) | Card/wallet capture, PSP-hosted | None in Apaleo. Out of demo scope (explicit decision) |

### E. Post-booking and the 12-week pre-arrival window (CP's ancillary engine)

| Feature | What Center Parcs does | Apaleo modelling needed |
|---|---|---|
| Cancellation | Self-serve cancel, charges scale with proximity to arrival | None for the simple case: policy already attached, cancel is a reservation action, refund is a folio posting. CP's tiered schedule = own layer |
| Add extras post-booking | Bolt on welcome packs, cycle hire after booking | None. Amend the reservation's services |
| Activities with time slots | 200+ bookable activities, per-slot capacity | Poor fit for Apaleo (no time slots). Own scheduling layer; charges posted to the folio |
| Restaurant reservations | Table bookings, small per-person deposits | Same: own layer, folio for charges |
| Grocery ordering (ParcMarket) | Pre-order groceries to the lodge | Same: own layer. The welcome-pack service already hints at it |
| Transactional email | Confirmation, balance reminders, 12-week window opening | None. Email service + scheduled jobs in own layer |

### F. Content and polish

- Real photography and branding (planned; placeholder by design)
- Interactive village map
- Help, FAQs, terms and conditions pages
- Activity/experience marketing pages (SEO-heavy content layer)

Note: a Flex vs Saver rate choice is NOT a Center Parcs feature (CP prices per break with one rate). It stays off this parity list; it is only interesting as an Apaleo modelling exercise.

---

## Part 3. Suggested order

**Before Friday's demo: nothing required.** The funnel is built and verified. If time allows, the two best-value additions are:
1. **Cancel my booking** - zero Apaleo modelling, completes the manage-booking story
2. **Whole-month price calendar** - read-only, and it is one of CP's most recognisable screens

**Post-demo phases:**
1. Checkout parity: deposit/balance schedule, guest manifest, transactional emails
2. Inventory breadth: dogs, adapted lodges, multi-lodge, location preference
3. The ancillary engine: activities, restaurants, groceries in the 12-week window
4. Accounts and real payments (Pesapal), then more villages
