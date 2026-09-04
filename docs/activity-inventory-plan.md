# Activity inventory and time slots: implementation plan

Status: interviewing

Scheduled 3 Sep 2026 as UNP-6, on branch `unp-6-activities-inventory`. Allan
mapped the old freeform status ("agreed direction, not yet scheduled") onto
the workflow's `interviewing` state, so this document is treated as notes to
be re-questioned, not as an approved plan. v1 scope is bikes and spa only;
activities ride the same tables afterwards as data rows.

Written 20 Aug 2026 after the
client feedback round (see the client's items 4 on bikes and spa). The build
was deliberately deferred out of client-feedback round 1 because it is the
first feature where our database, not Apaleo, becomes the source of truth
for availability. That is the same class of work as the Pesapal integration
and the referral engine: the happy path is a day, the seams are the project.
This document exists so we grill the plan before any code is written.

Related reading: `docs/referral-system-plan.md` (house patterns for money,
idempotency, and crash-replay that this plan reuses),
`docs/deposit-and-cancellation-plan.md` (the checkout sequence this plugs
into), `docs/post-booking-extras.md` (the Manage my booking surface).

---

## 1. What this is

Today, extras that are physically limited behave as if they are infinite:

- **Cycle Hire** is one Apaleo service (`CYCLE`, per person per night). There
  are no sizes. Sizing is a line of marketing copy ("our Cycle Centre team
  sizes every rider on arrival"). The only quantity cap anywhere is a
  client-side constant `MAX_QTY = 8` in `ExtrasClient.tsx`. Two hundred
  guests could book two hundred bikes for the same Friday and nothing would
  object.
- **Spa Day Pass** (`SPA`, per person per day) is an all-day pass with no
  capacity. Real spas do not work like this and neither does the reference:
  Center Parcs' Aqua Sana sells a 3-hour session with a fixed start time
  you choose, and sessions sell out.
- Apaleo cannot help. Apaleo services carry a price, a pricing unit, and a
  posting mode. They have no stock, no calendar, no capacity. Lodges are
  availability-checked by Apaleo; services are not and never will be.

This plan introduces an **availability layer on our side** for anything
limited or time-slotted, while Apaleo keeps everything money-shaped. It is
also, deliberately, the foundation of the future activities product: the
client wants Center Parcs-style pre-booking of activities before the stay
and during the stay, and every such activity (archery at 2pm, pottery at
10am, a dinner seating) is the same shape as a spa session.

What the guest will see when this ships:

- Bikes are hired **for the whole break**, per rider, in a **size** (adult
  S/M/L, child sizes by wheel), and a size can be **sold out for your
  dates**. This mirrors Center Parcs exactly (whole-break hire, sized
  fleet, "book early, they are popular").
- The spa is a **session**: pick a day of your stay and a start time, and a
  session can sell out.
- Sold-out states are honest in the extras step, re-checked at payment, and
  the same gate protects post-booking additions from Manage my booking.

What it does for us: the demo stops being embarrassable in exactly the spot
the client poked ("maybe this bike is not available this date since already
booked"), and the activities layer we have already promised ourselves gets
its data model for free.

## 2. The mental model in one paragraph

There are **resources** (a medium adult bike fleet, the 10am spa session, a
future archery class). A resource has a **capacity** (how many exist) and a
**kind**: stock resources are consumed per calendar day with no time
attached (bikes), session resources are consumed at a date plus a start
time (spa, activities). Guests take capacity by placing **holds**: a hold
is (resource, date, quantity, who, status). Availability is always
**derived**: capacity minus the sum of active holds for that resource-day.
Nothing ever stores "available = 7" anywhere, because stored availability
is a cache and caches of contended numbers drift. A whole-break bike hire
is simply one hold per night of the stay, placed and released as a unit.

## 3. Why our database and not Apaleo, and the split we accept

- Apaleo remains the **only** authority on money: service prices come from
  its service-offers endpoint, chosen extras are booked into the
  reservation as services, folios settle exactly as today. This plan adds
  zero new money paths.
- Our Postgres becomes the **only** authority on whether a bike or session
  exists to sell. The two systems are linked by the booking flow: no hold
  confirmed without an Apaleo booking, no capacity-limited service booked
  into Apaleo without a confirmed hold.
- The cost of a split source of truth is drift, and the mitigation is a
  reconciliation script (section 5.5) plus invariants simple enough to
  assert mechanically. We accept this cost because the alternative, no
  inventory at all, is what the client just called out.

## 4. Data model

Three tables, described here in prose; exact Prisma comes at build time.
House convention holds: dates are ISO `YYYY-MM-DD` strings in property-local
terms (the property runs +02:00; same convention as `arrival` and
`dateOfBirth` today).

**InventoryResource.** One row per sellable pool. Fields: `code` (stable
string key, e.g. `BIKE-ADULT-M`, `SPA-AM`), `name`, `kind`
(`STOCK` | `SESSION`), `capacity` (int), `sessionStart` (nullable "HH:MM",
set only for sessions), `apaleoServiceCode` (which Apaleo service prices
it, e.g. all bike sizes point at `CYCLE`), `active`. Capacity is flat, not
per-date, in v1; a per-date override table is a clean later bolt-on and is
deliberately out of scope now.

**ResourceDay.** The contention point, one row per (resource, date) that
has ever been touched: `resourceId`, `date`, `taken` (int). This is the
row the race-proof gate runs on (section 5.1). It is a **counter, not a
truth**: the truth is the hold ledger, and reconciliation asserts that
`taken` equals the sum of active holds. Rows are created lazily on first
hold (upsert), so the table stays tiny.

**InventoryHold.** The ledger. Fields: `resourceId`, `date`, `qty`,
`status` (`HELD` | `CONFIRMED` | `RELEASED`), `sessionId` (the
BookingSession that placed it), `bookingRecordId` (nullable, stamped on
confirm), `slotIndex` (which lodge, matching the session's lodge slots),
`expiresAt` (set while `HELD`), timestamps. Unique constraint on
`(sessionId, slotIndex, resourceId, date)` so a replay upserts instead of
duplicating. A whole-break bike hire for 3 nights and 2 riders is three
hold rows of `qty = 2` sharing one logical group; they are placed and
released together.

Sizes are just distinct resources. Sessions are just resources with a
`sessionStart`. An activity added in 2027 is one new row in
`InventoryResource` and zero schema changes. That is the entire trick of
the design.

## 5. The problems this must survive, and how

This section is the reason the build was deferred. Each subsection names a
failure that WILL happen if ignored, then the mitigation.

### 5.1 Concurrency: the last-bike race

Failure: two guests both see "1 medium bike left", both pass a
read-then-check-then-write availability check, both get a bike, fleet is
oversold. Naive `SELECT sum(...)` then `INSERT` is broken under any
concurrency, and Postgres READ COMMITTED will not save it.

Mitigation: the only gate that counts is one atomic guarded update per
resource-day, inside a transaction that also writes the hold rows:

    UPDATE "ResourceDay"
    SET taken = taken + $qty
    WHERE "resourceId" = $r AND date = $d
      AND taken + $qty <= (SELECT capacity FROM "InventoryResource" ...)

If the update reports zero affected rows, that day is sold out, the
transaction rolls back, the guest gets an honest message. No advisory
locks, no SERIALIZABLE, no retry loops: the row lock the UPDATE takes is
the whole concurrency story. Multi-day hires run the guarded update once
per night in one transaction, ordered by date to make deadlock impossible
(two transactions locking the same set of rows in the same order cannot
deadlock). If any night fails, the whole group rolls back: a 3-night hire
that can only get 2 nights is not a sale, it is a refusal.

### 5.2 Idempotency and crash-replay

Failure: checkout's `ensureRecord` is a sequence of network calls with no
umbrella transaction (referral plan, section 5.2: recovery is idempotency
keys plus the P2002 adopt-the-winner path). A crash mid-checkout replays
the sequence. If hold placement is not idempotent, every replay decrements
stock again and a flaky network eats the fleet.

Mitigation: hold identity is deterministic, derived entirely from the
session: `(sessionId, slotIndex, resourceId, date)` is unique, and
placement is an upsert that only moves `taken` when it actually creates or
grows a row. Replays with identical inputs are free, matching the
`up-allow-<sessionId>-<slot>` discipline the referral allowances use. The
basis for what to hold is the **session's extras snapshot**, never a live
re-read, for the same reason the referral split uses session snapshots:
identical on every retry, so the replay writes the same rows.

### 5.3 Abandoned baskets: hold expiry

Failure: holds placed when a guest adds a bike to the basket, guest walks
away, stock is hoarded by ghosts. Center Parcs sized this problem for us:
popular items and abandoned funnels are both guaranteed.

Mitigation, two-layered and schedulerless (house pattern from
`server/booking/reminders.ts`, which is deliberately schedulerless and
safe to run twice):

- **Lazy expiry at the gate.** An expired `HELD` hold counts as free: the
  guarded update's competing reads treat `expiresAt < now` holds as
  releasable, and the placement transaction sweeps expired holds on the
  rows it touches before applying itself. Availability shown to guests
  applies the same rule at read time. Nothing needs to run for
  correctness.
- **An ops sweep for hygiene.** `POST /api/ops/inventory/sweep` releases
  expired holds and re-derives `taken`, so the ledger stays clean and
  reconciliation stays cheap. Running it twice in a row is free. An
  external scheduler may hit it; nothing depends on it running.

When to place the hold is a policy choice with a real tradeoff: hold at
add-to-basket (nice UX, maximal hoarding) or hold at pay-start (minimal
hoarding, basket can disappoint at the last step). **Chosen: hold at
pay-start with a short TTL (a hold lives roughly 30 minutes, tuned
later), and the extras step only checks availability without holding.**
The basket is a plan, not a claim; the pay step is the claim. This matches
how the lodge itself already behaves (units are assigned at checkout, not
at search) and keeps the hoarding surface minimal. The cost is honest
disappointment at pay time under contention, mitigated by the re-check UX
in section 5.10.

### 5.4 Partial failure ordering against Apaleo

Failure: holds and the Apaleo booking must both happen, and either side
can fail. Book Apaleo first and holds second, and a hold failure strands a
real reservation with services we cannot honour. Confirm holds first and
Apaleo second, and an Apaleo failure strands consumed stock.

Mitigation, the two-phase shape the codebase already uses for units:

1. At pay-start: place `HELD` holds with `expiresAt` (the guarded-update
   transaction). Refusal here is cheap and honest, before any money.
2. Inside `ensureRecord`, after the Apaleo booking create succeeds: flip
   the session's holds `HELD -> CONFIRMED`, stamp `bookingRecordId`,
   clear `expiresAt`. This is one local transaction and it is idempotent
   (already-confirmed rows are a no-op on replay).
3. On checkout failure or payment abandonment: release. On a crash where
   nobody ever comes back: the TTL releases it. A crash after Apaleo
   create but before confirm leaves a booking whose holds are `HELD` and
   ticking; the confirm replay (same recovery path that already re-runs
   `ensureRecord`) fixes it, and reconciliation catches the residue.

This ordering means the failure we accept is the harmless one: stock
briefly reserved for a booking that died (self-heals by TTL), never a
confirmed booking with no stock behind it.

### 5.5 Drift between the two sources of truth

Failure: a released hold that Apaleo still bills, a cancelled booking
whose holds live on, a `taken` counter that no longer equals its ledger.
Any dual-write system drifts eventually; pretending otherwise is how it
drifts silently.

Mitigation: a reconciliation script (`scripts/inventory/reconcile.ts`,
runnable by hand and from an ops route) that asserts three invariants and
prints every violation:

1. For every ResourceDay: `taken` equals the sum of its active holds.
2. Every `CONFIRMED` hold points at a live, non-cancelled BookingRecord
   whose Apaleo reservation actually carries the matching service.
3. Every capacity-limited service on an Apaleo reservation made through
   the site has matching `CONFIRMED` holds.

Violations are reported, not auto-fixed, in v1. Auto-repair is a policy
decision per violation class and can come later. This mirrors the posture
the reminders module takes on auto-cancel: mechanical detection, human
judgment.

### 5.6 Cancellation and amendment

Failure: a guest cancels a booking and the bikes stay booked forever; or
amends dates and the holds stay on the old dates.

Mitigation: cancellation hooks the existing cancellation engine with one
added step, release all holds for the BookingRecord (idempotent, safe on
replay). Amendment is harder and v1 is deliberately blunt: a date
amendment attempts to place fresh holds on the new dates first, and only
then releases the old ones; if the new dates cannot cover the extras, the
amendment surface says so and the guest chooses to drop the extra or keep
their dates. Never release-then-place: that turns an amendment into losing
your bike to a stranger mid-edit.

### 5.7 Time zones and date boundaries

Failure: a hold placed for "today" computed in UTC frees or blocks the
wrong property-local day; the +02:00 offset has bitten this project
before.

Mitigation: all inventory dates are property-local ISO date strings,
computed by the same helpers the booking dates already use. `expiresAt`
is a real timestamp (UTC instant) because TTLs are physics, not
calendars. Session start times are property-local wall clock, display
only in v1 (no cross-midnight sessions allowed, ever; that constraint is
cheap now and painful to retrofit).

### 5.8 Scale

Non-problem, stated so nobody solves it: at 5 to 15 resources and a
400-day booking horizon the tables are thousands of rows. The only real
pressure point is lock contention on a hot ResourceDay row during a
sell-out rush, and a single-row guarded update is the cheapest possible
unit of contention. No sharding, no caching, no Redis. If this village
ever needs more, the design scales by resource (locks are per
resource-day) and that day is far away.

### 5.9 The physical world: walk-ins, breakage, manual adjustment

Failure: the model says 30 bikes; two are broken and four were hired to a
walk-in at the Cycle Centre. The website oversells reality.

Mitigation: ops adjustments are **holds too**, placed by an ops surface
with a reason string (`kind: ADJUSTMENT` on the hold, no session), never
edits to `capacity` or pokes at `taken`. This keeps one code path, keeps
the reconciliation invariants true, and gives an audit trail for free.
The demo needs only the mechanism and a minimal ops page; full ops
tooling is explicitly out of scope.

### 5.10 Sold-out UX honesty

Failure: guest adds a bike at the extras step, pays ten minutes later,
and the bike is gone; or worse, the UI silently drops it.

Mitigation: the extras step shows live availability per size and date
range ("2 medium bikes left for your dates" under a threshold, plain
"sold out" at zero). The pay step's hold placement is the moment of
truth; on refusal, the pay page stops, names exactly what could not be
held, and offers remove-or-swap before any money moves. Silent dropping
is forbidden, same discipline the location-fee fallback follows (a
dropped fee is surfaced, never swallowed).

## 6. How the booking flow changes

- **Extras step.** Cycle Hire card grows a size picker (each size a
  resource, priced by the same `CYCLE` Apaleo offer); Spa card becomes a
  session picker (day of stay plus start time). Both read a new
  availability endpoint (`GET /api/session/[id]/inventory`) that derives
  free counts for the stay's date range. Per-lodge slot switching works
  as today.
- **Session snapshot.** The chosen resources ride the session's extras
  snapshot with their resource codes, so pricing (Apaleo) and holding
  (ours) stay linked by `apaleoServiceCode`.
- **Pay step.** Places holds (5.3), refuses honestly (5.10).
- **Checkout.** `ensureRecord` confirms holds after the Apaleo create
  (5.4). The services booked into Apaleo are exactly what is confirmed.
- **Manage my booking.** Post-booking extras additions run the same
  hold-then-book gate; no second code path.
- **Untouched.** Firewood, grocery, early check-in and every uncapped
  extra skip the entire system (no resource row, no gate, zero overhead).

## 7. The activities layer this buys us

The client wants Center Parcs-style activity pre-booking: before the stay
(Center Parcs opens booking 12 weeks out, via the guest account) and
during the stay (their app). Under this design an activity is one
`InventoryResource` row of kind `SESSION` plus an Apaleo service for its
price. The pre-stay surface is Manage my booking, which already adds
extras post-booking; a during-stay app would call the same availability
and hold endpoints. A configurable "bookable from N weeks before
arrival" window per resource is a v2 field, noted here so the seam is
remembered.

Deliberately excluded, now and probably forever at demo scale: staff
rosters, per-instructor scheduling, buffer times between sessions,
rescheduling engines, waitlists, and per-unit identity (we count bikes,
we do not track bike #17's brake pads).

## 8. Costs and tradeoffs we accept

- **Dual source of truth**, paid for with reconciliation and invariants
  (5.5). Chosen because Apaleo offers no alternative.
- **Pay-time holds mean basket disappointment is possible** under
  contention. Chosen over add-to-basket holds because hoarding degrades
  every guest's experience to protect one guest's indecision.
- **Flat capacity per resource** in v1: no seasonal fleets, no
  maintenance calendars. Adjustment holds (5.9) cover reality well
  enough.
- **One price per Apaleo service across sizes**: all bike sizes bill as
  `CYCLE`. Differently-priced child bikes would need per-size Apaleo
  services (a `--services-only` reprovision away) and is a pricing
  decision for the client, not a schema problem.
- **Sessions are display-timed, not enforced-timed**: nothing stops a
  guest arriving late; the slot models capacity, not access control.
- **Reports, not auto-repair**, from reconciliation in v1.
- **Ops tooling is minimal**: seed script plus a bare adjustments page.

## 9. Build order sketch

1. Schema (three tables) plus the guarded-update placement primitive with
   unit tests hammering it concurrently (this test IS the feature).
2. Availability endpoint and derivation helpers (lazy expiry included).
3. Extras step UI: size picker, session picker, sold-out states.
4. Pay-step hold placement and refusal UX.
5. `ensureRecord` confirm step; cancellation release hook.
6. Manage my booking gate; amendment refusal path.
7. Reconciliation script, ops sweep route, adjustments surface.
8. Seed resources; docs and copy sweep.

Each step lands green before the next starts; steps 1 and 2 are pure
backend and demo nothing, which is fine.

## 10. Open questions to grill before building

- Bike sizes and per-size stock counts (client decision; placeholder
  adult S/M/L plus two child sizes, 20/30/20/10/10).
- Spa session times and capacity (placeholder 10:00 and 14:00, capacity
  20); does capacity differ weekday vs weekend?
- Hold TTL length (placeholder 30 minutes); does Pesapal's slowest real
  payment fit inside it comfortably?
- Do child bikes price differently (forces per-size Apaleo services)?
- Amendment policy wording when extras cannot follow the new dates.
- Does the sweep get an external scheduler on Railway or stay
  manual-plus-lazy like reminders do today?
- Minimum viable ops surface: is a read-only availability table plus an
  adjustment form enough for the demo?

## 11. Build vs adopt: why none of the free software fits

Asked on 3 Sep 2026 before the interview, because the answer decides what the
rest of the plan is about. Two candidates were examined properly rather than
dismissed from the search-result summary.

**LibreBooking** (GPL-3.0, the maintained fork of Booked Scheduler). PHP 8.2,
Apache, MySQL 8 or MariaDB. It is a whole separate application: its own
database engine, its own accounts, its own admin. Adopting it means a second
service on Railway, a second identity system, and a third source of truth
after Apaleo and ours. It also models the wrong thing, a person or room
calendar with conflict detection, where we need a counter of 30 bikes against
a resource-day. Rejected.

**payload-reserve** (MIT, v4.1.0 published 26 Aug 2026, peer dep
`payload ^3.86.0`). This one deserved a real read, because Payload 3.86.0 is
already a dependency on main, `app/(payload)` already ships, and the plugin
shares our Postgres. Its concurrency work is honest and close to ours: a
`bookingLock` write per resource manufactures row contention before the
conflict read, resource ids are sorted to make deadlock impossible, and the
retry wrapper distinguishes transient write conflicts by driver code rather
than message text. Its README documents a measured gap on SQLite instead of
hiding it. Good software. Still rejected, for three reasons that are about
fit, not quality:

1. **It models appointments, we need stock.** Reservations are start and end
   times with services, guest counts and buffers. A whole-break bike hire is
   one hold per night per size, which would have to be bent into overlapping
   time-window reservations to fit.
2. **The gate cannot join our transaction.** Its writes go through Payload's
   Local API on `req`; checkout is Prisma. The `HELD -> CONFIRMED` flip in
   `ensureRecord` (section 5.4) would become a cross-ORM two-phase problem,
   adding a compensating path exactly where our own design gets atomicity for
   free from one local transaction.
3. **It duplicates money and identity.** It carries services, pricing and
   customers, which are Apaleo's job and our accounts' job. We would adopt a
   booking system to use a small fraction of it and then fight the rest.

Maturity is a secondary concern, not the deciding one: first release 14 Feb
2026, four majors by August, 31 GitHub stars. Fine for a salon, thin for the
money path of a demo we have to explain line by line.

**What the engine actually is.** The valuable part of this feature is not a
booking UI, it is the guarded `UPDATE` in section 5.1. It has to run inside
our checkout transaction, next to our session snapshot, ordered against our
Apaleo call. No external package can own that, which is the whole reason the
buy option keeps failing.

**Where borrowing still makes sense**, and is not ruled out: a calendar
component for the session picker, and a generic admin table for the ops
adjustments surface (section 5.9). Both are leaf-level and carry no
correctness weight.
