# Unity Parks visual system, Center Parcs edition

The frontend is styled to match the look and feel of centerparcs.co.uk as closely
as possible while staying our own brand: our name, our logo, our copy, our
illustrations. Tokens below were sampled from the live Center Parcs site on
17 Jul 2026. Do not copy Center Parcs text, photos, video or code. Recreate the
layout and styling with our own assets.

## Brand purpose (drives all copy)

Unity Parks exists to create a billion happy memories. Families come to the
forest, stay in a lodge, and leave with memories. The site counts them. Copy is
warm, family-first, and speaks about time together, never about rooms and rates
first. The counter (components/MemoriesCounter.tsx) appears on the homepage and
the confirmation page.

Writing rules: no em dashes anywhere (use periods, commas, hyphens). British
English. Prices always "from KES X" style with the asterisk footnote pattern.

## Fonts

- Body: Open Sans (next/font Open_Sans, var --font-body). 16px / 24px,
  color #4c4e4b.
- Display: Fira Sans (next/font Fira_Sans, var --font-display), our stand-in
  for Center Parcs' Tisa Sans. Weights: 300 (hero display), 400, 600, 700
  (section and page headings). Italic 300 for the accented hero word.
- Hero h1: 56 to 68px, weight 300, line-height 1.1, color #1d1d1d, one word
  italicised (matches "For the *center* of your world").
- Page h1 (funnel and content pages): 44px, weight 700.
- Section h2: 34 to 44px, weight 700. On photo bands: white.
- Card titles: 20 to 22px, weight 700, usually navy.

## Palette (globals.css tokens)

| Token        | Hex      | Use |
|--------------|----------|-----|
| background   | #ffffff  | page background (white, not cream) |
| foreground   | #4c4e4b  | body text |
| ink          | #1d1d1d  | display headings, dark outline buttons |
| olive        | #536917  | brand green: funnel band, active step, primary accents |
| olive-soft   | #5e6448  | header nav links (weight 700-800) |
| leaf         | #647e1b  | small accents, footer link hover, ticks |
| ochre        | #af6408  | primary CTA background |
| ochre-dark   | #8a4e06  | primary CTA hover |
| bronze       | #8b7346  | outline button border and text (Sign in style) |
| navy         | #2c5670  | calendar selection, lodge names, links in funnel |
| teal         | #2d5f73  | info banner background (white text) |
| mist         | #f5f3ee  | alternating section background, panels |
| line         | #d9d6cf  | hairlines, card borders |
| footer       | #333333  | footer background |

Legacy aliases still exist so old classes keep working during the restyle:
forest = olive, forest-light = lighter olive, moss = leaf, lake = teal,
sand = mist, gold = ochre. Prefer the new names in new code.

## Buttons (utility classes in globals.css)

- .btn-primary: ochre bg, white text, 600 weight, radius 6px, padding 9px 20px,
  hover ochre-dark. Font size 16. For hero CTAs 18px / padding 11px 22px.
- .btn-outline: white bg, 1px bronze border, bronze text, 600, radius 6px.
- .btn-dark-outline: white bg, 1px ink border, ink text, 600, radius 6px.
- Funnel search CTA: ochre with a magnifier icon, radius 6px.
- Disabled: #cccccc bg, white text.

## Signature patterns

1. Header (white): logo left. Nav row under the logo line on desktop:
   bold 16px olive-soft links with 28-32px gaps. Right side: outlined
   "Sign in / Register" bronze button (or first name + sign out when signed
   in), small locale line "Lake Naivasha, Kenya".
2. Teal info banner directly under the header: full-width #2d5f73, white 16px
   text, info icon left, bold underlined link inside the sentence.
3. Split hero: left column huge light display h1 with one italic word. Right
   column: h2 (22-26px bold, #6b6248 brownish), paragraph, bold urgency line,
   ochre CTA. White background.
4. Media band with overlaid booking bar: full-bleed scenic image band
   (aspect around 21:9). The white booking bar floats near its top, centered,
   radius 12px, shadow. On scroll past the band, a fixed bottom olive
   (#536917) band shows the same bar in compact form ("sticky search").
5. Booking bar: white, radius 12px, divided into fields by 1px #e5e2da lines.
   Each field: small icon left (pin, calendar, building, person), value text
   16px semibold ink, chevron right. Date field when filled shows tiny
   weekday labels ("Friday") above each date and an arrow between dates.
   Search button: ochre, magnifier icon, white bold text.
6. Date panel: two tabs with icons ("Specific date" calendar icon, "Search
   whole month" magnifier). Below: two month calendars side by side, month
   titles navy bold, round navy prev/next buttons. Night-length pills:
   selected = navy filled white text, idle = white with navy border.
   Info strip: full-width #eef1f4 with centered 13px bold navy-grey text
   "Unity Parks breaks start on a Friday or Monday." Weekday header row bold.
   Available dates: white cell with grey border, bold. Unavailable: pale
   grey text, no border. Selected range: navy filled cells joined by a navy
   band.
7. Funnel band (results and checkout pages): full-width olive #536917 band,
   about 88px tall, containing the white search summary bar (see 5) with a
   "Search again" ochre button.
8. Funnel hero: image band about 350px tall with the page title centered in
   white 44px bold display over a soft dark overlay.
9. Results card: white, radius 8px, 1px line border. Image left (4:3, about
   38% width). Body: navy 22px bold lodge name, 14px italic tagline,
   two-column tick list (leaf-green check icons, 14px). Right rail: "4 nights
   from" small grey text, price 26px bold ink, "per lodge" small, ochre
   "Choose this lodge" button, navy "More details" text link with chevron.
10. Month price strip (results page): row of pills, one per open start date,
    date + "from" price, selected pill navy filled.
11. Checkout stepper: arrow-shaped cells (existing clip-path approach).
    Current cell olive bg white bold text. Done cells mist bg olive text with
    leaf tick. Todo cells white with grey text. Radius 8 container, 1px line.
12. Forms: labels 14px semibold #4c4e4b, inputs 16px with 1px #cccccc border,
    radius 6px, padding 10px 12px, focus ring navy. Error text #b3261e.
    Section cards: white, radius 8px, 1px line border, 24px padding,
    20px bold ink section titles.
13. Booking summary sidebar: white card, radius 8px, line border. Header strip
    mist with olive bold title. Rows 14px with dotted leaders optional. Total
    row bold 18px ink with top border.
14. Contour texture: subtle background pattern of thin beige contour lines on
    white for feature panels (CSS class .contour-bg, uses an inline SVG data
    URI, opacity kept very low).
15. Gallery grid (lodge detail): one large image left (55%), 2x2 grid right,
    last tile dark overlay with "View all N images" white text.
16. FAQ accordion: full-width rows separated by 1px line, question 18px
    semibold ink with chevron right, opens to 16px body. No boxes.
17. Footer: (a) newsletter strip on #333: white 16px text left, email input +
    ochre "Sign up" button right. (b) Link columns on #333: three columns,
    white 20px bold column titles, white 14px links with 10px spacing,
    hover leaf. (c) Social icon row (inline SVG circles, white outline).
    (d) Bottom bar #2b2b2b: 13px #bbbbbb copyright, demo note, and the
    memories line "Counting our way to a billion memories."
18. Breadcrumb (funnel pages): 14px, olive links, "/" separators, current
    page plain grey.

## Imagery

No photography yet. Use the flat scenic SVG illustrations in public/
(consistent style: layered forest silhouettes in olive and leaf greens, warm
sky, lake band in navy-teal, simple timber lodge shapes with dark roofs).
Aspect ratios: hero band 21:9, lodge card 4:3, activity card 3:2, seasonal
card 16:9. Never hotlink or copy Center Parcs media.

## Page inventory

- / homepage: split hero, media band + booking bar + sticky search, village
  intro, lodge showcase rows (alternating image sides), activities band,
  seasonal trio, memories counter band, discover trio, FAQ, footer.
- /lodges results: funnel hero "Choose your lodge", olive band with search
  summary, month price strip when present, results cards, empty state.
- /checkout/*: stepper + two-column (form left, summary right) on every step.
- /account, /login, /register, /manage: centered narrow forms and lists in
  the same card language.
- /confirmation/[id]: celebration heading, booking ref card, memories moment.
