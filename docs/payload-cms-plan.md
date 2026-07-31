# Payload CMS migration plan

Status: proposed. Branch: `payload-cms`. Written 30 Jul 2026.

Goal: non-tech editors can update the site's marketing content (copy, photos, FAQs) through an admin UI, without touching code, while Apaleo and Prisma keep owning everything transactional. Tool: Payload CMS, self-hosted inside this Next.js app, content in the same Postgres.

The plan follows four steps: audit the content, model a small set of content types, wire one page end to end as the proof, then roll through the rest of the site.

## 0. Verified facts (checked 30 Jul 2026)

- Latest stable Payload is v3.86.0 (10 Jul 2026). All `payload` and `@payloadcms/*` packages must be installed at the same exact version and upgraded together in lockstep; pin exact versions rather than caret ranges so a later package addition cannot drift.
- Next.js 16 support landed in Payload v3.73.0. This repo runs Next 16.2.10 and React 19.2.4, inside the supported window (16.2.6+). Do not downgrade Next below 16.2.6; Payload does not support Next 15.5 through 16.1.
- `@payloadcms/db-postgres` (Drizzle under the hood) defaults to push mode in development: schema syncs to the database with no migration files, same shape as our `prisma db push` habit. Production uses generated migrations (`payload migrate`).
- Payload manages the tables generated from its config. Coexistence with Prisma-managed tables in one database is common and community-documented, but not formally guaranteed: push mode diffs against the live schema, and Payload's own docs note it can drop schema it does not recognize in some setups. This is workable with the isolation and checks in step 3.4, not something to wave through.
- An experimental `schemaName` option can put Payload's tables in their own Postgres schema, away from Prisma's `public` schema.
- Media on Cloudflare R2 uses the official `@payloadcms/storage-s3` package (region `auto`, R2 S3 endpoint, `forcePathStyle: true`). This solves Railway's ephemeral disk: uploads never live on local disk in production. The dedicated `storage-r2` package is for Cloudflare Workers only, not us.
- No rich text editor is needed while every field is plain text or textarea; the `editor` config property is optional and `@payloadcms/richtext-lexical` gets added only if a richText field is ever introduced.
- Payload installs into an existing Next.js app: `payload.config.ts` at the root, an `app/(payload)/` route group copied from the official blank template, `withPayload()` around next.config, and a `@payload-config` tsconfig alias. Existing pages move into their own route group so root layouts do not clash.
- License is still MIT after the Figma acquisition (confirmed by maintainers, releases ongoing). Self-hosting is unaffected.
- Node 20.9+ required; we run Node 23.

Sources: payloadcms.com/docs (installation, postgres, storage-adapters, admin), github.com/payloadcms/payload releases and discussions #12843 and #4919, issue #5473.

## 1. Content audit (done, 30 Jul 2026)

A full sweep of every page, component, email template, and asset. Roughly 330 content units inventoried across ten areas, each classified as: stays in code, becomes CMS content, or transactional.

### The headline finding

Most marketing content is already centralized in three plain-TS files, which makes the migration mostly a lift of those files into Payload:

| File | Contents |
| --- | --- |
| [content/home.ts](../content/home.ts) | 4 activity cards, 3 season cards, 3 discover promo cards, 5 FAQs |
| [content/lodges.ts](../content/lodges.ts) | 4 lodge tiers keyed by Apaleo code (WDL, FST, LKV, EXC): name, tagline, blurb, features, sleeps/bedrooms, photo, accent color |
| [content/extras.ts](../content/extras.ts) | 5 extras keyed by Apaleo service code (CYCLE, SPA, EARLY, FIREWOOD, GROCERY): photo, unit noun, info sections |

Note the fan-out: content/lodges.ts has nine importers ([app/page.tsx](../app/page.tsx), [app/lodges/LodgesClient.tsx](../app/lodges/LodgesClient.tsx), [components/BookingSummary.tsx](../components/BookingSummary.tsx), [server/email/bookingConfirmation.ts](../server/email/bookingConfirmation.ts), [app/checkout/location/LocationClient.tsx](../app/checkout/location/LocationClient.tsx), [app/checkout/pay/PayClient.tsx](../app/checkout/pay/PayClient.tsx), [app/manage/[bookingId]/ManageClient.tsx](../app/manage/[bookingId]/ManageClient.tsx), [app/account/page.tsx](../app/account/page.tsx), [app/confirmation/[bookingId]/ConfirmationClient.tsx](../app/confirmation/[bookingId]/ConfirmationClient.tsx)). Six of those are client components. That is why lodges are a rollout phase of their own, not part of the pilot.

The rest of the CMS-worthy content is inline: homepage hero and section headings ([app/page.tsx](../app/page.tsx)), site-wide banner, footer contact details and SEO metadata ([app/layout.tsx](../app/layout.tsx)), the village name (hardcoded in [components/BookingBar.tsx](../components/BookingBar.tsx) and [components/BookingSummary.tsx](../components/BookingSummary.tsx)), checkout step intro paragraphs, and email copy.

### Classification totals

| Area | CMS | Code | Transactional |
| --- | --- | --- | --- |
| Homepage + layout + content files | 26 | 20 | 3 |
| Lodges page | 5 | 23 | 4 |
| Checkout (location, guests, details, extras) | 18 | 44 | 6 |
| Pay + confirmation | 5 | 27 | 3 |
| Auth + account | 6 | 30 | 1 |
| Manage booking | 2 | 33 | 3 |
| Emails | 13 | 7 | 4 |
| Assets + credits | 5 | 1 | 0 |
| Server-side strings (gap sweep) | 7 | 29 | 0 |

The pattern is clear: marketing surfaces (homepage, lodges, emails) are CMS-heavy; funnel and account surfaces are almost all functional code copy that editors should never touch.

### Audit findings worth acting on

- **Server-side user-facing strings.** API routes and server modules return error copy that clients render verbatim ([server/api-helpers.ts](../server/api-helpers.ts), [server/booking/checkout.ts](../server/booking/checkout.ts), [server/booking/cancellation.ts](../server/booking/cancellation.ts), auth routes). These stay in code, with one exception below.
- **The support phone number** +254 700 000 000 is hardcoded in five places: the footer ([app/layout.tsx](../app/layout.tsx)), the booking bar help line ([components/BookingBar.tsx](../components/BookingBar.tsx)), the manage screen ([app/manage/[bookingId]/ManageClient.tsx](../app/manage/[bookingId]/ManageClient.tsx)), cancellation refusal copy ([server/booking/cancellation.ts](../server/booking/cancellation.ts)), and the amend route. It belongs in a SiteSettings global so it changes in one place.
- **Email sender identity** (`Unity Parks <bookings@unityparks.com>` in [server/email/resend.ts](../server/email/resend.ts)) and the shared email footer are duplicated across all four templates. SiteSettings candidates, later phase.
- **Orphaned assets.** `public/videos/band-forest-lake.mp4` and `band-forest-mood.mp4` are referenced nowhere. Decide to delete or keep before seeding media.
- **Lodge sleeps/bedrooms** in content/lodges.ts duplicate Apaleo unit-group facts. Decision: they stay CMS-editable as marketing display, Apaleo remains the booking truth. A mismatch is an editor error, visible and fixable in the admin.
- **Credits governance** ([public/photos/CREDITS.md](../public/photos/CREDITS.md): Pexels-only sourcing, record every file, never Center Parcs media) must survive the move: the Media collection gets required credit fields so the rule is enforced by the schema, not by a markdown file nobody reads.
- **Season from-prices** in content/home.ts are hardcoded marketing strings, not live prices. They stay editor-owned strings with the existing disclaimer footnote. Live seasonal pricing from Apaleo is out of scope.

### What never goes in the CMS

Prices, availability, bookings, guest data, payment status (Apaleo, Prisma, Pesapal). Validation and error messages, button labels, form labels, stepper and nav labels (functional code copy). Auth flows. The memories counter value and goal (code and Prisma; only the caption around it is content).

## 2. Content model

Pilot scope, deliberately small (three collections, one global, plus media):

**Media** (upload collection)
- alt text (required), credit source URL (required), license note (default "Pexels License")

**Activity** (collection)
- title, copy (plain textarea), photo (Media relation), displayOrder

**Season** (collection)
- title, copy, fromPrice (plain string, e.g. "from KES 38,500*"), photo, displayOrder

**FAQ** (collection)
- question, answer (textarea), displayOrder

**HomePage** (global)
- hero: heading, subheading, intro, urgency line, CTA label, video (Media), video description (aria)
- village section: heading, paragraph, card name, location line, blurb, map alt
- section headings + intros: lodges, activities, seasons (plus price footnote), discover, FAQs
- discover cards: array of { title, copy, photo, link }
- memories band: caption, explainer line

**Admins** (auth collection for the Payload admin UI)
- Completely separate from the Prisma `User` guest accounts, named `Admins` to avoid any confusion. Set `admin.user: 'admins'` in the config so Payload never auto-creates its default users collection. Guest auth does not change.

Deferred to rollout (step 4): **Lodge** (from content/lodges.ts, keyed by Apaleo code), **Extra** (from content/extras.ts, keyed by service code), **SiteSettings** global (village name, phone, contact email, locality line, notice banner, newsletter line, SEO defaults, email footer and sender name). A **Village** collection only if a second village ever exists.

Modeling rules: structured fields only, no rich-text page builder, no free-form HTML. Every field maps to an existing component prop. Editors fill fields; the components keep the Center Parcs look. Plain textareas in the pilot. No drafts in the pilot; drafts arrive as their own rollout phase.

## 3. Pilot: homepage end to end

The homepage is the proof because it is the content-richest page (hero, activities, seasons, discover, FAQs, memories band) and everything it needs beyond content/home.ts is section headings. Lodge cards keep reading content/lodges.ts during the pilot. The layout (banner, footer, SEO metadata) also stays hardcoded until the SiteSettings phase; the pilot switches app/page.tsx only.

Install and wiring, in order:

1. **Clean tree first.** Land or merge the in-flight deposit/cancellation work before starting; the route-group move touches every page file and must be its own commit on a clean tree. Then move existing pages into `app/(site)/` (mechanical move, URLs unchanged) and copy `app/(payload)/` from the official blank template. Admin UI appears at `/admin`.
2. **Packages.** `payload`, `@payloadcms/next`, `@payloadcms/db-postgres`, `@payloadcms/storage-s3`, `sharp`, all pinned to the same exact version (3.86.0 at time of writing) for the Payload packages. No rich text package.
3. **Config.** `payload.config.ts` at root with the collections and global above and `admin.user: 'admins'`; wrap [next.config.ts](../next.config.ts) with `withPayload()`; add the `@payload-config` alias to tsconfig. New env var: `PAYLOAD_SECRET` (local .env now, Railway dashboard at deploy).
4. **Database, carefully.** Same `DATABASE_URL` as Prisma (local `unity_parks_dev` first, as always), with three guardrails. First: `pg_dump` the local database before the first `payload dev` run against it, since Drizzle push diffs the live schema and coexistence is community-proven, not formally guaranteed. Second: use `schemaName: 'payload'` so Payload's tables sit in their own Postgres schema away from Prisma's; it is marked experimental, so exercise drafts/versions/relationships locally, and fall back to the default public schema if anything misbehaves. Third: whenever a migration is generated later, read the SQL before it goes anywhere near Railway and confirm it touches only Payload's tables. Decide the schema question once, locally, before anything touches Railway.
5. **Media storage.** Configure `s3Storage` unconditionally in payload.config.ts with `enabled: process.env.NODE_ENV === 'production'` and `alwaysInsertFields: true`, so dev uses a local gitignored `./media` folder while prod uses R2, and the schema stays identical in both environments (conditionally spreading the plugin into the config is the documented footgun: migrations generated in dev would miss plugin fields that only exist in prod).
6. **Workflow fit.** Dev uses Payload push mode, same rhythm as `prisma db push`, nothing new to learn. For production: run `payload migrate:create` locally, read the SQL, commit the migration, and Allan applies it to Railway himself with `payload migrate`, right next to his manual Prisma push, before git push. Same discipline, one extra command.
7. **Seed script.** `scripts/seed-cms.ts`: uploads the existing photos/videos from public/ into Media (carrying alt text and the Pexels credit URLs from [public/photos/CREDITS.md](../public/photos/CREDITS.md)), then creates the Activity, Season, FAQ docs and the HomePage global from content/home.ts, published, not drafts. Idempotent: safe to re-run, updates by slug/key. After cutover this becomes a documented, required local setup step (README and CLAUDE.md): fresh clone, fresh database, new dev machine all need `npm run seed:cms` before the homepage renders.
8. **Read path.** A single accessor module, `server/content.ts`, server-only, using Payload's Local API (`getPayload`). Server components call it and pass plain props down to any client component that needs content. If the HomePage global is missing (unseeded database), the accessor throws a clear error naming the seed command rather than letting undefined content reach JSX. One correction from the audit: the homepage is currently dynamic only because the root layout reads the auth cookie ([app/layout.tsx](../app/layout.tsx) says so in a comment), not because of the Prisma memories call. That is an accident to not depend on: add `export const dynamic = "force-dynamic"` to the homepage so per-request CMS reads are declared, not incidental. No caching layer in the pilot; incremental static regeneration (a Next caching mode) plus publish-time revalidation is a later optimization if it ever matters.
9. **Cutover.** app/page.tsx renders from the accessor; content/home.ts is deleted. Before deleting, diff the extracted homepage text against the pre-cutover render, word for word.

Pilot acceptance checklist:

- `/admin` loads locally, first admin account created, a second admin account can log in and edit content
- Rendered homepage text is identical to the pre-cutover page, verified by diffing the extracted page text
- Editing an FAQ and saving shows on the homepage after refresh
- Swapping an activity photo in the admin works end to end
- A fresh database renders the accessor's clear seed-me error, not a broken page
- `npm run build` and `vitest` pass; checkout flow re-tested manually and untouched
- content/home.ts is gone

## 4. Rollout, page by page

Each phase is small and shippable. Every schema-changing phase ends the same way: build passes, manual pass of affected pages, `payload migrate:create`, read the SQL, commit, Allan applies to Railway.

1. **Lodges.** Lodge collection keyed by Apaleo code. Swap every one of the nine importers of content/lodges.ts (listed in section 1) to content served from `server/content.ts`. Six are client components, so their server parents fetch and thread lodge content down as props; that is the real work of this phase and it touches checkout, manage, account, and confirmation surfaces, so it gets its own commit and a full manual funnel pass. Delete content/lodges.ts.
2. **Extras.** Extra collection keyed by Apaleo service code (photos, unit nouns, info sections; names and prices keep coming from Apaleo). Same prop-threading pattern for ExtrasClient. Delete content/extras.ts.
3. **SiteSettings global.** Village name, phone, contact email, locality, notice banner, newsletter line, SEO defaults, memories caption, email footer chrome and sender name. Consumers switch in the same phase: layout, BookingBar and BookingSummary (props from server parents), ManageClient, cancellation and amend server copy, email templates. After this phase the phone number and village name each live in exactly one place.
4. **Roles.** Add a `role` field to Admins: `admin` (everything) and `editor` (content collections and globals only, no Admins access). Payload access control functions, a few lines each.
5. **Drafts.** Versions plus drafts on HomePage and the collections, with the read path querying published content only.
6. **Optional, decide later.** Live Preview for the homepage (drafts alone already give a safe edit-look-publish path; preview iframe wiring is extra machinery a one-editor demo may never need). Checkout step intro paragraphs and confirmation page prose. Email body copy (logic-branched templates, high effort, low editing frequency): keep in code, revisit only if editors actually ask.

Any audited item not named in this plan stays in code. The borderline ones deliberately left there: the lodges page no-offers empty state, the layout legal placeholder labels, the checkout details consent card and terms checkbox prose, the manage page cancellation policy prose, the forgot/reset password SEO titles, and the text labels baked into village-map.svg.

## Risks and caveats

- Shared database: coexistence with Prisma is common but not contractual. Mitigations are baked into steps 3.4 and 3.6: pg_dump before first run, schema isolation, and reading every generated migration before it reaches Railway.
- `schemaName` is experimental. Test locally first, fall back to public schema. Decide before first Railway deploy; changing later means moving tables.
- Admin and site share one deploy; a broken CMS change ships with the site. Mitigation: build must pass locally before push, same discipline as today.
- Payload manages only its own tables and will never read Prisma's. Nothing Prisma-owned becomes admin-editable without deliberate re-modeling. That is the intended boundary, not a limitation to work around.
- The repo has no CI today, and `next build` needs no database only while every route renders dynamically. If CI or static pages arrive later, the build gains a database dependency; revisit then.
- Turbopack (Next 16's default bundler) is supported since Payload 3.73.0. If odd hot-reload behavior appears in the admin panel during dev, upgrading Payload is the first fix.
- R2 needs a Cloudflare account and bucket before the first Railway deploy of the pilot (env vars: endpoint, access key, secret, bucket, public URL). Local dev needs none of it.
- A future Payload 4.0 major would mean a migration eventually; 3.x receives regular releases today.

## Working agreements (unchanged)

- No em dashes in any copy, code, or CMS seed content.
- Boring and explainable over clever. Structured fields, one accessor module, no page builder.
- Local database first; Allan pushes Railway and git himself.
