# **Unity Parks — Website Booking Engine**

## **Functional & Technical Specification (Prototype Phase)**

**Version:** 1.0 (Draft) **Date:** 3 July 2026 **Author:** Prepared for John Latham **Audience:** Development team **Reference model:** Center Parcs UK (centerparcs.co.uk) booking journey, analysed live July 2026 **PMS:** Apaleo (apaleo.com / apaleo.dev)

---

## **1\. Introduction**

### **1.1 Purpose**

This document specifies the Unity Parks website booking engine: a Center Parcs UK–style lodge booking journey for a single Unity Parks site, integrated with Apaleo as the Property Management System (PMS). It covers the full guest journey from search to the point at which a reservation is created in Apaleo via a "Buy now" action. It is written to be implementable by any competent development team regardless of technology stack.

### **1.2 Scope**

**In scope**

* Full booking journey: search widget, break/date selection, party composition, lodge search results, lodge location selection, enhancements (extras/upsells), booker details, guest details, booking summary with "Buy now", confirmation and failure states.  
* All business rules: fixed break patterns, occupancy validation, multi-lodge bookings, dogs, adapted lodges, basket holds and session expiry.  
* Apaleo account configuration: property, unit groups, units, rate plans, restrictions, services, channel setup.  
* Apaleo API integration in detail: authentication, offers, service offers, availability, booking creation, error handling, webhooks.  
* Engine-side data model.

**Out of scope (later phases)**

* Payment provider integration. The prototype ends with a "Buy now" button that creates the reservation in Apaleo with no payment taken. (Apaleo's IBE guide has a dedicated "Get the money" step that slots in here later.)  
* Guest accounts / login and booking management ("My booking").  
* The activities / spa / dining booking system — this will be a separate mobile app, as at Center Parcs.  
* Multi-site support (the architecture must not preclude it, but only one site is specified).  
* CRM, email marketing, gift cards, and post-booking amendments/cancellations.

### **1.3 How Center Parcs UK is used in this document**

Center Parcs UK's live booking engine was analysed as the reference model. Section 3 documents its observed journey; each step then defines the Unity Parks equivalent. Where Center Parcs behaviour was directly observable (search widget structure, break patterns, checkout page sequence, session/basket behaviour, guest age bands, festive exception data), the spec reproduces it precisely. Where behaviour sits behind a live basket session (exact enhancement SKUs, exact form fields), the spec defines a faithful functional equivalent and marks it **\[CONFIG\]** — meaning the item is a configurable catalogue entry, not a hard-coded behaviour.

### **1.4 Definitions**

| Term | Meaning |
| ----- | ----- |
| Break | A fixed-pattern stay: 3-night weekend (Fri→Mon), 4-night midweek (Mon→Fri) or 7-night week (Fri→Fri or Mon→Mon). Festive periods may vary. |
| Lodge | A self-catering accommodation unit. One lodge \= one Apaleo **unit**. |
| Lodge type | A bookable category (e.g. Woodland Lodge 3-bed). One lodge type \= one Apaleo **unit group**. |
| Party | The guests (and dogs) occupying one lodge. |
| Basket | The guest's in-progress selection, held server-side with a TTL. |
| Enhancement | A pre-arrival extra sold during checkout (cot, hamper, etc.). One enhancement \= one Apaleo **service**. |
| IBE | Internet Booking Engine — Apaleo's term for exactly this system; Apaleo has a dedicated IBE channel code. |
| Offer | Apaleo's priced, bookable combination of unit group \+ rate plan \+ dates returned by `GET /booking/v1/offers`. |

---

## **2\. System Overview & Architecture**

### **2.1 Components**

The engine is stack-agnostic. It consists of:

1. **Web front end** — the booking UI (SPA or server-rendered). Renders the search widget, results, checkout steps and confirmation. Holds no secrets and never calls Apaleo directly.  
2. **Booking API (backend-for-frontend)** — the only component that talks to Apaleo. Responsibilities: OAuth token management, break-calendar computation, offer search and caching, basket/session management, occupancy validation, booking creation, error mapping.  
3. **Basket/session store** — server-side store (e.g. Redis or a database table) keyed by a session ID cookie. TTL-based expiry (see 4.6).  
4. **Content store** — lodge type descriptions, photos, feature icons, enhancement marketing copy, village map data. (CMS or static config; Apaleo holds inventory and prices, not marketing content.)  
5. **Apaleo** — single source of truth for inventory, availability, rates, prices, extras pricing and the final reservation record.

### **2.2 Key architectural decisions**

* **Apaleo is the pricing source of truth.** The engine never computes a price; it displays amounts returned by Apaleo's offers and service-offers endpoints, and passes those same amounts back when booking.  
* **Break patterns live in the engine.** Apaleo supports arrival/length-of-stay restrictions, but the fixed-break calendar (and its festive exceptions) is a Unity Parks product rule, generated and enforced by the Booking API. Apaleo restrictions are configured as a defensive second layer (Section 5.4).  
* **Soft holds only.** Apaleo has no reservation-hold primitive suitable for an IBE basket. The basket is a soft hold inside the engine; availability is re-validated immediately before booking creation, and a race-condition failure path is specified (Sections 4.6, 6.7). This matches Center Parcs' observed behaviour ("You have items in your basket that will expire", "Held Until" countdown, a race-condition error page).  
* **One booking, N reservations.** A multi-lodge purchase (up to 3 lodges) is a single Apaleo booking containing one reservation per lodge — Apaleo's native model ("a booking is a container for one or more reservations; one reservation is for one room/unit").

### **2.3 Journey-to-page map**

Center Parcs' engine exposes this exact page sequence (extracted from its site configuration); Unity Parks mirrors it minus payment:

| Step | Center Parcs URL | Unity Parks page |
| ----- | ----- | ----- |
| Search & results | `/breaks-we-offer/search.html` | `/search` |
| Lodge location | `/checkout/location.html` | `/checkout/location` |
| Enhancements | `/checkout/enhancements.html` | `/checkout/enhancements` |
| Your details | `/checkout/your-details.html` | `/checkout/your-details` |
| Guest details | `/checkout/guest-details.html` | `/checkout/guest-details` |
| Payment | `/checkout/payment.html` | `/checkout/summary` (Buy now — no payment in prototype) |
| Confirmation | `/checkout/booking-confirmation.html` | `/checkout/confirmation` |
| Booking failure | `/errors/booking-failure.html` | `/checkout/failure` |
| Race condition (sold while in basket) | `/errors/400errorpage.html` | `/checkout/sold-out` |

---

## **3\. The Booking Journey**

### **3.1 Step 0 — The search widget ("Book your break")**

Center Parcs renders a persistent multi-panel search widget on every page. It has four sequential panels: **Location(s) → Dates → Lodges → Guests & Dogs**, then a **Search** action. Unity Parks reproduces the widget with the Location panel removed (single site).

#### **3.1.1 Panel: Choose dates**

Two search modes (mutually exclusive tabs):

**A. Specific date.** A calendar in which only valid break arrival dates are selectable. Guest first selects a duration; the calendar then highlights valid arrival days.

* Standard durations offered: **3 nights (Fri→Mon "weekend"), 4 nights (Mon→Fri "midweek"), 7 nights (Fri→Fri or Mon→Mon "week")**. Default selection: 4 nights (Center Parcs' widget default is duration "4").  
* Helper copy (observed verbatim on Center Parcs): *"You can book a break for a three-night weekend (Friday to Monday), four-night midweek (Monday to Friday) or seven-nights (starting Monday or Friday). Breaks over the festive period may vary from this pattern."* and *"Breaks start on a Friday or Monday."*  
* **Festive exceptions.** Around Christmas/New Year the pattern changes: Center Parcs publishes an exception dataset offering 2-, 3-, 4-, 5-, 6-, 7- and 8-night breaks with explicit start/end dates, a `breakType` (`midweek`, `weekend`, `fri-week`, `mon-week`) and a product code (e.g. `XM25` \= 23→27 Dec 2025, 4 nights; `NYE257` \= 30 Dec→5 Jan, 6 nights). Unity Parks must support the same mechanism: an **exception table** that adds non-standard breaks and (optionally) suppresses standard ones for a date window. See data model, Section 7.3.  
* Bookable horizon: a configurable far-future limit (Center Parcs currently sells \~18 months ahead: "Breaks available to book up to 13 December 2027").

**B. Search whole month.** Guest picks a month (rolling \~24 months shown) and one break pattern (Fri→Mon 3n, Mon→Fri 4n, Fri→Fri 7n, Mon→Mon 7n). Results show every matching break in that month with a lowest-available price per lodge type (see 3.2.3). Center Parcs disallows month search with 2 villages selected; irrelevant for Unity Parks (single site).

Validation: an arrival date must resolve to exactly one BreakDefinition (Section 7.3). The departure date is always derived, never chosen.

#### **3.1.2 Panel: How many lodges?**

* Options: **1, 2 or 3 lodges**. More than 3 → display call-centre message with phone number (observed CP behaviour: "If you require more than 3 lodges, call…").  
* Each lodge gets its own party (next panel) and its own lodge-type selection in results.

#### **3.1.3 Panel: Guests & Dogs (per lodge)**

For **each** lodge, capture (labels and age bands exactly as Center Parcs):

| Field | Band | Notes |
| ----- | ----- | ----- |
| Adults | 18+ years | Min 1 per lodge; at least one adult must be in every lodge |
| Children | 6–17 years |  |
| Toddlers | 2–5 years |  |
| Infants | Under 2 years |  |
| Dogs | — | Note shown: *"This cost will be added when you select your accommodation location"* — dog fee is priced at the location step |
| Number of bedrooms | 0 \= no preference | Bedroom-count preference used as a results filter |
| Adapted lodge required? | Toggle | Filters to accessible lodge stock |

Prompt: *"Please enter age at time of arrival."* Ages at arrival, not at booking, drive banding.

Occupancy validation rules: Section 4.2.

#### **3.1.4 Search action**

Submitting calls `POST /api/search` on the Booking API with: arrival date, duration/break code (or month \+ pattern for month search), and the per-lodge party array. The API resolves the BreakDefinition(s), queries Apaleo offers (Section 6.4) and returns the results payload. The search criteria are stored in the basket session; the results page is shareable/bookmarkable via query string.

### **3.2 Step 1 — Search results: "Choose your accommodation"**

#### **3.2.1 Multi-lodge iteration**

For multi-lodge searches, lodges are chosen sequentially. The header shows **"Lodge X of Y"** (observed CP pattern). The guest picks a lodge type for lodge 1, then the results re-render for lodge 2's party, and so on. Each lodge's selection is added to the basket independently.

#### **3.2.2 Result cards (specific-date search)**

One card per available lodge type, showing:

* Lodge type name, hero image, short strapline (e.g. "Practical and stylish"), feature icons (Wi-Fi, TV, hot tub, sauna, access-from time, etc.) — all from the content store.  
* Bedroom count / max occupancy.  
* Badges: dog-friendly, adapted, waterside etc. where applicable.  
* **Total price for the break for this lodge** (not per night), from Apaleo `totalGrossAmount`. If a compensatory discount or promotional banner applies, show it above the results (Center Parcs shows contextual banners, e.g. pool-closure compensation messaging).  
* CTA: **Select** → proceeds to Step 2 (location) with this lodge type held in basket.  
* A "sold out" state for lodge types with no availability (card visible but not selectable, or hidden — **\[CONFIG\]**).

Sort order: price ascending by default. **\[CONFIG\]**

#### **3.2.3 Result grid (whole-month search)**

A month grid: rows \= lodge types, columns \= each valid break in the month (e.g. every Fri→Mon), cells \= lowest price or "—" if unavailable. Selecting a cell converts it to a specific-date selection and proceeds as 3.2.2.

#### **3.2.4 Filters**

Filter panel (observed CP has a filter drawer with count badge): bedrooms, lodge type/class, dog-friendly, adapted, price band. Filters apply client-side to the returned result set.

#### **3.2.5 Occupancy fit**

Only lodge types whose `maxPersons` (from Apaleo unit group) can accommodate the party are shown as bookable. Occupancy counting rules in Section 4.2 (note infants and dogs).

### **3.3 Step 2 — Choose your lodge location (`/checkout/location`)**

Center Parcs' first checkout step lets the guest place their chosen lodge type on the village: an interactive map/list of specific lodges or areas, some carrying a **location premium** (e.g. waterside, near the village centre), and it is here that the **dog cost is added**. Unity Parks reproduces this:

1. Display an interactive site map (SVG/tiled image with plot markers) plus an equivalent accessible list view.  
2. Markers show available plots for the selected lodge type and break; each plot may carry a location premium (flat per-stay amount) **\[CONFIG\]**.  
3. If the party includes dogs, the dog fee (per dog, per break) is added to the basket at this step and itemised.  
4. Selecting a plot puts it in the basket and starts/refreshes the basket hold countdown (Section 4.6).  
5. "No preference" option: guest may skip plot choice; a plot is auto-assigned (cheapest, no premium). **\[CONFIG\]**

Apaleo mapping: plots are Apaleo **units** within the unit group. Availability of specific units for the stay window is read via the Availability API (Section 6.5); the chosen unit ID is stored in the basket and passed at booking time as a unit preference (see 6.7 note on unit assignment). Location premiums and dog fees are Apaleo **services** (Section 5.5) so that pricing stays in Apaleo.

### **3.4 Step 3 — Enhancements (`/checkout/enhancements`)**

The extras/upsell step, mirroring Center Parcs' "enhancements" page. Only lodge-related, pre-arrival extras are in scope (activities/spa/dining are excluded — separate future app).

Catalogue (all **\[CONFIG\]**, each mapped to an Apaleo service; indicative Unity Parks launch set matching Center Parcs' enhancement categories):

| Enhancement | Pricing model | Apaleo pricingUnit |
| ----- | ----- | ----- |
| Travel cot | Free, limited stock per lodge | Room (zero price) |
| Highchair | Free, limited stock | Room (zero price) |
| Bed & bath linen upgrade / sofa-bed made up | Per stay | Room |
| Welcome food hamper (variants) | Per hamper | Room |
| BBQ / patio pack | Per stay | Room |
| Daily housekeeping | Per night | Room (per night) |
| Early lodge access / late departure | Per stay | Room |
| Logs for open fire (where applicable) | Per pack | Room |
| Woodland Wonder / kids' welcome pack | Per child | Person |

Behaviour:

* Enhancements are fetched live from Apaleo `GET /booking/v1/service-offers` for the selected rate plan and dates (Section 6.6), so prices and availability windows are Apaleo-driven; the content store supplies imagery and descriptions keyed by service code.  
* Quantity steppers with min/max per item **\[CONFIG\]**; some items constrained by party (e.g. cots ≤ infants count).  
* Mandatory services included in the rate plan (Apaleo supports rate-plan-included mandatory services, e.g. a resort charge) are displayed as included line items and cannot be removed.  
* Running basket total updates as items are added.  
* Step is skippable ("Continue without extras").  
* For multi-lodge bookings the step repeats per lodge or presents a lodge switcher **\[CONFIG — recommend per-lodge tabs\]**.

### **3.5 Step 4 — Your details (`/checkout/your-details`)**

Captures the **booker** (lead guest). Prototype has no accounts; this is a plain form (Center Parcs offers sign-in here; noted as phase 2).

Fields (all required unless stated):

* Title (Mr/Mrs/Ms/Mx/Dr/…), First name, Last name  
* Email, Confirm email  
* Mobile phone  
* Address: postcode lookup (UK postcode → address list; Center Parcs uses a postcode lookup service \+ address validation service), with manual entry fallback: Address line 1, Address line 2 (optional), City, County (optional), Postcode, Country (default GB)  
* Marketing opt-in checkbox (optional, unchecked by default)

Validation: RFC-compliant email match, UK/e.164 phone, postcode format. The booker is passed to Apaleo as the `booker` object and as `primaryGuest` of lodge 1's reservation (Section 6.7).

### **3.6 Step 5 — Guest details (`/checkout/guest-details`)**

Captures the party occupying each lodge, consistent with the counts declared in search (which are locked here; changing party size returns the guest to search with a basket-reset warning — Section 4.7):

Per lodge: for each adult/child/toddler/infant — First name, Last name, Age band (pre-filled), Age at arrival (for under-18s). Lodge 1's first adult defaults to the booker (editable). Dogs: count confirmed, no names required.

Prototype note: Apaleo's reservation model requires only `primaryGuest` per reservation; additional guests are stored as `additionalGuests`/comment data. Full party capture is retained in the engine database regardless (Section 7.6), because the future activities app and site operations need it.

### **3.7 Step 6 — Summary & "Buy now" (`/checkout/summary`)**

Replaces Center Parcs' payment page for the prototype.

Displays:

1. Full itemised basket per lodge: break dates and nights, lodge type, plot/location (+premium), dog fees, each enhancement, per-lodge subtotal, grand total. All amounts are the Apaleo offer amounts captured in the basket.  
2. **Price re-validation:** on page load the Booking API silently re-runs the offers call; if any price differs from the basket, show a "prices have been updated" notice with old→new totals and require re-confirmation (Center Parcs T\&Cs: "the price is only guaranteed at the time of reservation").  
3. Key policies: cancellation policy summary from the Apaleo rate plan (`cancellationFee` on the offer), no-show policy, and a placeholder module for **Flex Your Stay**\-style cancellation-protection upsell (Center Parcs sells "Flex" on the payment page; for Unity Parks this is a phase-2 item once payment exists — leave a feature-flagged slot).  
4. Terms & conditions checkbox (required).  
5. **Buy now** button → `POST /api/bookings` → Apaleo booking creation (Section 6.7). Button disables on first click; the API is idempotent (Section 6.8).

### **3.8 Step 7 — Confirmation / failure**

**Confirmation (`/checkout/confirmation`):** shown when Apaleo returns 201\. Displays the Apaleo **booking ID** (e.g. `KYKXKLWL`) as the Unity Parks booking reference, per-lodge reservation IDs, full recap, and "what happens next" copy. Basket is cleared. (Confirmation email is triggered by the `reservation/created` webhook — Section 6.9 — or synchronously by the API; webhook preferred.)

**Failure (`/checkout/failure`):** Apaleo rejected the booking for a non-availability reason (validation, server error after retries). Basket preserved; guest can retry or contact support. Show a reference (correlation ID) for support.

**Sold out (`/checkout/sold-out`):** the specific race-condition path — the lodge sold while in the basket (Apaleo returns 422/unavailable at creation). Message the situation plainly and deep-link back to results for the same criteria. (Center Parcs has a dedicated race-condition error route.)

---

## **4\. Business Rules**

### **4.1 Break calendar generation**

* The engine generates the rolling break calendar from: (a) the standard pattern rules — every Friday: 3n and 7n products; every Monday: 4n and 7n products — and (b) the **exception table** for festive windows, which can add non-standard durations (2, 5, 6, 8 nights observed at Center Parcs) and suppress standard breaks whose window overlaps an exception. Each break carries a **break code** (e.g. `WKD-2026-07-10`, or an explicit exception code like `XM26`).  
* Sales horizon: `bookableFrom` (today \+ configurable min lead time, default 0–1 day) to `bookableUntil` (configurable end date).  
* A break is offered only if Apaleo has the stay dates open for sale (restrictions/closed dates respected via the offers call returning no offer).

### **4.2 Occupancy & party validation**

* Per lodge: ≥1 adult; total party ≤ lodge type `maxPersons` (Apaleo unit group). **Counting rule \[CONFIG\]:** default — adults \+ children \+ toddlers count toward occupancy; infants (\<2) do not, but each lodge supports a max number of cots **\[CONFIG, default 2\]**. (If Unity Parks prefers infants to count, flip the flag; Apaleo `childrenAges` still receives all under-18 ages.)  
* Dogs: only lodge types flagged dog-friendly are bookable; max dogs per lodge **\[CONFIG, default 2\]**.  
* Adapted required → only adapted lodge stock shown.  
* Bedrooms preference filters but never blocks (0 \= no preference).  
* Age bands are recomputed from age-at-arrival; a child turning 18 before arrival is an adult.

### **4.3 Pricing display rules**

* All prices are **per lodge per break totals**, VAT-inclusive gross amounts as returned by Apaleo. Never display computed per-night prices except as optional "from £X per person per night" marketing derived by division and rounded up to the nearest pound (Center Parcs rounds pppn up).  
* The basket total \= Σ per-lodge (stay `totalGrossAmount` \+ location premium service \+ dog services \+ enhancement services). City-tax-like fees, if ever configured, are added by Apaleo at booking and must be shown from the offer's fee breakdown, never computed locally.  
* Prices are only guaranteed at reservation creation; re-validation at summary (3.7).

### **4.4 Promotion / offer codes**

The engine supports an offer-code entry field (basket-level). Implementation: the code maps to one or more **promo rate plans** in Apaleo (Section 5.4); entering a valid code re-runs the offers call including those rate-plan codes and re-prices the basket. Invalid/expired code → inline error, basket unchanged. (Center Parcs exposes an `offerCode` endpoint in checkout.) **\[Phase-flag: can ship after prototype\]**

### **4.5 Multi-lodge rules**

* Max 3 lodges online; \>3 via phone messaging.  
* Each lodge has independent party, lodge type, plot and enhancements; all share one break (same arrival/departure) — matching Center Parcs (a single break search drives all lodges).  
* One Apaleo booking with N reservations; if any single reservation fails availability at creation, the whole booking POST fails — surface the sold-out flow for the affected lodge and preserve the rest of the basket for re-selection.

### **4.6 Basket, holds & session expiry**

* Basket TTL: **20 minutes** from last basket mutation (Center Parcs `tsl` \= 1200 seconds), refreshed on each checkout step completion.  
* A visible countdown/held-until indicator in the basket UI; a persistent banner when items are near expiry ("You have items in your basket that will expire — don't miss out, checkout now").  
* On expiry: basket cleared server-side; guest sees "Your booking session has expired" modal with a link home (Center Parcs behaviour).  
* Holds are **soft** — no inventory is reserved in Apaleo until "Buy now". Consequences and race handling: Sections 2.2, 6.7.

### **4.7 Basket reset rules**

Starting a new search with a non-empty basket prompts: *"Are you sure? Continuing will clear your basket."* (verbatim CP pattern). Confirm → clear basket and proceed; cancel → keep basket. Editing party size or dates from checkout returns to search with the same prompt.

### **4.8 Accessibility & compliance (summary)**

WCAG 2.2 AA: the map step must have a full list-view equivalent; calendars keyboard-navigable; countdowns exposed via ARIA live regions politely. GDPR: party data minimisation, marketing opt-in unchecked by default, retention policy on abandoned baskets (purge ≤ 30 days).

---

## **5\. Apaleo Configuration (Unity Parks Account Model)**

This section defines how the Unity Parks estate is modelled inside Apaleo. It is a prerequisite for the integration in Section 6\.

### **5.1 Account & property**

* One Apaleo account; one **property** `UP1` — "Unity Parks \[Site Name\]". Currency GBP, time zone Europe/London, check-in/check-out times per lodge class (e.g. 16:00/10:00 standard; premium classes earlier check-in — Apaleo supports per-unit-group defaults via rate plan/time slice definitions; the earlier-access upsell is a service).  
* Environments: use an Apaleo **test/sandbox account** for development; production account for launch. Register the Booking API as an **OAuth simple client (custom app)** in the Apaleo dev console (client credentials flow — Section 6.1).

### **5.2 Unit groups \= lodge types**

One unit group per bookable lodge type **variant**. Because Apaleo availability and offers operate at unit-group level, attributes that gate bookability (dog-friendly, adapted) are modelled as separate unit groups, not tags:

| Unit group code (example) | Name | maxPersons | Notes |
| ----- | ----- | ----- | ----- |
| UP1-WL2 | Woodland Lodge 2-bed | 4 |  |
| UP1-WL3 | Woodland Lodge 3-bed | 6 |  |
| UP1-WL3-DF | Woodland Lodge 3-bed dog-friendly | 6 | dog-friendly stock |
| UP1-WL3-AD | Woodland Lodge 3-bed adapted | 6 | accessible stock |
| UP1-WL4 | Woodland Lodge 4-bed | 8 |  |
| UP1-EX2 | Exclusive Lodge 2-bed | 4 | hot tub, sauna |
| UP1-TH4 | Treehouse 4-bed | 8 |  |

(Extend to the real Unity Parks stock list. Center Parcs' classes — Woodland, Woodland Premium, Forest, Grand Forest, Exclusive, Treehouse, Waterside — illustrate the class × bedrooms × attribute matrix.)

The engine's content store maps unit-group codes → marketing name, images, feature icons, class grouping (so "Woodland Lodge" renders as one card with bedroom variants, or separate cards — **\[CONFIG\]**).

### **5.3 Units \= individual lodges/plots**

Every physical lodge is an Apaleo **unit** inside its unit group, named by plot number (e.g. "Plot 214 — Lakeside"). Unit attributes (Apaleo supports unit attributes) record map coordinates reference and premium band; the engine's map config keys off unit ID.

### **5.4 Rate plans & restrictions**

* Base rate plan per unit group: `UP1-BAR-<UG>` ("Unity Parks Best Available Rate"), **channel: IBE**, guarantee/cancellation policy attached (e.g. standard policy: cancellation fee schedule mirroring Center Parcs-style tiers — **\[CONFIG\]**; the offer response carries `cancellationFee` and `noShowFee` for display).  
* Prices are maintained in Apaleo per time slice (nightly) by revenue management; the engine only reads them. Seasonal pricing, peak dating etc. are entirely an Apaleo rates exercise.  
* **Restrictions (defence in depth):** on each BAR plan set arrival-day restriction to Mon+Fri only, and min/max LOS consistent with 3/4/7-night patterns; festive exception windows get their own restriction periods. Primary enforcement remains the engine's break calendar — restrictions only guarantee that nothing non-conformant can ever be sold even if the engine has a bug.  
* **Promo rate plans:** `UP1-PROMO-<code>-<UG>` derived plans (percentage or fixed discount off BAR), also on the IBE channel, surfaced only when the matching offer code is entered (4.4).

### **5.5 Services \= enhancements, dog fee, location premiums**

One Apaleo **service** per enhancement (Section 3.4 table), plus:

* `UP1-DOG` — dog fee, per stay per dog (booked with quantity \= number of dogs).  
* `UP1-LOC-PREM-1/2/3` — location premium bands, per stay, attached when a premium plot is chosen.

Set each service's pricing unit (Room/Person, one-off or per-night) to match the table in 3.4. Zero-price services (cot, highchair) are real services so stock/ops can see them on the reservation. Mandatory rate-plan-included services (if any, e.g. a future resort charge) are configured as rate-plan included services and displayed as included (Apaleo returns them inside the offer).

### **5.6 Channel & attribution**

All engine traffic uses **channelCode `Ibe`** on offers and service-offers calls (required by Apaleo for correct filtering/attribution) and the booking is created with the corresponding channel so direct-web revenue reports cleanly.

---

## **6\. Apaleo API Integration Design**

Base URL `https://api.apaleo.com`; identity `https://identity.apaleo.com`. All calls are made by the Booking API server-side.

### **6.1 Authentication**

OAuth 2.0 **client credentials** flow (Apaleo "simple client"): POST to identity token endpoint with client ID/secret; cache the bearer token until \~60s before expiry; single-flight refresh. Scopes (minimum): `offers.read`, `reservations.manage` (booking creation), `availability.read`, `setup.read` (properties/unit groups), plus `distribution:subscriptions.manage` later for webhooks. Secrets live in the server secret store; never in the front end.

### **6.2 Reference data sync**

Nightly (and on-demand) sync into the engine cache:

* `GET /inventory/v1/properties` → property details.  
* `GET /inventory/v1/unit-groups?propertyId=UP1` → unit group list, `maxPersons`, for occupancy fit and card rendering.  
* `GET /inventory/v1/units?propertyId=UP1` → unit list for the map.  
* `GET /rateplan/v1/rate-plans?propertyId=UP1&channelCodes=Ibe` → active IBE rate plans.

### **6.3 Search → offers mapping**

For a specific-date search:

```
GET /booking/v1/offers
    ?propertyId=UP1
    &arrival=2026-08-14        // break start
    &departure=2026-08-17      // derived from break definition
    &adults={adults for THIS lodge}
    &childrenAges=16,4,1       // all under-18 ages for THIS lodge, comma-separated
    &channelCode=Ibe
```

Rules (per Apaleo IBE guide):

* `adults` is **per unit**; multi-lodge \= one offers call per lodge with that lodge's party. Calls are made in parallel.  
* `childrenAges` must carry actual ages (banding alone is insufficient — Apaleo prices services/rates by age). Send children \+ toddlers \+ infants ages.  
* Response: array of offers, each \= unit group × rate plan with `totalGrossAmount`, `availableUnits`, `timeSlices` (per-night breakdown), `services` (rate-included mandatory services), `cancellationFee`, `noShowFee`, `minGuaranteeType`. The engine groups offers by unit group, takes the BAR plan (or promo plan when a code is active), and renders cards. `availableUnits` low values can drive scarcity messaging ("Only 2 left") **\[CONFIG\]**.  
* No offer for a unit group \= not available for that break → sold-out card state.

Month search: for each valid break in the month (typically 4–5), run the offers call; run per-break calls in parallel with a short concurrency cap; cache aggressively (6.10).

### **6.4 Plot availability (location step)**

To show available plots for the chosen unit group and stay:

```
GET /availability/v1/units?propertyId=UP1&unitGroupId=UP1-WL3&from=2026-08-14&to=2026-08-17&includeOutOfService=false
```

Filter to units available across the whole window; intersect with map config for rendering. (Endpoint shape per Apaleo Availability API; verify exact parameter names against the current Swagger — flagged in Appendix B.)

### **6.5 Live availability re-checks**

Cheap re-validation before summary render and before booking creation: re-run the offers call (it reflects real-time availability) and, if a specific plot was chosen, the unit availability call. Any change → guest-facing "updated" flows (3.7, 3.8).

### **6.6 Service offers (enhancements pricing)**

After lodge-type selection (and again when the enhancements page loads):

```
GET /booking/v1/service-offers
    ?ratePlanId=UP1-BAR-WL3
    &arrival=2026-08-14&departure=2026-08-17
    &adults=2&childrenAges=16,4,1
    &channelCode=Ibe
```

Response services carry `totalAmount`, per-date breakdown (`dates[]` with `serviceDate`, `amount`, `isDefaultDate`) and pricing unit. Render the catalogue by joining service code → content store. For per-night services (housekeeping) the guest may pick dates or take all-default dates **\[CONFIG — prototype: all nights\]**.

### **6.7 Booking creation ("Buy now")**

Single call: `POST /booking/v1/bookings`. Shape (per Apaleo IBE guide; prototype \= no payment fields):

```json
{
  "booker": {
    "title": "Mr", "firstName": "John", "lastName": "Latham",
    "email": "guest@example.com", "phone": "+447700900000",
    "address": { "addressLine1": "1 High St", "postalCode": "AB1 2CD",
                 "city": "Town", "countryCode": "GB" }
  },
  "reservations": [
    {
      "arrival": "2026-08-14",
      "departure": "2026-08-17",
      "adults": 2,
      "childrenAges": [16, 4, 1],
      "channelCode": "Ibe",
      "guaranteeType": "Company",            // see note below
      "primaryGuest": { "...as booker or lodge lead..." },
      "guestComment": "Plot preference: 214 Lakeside. Party: ... Dogs: 1",
      "timeSlices": [
        { "ratePlanId": "UP1-BAR-WL3" },
        { "ratePlanId": "UP1-BAR-WL3" },
        { "ratePlanId": "UP1-BAR-WL3" }
      ],
      "services": [
        { "serviceId": "UP1-DOG" },
        { "serviceId": "UP1-HAMPER-CLASSIC" },
        { "serviceId": "UP1-LOC-PREM-1" }
      ]
    }
    // ...one reservation object per additional lodge
  ]
}
```

Implementation notes:

1. **timeSlices:** one entry per night carrying the `ratePlanId`; omit `totalAmount` overrides so Apaleo prices from its rates (source of truth). If the engine ever needs to pin the displayed price, it may send per-slice `totalAmount` gross values — never including city-tax-like fees.  
2. **guaranteeType / payment:** prototype creates the booking with the least-restrictive guarantee the rate plan allows and **no `transactionReference` and no `prePaymentAmount`** (both are payment-phase fields; Apaleo only attempts to finalise payment when a transactionReference is present). When payments arrive (phase 2), follow Apaleo's IBE "Get the money" guide: charge `prePaymentGrossAmount` (stay \+ services, per reservation), pass `prePaymentAmount` per reservation and the PSP reference as `transactionReference`, then optionally attach a payment account via `POST /booking/v1/payment-accounts/by-authorization`.  
3. **Unit (plot) assignment:** reservation creation books a unit **group**; the specific plot is then assigned via the reservation-actions assign-unit endpoint (`PUT /booking/v1/reservation-actions/{id}/assign-unit/{unitId}`) immediately after creation, using the reservation IDs from the 201 response. If assignment fails (plot taken in the race window), fall back to auto-assignment and flag the discrepancy on the confirmation ("your lodge location will be confirmed"), logging for ops. Also always record the plot in `guestComment` as a belt-and-braces signal for the site team. (Verify the exact assign-unit route against current Swagger — Appendix B.)  
4. **Response:** 201 with booking `id` and per-reservation `id`s → persist BookingRecord (7.7), clear basket, render confirmation.  
5. **Failures:** 422 availability/validation → sold-out flow (3.8); 401 → token refresh \+ single retry; 5xx/timeouts → retry policy (6.8) then failure page.

### **6.8 Idempotency & retries**

All POSTs to Apaleo send an **Idempotency-Key** header (UUID persisted with the basket's checkout attempt) so client retries and double-clicked "Buy now" cannot create duplicate bookings. Retry policy: network errors/5xx — up to 2 retries, exponential backoff (0.5s/2s), same idempotency key; 4xx — never retried. "Buy now" button disabled after first click regardless.

### **6.9 Webhooks**

Subscribe (Webhook API) to `reservation/created` (and later `booking/*`, `reservation/changed`) for: confirmation email dispatch, engine-side booking status sync, and ops notifications. Webhook consumer verifies signature, is idempotent by event ID, and reconciles nightly against `GET /booking/v1/reservations?propertyId=UP1`.

### **6.10 Caching & rate limits**

* Offers cache: key `(unitGroup?, arrival, departure, partySignature, promoCode?)` → TTL 5 minutes (month-grid cells 15 minutes). All checkout-path calls (summary re-validation, booking) bypass cache.  
* Reference data cache: 24h TTL \+ on-demand invalidation.  
* Respect Apaleo rate limits (429 handling: back off per `Retry-After`, degrade month grid gracefully).

### **6.11 Error mapping table**

| Apaleo condition | Engine behaviour | Guest experience |
| ----- | ----- | ----- |
| Token failure (401) | Refresh once, retry | Invisible |
| Offers: empty for unit group | Mark unavailable | Sold-out card |
| Offers: empty for all | — | "No availability for this break" \+ nearest-alternative suggestions **\[CONFIG\]** |
| Price changed at summary | Re-quote basket | "Prices updated" notice, re-confirm |
| POST booking 422 (availability) | Identify failing lodge | Sold-out page, basket preserved minus failed lodge |
| POST booking 4xx (validation) | Log \+ alert; do not retry | Failure page with support reference |
| POST booking 5xx/timeout | Retry ×2 idempotently | Spinner; then failure page if exhausted |
| 429 rate limit | Backoff per Retry-After | Slight delay / degraded month grid |

---

## **7\. Engine Data Model**

Server-side entities (storage-agnostic; suggested field lists):

### **7.1 BasketSession**

`id (uuid)`, `createdAt`, `lastTouchedAt`, `expiresAt (lastTouched + 20m)`, `state (searching | selecting | checkout | completed | expired)`, `searchCriteria`, `lodgeSelections[]`, `booker`, `idempotencyKey`, `promoCode?`.

### **7.2 SearchCriteria**

`mode (specificDate | wholeMonth)`, `arrivalDate?`, `breakCode`, `month?`, `pattern?`, `lodgeCount (1–3)`, `parties[]` (per lodge: `adults`, `childAges[]`, `toddlerAges[]`, `infantAges[]`, `dogs`, `bedroomsPref`, `adaptedRequired`).

### **7.3 BreakDefinition**

`code`, `type (weekend | midweek | friWeek | monWeek | exception)`, `arrivalDate`, `departureDate`, `nights`, `source (standard | exception)`. Exception table rows: `code`, `startDate`, `endDate`, `nights`, `breakType`, `suppressesStandard (bool)` — exactly the shape observed in Center Parcs' published festive dataset (e.g. `{"code":"XM25","startDate":"23/12/2025","endDate":"27/12/2025","breakType":"midweek"}`).

### **7.4 LodgeSelection (per lodge in basket)**

`lodgeIndex`, `unitGroupId`, `ratePlanId`, `offerSnapshot` (totalGrossAmount, timeSlices, cancellationFee, capturedAt), `unitId?` (plot), `locationPremiumServiceId?`, `enhancements[] {serviceId, quantity, dates?, amountSnapshot}`, `dogServiceQuantity`.

### **7.5 Booker**

Title, names, email, phone, address (line1, line2?, city, county?, postcode, countryCode), marketingOptIn.

### **7.6 PartyMember**

`lodgeIndex`, `band (adult|child|toddler|infant)`, `firstName`, `lastName`, `ageAtArrival?`.

### **7.7 BookingRecord**

`engineRef`, `apaleoBookingId`, `apaleoReservationIds[]`, `status (created | unitAssigned | failed)`, `totalGross`, `createdAt`, `basketSnapshot (json)`, `correlationId`.

---

## **8\. Non-Functional Requirements**

* **Performance:** search results ≤ 2.5s p95 (parallel offers calls \+ cache); month grid ≤ 4s p95 with progressive cell fill.  
* **Availability:** engine degrades to "phone us" messaging if Apaleo is unreachable; status probe on Apaleo platform status.  
* **Security:** all Apaleo credentials server-side; TLS everywhere; basket session cookie HttpOnly/SameSite=Lax; PII encrypted at rest; audit log on booking creation.  
* **Observability:** correlation ID per basket flows through all Apaleo calls and appears on failure pages; metrics on offers latency, cache hit rate, booking success/failure, race-condition (422) count, basket-expiry rate.  
* **Analytics events:** search, results-view, lodge-select, plot-select, enhancement-add, checkout-step, buy-now, confirmation, failure — with break code, unit group and totals for conversion funnels.  
* **Responsive:** mobile-first; the search widget collapses to a stepper as on Center Parcs mobile.

---

## **9\. Phase 2 Hooks (explicitly out of scope now)**

1. **Payments** — insert Apaleo's IBE "Get the money" step between summary and booking creation: charge Σ `prePaymentGrossAmount` (stay \+ services) per reservation, pass `prePaymentAmount` \+ `transactionReference` in the booking POST, optionally attach payment accounts. Deposit/balance schedules (Center Parcs: deposit at booking, balance \~10–12 weeks pre-arrival) are a policy layer above.  
2. **Flex Your Stay-equivalent** cancellation-protection product — priced per lodge, varies by date/lodge type, purchasable only at booking or within 14 days after; modelled as an Apaleo service \+ policy switch.  
3. **Guest accounts and My Booking** (view, amend, pay balance, invite guests).  
4. **Offer codes** at launch-ready polish (4.4), gift cards, repeat-guest offer pricing.  
5. **Multi-site** — add properties; search widget regains the Location panel (Center Parcs allows selecting up to 2 villages to compare).  
6. **Activities app integration** — the confirmed booking (Apaleo booking ID \+ party) is the identity anchor the future activities app will consume.

---

## **Appendix A — Observed Center Parcs reference data (evidence)**

* Checkout sequence (from site config JSON): `search → /checkout/location.html → /checkout/enhancements.html → /checkout/your-details.html → /checkout/guest-details.html → /checkout/payment.html → /checkout/booking-confirmation.html`, with `errors/booking-failure.html` and a race-condition error route; session `tsl: 1200` (seconds); basket-clear warning: "Continuing will clear your basket"; session-expiry modal: "Your booking session has expired". Support endpoints observed: postcode lookup, address validation, offer code, accommodation-book, location-book, remove-from-basket.  
* Search widget: villages (up to 2\) → dates (specific / whole month; 2–8 night options; default 4; "Breaks start on a Friday or Monday") → lodges (1–3, else phone) → guests & dogs per lodge (Adults 18+, Children 6–17, Toddlers 2–5, Infants \<2, Dogs with "cost added at location selection", bedrooms, adapted toggle; "age at time of arrival").  
* Festive exception dataset (sample): `XM25` 23→27 Dec 2025 (4n midweek); `NYE25` 30 Dec→2 Jan (3n); `PX257` 19→27 Dec 2025 (8n fri-week); `NY267` 30 Dec 2026→4 Jan 2027 (5n fri-week); full dataset embedded in the site's calendar component.  
* Month-search patterns: Fri–Mon 3n, Mon–Fri 4n, Fri–Fri 7n, Mon–Mon 7n; month search disabled when 2 villages selected.  
* Booking horizon: "Breaks available to book up to 13 December 2027" (observed July 2026).  
* Lodge classes and per-class access times: Woodland/Woodland Premium from 4pm, Forest/Grand Forest from 3pm, Exclusive from 2pm, Treehouse from 1pm.  
* Flex Your Stay: purchasable at booking (payment page) or within 14 days by phone; price varies by village, date, accommodation; non-refundable; per lodge.  
* Pricing T\&Cs: prices subject to change, "only guaranteed at the time of reservation"; pppn prices rounded up to nearest pound.

## **Appendix B — Apaleo endpoint reference used by this spec**

| Purpose | Endpoint | Verified against |
| ----- | ----- | ----- |
| Properties | `GET /inventory/v1/properties` | apaleo.dev IBE guide |
| Unit groups / units | `GET /inventory/v1/unit-groups`, `GET /inventory/v1/units` | Apaleo Inventory API |
| Stay offers | `GET /booking/v1/offers` (`propertyId, arrival, departure, adults, childrenAges, channelCode=Ibe`) | apaleo.dev IBE guide (verbatim) |
| Enhancement offers | `GET /booking/v1/service-offers` (`ratePlanId, arrival, departure, adults, channelCode=Ibe`) | apaleo.dev IBE guide (verbatim) |
| Create booking | `POST /booking/v1/bookings` (booker, reservations\[\], timeSlices\[\], services\[\]) | apaleo.dev IBE guide (verbatim) |
| Assign plot | `PUT /booking/v1/reservation-actions/{id}/assign-unit/{unitId}` | To re-verify field-exact in Swagger before build |
| Unit availability | `GET /availability/v1/units` | To re-verify field-exact in Swagger before build |
| Payment accounts (phase 2\) | `POST /booking/v1/payment-accounts/by-authorization` | apaleo.dev IBE guide |
| Webhooks | Webhook API subscriptions (`reservation/created`) | apaleo.dev webhook guides |

Swagger for exact schemas: `https://api.apaleo.com/swagger/index.html` (Booking V1, Inventory V1, Availability V1, Rateplan V1).

**Sources:** centerparcs.co.uk (homepage, search, break-durations, Flex Your Stay pages, live July 2026); apaleo.dev IBE integration guides ("Get offers", "Create the booking").

