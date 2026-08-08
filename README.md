# Unity Parks

A Center Parcs-style booking demo for a fictional Kenyan holiday village on
Lake Naivasha. Real inventory, pricing, bookings and folios live in an
Apaleo sandbox (property UPNV); payments run through the Pesapal sandbox;
everything else (accounts, sessions, referrals, extras orders, reminders)
lives in our own Postgres.

## Stack

Next.js (App Router) + Prisma + Postgres. Tailwind for styling, Vitest for
unit tests, Resend for transactional email, deployed on Railway.

## Getting started

```bash
npm install
npx prisma db push   # local Postgres, never prisma migrate
npm run dev
```

Environment (`.env`): `DATABASE_URL` (local Postgres, e.g.
`unity_parks_dev`), `CLIENT_ID`/`CLIENT_SECRET` (Apaleo),
`PESAPAL_CONSUMER_KEY`/`PESAPAL_CONSUMER_SECRET`/`PESAPAL_IPN_ID`/`PESAPAL_BASE_URL`,
`APP_BASE_URL`, and optionally `RESEND_API_KEY`/`EMAIL_FROM` (absent =
emails logged, never sent), `PAYMENTS_PROVIDER=simulated` (folio-post
payments with no processor, useful locally), `OPS_ALERT_EMAIL`,
`REMINDERS_RUN_SECRET` (lets an external scheduler trigger balance
reminders).

Tests: `npx vitest run` (pure-logic suites over `lib/` and `server/`).

## Where things live

- `app/` routes: the funnel (`checkout/*`), `manage/`, `account`,
  `ops/` (admin console, gated by `User.isAdmin` via
  `scripts/make-admin.mjs`), `api/`.
- `server/` the engine: `apaleo/` (the only HTTP surface to Apaleo),
  `pesapal/`, `booking/` (checkout, cancellation, extras, reminders),
  `referral/`, `email/`, `auth/`.
- `content/` marketing words and pictures; Apaleo owns names and prices.
- `docs/` the real documentation. Start with `FEATURES-REPORT.md` (what is
  built and what is not), `DESIGN.md` (the visual system),
  `deposit-and-cancellation-plan.md` and `referral-system-plan.md` (the two
  money engines, spec plus post-build truth).

## House rules

- `prisma db push` only, never migrate. Local database first; the Railway
  database is pushed by hand before deploying schema-touching changes.
- Apaleo owns inventory, prices and money movement; Prisma owns commercial
  policy and bookkeeping. Never invent an amount a folio could tell you.
- Every Apaleo write carries an idempotency key or is naturally idempotent.
- No em dashes anywhere: code, comments, copy.
