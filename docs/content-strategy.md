# Unity Parks content strategy

Status: proposed. Written 30 Jul 2026, amended 17 Aug 2026 for the Mount
Kenya setting: docs/village-and-content-direction.md now owns the where and
the what; this doc keeps the how and its four-season framework. Companion to
docs/payload-cms-plan.md (the CMS is the delivery vehicle; this doc decides
what the content says). Voice rules in docs/DESIGN.md still govern
everything here.

Goal: a site that reads ready to open. That means three things: the seasonal
story is true to the mountain instead of borrowed from Europe, every link and
nav item leads somewhere real, and all copy sounds like one brand wrote it.

## 1. The problem with today's seasons

The three season cards are European in shape and internally contradictory.
"Green season" promises bright days and the village at its liveliest, but in
Kenya the green season IS the rainy season, which the next card ("The long
rains") also claims. "Festive season" floats with no months attached. A
Kenyan family reading these cards would notice immediately, and they are the
audience.

## 2. The mountain year (climate truth)

The village sits at about 2,100 m on the western slopes of Mount Kenya, so
days are mild and nights are cold all year, and June to September is
genuinely chilly. The mountain hides in cloud through the middle of the day
and shows itself at dawn and at sunset. The year splits the way the whole
Kenyan calendar does:

| Months | What it is like on the mountain |
| --- | --- |
| December to February | Hot clear days, cold nights, the peaks out at breakfast |
| March to May | The long rains. Afternoon storms, clear mornings, everything green, fewest visitors |
| June to September | The cool season. Mist to the knees at dawn, fires lit by five, the Water Garden steaming |
| October to November | The short rains. Light afternoon showers, the forest greens again |

The demand calendar overlays it: Kenyan schools run three terms with
holidays in April, in August, and a long break from late October or November
through early January. Those three windows plus Easter and the festive weeks
are when families book. The homepage urgency line ("School holiday breaks
are booking fast") should always be pointing at whichever window is next.

## 3. The new seasonal model

Four evergreen seasons, each with its months on the card, replacing the
current three. Campaigns sit on top as time-boxed moments, not seasons.

| Season | Months | Copy angle | From-price (real floor) |
| --- | --- | --- | --- |
| Sunshine season | December to February | Hot clear days, cold nights, the peaks out at breakfast | from KES 109,500* |
| Long rains | March to May | Afternoon storms, clear mornings, the forest at its greenest, the best prices of the year | from KES 84,000* |
| Cool season | June to September | Mist at dawn, fires lit by five, the Water Garden steaming, and the August holidays in the middle of it | from KES 96,000* |
| Short rains | October to November | Green afternoons, quiet trails, value before the festive rush | from KES 90,000* |

Pricing is real, not editorial (implemented 30 Jul 2026). The provisioning
script writes seasonal nightly rates into Apaleo: each tier's base price is
the long-rains floor, multiplied per date (long rains 1.0, short rains 1.08,
cool 1.15, sunshine 1.3) with campaign overlays on top (festive weeks 1.5,
August holidays 1.25, April holidays 1.15), rounded to the nearest KES 500.
Card from-prices quote the cheapest real product per season, a three-night
Cedar Lodge 2 bedroom (WDL) break (3 x floor nightly), and are always quoted
per break, never per night, because checkout prices per break and the unit
must not change mid-funnel. The WDL floor deliberately survived the Mount
Kenya reprice, so these card prices did too. If multipliers or bases change
in provision.ts, the card prices in scripts/seed-cms.ts must be recomputed to
match. The from-price footnote promises "lowest price for a three-night
Cedar Lodge 2 bedroom break in the season"; keeping that promise true is
part of any pricing change.

Campaign moments (banner plus, later, a landing page each): Festive (mid
December to early January, inside sunshine season, the existing festive card
copy and photo move here), August holidays, April/Easter holidays. The
site-wide teal banner is the campaign slot until landing pages exist.

What this touches when implemented:

- Seasons collection gains a `months` text field ("December to February").
  The card grid goes from three columns to a 2x2 or 4-across layout.
- Season content reworked to the four rows above. Two new photos needed
  (sunshine: the peaks at dawn; cool season: misty forest), Pexels with
  credits per the governance rules. season-festive.jpg is reserved for the
  festive campaign; season-green.jpg fits the short rains.
- The extras get seasonal anchors in copy where natural: firewood and BBQ
  belongs to cool-season evenings, cycle hire to the dry months, the spa to
  misty mornings. One sentence each, no schema change.
- Two FAQ additions: "When is the best time to visit?" (answer: the four
  seasons in three sentences, there is no bad time, prices are lowest in the
  rains) and "How do we get there?" (Naro Moru on the A2, two and a half to
  three hours from Nairobi, tarmac throughout, Nanyuki airstrip 30 km;
  parking included, plate captured at booking for the gate).
- Editor rhythm: the hero urgency line and the banner change six or so times
  a year, tracking the next school-holiday window. That is the single most
  important recurring content task and it takes two minutes in the admin.
- Later, optional: mirror the from-price ladder in real Apaleo seasonal
  rates. Sandbox rate writes are budgeted, so this is a deliberate exercise,
  not a casual one, and nothing on the site blocks on it.

## 4. What is left, from the features report (content items only)

Verdicts on every unchecked content item in docs/FEATURES-REPORT.md section
6, plus the loose ends the CMS audit found:

**Build**

| Item | Shape |
| --- | --- |
| Lodge detail pages | One page per tier: gallery, what's included list, the tier's story. Rides the Lodge collection rollout (payload plan phase 1). Floor plans deferred until we have illustrations |
| Things to do landing + 4 activity pages | Fixes the dead "Discover more" links. Activity collection gains detail fields (intro, sections, gallery). The forest spa page IS the spa marketing page; no separate Aqua Sana clone |
| Village page | The character page the nav's "Discover Unity Parks" deserves: karibu welcome, the map, wildlife neighbours (colobus, turacos, tree hyrax; elephant beyond the fence), getting there, the four seasons strip |
| Help page | One /help route, categorized accordion from the Faqs collection (add a category field). Homepage keeps its top five. No search, it is one page |
| Legal pages | Real Terms of stay, Privacy, and Booking and cancellation policy pages. The policy copy already exists in DESIGN.md and the deposit plan; this is assembly, not writing. Code-owned, not CMS: lawyers edit rarely, editors never |
| Village news | Small News collection, three seed posts (building the village, meet the lodges, the neighbours beyond the fence). Powers the "Village news" discover card's dead link |
| Group bookings page | Thin landing page for a feature that already works (multi-lodge, "more than 3 lodges call us"). The "Group bookings" discover card links to it |

**Swap**

- The "Gift a break" discover card points at a feature we have not built
  (gift cards). Replace it with "A billion memories", a brand-story page for
  the counter: what counts as a memory, the running total, why the goal is a
  billion. It is the most on-brand page the site could have and needs no new
  features.

**Defer, with reasons**

- Guest reviews wall: needs real guests. Post-launch.
- Gift cards: a purchase feature, not content.
- Seasonal campaign landing pages: phase C below, banner carries campaigns
  until then.
- Mega-menu: last, once the destinations above exist. A mega-menu over four
  links is a facade.
- Newsletter wiring, live chat, locale toggle: integrations, not content.
- Real photography: the governed Pexels set stays until a real shoot, and
  the Naivasha-era files (the lake band, the hero video, the old Lakeview
  photo) go with the Mount Kenya media sweep (docs/mount-kenya-sweep.md,
  stage C3). The orphaned band-forest-lake video goes with them;
  band-forest-mood, once earmarked alongside it, never existed on disk.

## 5. The site map when this is done

Nav: Discover Unity Parks (village page), Lodges (list + 4 detail pages),
Things to do (landing + 4 pages), My booking. Mega-menu groups arrive last:
Discover (village, seasons, news, a billion memories), Lodges (tiers +
compare), Things to do (activities, spa, groups), Help.

Footer: village, help, group bookings, news, contact details, real legal
links. Nothing in the footer may point at a placeholder.

## 6. Voice and Kenya-grounding rules

Everything in DESIGN.md holds (warm, family-first, British English, no em
dashes, "from KES X" with the asterisk footnote). Added for cohesion:

- Ground in real places and real nature: Mount Kenya, Naro Moru, the
  Burguret, Nanyuki, the A2, the equator; colobus and sykes monkeys, tree
  hyrax, bushbuck, turacos, sunbirds, trout in the rivers, and elephant and
  buffalo beyond the fence. Never invent geography.
- Swahili is seasoning, not sauce: "karibu" belongs on the village page
  welcome, "Kirimara" names the evening restaurant, and that is it. No
  phrasebook copy.
- Seasons are always named with their months. No card or page says "summer"
  or "winter", ever; those words do not exist at the equator.
- School holidays are the demand language: copy says "the August holidays",
  not "summer break".
- Wildlife is a neighbour, not a threat and not a zoo: the dog FAQ's tone
  (safety, respect, a little wonder, an honest fence) is the template.
- Altitude and cold are assets, not caveats: say "bring a jumper" with
  pleasure.
- Every media file carries alt text and a credit URL in the CMS; the Media
  collection enforces it. Never Center Parcs assets, in any form.

## 7. Implementation phases

Each phase is shippable and leaves the site more coherent than before.

**Phase A. Kenyan re-grounding (no new routes).** The seasons rework from
section 3 end to end: schema field, four cards, two new photos, extras
sentences, two FAQs, urgency-line guidance written into the admin field
descriptions. Plus: unlink the "Discover more" and discover-card dead links
until their pages exist (a card without a link is honest; a link to nowhere
is not). Definition of done: nothing on the site contradicts the mountain
calendar and nothing clicks to nowhere.

**Phase B. Depth pages, riding the CMS rollout order.** Lodge detail pages
with the Lodge collection phase, then things to do, the village page, help,
legal, news, group bookings. Each page ships with its nav/footer link the
day it exists, not before. Definition of done: every destination in section
5's map is real.

**Phase C. Campaign layer.** Festive landing page first (December is the
peak and the banner slot is proven), then August holidays, then the billion
memories story page, then the mega-menu over the now-real destinations.

The content itself is written at each phase inside the CMS (seed scripts for
initial copy, admin for everything after), so by phase C editors are doing
what editors will do in production: seasonal rotations, news posts, campaign
copy, all without a deploy.
