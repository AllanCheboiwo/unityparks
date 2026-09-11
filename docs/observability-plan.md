# Observability, minimal (LO-16)

Status: batch path (interview, grilling and test freeze skipped, Allan's call 10 Sep 2026)
Linear: UNP-33
Branch: unp-33-observability

Sentry for exceptions, a health route for Railway, a log helper that tags
the booking id, and one email alert. Not a monitoring platform.

Pulled ahead of the D-9 order on 10 Sep 2026 because it depends on nothing
and catches the failures LO-14, LO-15 and LO-1 will introduce.

## Defaults taken

- Health route checks Postgres only. Vendor outages must not restart the app.
- Log helper captures errors only. It always writes to console as well, so
  Railway's log view works with Sentry unset.
- Event context is booking id and route name. Never guest email or name.
  Sentry send-default-PII stays off.
- Tracing off. Errors only.
- Alert goes to Allan's email, on issue first seen.
- The wizard's example page is deleted once the first event has landed.
- No DSN in local .env. Local runs never send.
- Environment tag comes from NEXT_PUBLIC_SENTRY_ENVIRONMENT, which Railway
  fills from its own environment name.

## Checklist

- [x] Claude: SDK wired by hand instead of the wizard (the wizard needs an
      interactive login). Three runtimes, errors only, DSN from
      NEXT_PUBLIC_SENTRY_DSN, tracing and PII off, environment from
      RAILWAY_ENVIRONMENT_NAME. Build verified with no DSN and no token.
- [ ] Allan: create Sentry org "unity-parks" and Next.js project
      "unity-parks" (those slugs are in next.config.ts), copy the DSN.
- [ ] Allan: add to Railway: NEXT_PUBLIC_SENTRY_DSN, SENTRY_AUTH_TOKEN, and
      NEXT_PUBLIC_SENTRY_ENVIRONMENT=${{RAILWAY_ENVIRONMENT_NAME}} (Railway
      reference syntax, so the browser bundle gets the same environment tag
      as the server).
- [x] Claude: app/api/health/route.ts, 200 with a trivial Postgres query,
      503 otherwise. Tests.
- [x] Claude: lib/log.ts, logError(message, err, { bookingId, route }).
      Console always, Sentry when a DSN is set. Tests.
- [x] Claude: replace the app/ console.error sites (Pesapal IPN, Pesapal
      callback, register, amend, session details) plus handleRoute's
      catch-all. The ~60 sites under server/ are UNP-34.
- [x] Claude: note in docs/lean-operations.md that LO-16 was pulled forward
      (D-9a, committed on the UNP-29 docs branch).
- [ ] Allan: point Railway's health check at /api/health.
- [ ] Allan: alert rule in Sentry, email on first seen.
- [ ] Both: throw a test error on Railway (temporary route or a deliberate
      bad request), see the event with readable frames, remove the route.
- [ ] One /code-review pass, PR with "Fixes UNP-33".

## Acceptance

On Railway: /api/health returns 200. The example page produces an issue in
Sentry with readable TypeScript frames and an environment tag. Allan
receives the first-seen email. Then the example page is removed.
