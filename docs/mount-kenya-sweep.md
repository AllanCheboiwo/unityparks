# Mount Kenya sweep: execution plan

*Status: working checklist, 17 August 2026. Companion to
docs/village-and-content-direction.md. Section 15 of that document says what
has to change; this one says in what order, exactly where, and what has been
done. Tick items as they land.*

*State as of 17 Aug, evening: stages 0, B, C (code side) and D are done on
branch `mount-kenya`, stage A is written and validated with a read-only dry
run, and stage E's local gates, tests, build and funnel walkthrough have
passed against the pre-migration sandbox (which exercised the flat-list
fallback). What remains: the migration write run, merge and deploy, the
seed re-run on Railway, and the media replacements.*

*Rule for the whole sweep: rename and rewrite, never re-provision. Codes stay
(UPNV, WDL, FST, LKV, EXC, the service codes). Anything that means deleting
and recreating Apaleo objects is out of scope.*

---

## 0. Sequencing

1. **Stage A (Apaleo) and Stage B (code) land in the same sitting.** The
   Railway demo reads the same UPNV sandbox, so after the Apaleo migration the
   live Location step shows lane names and the new LKV/EXC prices while the
   rest of the site still says Lakeview. Acceptable for hours, not days.
2. **Stage C (content) can trail by a day.** The CMS copy is wrong today
   anyway; it gets less wrong with every stage.
3. **Stage D (zones and the map)** needs Stage A's lane names in place to be
   testable, but nothing in A to C depends on it.
4. **New pages come last** and are not part of this sweep (section 15: then,
   and only then).

Mechanics:

- [x] Branch `mount-kenya`, cut from `outstanding-features` rather than
      local main, which was stale; outstanding-features already contained
      the merged origin/main plus the newest work.
- [x] Commit docs/village-and-content-direction.md and this file first; both
      were untracked.
- No Prisma schema changes anywhere in the sweep (comment edits only), so no
  db push is needed.
- Usual flow: everything local first; Allan runs the Apaleo migration and the
  Railway side himself.

---

## Stage A. Apaleo sandbox migration

Inventory PATCHes are not subject to the 8-per-20-minute rate-write budget.
Only the final rate rewrite touches it, and since the horizon extension
(17 Aug, 100 days to 400) it rewrites all four calendars: 4 GETs + 4 PUTs,
the whole budget. Run it at least 20 minutes after any dry run, and treat a
429 as "wait 20 minutes, re-run"; every step is idempotent.

### A1. Update provision.ts first

The provisioning script is the source of truth for fresh environments. It
lived in the untracked sibling project when this sweep started; on 17 Aug
it moved into this repo as scripts/apaleo/provision.ts (`npm run
apaleo:provision`), alongside the migration (`npm run apaleo:migrate`).
Update the constants so the migration reads from them and a fresh
provision lands on the new model:

- [x] `PROPERTY_NAME`, property description and address (values in A2).
- [x] `UNIT_GROUPS`: names, descriptions, `maxPersons`, prices per the table.
- [x] `SERVICES`: EARLY and SPA copy (A4).
- [x] Housekeeping while in there: the header comment still says lake/forest
      and claims a 6-month window (RESTRICTION_MONTHS is 3), the pricing
      rationale block still reasons from Center Parcs tiers, and the banner
      and summary box still print Naivasha and the old prices.

| Code | New name | maxPersons | Floor price/night | Today |
|---|---|---|---|---|
| WDL | Cedar Lodge 2 bedroom | 4 (unchanged) | 28,000 (unchanged) | Woodland Lodge, 4, 28,000 |
| FST | Cedar Lodge 3 bedroom | 6 (unchanged) | 42,000 (unchanged) | Forest Lodge, 6, 42,000 |
| LKV | Signature Lodge 2 bedroom | 8 to 4 | 65,000 to 38,000 | Lakeview Lodge |
| EXC | Signature Lodge 3 bedroom | 8 to 6 | 95,000 to 56,000 | Exclusive Lodge |

New descriptions come straight from section 5 of the direction doc: Cedar is
the base spec (a stove in every lodge), Signature is the seven things,
identical at both sizes, and the 3 bedroom gets more of the same.

### A2. One-off migration script

- [x] New `migrate-mount-kenya.ts` next to provision.ts, reusing its api
      helper and constants. One run, roughly 33 calls:
  - [x] Property PATCH: name, description, address. Keep the code UPNV (from
        here on it is just an opaque code), keep countryCode DE, timezone
        Europe/Berlin and the 14:00/11:00 times: all three are baked into the
        time-slice boundaries and the +02:00 offsets hardcoded in
        server/apaleo/units.ts, and changing them buys nothing guest-visible.
        Proposed values: name "Unity Parks Mount Kenya"; description "A
        car-free forest village of self-contained lodges on the western
        slopes of Mount Kenya, near Naro Moru. (Sandbox demo property.)";
        addressLine1 "Naro Moru, Kieni West (Demo)"; city "Naro Moru (Demo)";
        postalCode 10105.
  - [x] Unit group PATCH x4: names and descriptions; maxPersons on LKV (4)
        and EXC (6).
  - [x] Unit PATCH x20: names to lane and number per A3; maxPersons on the
        five LKV units (4) and the five EXC units (6). Units carry their own
        maxPersons, so the group PATCH alone is not enough.
  - [x] Rate plan PATCH x4: names follow the tier ("Cedar Lodge 2 bedroom
        Flexible" and so on); descriptions keep the deposit wording.
  - [x] Service PATCH x2: EARLY and SPA (A4).
  - [x] Rate rewrite on all four plans out to the 400-day horizon, reusing
        the setRatePlanPrices logic. Seasonal multipliers and the
        Friday/Monday turnover restrictions are unchanged. LKV and EXC land
        on their new floors; WDL and FST are rewritten at their existing
        floors purely to lengthen the calendar, which is what keeps the
        published season from-prices true.
- [x] Pre-flight, read-only: list future reservations on LKV and EXC with
      more adults than the new maxPersons. Existing reservations stay valid
      in Apaleo; this is only so odd historical rows are known, not found.

### A3. Unit naming: lanes

Lanes carry the place; the grade never appears in a name (section 5.5). Tree
lanes in The Glades, creature lanes up on the forest edge. Both grades in
every lane. Distribution per section 14: The Glades takes WDL x3, FST x3,
LKV x2, EXC x2; Sunrise Ridge takes the rest.

Each grade sits in a **consecutive block**: a run of three doors in one zone
and a run of two in the other. This is load-bearing, not tidiness. "Place our
lodges together" sells genuinely neighbouring lodges for parties of up to
three (MAX_LODGES), and only consecutive doors of the same grade can deliver
that. The first layout interleaved the grades door by door, which left no
grade with two adjacent doors anywhere and quietly made the product
unsellable; the fee was charged and refunded at checkout every time. Scatter
a grade across a lane again and the same thing happens.

| Unit code | New name | Zone |
|---|---|---|
| WDL01 | Fig Lane 1 | The Glades |
| WDL02 | Fig Lane 2 | The Glades |
| WDL03 | Fig Lane 3 | The Glades |
| LKV04 | Fig Lane 4 | The Glades |
| LKV05 | Fig Lane 5 | The Glades |
| FST01 | Olive Lane 1 | The Glades |
| FST02 | Olive Lane 2 | The Glades |
| FST03 | Olive Lane 3 | The Glades |
| EXC04 | Olive Lane 4 | The Glades |
| EXC05 | Olive Lane 5 | The Glades |
| LKV01 | Turaco Lane 1 | Sunrise Ridge |
| LKV02 | Turaco Lane 2 | Sunrise Ridge |
| LKV03 | Turaco Lane 3 | Sunrise Ridge |
| WDL04 | Turaco Lane 4 | Sunrise Ridge |
| WDL05 | Turaco Lane 5 | Sunrise Ridge |
| EXC01 | Hyrax Lane 1 | Sunrise Ridge |
| EXC02 | Hyrax Lane 2 | Sunrise Ridge |
| EXC03 | Hyrax Lane 3 | Sunrise Ridge |
| FST04 | Hyrax Lane 4 | Sunrise Ridge |
| FST05 | Hyrax Lane 5 | Sunrise Ridge |

Unit codes above are the intended pairing; the re-map assigns by door rather
than by code, so a given lodge may hold a different code than this table
shows. The names, blocks and per-grade counts are what matter.

Applied by `npm run apaleo:migrate -- --lanes-only`, which parks every mover
on a temporary name before taking its final one (the layout is a permutation
of the same twenty names, so renaming in place would collide) and writes
nothing when the village already matches.

Historical rows: `locationUnitName` snapshots keep "Lakeview Lodge 3" on old
bookings, and bookings taken before the re-map keep their old lane names.
Leave them; they were true when written.

### A4. Service copy fixes (found in the sweep, missing from section 15)

- [x] SPA: the description names "the Unity Spa"; it is The Forest Spa now.
- [x] EARLY: "from 10 am rather than the standard 2 pm" predates the 11:00
      checkout on a turnover day. Proposed: "from noon". (Open decision 3.)
- CYCLE and LOCATION copy survive as they are.

### A5. Verify

- [x] Offers endpoint returns the new names and 38,000/56,000-based seasonal
      prices for LKV/EXC; a WDL three-night long-rains break still totals
      84,000.
- [x] December spot-check: a WDL Friday start on 4 or 11 December totals
      109,500 (sunshine 1.3) and on 18 or 25 December totals 126,000
      (festive 1.5). Found 17 Aug when the horizon opened: beyond its
      seasonal window the sandbox serves legacy FLAT 84,000-based rates from
      before seasonal pricing existed, so festive weeks are underpriced
      until this migration runs. That makes the run a hard prerequisite of
      the merge, not a nicety.
- [x] Unit availability lists lane names (numeric name sort is already on).

---

## Stage B. Code sweep (this repo)

One name, one place first. The village name is repeated across components,
emails, the SVG and the CMS seed today:

- [x] New `content/village.ts`: `VILLAGE_NAME` and the locale line ("Naro
      Moru, Mount Kenya"). Stage D later adds zones and lanes to the same
      file, so every village fact lives in one module. Import it in:
  - [x] components/BookingBar.tsx:28 (drop the module-local const)
  - [x] components/BookingSummary.tsx:85 (hardcoded literal today)
  - [x] app/(site)/login/LoginClient.tsx:46
  - [x] app/(site)/checkout/location/LocationClient.tsx:222 (map alt)
  - [x] app/(site)/layout.tsx:24-26 (title, description) and :78 (locale
        line in the header)
  - [x] the seven email footers (below)

Copy sites, top of funnel to bottom:

- [x] app/(site)/layout.tsx: title "Forest & Lake Breaks" and the metadata
      description ("lakeside forest village near Naivasha"). The new lines
      come from section 3 of the direction doc.
- [x] app/(site)/lodges/[code]/page.tsx:171: eyebrow "Lake Naivasha village".
- [x] app/(site)/checkout/location/LocationClient.tsx:186: "favourite spot by
      the lake".
- [x] app/(site)/account/page.tsx:68: "waiting by the lake" empty state.
- [x] Emails, all seven templates in server/email/: the shared footer line
      "Unity Parks · Lake Naivasha, Kenya" (13 occurrences across html and
      text variants), plus body copy in bookingConfirmation.ts:87-88 and
      :126-127 and bookingCancellation.ts:70 and :91. Subjects are already
      place-free; section 15 overstates that part.
- [x] Comments only: server/apaleo/units.ts:17 and :43,
      prisma/schema.prisma:189 (all cite "Lakeview Lodge 3"). No db push.

Party size and bedrooms, the LKV/EXC shrink:

- [x] lib/occupancy.ts: MAX_PARTY 8 to 6, MAX_BEDROOMS 4 to 3.
- [x] app/api/search/route.ts: zod caps adults max(8) to 6 and children
      max(7) to 5; the size-over-8 guard becomes size-over-6 and its copy
      ("Our largest lodge sleeps 8") should now say what the doc says:
      parties of more than six take two lodges in the same lane.
- [x] app/api/month-availability/route.ts: the same zod caps.
- [x] app/(site)/lodges/LodgesClient.tsx: the tooSmall logic is data-driven
      and survives; re-read the copy at :584.
- Multi-lodge booking already exists, so parties of 7 plus keep a real path.
  Verify the nudge in Stage E.

content/lodges.ts, the full rewrite (section 5 is the spec):

- [x] All four entries keep their codes and image filenames. Names, taglines,
      sleeps (4/6/4/6), bedrooms (2/3/2/3), features, intro, included, rooms
      and goodToKnow rewritten. Cedar carries the base spec; Signature
      carries the seven things; the 3 bedroom is more of the same, never
      different things.
- [x] LKV is the deep one: a dozen lake-coupled lines ("Wake up to the
      water", glazed wall to the lake, lake-facing terrace). Its accent
      #2c5670 is lake blue and needs a warmer tone from the DESIGN.md
      palette. (Open decision 5.)
- [x] Gallery alts on WDL/FST/EXC: "Lake Naivasha at golden hour" at :66,
      :114, :211.

---

## Stage C. Content sweep

### C1. scripts/seed-cms.ts (fresh environments)

- [x] Media alts and credits: :27-29 (hero video "by the lake"), :33, :73,
      :77-78.
- [x] Activities: "on-the-water" (:109) is the one lake activity. Replace
      with a section 6 activity that tells the new water story; proposed
      trout fishing on the Burguret.
- [x] Seasons: sunshine-season copy at :139 ("Lake mornings") and its photo
      at :141; re-read all four against section 9. Months and multipliers
      stay.
- [x] FAQs: :201 (dogs FAQ places the village on the shore with hippos;
      rewrite wildlife per section 12) and :211-213 (getting there: A2, two
      and a half to three hours, tarmac throughout, Nanyuki airstrip 30 km.
      The number-plate promise stays; it is implemented and stays true).
- [x] home-page global: hero :322-329, village group :334-339, and the
      footnote :348, where "Woodland Lodge" becomes "Cedar Lodge 2 bedroom".
- Season card from-prices (109,500 / 84,000 / 96,000 / 90,000) are unchanged
  because the WDL floor is unchanged. Do not touch them.

### C2. Live CMS content (admin)

The same items as C1, edited in the Payload admin: local database first,
Allan does Railway. Check first whether `npm run seed:cms` skips or updates
existing rows; if it only bootstraps, the admin edit is the real change and
C1 just keeps fresh environments honest.

### C3. Media (Allan sources; own assets only)

Replace, then fix the CREDITS.md rows to match:

- [ ] /videos/hero-family-lake.mp4 (homepage hero). Still the lake-walk
      video; a replacement needs sourcing, and the LIVE copy lives in R2, so
      swap it via the Payload admin (upload a new file on the media doc).
      The same admin route updates the other CMS-served stills, whose R2
      binaries a repo swap cannot reach
- [x] /photos/band-lake.jpg replaced 18 Aug: a golden mountain valley
      (Pexels 10195041). Filename kept, CREDITS notes it is Naivasha-era
- [x] /photos/lodge-lkv.jpg replaced 18 Aug: dark-timber cabins in fern
      forest (Pexels 20624333), very Signature
- [x] Reviewed 18 Aug: hero-forest.jpg was half lake, replaced with misty
      pines (Pexels 10762369); season-cool.jpg passes as montane forest and
      stays.
- [x] Orphan band-forest-lake.mp4 deleted 18 Aug, credits row with it.

Prefer new filenames that say what they are (band-mountain.jpg), so no lake
names linger in code.

### C4. Docs

- [x] docs/DESIGN.md: locale line :91, imagery rule :157, and a note on the
      legacy --lake colour alias (:73-75); the CSS token itself is cosmetic,
      keep or rename.
- [x] docs/content-strategy.md: section 2 becomes the Mount Kenya year (the
      four-season framework survives; the climate table is rewritten for
      2,100 m), grounding rules :140-158 swap hippos and the escarpment for
      the section 12 list, the getting-there FAQ spec :81-83, the village
      page and news post specs :102-105, and the definition of done :167.
- [x] README.md:3-5.
- [x] docs/payload-cms-plan.md and the older engine and walkthrough docs get
      a one-line "superseded by village-and-content-direction.md where they
      disagree" note, not a rewrite of history.

---

## Stage D. Zones at the Location step, and the map

The one structural feature in the sweep. No zone data exists anywhere today;
the map's area labels are plain SVG text.

- [x] Extend `content/village.ts`: the four zones of section 4.6, the lane
      list with each lane's zone, and a laneOf(unitName) helper. Lane names
      are ours (set in A3), so parsing the lane prefix off the Apaleo unit
      name is reliable and needs no schema or API change.
- [x] LocationClient: zone choice ahead of the exact-lodge choice. Two zones
      are live at demo scale (The Glades, Sunrise Ridge); show all four with
      the other two marked as later phases, or just the live two. Fee
      semantics unchanged: zone choice is free navigation, the 2,500
      LOCATION fee still attaches only when an exact lodge is picked. (Open
      decision 7.)
- [x] Group the unit grid by lane within the chosen zone.
- [x] public/village-map.svg redraw: drop the lake, draw the four zones, the
      square, the Forest Spa, the Burguret and the forest edge, and give
      each zone an id so the selected zone can highlight. Keep the
      "Illustrative map, final art to come" pill, and fix the malformed
      cx="900 " attribute while in there.
- [x] Alts: the homepage map alt is CMS-driven (C1); the checkout alt comes
      from content/village.ts (Stage B).

---

## Stage E. Verification gates

- [x] `rg -ni "naivasha|hippo|escarpment|rift valley" app components content
      server scripts public README.md` returns nothing guest-facing. Passed
      17 Aug; the only hits are deliberate: seed-cms.ts comments explaining
      the Naivasha-era upsert keys, and the oldQuestion literal the FAQ
      rename needs to update in place.
- [x] `rg -ni "lake" app components content server scripts public` returns
      nothing guest-facing. Passed 17 Aug; remaining hits are the kept CSS
      alias, the fallback unit test, and CREDITS.md rows that go with the
      C3 media swap.
- [x] Booking end to end at parties of 2, 4 and 6; a party of 7 gets the
      two-lodge suggestion and completes a two-lodge booking. (25 Aug: 2/4/6
      booked and settled on the simulated provider, incl. deposit path and
      the location fee; party of 7 refused with the split copy. The
      two-lodge completion itself not re-run this pass.)
- [x] LKV/EXC offers reflect the 38,000/56,000 floors; a WDL three-night
      long-rains break still totals 84,000; season cards unchanged; the
      footnote names the Cedar Lodge 2 bedroom.
- [x] Location step end to end: zone, lane, lodge; the fee posts as before;
      the race-loss path (chosen unit gone) still removes the service.
- [ ] One test send of each of the seven emails renders the new footer.
- [x] npm test passes (extras fixtures use UPNV service ids and survive).
- [x] An account with a legacy booking still renders its "Lakeview Lodge 3"
      snapshot harmlessly.

---

## Out of scope for this sweep

The new pages (village, breaks, activities), the hero units, promo codes,
basket hold, dogs and adapted lodges, and the activities booking layer.
Section 15's "then, and only then" applies.

---

## Open decisions

1. Village display name: proposed "Unity Parks Mount Kenya" (property name,
   VILLAGE_NAME, email bodies).
2. Locale line: proposed "Naro Moru, Mount Kenya" (header, footers, DESIGN).
3. Early check-in copy: proposed "from noon" (checkout is 11:00, so the
   current "from 10 am" is impossible on a turnover day).
4. The Fireside and Work-from-the-forest bundles lost late checkout; add
   early check-in as a third include, or leave them at two.
5. LKV accent colour replacement for the lake blue #2c5670.
6. Meta title: proposed "Unity Parks | Forest Breaks on Mount Kenya".
7. Whether a zone-only choice (no exact lodge) should ever carry a fee;
   proposed no, the fee stays on the exact lodge.
