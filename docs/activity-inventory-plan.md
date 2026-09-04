# Activities: bikes, spa sessions and the inventory layer (UNP-6)

Status: writing-tests

Plan approved: 4 Sep 2026, Allan wrote "plan-approved"

Scheduled 3 Sep 2026 as UNP-6, on branch `unp-6-activities-inventory`.
Redrafted 4 Sep 2026 from the phase 1 interview. The 20 Aug draft (checkout
as the surface, bike sizes, v2 booking window) is superseded; section 11
keeps the build-vs-adopt record from it because that decision stands.

Related reading: `docs/post-booking-extras.md` (the engine this plugs into,
read it first), `docs/deposit-and-cancellation-plan.md` (the 8-week anchor
and the cancellation engine), `docs/referral-system-plan.md` (house
patterns for idempotency and crash replay).

---

## 1. The problem

Two extras are physically limited and the site pretends they are not.
Cycle Hire is one Apaleo service (`CYCLE`, per person per night) with no
stock and no sizes; the only cap anywhere is `MAX_EXTRA_QTY = 8` per lodge.
The Spa Day Pass (`SPA`) is an all-day pass with no capacity. Two hundred
guests could book two hundred bikes for one Friday and nothing would object.
The client saw this in feedback round 1 ("maybe this bike is not available
this date since already booked"), and it is the gap between us and the
reference: Center Parcs sells a fixed fleet and a spa that sells out.

Apaleo cannot help. Its services carry a price, a pricing unit and a
posting mode. They have no stock, no calendar, no capacity, and never will.
So this feature makes **our Postgres the authority on whether a bike or a
spa place exists to sell**, while Apaleo stays the only authority on money.

It is also the foundation of the activities product the client wants
(Center Parcs-style pre-booking before the stay). Under this design an
activity is one row in a table plus an Apaleo service for its price.

## 2. What Center Parcs does, and what we copy

Researched 4 Sep 2026 (sources in section 11). The facts that shape the
design:

- **Cycle hire is sold at checkout**, priced into the booking summary
  (Allan checked the live site, 4 Sep; an earlier draft of this section
  claimed otherwise and was wrong). It can also be added later through
  the account, up to 24 hours before arrival; after that the Cycle Centre
  sells walk-ins from what is left.
- **The spa is not sold at checkout.** The spa page says outright that a
  booking cannot be made without an accommodation booking; sessions open
  through the account 12 weeks before arrival.
- **Bikes are sold by category, not size**: adult cycle, child's cycle.
  Staff fit the rider on arrival. Categories are priced differently (about
  £45 adult, £35 child for a short break).
- **Bikes are hired for the whole break** at one price. No daily rate.
- **The spa sells a 3-hour session** with a start time you choose, and a
  session can be sold out. There is a per-booking allocation cap.
- CP shows no availability numbers for bikes at all, and for the spa shows
  "sold out" only after you pick a slot.

What we copy: everything above except the last line. We show the numbers.
For an investor demo, "3 adult cycles left for your dates" and a spa grid
that greys out at zero are a better story than CP's silence, and they are
honest as long as the pay step is the moment of truth (section 5.9).

Our spa window is **8 weeks** (56 days), not 12, because that is already
the booking's balance-due anchor (`lib/paymentPlan.ts`, `BALANCE_DUE_DAYS`)
and one anchor is easier to explain than two. Bikes have no window: they
are bookable from the moment the break is confirmed.

**Bikes at checkout are deferred to UNP-25**, deliberately. The checkout
entry point means session-owned holds placed at pay-start and confirmed
inside `ensureRecord`, the replay-sensitive sequence, and the primitive
should be proven by the account path first. v1 keeps a Cycle Hire teaser
card at checkout ("Book from your account after checkout, subject to
availability") so the client sees no regression, and the schema carries
the `sellAtCheckout` flag now so switching it on later is data plus one
caller, not a migration.

## 3. Scope

**In v1:**

- Adult cycle and child's cycle as whole-break hire with real stock.
- Spa as 3-hour sessions at fixed start times with real capacity.
- One surface: an Activities card on Manage my booking, owner only, until
  the day before arrival. Bikes from confirmation onward; spa from 56 days
  before arrival.
- Bikes and spa removed from the checkout extras step; a Cycle Hire teaser
  card (copy only) takes their place.
- The hold gate inside the existing post-booking extras engine.
- Cancellation releases holds. Date amendment refuses while activities are
  held.
- Ops: resources CRUD, adjustments, a sweep, a reconciliation report.
- Confirmation page and email carry one line about when activities open.

**Out of scope, now:**

- Any activity beyond bikes and spa (the tables take them as data rows).
- Self-serve removal of activities (extras have no removal either; refund
  policy first).
- Per-date capacity overrides, seasonal fleets, maintenance calendars.
- Staff rosters, instructors, buffers, waitlists, per-unit identity.
- Auto-repair from reconciliation. Reports only.
- A scheduler. Lazy expiry plus a manual sweep, like reminders.
- Sizes. Fitting is a Cycle Centre job, as at CP.
- A during-stay app. The endpoints would serve one; none is built.
- Bikes sold at checkout with real stock (UNP-25, the next slice set after
  this ships). The `sellAtCheckout` flag exists in v1 and is ignored by the
  checkout route until that caller lands.

## 4. The mental model

There are **resources** (adult cycles, the 10:00 spa session). A resource
has a **capacity** and a **kind**: `STOCK` is consumed per calendar night
with no time attached (bikes), `SESSION` is consumed at a date plus a start
time (spa). Guests take capacity by placing **holds**: (resource, date,
quantity, which order, status). Availability is always **derived**,
capacity minus active holds for that resource-day. Nothing stores
"available = 7", because a cached count of a contended thing is a bug with
a delay on it. A whole-break bike hire is one hold per night, placed and
released as a unit.

Money never enters this layer. Apaleo prices the service; we decide whether
the thing exists.

## 5. Design

### 5.1 Apaleo services (a `--services-only` reprovision)

| Code | Replaces | Pricing unit | Mode | Placeholder price |
|---|---|---|---|---|
| `CYCLE-ADULT` | `CYCLE` | Person | Arrival | KES 3,000 per break |
| `CYCLE-CHILD` | new | Person | Arrival | KES 2,000 per break |
| `SPA-SESSION` | `SPA` | Person | Arrival | KES 2,500 per place |

`Arrival` posts once, `Person` charges per rider or per place. `count` on
the reservation is the number of riders (bikes) or the total number of spa
places across the booking's sessions. The spa session's date and time are
our concern, not Apaleo's; Apaleo sees "3 places at KES 2,500".

`CYCLE` and `SPA` are retired. Apaleo service codes are immutable, so the
old services stay in the sandbox; the provisioning script deactivates them
if the API allows, and code carries a `RETIRED_SERVICE_CODES` exclusion so
they never reach an offers list either way (open question 1). Sandbox
bookings that already own `CYCLE` keep it on their folio; the extras card
simply stops listing it, which is acceptable for demo data.

CMS content for the new codes: three `extras` collection rows keyed by the
new service codes, seeded by `scripts/seed-cms.ts`, photos reused.

### 5.2 Data model

Three tables, `prisma db push` as always. Dates are property-local ISO
`YYYY-MM-DD` strings like `arrival` and `departure`.

**InventoryResource**, one row per sellable pool.

| Field | Notes |
|---|---|
| `id`, `createdAt`, `updatedAt` | house standard |
| `code` String @unique | `CYCLE-ADULT`, `CYCLE-CHILD`, `SPA-1000`, `SPA-1400` |
| `name` String | "Adult cycle", "Spa session, 10:00" |
| `kind` String | `STOCK` or `SESSION` |
| `capacity` Int | flat, every date |
| `sessionStart` String? | "HH:MM", sessions only |
| `sessionMinutes` Int? | 180, display only |
| `apaleoServiceCode` String | which service prices it; both spa sessions point at `SPA-SESSION` |
| `openDaysBefore` Int? | 56 for spa sessions; null means bookable from confirmation (bikes) |
| `capRule` String | `adults` or `children`: which head count of the lodge caps this resource (section 5.6). Data, so a new activity needs no code |
| `sellAtCheckout` Boolean | default false; honoured only once UNP-25 lands |
| `active` Boolean | inactive resources are not offered but their holds stay valid |

**ResourceDay**, the contention point: `resourceId`, `date`, `taken` Int,
`@@unique([resourceId, date])`. Rows are created lazily on first hold. It
is a **counter, not a truth**: the truth is the hold ledger, and
reconciliation asserts they agree.

**InventoryHold**, the ledger.

| Field | Notes |
|---|---|
| `resourceId`, `date`, `qty` | what and how much |
| `status` String | `HELD`, `CONFIRMED`, `RELEASED` |
| `kind` String | `ORDER` or `ADJUSTMENT` |
| `ownerKey` String? | `order:<extrasOrderId>` in v1; UNP-25 adds `session:<sessionId>:<slot>` as a new value, not a schema change |
| `orderId` String? | the `ExtrasOrder` that placed it (`ORDER` kind), for joins |
| `recordId` String? | denormalised for cancellation and reconciliation |
| `slot` Int? | which lodge |
| `expiresAt` DateTime? | set while `HELD`, a real instant |
| `reason` String? | `ADJUSTMENT` kind: "two bikes in the workshop" |
| `createdBy` String? | admin email on adjustments |
| `@@unique([ownerKey, resourceId, date])` | a replay upserts, never duplicates; `ADJUSTMENT` rows have a null `ownerKey`, which Postgres treats as distinct, so many adjustments per day are allowed |

`taken` counts holds in `HELD` (unexpired) plus `CONFIRMED`. `RELEASED`
holds stay as audit rows and count nothing.

**ExtrasOrder** gains nothing. Holds hang off it by `orderId`, so the
hold lifecycle rides the order lifecycle that already exists (created,
settled, failed) and recovery already knows how to resolve.

### 5.3 The guarded update (the whole concurrency story)

The only gate that counts is one atomic update per resource-day, inside
the transaction that writes the hold rows:

    UPDATE "ResourceDay"
    SET taken = taken + $qty
    WHERE "resourceId" = $r AND date = $d
      AND taken + $qty <= (SELECT capacity FROM "InventoryResource" WHERE id = $r)

Zero rows affected means sold out, the transaction rolls back, the guest
gets an honest refusal naming the resource. The row lock the UPDATE takes
is the entire story: no advisory locks, no SERIALIZABLE, no retry loops.
Multi-night hires and multi-resource orders run the update once per
(resource, date) in one transaction, **ordered by (resourceId, date)**, so
two transactions touching the same set of rows lock them in the same order
and cannot deadlock. If any row refuses, the whole order rolls back: a
3-night hire that can only get 2 nights is not a sale.

Before applying itself to a row, the placement transaction sweeps expired
`HELD` holds on that row (status to `RELEASED`, `taken` decremented), so an
abandoned claim never blocks a real one. The sweep and the guarded update
run inside the same ordered loop, row by row, so every lock on a
`ResourceDay` is still taken in `(resourceId, date)` order.

Every release, wherever it runs (placement sweep, ops sweep, order
failure, cancellation), is a **guarded status flip**: `updateMany` where
the hold id matches and `status` is what the caller expects, and `taken`
moves only when that flip affected a row. Two sweeps racing over one
expired hold therefore decrement once, not twice.

### 5.4 Where the gate sits: inside `addManageExtras`

The post-booking extras engine already does the hard part. Its sequence
becomes, with the new steps marked:

1. `recoverStaleExtrasOrder`, then `assertExtrasAllowed` (unchanged).
2. **Activity window and caps** (new): every capacity-limited service in
   the request must be inside its resource's window and within the
   per-lodge cap (section 5.6). Refuse before touching anything.
3. Quote and price from live offers (unchanged).
4. Folio baseline check (unchanged).
5. Create the `ExtrasOrder` with `liveForRecordId` (unchanged). This is
   the per-booking serializer; two adds on one booking already cannot run
   at once.
6. **Place holds** (new): one transaction, guarded updates plus `HELD` rows
   carrying `orderId`, `expiresAt = now + 30 min`. On refusal: retire the
   order as `failed`, answer 409 naming the item ("Only 2 adult cycles are
   left for your dates"). Nothing has touched Apaleo and no money moved.
7. `bookReservationService` per addition, folio delta check, `payFolio` on
   `charge_now` (unchanged).
8. `settleExtrasOrder` transaction (extended): flip the order's holds
   `HELD -> CONFIRMED`, clear `expiresAt`, guarded on `status = HELD`.
9. Every rollback and failure path that retires the order as `failed`
   (extended): release the order's holds, `taken` decremented for each row
   still counting.

Ordering rationale: holds first, money second. The failure we accept is the
harmless one, stock briefly held for an order that died, which the TTL
heals. A paid booking with no bike behind it cannot happen, because Apaleo
is only asked after the hold succeeded.

Uncapped extras (firewood, grocery, BBQ, early check-in) have no resource
row and skip steps 2, 6, 8 and 9 entirely. One engine, one code path, and
the uncapped path is byte-for-byte what it is today.

### 5.5 Recovery and the one drift we accept

`resolveOrder` decides a crashed order's ending from folio truth. Its
endings now carry holds:

| Ending | Holds |
|---|---|
| settled (payment landed, counts at target) | confirm |
| retired as no-op or rolled back | release |

The window that can drift: an order crashes after `payFolio` landed, nobody
touches the booking for over 30 minutes, the `HELD` holds expire and are
swept by a competing guest, who takes the stock. Recovery later finds the
payment landed and settles. Its confirm step then finds holds in `RELEASED`
and re-places them through the guarded update. If that refuses, the fleet
is oversold by that order: money is settled anyway (it already moved),
and an `OpsAlert` of kind `inventory_oversold` names the order. A human
sorts it, which is what the Cycle Centre does anyway. Rare, detected,
never silent.

### 5.6 Caps and the window

Per lodge, at the time of the add, owned plus requested, driven by the
resource's `capRule` (tests-phase clarification, 4 Sep: the rule is a
column so an activity is still only a row):

- `adults`: at most the lodge's adult count (adult cycles, spa places),
- `children`: at most the lodge's children aged 2 and over (child cycles;
  infants do not ride, the same rule per-person extras already follow),
- and for sessions, one session per date per lodge across owned and
  requested.

The window: a resource is bookable when `today < arrival` (the existing
extras rule) and, if `openDaysBefore` is set, `today >= arrival -
openDaysBefore`. Before a window the card shows "Opens on 14 November".
Bikes have no window and are offered from confirmation. `today` uses the same UTC-sliced
`todayIso()` the extras engine already uses (open question 3).

### 5.7 Expiry and the sweep, schedulerless

- **Lazy at the gate** (section 5.3): expired `HELD` holds are swept by the
  next placement that touches their rows, and the availability read treats
  them as free. Nothing needs to run for correctness.
- **`POST /api/ops/inventory/sweep`** releases every expired `HELD` hold and
  re-derives `taken` on the rows it touched. Running it twice is free. Admin
  gate like every ops route, plus an optional bearer secret for a future
  scheduler. Not scheduled.

TTL is 30 minutes, one constant. Real payments take under five minutes.

### 5.8 Cancellation and amendment

- `cancelBooking` gains one step, inside the same transaction as the
  record's status flip to `cancelled`: release every `CONFIRMED` hold for
  the record (guarded flip per row, `taken` decremented per row that
  flipped). A crash cannot leave a cancelled record still holding stock,
  and a replay finds nothing left to flip.
- The amend route refuses while the record has any `CONFIRMED` hold:
  "This break has activities booked. Call our team to move it." Blunt on
  purpose; guests cannot remove activities themselves in v1 either.

### 5.9 Availability display and honesty

`GET /api/booking/[bookingId]/activities` answers, per lodge, every active
resource with: window state (`opens_on` with a date, `open`, `closed`),
owned count, the cap, and free counts. Owned counts come from the lodge's
`CONFIRMED` holds, not from Apaleo: the card is then a local read, Apaleo
is touched only on an add, and a spa booking can be shown per session
("2 places, Saturday 14:00") where Apaleo only knows "4 places". For `STOCK` the free count is the
minimum over the stay's nights; for `SESSION` it is per date of the stay
per session. Reads apply the expiry rule at read time.

Rules the UI must keep:

- A displayed count is a **display**, never a promise. The pay step is the
  moment of truth.
- On a step 6 refusal the card stops, names exactly what could not be held
  and by how much, and re-quotes. Silent dropping is forbidden.
- Under a threshold the count is shown in words ("2 left for your dates");
  above it, nothing; at zero, "Sold out for your dates".

### 5.10 Checkout exclusion

`GET /api/session/[id]/extras` drops any code in `RETIRED_SERVICE_CODES`
the way it already drops `LOCATION`, and returns any service whose code
has an `InventoryResource` row flagged `teaser: true`: price included, so
Apaleo stays the only price source, and the extras step renders it as the
Cycle Hire teaser with no quantity control. `POST /api/session/[id]/extras`
refuses a teaser service in the snapshot, so checkout's snapshot never
contains a capacity-limited service and `ensureRecord` is untouched. (Post-
approval clarification, 4 Sep: the earlier wording dropped teaser services
entirely, which left the teaser with no honest price to show.) The
confirmation page and email say when activities open.

### 5.11 Ops surface

`/ops/inventory`, admin gate identical to `/ops/reminders`:

- Resources table with inline edit for every field, including capacity.
- A 30-day grid of `taken / capacity` per resource.
- Adjustment form: resource, date range, qty, reason. Creates `ADJUSTMENT`
  holds in `CONFIRMED` through the same guarded update (an adjustment that
  would exceed capacity is refused like any other claim; reduce capacity
  instead if the fleet shrank).
- Sweep and Reconcile buttons; results appear as `OpsAlert` rows.

The rule: **nobody hand-edits `taken`.** Reality changes are holds with a
reason, or capacity edits. That keeps the invariants provable.

### 5.12 Reconciliation

`POST /api/ops/inventory/reconcile` (and `scripts/inventory/reconcile.ts`
for the terminal) checks and reports, never fixes:

1. Every `ResourceDay.taken` equals the sum of its unexpired `HELD` plus
   `CONFIRMED` holds.
2. Every `CONFIRMED` order-hold belongs to a `settled` order on a record
   that is not cancelled.
3. For every record with settled orders on capacity-limited services, the
   Apaleo reservation's service count equals the sum of that lodge's
   `CONFIRMED` order-holds for the service (bikes: qty on any one night;
   spa: total places).

Each violation is one `OpsAlert` of kind `inventory_drift`, deduplicated on
an open alert with the same detail so the button can be pressed twice.

### 5.13 Time zones

Inventory dates are property-local ISO strings computed by the helpers the
booking dates already use. `expiresAt` is a real instant, because a TTL is
physics. Session start times are property-local wall clock, display only;
cross-midnight sessions are forbidden by construction (`sessionMinutes` is
validated against `sessionStart`).

### 5.14 Scale

Non-problem, stated so nobody solves it. Four resources, a 400-day horizon:
thousands of rows. The only pressure point is lock contention on a hot
`ResourceDay` row in a sell-out, and a single-row guarded update is the
cheapest unit of contention there is.

## 6. Invariants

1. `taken` on a `ResourceDay` never exceeds its resource's capacity, ever,
   under any concurrency. (The guarded update is the only writer.)
2. Availability is never stored; every displayed count is derived.
3. A hold is confirmed only inside the transaction that settles its order,
   and released whenever its order retires as failed.
4. No Apaleo write for a capacity-limited service happens without a `HELD`
   hold already in place for the same order.
5. A cancelled record has no `CONFIRMED` holds.
6. Holds are identified by `(ownerKey, resourceId, date)`; a replay of any
   step writes the same rows.
7. `taken` is written only by the guarded update, the confirm and release
   paths, the sweep, and adjustments through the same guarded update. No
   route or page sets it directly.
9. A hold's status moves only by a guarded flip, and `taken` moves only
   when a flip affected a row. Nothing is ever decremented twice.
8. Uncapped extras behave exactly as before this feature.

## 7. Inputs and outputs

- `GET /api/booking/[bookingId]/activities`: per-lodge availability,
  window state, owned counts, caps. Owner or invitee may read.
- `POST /api/booking/[bookingId]/extras`: each addition is still
  `{ serviceId, count }`; a `SESSION` addition also carries
  `{ resourceCode, date }`. Several session additions may share one
  `serviceId` (two spa sessions on different nights), so the existing
  "each extra once per request" rule relaxes to once per
  `(serviceId, resourceCode, date)`, and the Apaleo count for that service
  is the sum. The two new refusals are 409s with the item named.
- `POST /api/ops/inventory/sweep`, `.../reconcile`, `.../resources`,
  `.../adjustments`: admin.
- Emails: the extras receipt already exists and now lists sessions with
  their date and time. Confirmation email gains one line.

## 8. Files touched

| Concern | File |
|---|---|
| Schema | `prisma/schema.prisma` (three models) |
| Pure logic | `lib/inventory.ts`: window math, caps, free-count derivation, session date rules. Tests in `lib/inventory.test.ts` |
| Placement primitive | `server/inventory/holds.ts`: `placeHolds`, `confirmHolds`, `releaseHolds`, `sweepExpired`. Tests hammer `placeHolds` concurrently against the local database |
| Availability | `server/inventory/availability.ts` and `app/api/booking/[bookingId]/activities/route.ts` |
| Engine hook | `server/booking/extras.ts` (steps 2, 6, 8, 9), `server/booking/cancellation.ts` (release), `app/api/booking/[bookingId]/amend/route.ts` (refusal) |
| Checkout exclusion | `app/api/session/[id]/extras/route.ts`, `server/apaleo/units.ts` (`RETIRED_SERVICE_CODES`) |
| UI | `app/(site)/manage/[bookingId]/ActivitiesCard.tsx` (new, beside `AddExtrasCard`), confirmation page line |
| Ops | `app/(site)/ops/inventory/*`, `app/api/ops/inventory/*`, `server/inventory/ops.ts`, `scripts/inventory/reconcile.ts` |
| Apaleo | `scripts/apaleo/provision.ts` (three services, two retired) |
| Seeds | `scripts/seed-inventory.ts` (four resources), `scripts/seed-cms.ts` (three content rows) |
| Email | `server/email/extrasReceipt.ts` (session lines), `server/email/bookingConfirmation.ts` (one line) |
| Docs | this file, `docs/post-booking-extras.md` (a pointer) |

## 9. Edge cases and failure modes

- **Last bike, two guests.** Both see 1 left. Both reach step 6. The row
  lock serialises them; the second's guarded update affects zero rows; it
  rolls back and is told. No money moved for the loser.
- **Three nights, two available.** Refused as a whole. Message names the
  night that failed.
- **Guest abandons after step 6.** Nothing else runs on that request, so
  the order retires immediately with its holds released. If the process
  dies instead, the TTL frees the stock and recovery retires the order on
  the next touch.
- **Crash after `payFolio`, recovered late, stock gone.** Section 5.5: money
  settles, `inventory_oversold` alert, human.
- **Apaleo `book-service` fails at step 7.** Existing rollback path, holds
  released with the order.
- **Folio delta mismatch at step 7.** Existing rollback, holds released.
- **Cancellation racing an add.** The settle transaction already guards on
  record status; holds confirm only if the order settles, and cancellation
  releases whatever is `CONFIRMED` at its moment. A hold confirmed a
  millisecond after cancellation released is caught by reconciliation
  invariant 2.
- **Amend with activities.** Refused. The break keeps its dates and stock.
- **Adjustment beyond capacity.** Refused by the same gate; reduce capacity.
- **Capacity reduced below `taken`.** Allowed (fleet shrank); the resource
  shows sold out until holds release; no existing booking is touched.
  Reconciliation invariant 1 still holds because it compares `taken` to
  holds, not to capacity.
- **Resource deactivated.** Not offered; existing holds stay valid and
  still count.
- **Booking made inside the window** (a last-minute break). Confirmation
  page says activities are open now.
- **Session on the departure day.** Not offered; sessions run on the stay's
  nights (arrival through the night before departure). Open question 2.
- **Invitee tries to book activities.** Reads the card, cannot write: every
  mutating route calls `assertBookingAccess`, which does not know invitees
  exist, exactly as for extras today.
- **A doctored request with an amount or a date.** The client only ever
  sends service ids and counts (existing rule) plus, for sessions, a
  resource code and a date; both are validated against the resource table
  and the stay.

## 10. Acceptance check (end to end, deployed)

1. Reprovision services, seed resources and CMS rows, deploy. Checkout's
   extras step shows firewood, grocery, BBQ, early check-in, and the Cycle
   Hire teaser with no quantity control.
2. Book a break with arrival inside 56 days, two adults and one child, pay
   in full. Confirmation page and email say activities are open.
3. Manage my booking shows the Activities card: adult cycles with a count,
   child cycles with a count, a spa grid for the stay's nights at 10:00 and
   14:00 with counts. A second booking 70 days out shows bikes open and the
   spa as "Opens on <date>".
4. Add 2 adult cycles and 1 child cycle. Folio shows `CYCLE-ADULT x2` and
   `CYCLE-CHILD x1` once, at break prices; card shows owned counts; the
   receipt email lists them.
5. Add 2 spa places at 14:00 on the second night. Folio shows
   `SPA-SESSION x2`; the grid shows the session's count down by 2.
6. Ops adjustment: put the adult fleet at 3 in the workshop for those dates
   with a reason. The card's adult count drops by 3.
7. Sell-out race: set adult capacity so exactly 1 remains for the dates;
   two browsers each try to add 1 adult cycle at once. Exactly one succeeds;
   the other is refused by name with no money moved. Reconcile: no alerts.
8. Cap: a third adult cycle for a two-adult lodge is refused before any
   Apaleo call.
9. Window: on the 70-day booking a direct POST for a spa session is
   refused 409 while a bike add succeeds.
10. Amend: moving the break from step 4 is refused with the activities
    message. A break with no activities still moves as today.
11. Cancel the break from step 4: refund math unchanged; the adult and
    child counts return to their pre-step-4 values. Reconcile: no alerts.
12. Sweep: place a hold by killing a dev-server request between steps 6
    and 7 (local only), wait past the TTL, run the sweep; `taken` returns
    to its ledger sum. Reconcile: no alerts.
13. Deposit-paid booking: add 1 adult cycle; it joins the balance, `/pay`
    settles it, the hold is `CONFIRMED` throughout.

## 11. Build vs adopt: why none of the free software fits

Asked on 3 Sep 2026 before the interview, because the answer decides what
the rest of the plan is about. Two candidates were examined properly rather
than dismissed from the search-result summary.

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
   one hold per night, which would have to be bent into overlapping
   time-window reservations to fit.
2. **The gate cannot join our transaction.** Its writes go through Payload's
   Local API on `req`; the extras engine is Prisma. The `HELD -> CONFIRMED`
   flip inside `settleExtrasOrder` would become a cross-ORM two-phase
   problem, adding a compensating path exactly where our own design gets
   atomicity for free from one local transaction.
3. **It duplicates money and identity.** It carries services, pricing and
   customers, which are Apaleo's job and our accounts' job. We would adopt a
   booking system to use a small fraction of it and then fight the rest.

Maturity is a secondary concern, not the deciding one: first release 14 Feb
2026, four majors by August, 31 GitHub stars. Fine for a salon, thin for the
money path of a demo we have to explain line by line.

**What the engine actually is.** The valuable part of this feature is not a
booking UI, it is the guarded `UPDATE` in section 5.3. It has to run inside
our transaction, next to our order row, ordered against our Apaleo call. No
external package can own that, which is the whole reason the buy option
keeps failing.

**Where borrowing still makes sense**: a calendar component for the session
grid, and a generic admin table for the ops page. Both are leaf-level and
carry no correctness weight.

Center Parcs sources (4 Sep 2026): help.centerparcs.co.uk cycle FAQs and
bike hire pages, centerparcs.co.uk Cycle Centre and Forest Spa Experience
pages, help.centerparcs.co.uk "How do I book a spa session",
insideoursuitcase.com bike hire guide.

## 12. Build order

1. Schema plus `lib/inventory.ts` pure logic and `server/inventory/holds.ts`
   with the concurrent placement tests. This step is the feature.
2. Availability derivation and the activities GET.
3. Engine hook: steps 2, 6, 8, 9 in `addManageExtras`; recovery endings.
4. Cancellation release; amend refusal.
5. Checkout exclusion; Apaleo reprovision; seeds; CMS rows.
6. Activities card on Manage my booking; confirmation line; receipt lines.
7. Ops page, sweep, adjustments, reconcile.
8. Docs and copy sweep.

Each step lands green before the next. Steps 1 and 2 demo nothing, which
is fine.

## 13. Decisions made for you

Flagged so they can be overturned at the grill without anyone pretending
they were agreed.

1. Placeholder prices: KES 3,000 adult, 2,000 child per break; 2,500 per spa
   place. Placeholder capacities: 30 adult, 15 child, 20 per spa session.
2. Two spa start times, 10:00 and 14:00, 180 minutes, every day the same.
3. Spa cap: places per session at most the lodge's adults, one session per
   date per lodge. Bike caps: adults and children of the lodge.
4. Spa sessions offered on the stay's nights only, never the departure day.
5. The account section is called "Activities". Bikes sit inside it.
6. The spa window is 56 days, the same anchor as the balance due date;
   bikes have none.
7. Amend refuses outright while activities are held (your "keep simple").
8. Reconciliation writes `OpsAlert` rows rather than printing, so the
   existing alerts page is the report.
9. Adjustments go through the guarded update and can be refused; shrinking
   the fleet is a capacity edit.
10. `today` for the window uses the UTC-sliced `todayIso()` the extras
    engine already uses, for consistency with its arrival rule, even though
    the repeat offer uses property-local days.
11. Old `CYCLE` and `SPA` services are excluded by code, not deleted.
12. Bikes at checkout deferred to UNP-25 with a teaser card in v1 (Allan
    agreed 4 Sep). `sellAtCheckout` and `ownerKey` are shaped for it now.

## 14. The grill record, 4 Sep 2026

Allan's own words on the three tables, lightly punctuated: "We have the
resource inventory: it shows what inventory we have and quantity for
specific time slots. Then we have the table that is like a ledger that
documents everything that happens to the resources: hold, confirmed,
released. And the final table is used to calculate available quantity,
and uses the ledger as proof." Nudge recorded: the third table exists to
be locked, availability is capacity minus its counter, the ledger proves
the counter.

On ordering (question 2): "We can charge on Apaleo on an already taken
resource, which complicates matters: you have to find a new resource or
do a refund." On the race (question 4): "Whoever gets a hold first and
their transaction succeeds in the database." Sharpened to: the decision
is the WHERE clause of one guarded UPDATE under its row lock.

Answered for him and accepted: why the counter is never stored as truth
(a cached count of a contended value can be wrong silently, a derived one
cannot); why holds belong to the order (they inherit its create, settle,
fail and recovery life); per-night rows (stays overlap by nights); capacity
cut below taken (holds untouched, sold out until they release); the
deposit-paid path (charge on the folio at once, holds CONFIRMED, money
collected by the pay route, released on cancellation).

## 15. Open questions

1. Can the provisioning script deactivate `CYCLE` and `SPA` in Apaleo, or
   is the code exclusion the only tool? To check against the sandbox API
   before step 5.
2. Sessions on the departure day: checkout is 11:00, so a 10:00 session is
   physically odd but not impossible. Excluded for now.
3. UTC-day versus property-day for the window edge. The difference is two
   hours around midnight; decision 10 picks consistency with extras.
4. Should the balance reminder email, which fires around the same 56-day
   mark, mention that activities are open? Copy only, and out of scope
   unless you want it in.
5. Closed 4 Sep, Allan: "yes" to the `*.db.test.ts` convention. Files
   matching it run against `unity_parks_dev` when `DATABASE_URL` is set and
   skip with a printed notice otherwise, so `npm test` stays one command.
   The `vitest.config` change lands in the tests commit, before the freeze.
