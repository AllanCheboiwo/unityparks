# Handoff: Unity Parks homepage redesign (warm-family pass)

## Overview
Redesign of the unityparks homepage (`app/(site)/page.tsx` + `layout.tsx`): one full-bleed motion hero with the booking bar riding its bottom edge, single-village framing, lodges presented on the two-axis model (grade × size) with from-prices, a zones block, an olive Things-to-do band, seasons row, memories counter band, FAQ, and a closing CTA. Tone: warm family (Center Parcs-style conventions), bold Fira Sans headings, 12px rounded cards, green-dominant accents.

## About the Design Files
`Unity Parks Home v2.dc.html` (+ `support.js`, `public/`) is a **design reference created in HTML** — a prototype showing intended look and behavior, not production code to copy. The task is to **recreate this design in the existing Next.js + Tailwind v4 codebase** (`AllanCheboiwo/unityparks`, branch `main`), reusing its established components (`BookingBar`, `StickySearch`, `MemoriesCounter`, `NewsletterForm`) and tokens in `app/(site)/globals.css`. Open the HTML in a browser and keep it side-by-side while implementing.

## Fidelity
**High-fidelity.** Colors, type sizes, spacing and copy are final unless the CMS supplies different copy. Recreate pixel-perfectly with Tailwind utilities against the existing CSS variables.

## Repo mapping (what changes where)
- `app/(site)/layout.tsx` — header becomes ONE row (logo · nav · locale · Sign in · Book a break CTA), sticky not required; teal banner stays above it. Mobile ≤760px: nav collapses to a hamburger + full-screen drawer.
- `app/(site)/page.tsx` — full rewrite of section order and markup (spec below). Hero heading changes to "A village in the cedar forest" (update CMS seed `home.hero.*`: headingBefore "A village in the", headingEmphasis "cedar forest", headingAfter "").
- `app/(site)/StickySearch.tsx` — keep the sentinel logic; when stuck, pin the bar itself (white, 12px radius, shadow `0 12px 32px rgba(18,22,15,.28)`, `top:14px`, width `min(1160px, 100vw - 80px)`, centered) instead of a full-width olive band. Below 1120px viewport: never pin (the stacked bar is too tall).
- `components/BookingBar.tsx` — keep all logic/panels. Bar container: `rounded-xl` (12px), hairline ring `#e9e6de`, shadow `0 20px 48px rgba(18,22,15,.22)`. Stacks vertically below `lg` (already does).
- `app/(site)/globals.css` — no new variables needed. Palette usage RULES (enforce in markup): ochre = CTAs and card action links only; navy = interactive text links only; teal = notice banner only; bronze = outline (Sign in) button only; olive = brand/eyebrows/bands.
- `public/village-map.svg` — replace with the copy in this bundle (relabelled to Mount Kenya zones: Riverside, The Glades, Cedar Rise, Sunrise Ridge, Water Garden, The Square; placeholder badge moved to x=110 so a 16/10 crop doesn't clip it).
- CMS seeds (`seed:cms`) — season cards, FAQ entries and activity copy below.

## Design tokens (from globals.css — unchanged)
- ink `#1d1d1d`, body `#4c4e4b`, olive `#536917`, olive-soft `#5e6448`, leaf `#647e1b`, ochre `#af6408`, ochre-dark `#8a4e06`, bronze `#8b7346`, navy `#2c5670`, teal `#2d5f73`, mist `#f5f3ee`, line (use `#e9e6de` for hairlines in this design), footer `#333333`, pale-green accent on dark `#c9dbb2`, muted grey `#8a877f`, secondary body `#6f6c64`.
- Type: Fira Sans (display, 600/700 for headings), Open Sans (body 16px/1.55).
- Container: max-width 1240px, gutters 40px (20px ≤700px). Section rhythm: 120px top padding between sections (72px ≤700px).
- Radius: 12px cards/photos/booking bar; 6px buttons; 3px small badges. Photo treatment: `filter: saturate(.85) contrast(1.03)` on every photo.
- Section header pattern (repeated): eyebrow 12px/700 uppercase tracking .18em olive, margin-bottom 18px → h2 Fira Sans 42px/700, line-height 1.12, tracking -.015em, ink → right-aligned intro 16px/1.7 `#6f6c64` max-width ~34-38ch; row is `grid-cols-[1fr_auto]`, gap 60px, `items-end`, 30px padding-bottom, 1px `#e9e6de` border-bottom (no border in the olive Things-to-do band).

## Screens / Views — Homepage (single page)

### 0. Teal notice banner
Teal `#2d5f73`, white 14px text, info icon, container-width, 10px vertical padding. Copy: "Breaks start on a Friday or a Monday. **Secure your dates and lodge**" (bold underlined link → #search).

### 1. Header (82px, white, 1px bottom border #e9e6de)
Logo (34px roundel + "Unity Parks" Fira Sans 600 22px olive) · nav links 15px/600 `#5e6448` gap 30px (Discover Unity Parks, Lodges, Things to do, Breaks, My booking) · right: locale line 13px grey with pin icon ("Naro Moru, Mount Kenya"), Sign in (bronze outline 6px radius), Book a break (ochre solid). Degrade: hide locale ≤1240, Sign in ≤1140, trim nav links at 1060/980/860, hamburger ≤760 (full-screen white drawer: logo row + close, 20px/600 links with hairline dividers, full-width ochre CTA).

### 2. Hero (motion) — height 78vh, min 600 / max 820px, dark base #12160f
- Media: production uses the existing muted looping `<video>` (CMS `home.hero.video` + poster). Prototype simulates with a slow Ken Burns on the photo: `transform-origin 60% 55%`, keyframes scale 1.06→1.18 with translate(-1.5%,-2%), 26s ease-in-out alternate infinite.
- Overlays: `linear-gradient(100deg, rgba(12,18,10,.8) 0%, .5 46%, .08 100%)` + bottom fade `to top rgba(12,18,10,.72) → transparent 42%`.
- Content bottom-left, container-aligned, padding-bottom 190px (clears the overlapping bar): eyebrow "ONE VILLAGE · 2,100 M · NARO MORU" 12px/700 tracking .2em `#c9dbb2`; h1 Fira Sans 700 64px/1.06 tracking -.02em white "A village in the *cedar forest*" (em italic); sub 18px/1.65 rgba(255,255,255,.84) max 50ch: "A lodge of your own in the cedar forest below the peaks. Your own stove, your own deck, warm water every day, and no car once you arrive."

### 3. Booking bar (overlapping hero bottom edge by 50%)
White, 12px radius, ring 1px #e9e6de, shadow `0 20px 48px rgba(18,22,15,.22)`. Fields separated by 1px #e9e6de dividers, each: icon 18px olive stroke 1.8 + label 11px/700 uppercase tracking .09em `#8a877f` + value 16px/600 ink + chevron `#b8b4aa`. Flex ratios: Village 1.15 (fixed "Unity Parks Mount Kenya", pin icon, no chevron) · Dates 1.35 ("Fri 18 Sep → Mon 21 Sep") · Lodges .8 ("1 lodge") · Guests .8 ("2 adults") · Search: ochre, 700, magnifier icon, px 34, self-stretch, hover ochre-dark. Hover on fields: `#faf9f5`. ≤1120px: bar stacks vertically (fields full-width, horizontal dividers, Search full-width centered py 15) and sits in normal flow under the hero (hero content padding-bottom 64px, next section top padding 96px). Sticky behavior: see StickySearch note above (trigger: hero bottom < 44px from viewport top).

### 4. The village (top padding 180px to clear the bar; 96px when stacked)
Two-col grid `1fr 1.05fr`, gap 80px, items-start.
- Left: section eyebrow/h2 ("The village" / "One village, high on the mountain"), two paragraphs 17px/1.75 (village stands in indigenous cedar forest above Naro Moru… lanes of four to six around a shared green… park once and walk everywhere; at 2,100 m evenings are properly cold all year — insulated, double glazed, wood-burning stove). Stat grid 2×2 (gap 32/40, top hairline, padding-top 36): number Fira Sans 34px/600 olive + caption 14px `#6f6c64` — "2,100 m / above sea level, in the cedar forest", "4 / lodges, two grades in two sizes", "Car-free / lanes, with parking beside your lodge", "Fri / Mon / the two days every break starts".
- Right: map image (1px border #e9e6de, 12px radius, aspect 16/10, object-cover) then "Four zones, downhill to uphill" Fira Sans 20px/600 + sub 14px grey ("Grade and size decide the lodge. The zone decides the view. Price climbs with the slope."), then 4 hairline-divided rows `grid-cols-[1fr_auto]`: zone name 15px/700 + one-line character 14px `#6f6c64`; badge right — Open: olive bg white text; Phase two: neutral outline `#8a877f` text / `#d4d1c9` border; 11px/700 uppercase, 3px radius, 4×9px padding. Rows: Riverside (Phase two), The Glades (Open), Cedar Rise (Phase two), Sunrise Ridge (Open) — copy from `content/village.ts`.
- ≤900px: single column, gap 40.

### 5. Quote band (full-bleed, margin-top 120px)
Height 52vh (min 380 / max 540), photo `season-cool.jpg` (mist in cedars) cover + gradient `to top rgba(12,18,10,.7)→.15@55%→.05`. Bottom-left, container-aligned, padding-bottom 56px: eyebrow "LIFE IN THE VILLAGE" 11px/700 tracking .16em `#c9dbb2`; statement Fira Sans 34px/700/1.2 white: "Park once. The mountain does the rest."

### 6. Lodges
Section header: "Lodges" / "Two grades, two sizes" + right intro: "Cedar is the spec the village is built from. Signature adds the same seven things at either size. One price per lodge, however many of you come."
- 4-up card grid (gap 28; 2-up ≤1000, 1-up ≤640). Card: photo 4/3 12px radius → eyebrow 11px/700 uppercase tracking .12em (Cedar cards olive, Signature cards ink) "Cedar · 2 bedroom" etc → title Fira Sans 21px/700 (The break, made simple / Room for six / The cold-weather grade / The celebration lodge) → blurb 14px/1.65 `#5f5c55` → meta row (margin-top auto, top hairline, padding-top 14, flex space-between baseline): "2 bed · sleeps 4" 13px/700 + "from **KES 84,000***" (strong Fira Sans 17px/700 ink, "from" 13px grey) → link "See dates and prices →" 14px/700 ochre. Badge on Cedar 3 bed photo: "Family favourite" white bg, ink text, 11px/700 uppercase, top-left 14px. Prices: Cedar 2br 84,000 · Cedar 3br 129,000 · Signature 2br 112,000 · Signature 3br 156,000 (ladder per docs: Signature 2br sits between the Cedars). Footnote under grid 13px grey: "*Lowest three-night break per lodge, subject to season and availability."
- Comparison card (margin-top 48, 1px border, 12px radius, 2 cols; stacks ≤1000): left white "IN EVERY CEDAR LODGE" (label ink→olive 11px/700 uppercase) + 5 tick rows (leaf `#647e1b` tick icon, 15px text): stove/insulated+double glazed; full kitchen; private deck with built-in braai; beds made up, towels and linen; Wi-Fi, parking, cot & high chair on request. Right mist bg "SIGNATURE ADDS, AT EITHER SIZE" (label ink) + 6 tick rows (leaf ticks): hot tub facing the mountain; roofed wraparound deck with outdoor dining and braai; underfloor-heated bathrooms; en-suite plus second bathroom; dishwasher, full oven, coffee machine; robes, slippers, heavier linen, better beds, bigger plot. Copy source: `content/lodges.ts` (CEDAR_INCLUDED_CORE / SIGNATURE_INCLUDED_CORE, abridged).

### 7. Things to do (olive band + overlapping tiles)
Full-width olive `#536917` band, padding 52px top / 100px bottom, containing the section header with white text (eyebrow `#c9dbb2` "Things to do"; h2 white "Days that fill themselves"; right intro rgba(255,255,255,.85) "Everything below is inside the village, and nothing needs a car."). No hairline. Tiles container margin-top −56px (overlaps band):
- Grid `1.4fr 1fr` gap 28 (1-col ≤1000, tiles min-height 340). Big tile (min-height 460, 12px radius): `activity-pool.jpg`, `object-position: center 68%`, gradient to top .85→0; eyebrow "INCLUDED EVERY DAY" `#c9dbb2`; h3 Fira Sans 32px/700 white "The Water Garden"; sub 15px/1.65 rgba(.86) "Warm water under a glass roof while the mountain air stays cold outside. Shallows for the small, lanes for the early risers."
- Right column: two stacked tiles (min 216 each): "The Forest Spa" (`activity-spa.jpg`) "Steam, stillness and birdsong, ten minutes uphill through the cedars." / "Forest trails" (`activity-cycle.jpg`) "Shaded loops for every pace on foot or on a hired bike." — h3 22px/700 white, sub 14px.
- Note line under grid 14px `#8a877f`: "Spa treatments, bike hire and firewood are added to your booking in the village, not at checkout."

### 8. When to come (seasons)
Header: "When to come" / "A mountain for every season" + intro "The stove is lit all year. What changes is the sky." 4-up grid (same collapse rules): photo 16/10 12px radius → months eyebrow 11px/700 `#8a877f` → title 21px/700 → copy 14px `#5f5c55` → price row (auto-top, hairline): "from **KES …***" strong 21px/700. Cards: Dec–Feb "Clear skies" (season-festive.jpg, "The peaks out all day, cold bright nights, the village at its busiest.", 109,500) · Mar–May "Long rains" (season-rains.jpg, "Cloud on the shoulder of the mountain, empty trails, the best prices of the year.", 84,000) · Jun–Sep "Cool season" (season-cool.jpg, "Mist in the cedars, firewood evenings, and the hot tub earning its keep.", 96,000) · Oct–Nov "Short rains" (season-green.jpg, "Afternoon showers, a forest turning green, good value before the festive rush.", 90,000). Footnote: "*Indicative lowest price for a three-night Cedar 2 bedroom break in the season, subject to availability."

### 9. Memories counter band (olive, margin-top 120)
Container padding 84px/40px, grid `auto 1fr` gap 64 items-center (1-col ≤900). Left: `MemoriesCounter` Fira Sans 88px/600 white tabular-nums + caption "MEMORIES MADE SO FAR" 13px/700 tracking .14em `#c9dbb2`. Right (1px left border rgba(255,255,255,.28), padding-left 64): h2 34px/700 white "Counting our way to a billion" + 15px/1.7 rgba(.82): "One memory is one guest, one stay on the mountain. Every break in the village adds to the count, and there are {remaining} still to go." Counter animates 0→value, ~1.6s cubic ease-out on mount.

### 10. FAQ
Grid `1fr 1.5fr` gap 80 (1-col ≤900). Left sticky (top 40; static ≤900): eyebrow "Questions" / h2 "Answered before you ask" / 16px "Still stuck? Call the village on +254 700 000 000." Right: native `<details>` accordion, hairline-divided; summary Fira Sans 19px/600 ink, py 24, "+" 24px olive rotating 45° when open (.18s); answer 15px/1.75 max 66ch. Six entries (first open): what's included; Cedar vs Signature difference; how breaks work (Fri/Mon shapes, 2pm/11am); can we choose where our lodge sits (zones, Location step); how cold does it get; demo payments note. Full copy in the HTML file.

### 11. Closing CTA (container-width card, 12px radius, min-height 340)
Photo `discover-groups.jpg` + gradient 100deg .88→.4@66%→.1. Padding 64: h2 Fira Sans 36px/700 white "Your dates are still free. *For now.*" + 16px rgba(.85) "School holidays and festive weeks fill first. Find yours while the lanes are still open." Buttons: "Find your break" (ochre solid) + "Compare the lodges" (white 1px outline rgba(255,255,255,.6), hover rgba(255,255,255,.12)), both 16px, 6px radius, 13×28 padding.

### 12. Footer (#333)
Newsletter strip (hairline-bottom): line 15px + email input (dark `#3d3d3d`, 1px `#5a5a5a`, 6px radius, min-width 280 — full-width flex ≤700) + ochre Sign up. 4-col grid `1.5fr 1fr 1fr 1fr` gap 44 (2-col ≤700, 1-col ≤640): brand blurb; Explore links; Get in touch; Legal (plain spans). Bottom bar `#2b2b2b` 13px rgba(255,255,255,.55): "© 2026 Unity Parks Ltd · demo environment, no real payments." / "Counting our way to a billion memories."

## Interactions & Behavior
- **Sticky bar**: sentinel/scroll check (existing StickySearch); stuck when hero bottom < 44px above viewport; release on scroll-up. Suppress pinning ≤1120px.
- **Hero motion**: video autoplay/muted/loop/playsInline with poster (prototype: 26s Ken Burns). Respect `prefers-reduced-motion` → static frame.
- **Drawer**: hamburger toggles full-screen menu; every link closes it.
- **Counter**: animate on mount (or on first in-view), cubic ease-out ~1.6s.
- **Hovers**: nav links → olive; field hovers `#faf9f5`; ochre buttons → `#8a4e06`; white-outline CTA → translucent white fill; footer links → moss.
- **FAQ**: native details/summary, chevron/plus rotates.
- Breakpoints summary: 1240 (hide locale) / 1140 (hide Sign in) / 1120 (bar stacks + unpins, hero pb 64, village pt 96) / 1060–860 (nav trims) / 1000 (grids 4→2, comparison + activities stack) / 900 (village/FAQ/counter/section-headers 1-col, FAQ unsticks) / 760 (hamburger) / 700 (20px gutters, 72px rhythm, h1 40px, footer 2-col) / 640 (grids →1-col).

## State Management
Existing: BookingBar owns all search state; MemoriesCounter takes `value`; StickySearch owns `stuck`. New: `menuOpen` (header drawer) — local useState in a client header component. No new data fetching; lodge from-prices should come from the same pricing source as seasons when available (hard-coded placeholders in the prototype).

## Assets
All photos are the repo's own `public/photos/*` placeholders (CREDITS.md applies). `village-map.svg` in this bundle is the updated one — copy it over `public/village-map.svg`. Apply `saturate(.85) contrast(1.03)` to photos globally (one utility class).

## Files in this bundle
- `Unity Parks Home v2.dc.html` — the hi-fi reference (open in a browser; `support.js` must sit beside it)
- `support.js` — runtime the HTML file needs (reference only, do not port)
- `public/village-map.svg` — updated map, copy into the repo
- `public/photos/…` — only so the HTML renders; identical to the repo's own photos
