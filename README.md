# Unity Parks

A Center Parcs-style booking demo for a fictional Kenyan holiday village at
Naro Moru, on the western slopes of Mount Kenya. Real inventory, pricing,
bookings and folios live in an Apaleo sandbox (property UPNV); payments run
through the Pesapal sandbox; everything else (accounts, sessions, referrals,
extras orders, reminders) lives in our own Postgres.

## Stack

Next.js (App Router) + Prisma + Postgres, with Payload CMS driving the
homepage content. Tailwind for styling, Vitest for unit tests, Resend for
transactional email, deployed on Railway.

**Two schemas share one database.** Prisma owns `public` (bookings,
accounts, referrals, everything transactional). Payload owns `payload`,
pinned by `schemaName` in `payload.config.ts`. Prisma cannot see Payload's
tables, which is what keeps the two migration styles below from colliding.

## Getting started

```bash
npm install
npx prisma db push   # public schema; never prisma migrate (see house rules)
npm run dev
```

Payload's own schema auto-pushes in development, so `/admin` works without
any migration step locally. In production it does not: `payload migrate` is
a separate, manual deploy action, and `next build` runs neither.

Environment (`.env`): `DATABASE_URL` (local Postgres, e.g.
`unity_parks_dev`), `PAYLOAD_SECRET` (without it the whole app fails to
boot, not just `/admin`), `CLIENT_ID`/`CLIENT_SECRET` (Apaleo),
`PESAPAL_CONSUMER_KEY`/`PESAPAL_CONSUMER_SECRET`/`PESAPAL_IPN_ID`/`PESAPAL_BASE_URL`,
`APP_BASE_URL`, and optionally `RESEND_API_KEY`/`EMAIL_FROM` (absent =
emails logged, never sent), `PAYMENTS_PROVIDER=simulated` (folio-post
payments with no processor, useful locally), `OPS_ALERT_EMAIL`,
`REMINDERS_RUN_SECRET` (lets an external scheduler trigger balance
reminders).

Tests: `npx vitest run` (pure-logic suites over `lib/` and `server/`).

## Where things live

- `app/(site)/` every guest-facing page: the funnel (`checkout/*`),
  `manage/`, `account`, `lodges/` (funnel results plus `[code]` marketing
  pages), and `ops/` (admin console, gated by `User.isAdmin` via
  `scripts/make-admin.mjs`). The route group carries the site layout, so a
  page outside it renders with no chrome and no styles while still
  returning 200. `app/(payload)/` is the CMS admin; `app/api/` and
  `app/r/[code]/` are route handlers and need no layout.
- `server/` the engine: `apaleo/` (the only HTTP surface to Apaleo),
  `pesapal/`, `booking/` (checkout, cancellation, extras, reminders),
  `referral/`, `email/`, `auth/`.
- `content/` marketing words and pictures; Apaleo owns names and prices.
- `scripts/apaleo/` the sandbox provisioning and migration scripts
  (`npm run apaleo:provision`, `npm run apaleo:migrate`), moved in from the
  old untracked sibling project. Rate writes are budgeted at 8 calls per
  20 minutes; the script headers say what each run spends.
- `docs/` the real documentation. Start with `FEATURES-REPORT.md` (what is
  built and what is not), `DESIGN.md` (the visual system), and the three
  money engines: `deposit-and-cancellation-plan.md`,
  `referral-system-plan.md`, `post-booking-extras.md`.

## House rules

- `prisma db push` only, never `prisma migrate`. Local database first; the
  Railway database is pushed by hand **before** deploying schema-touching
  changes. The root `migrations/` directory is **Payload's**, driven by
  `payload migrate`, and has nothing to do with Prisma: never point one
  tool at the other's schema.
- Apaleo owns inventory, prices and money movement; Prisma owns commercial
  policy and bookkeeping. Never invent an amount a folio could tell you.
- Every Apaleo write carries an idempotency key or is naturally idempotent.
- No em dashes anywhere: code, comments, copy.
