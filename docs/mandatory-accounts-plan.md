# Mandatory accounts at checkout (UNP-19)

Status: plan-approved

Linear: UNP-19 "Make accounts mandatory at checkout (CP parity)"
Branch: unp-19-mandatory-accounts (not yet created)
Tier: full path (touches auth and the checkout details step)

Plan approved: 28 Aug 2026, Allan wrote "plan approved!"

## The problem

Center Parcs requires an account for every booking. Our July design made the
account optional at the details step: an inline "Create an account" checkbox,
default ticked but skippable, plus a "Not now, continue as guest" escape for
guests whose email already has an account. The result is three identity states
(owned, orphan, orphan-with-an-account-elsewhere) that every downstream feature
has to reason about.

Allan walked CP's live checkout on 28 Aug 2026 and decided to match them. Making
the account mandatory collapses the state space to one: **every booking has an
owner from the moment the details step is submitted.** That in turn simplifies
the repeat-guest offer (UNP-7, which becomes account state instead of a typed
booking reference), gives invite-a-guest (UNP-20) a real identity to invite, and
retires the anonymous-guest question.

## What CP actually does (the reference)

Two branches off the email check, from Allan's walkthrough:

Existing account:
```
Have an account with us?
Enter your email address to confirm if you have an account
Email address: allangabz@gmail.com

Welcome back
Enter your password to sign in and we'll fill in the fields for you
Password                      Forgotten password?
[ ] Keep me signed in
```
No guest escape. Sign in, reset the password, or use a different email.

No account: the "Create an account" section requires a password, cannot be
skipped, lists the benefits, and carries a "Keep me signed in for 6 months" tick.

## Out of scope

- Postal address UI (Allan, 28 Aug: OUT). The nullable columns stay as they are.
- Email verification, social sign-in, admin UI.
- Any change to UNP-7 or UNP-20 surfaces. This feature only creates the
  precondition they need.
- Matching CP's exact password-strength policy. We could not verify it: their
  account pages 404 or render blank to our browser. We keep our shipped
  8-character minimum. If Allan reads their rule text later it becomes a
  one-line change.
- Migrating the existing orphan bookings (Allan, 28 Aug: demo data, not live).

## Invariants

1. A `BookingRecord` created after this ships always has a non-null `userId`.
2. A booking is viewable and manageable only by the account that owns it, or by
   the browser holding the unguessable `sessionId` that just paid for it.
3. The account is created at details submit, before payment. An abandoned
   checkout leaving a real account behind is accepted (Allan, 28 Aug), and
   matches CP.
4. Signing in never changes the lead-guest email on the booking; the details
   form edits the booking, the account profile is written back separately.
   (Existing behaviour, preserved.)
5. The email-status check stays an existence oracle. It already is, deliberately.

## Behaviour

### Details step, signed out, email has no account

Unchanged in shape, mandatory in force. The "Create an account" card loses its
checkbox: the password field is always shown and always required. `checkStep`
fails the last step without a password of at least 8 characters.

### Details step, signed out, email has an account

The sign-in panel becomes the only way forward:

- "Not now, continue as guest" and its `declinedSignIn` state are deleted
  (`DetailsClient.tsx:692`, `:314`, `:376`).
- The stale line "Password reset is not part of this demo" (`:699`) becomes a
  live "Forgotten password?" link to `/forgot-password`.
- **Change** stays. A typo has to be recoverable and we cannot distinguish one
  from evasion.
- The form below stays locked (`formUnlocked`) until sign-in succeeds.

### Details step, signed in

Unchanged. The form is a view of the account, edits write back.

### Keep me signed in

`AUTH_TTL_MS` is currently a flat 30 days for every login, and
`createAuthSession` sets `expires` on the cookie (`server/auth/session.ts:31`),
making it a persistent cookie that survives closing the browser. CP makes the
long session opt-in.

**The tick controls the cookie's kind, not its length.** Shortening 30 days to a
smaller number would still persist a session the guest declined; declining has to
mean something categorical.

- unticked: **no `expires` on the cookie** - a session cookie, held in memory,
  gone when the browser closes. The guest stays signed in for the rest of
  checkout, and nothing survives it.
- ticked: persistent cookie, `expires` 6 months out.

`AuthSession.expiresAt` is non-null and still needs a value in both cases, but it
stops being the consent surface: for the unticked case it is a server-side cap on
a token the browser has already discarded (24 hours), not a promise to the guest.
Consent lives in the cookie; the DB row is garbage collection.

Known consequence: today every login is persistent for 30 days, so an unticked
sign-in is a real reduction in convenience against current behaviour. That is the
intended effect of asking.

The tick appears in the inline sign-in panel, on the create-account card, and on
the standalone `/login` and `/register` pages, so one code path serves all four.
`createAuthSession` takes a `remember: boolean`.

### Manage

`/manage` moves behind the account. `FindBookingClient.tsx` and the `?email=`
challenge branch of `assertBookingAccess` are deleted; bookings are reached from
the account's My bookings list, or from the `?session=` link the browser holds
immediately after paying. `assertBookingAccess` drops to two proofs, and its
docstring (which also still claims password reset does not exist) is rewritten.

**The emailed links (grilling finding, 28 Aug).** `bookingConfirmation.ts` and
`balanceReminder.ts` both link to `/manage`, and the reminder's copy says
"you'll need your reference and the lead guest's email" - a description of the
challenge flow this feature deletes, sitting in inboxes where it may be clicked
after we ship. So `/manage` cannot 404: it becomes a redirect - signed out to
`/login?next=/account` (or equivalent), signed in to the account's bookings.
Both email templates drop the challenge wording and say "sign in" instead. An
already-sent reminder then still lands somewhere sane: the guest clicks, signs
in, and their booking is in the list because every post-ship booking is owned
and pre-ship orphans are accepted losses (demo data).

### Server enforcement

`app/api/session/[id]/details/route.ts`:

- `password` stops being optional in `DetailsBody` for the signed-out case. The
  rule is conditional, not a flat `required`: signed in = no password accepted,
  signed out = password required. Enforced after `getCurrentUser()`, returning
  400 rather than a Zod shape error, so the message is usable.
- The existing P2002 `emailTaken` 409 stays and matters more now: it is the race
  where the email-status check said "none" and an account appeared before submit.
- `claimByEmail` stays. It is now the mechanism that adopts a guest's own earlier
  orphan bookings on their first real account, rather than a general-purpose
  backfill.

## Data model

No schema change. Everything needed already exists:

- `User` carries title, DOB, address columns, marketing flags, `isAdmin`.
- `AuthSession.expiresAt` already varies per row, so "keep me signed in" is a
  value change, not a migration.
- `BookingRecord.userId` / `BookingSession.userId` stay nullable in the schema.
  Invariant 1 is enforced by the details route, not by the column, because the
  30 existing orphan rows must stay readable.

## Files touched

| File | Change |
| --- | --- |
| `app/(site)/checkout/details/DetailsClient.tsx` | delete guest escape, make password required, add remember tick, live reset link |
| `app/api/session/[id]/details/route.ts` | conditional password requirement |
| `server/auth/session.ts` | `createAuthSession(userId, remember)`, two TTLs |
| `app/api/auth/login/route.ts`, `register/route.ts` | accept and pass `remember` |
| `app/(site)/login/*`, `app/(site)/register/*` | remember tick |
| `server/booking/access.ts` | drop the `?email=` proof, rewrite docstring |
| `app/(site)/manage/page.tsx`, `FindBookingClient.tsx` | challenge page becomes a redirect (signed out: login, signed in: bookings) |
| `server/email/bookingConfirmation.ts`, `balanceReminder.ts` | manage links keep working; challenge wording replaced with "sign in" |
| `app/api/booking/[bookingId]/route.ts` | drop `?email=`, simplify `accountStatus` |

## Edge cases and failure modes

1. **Password reset mid-checkout.** The booking session TTL stays at **30
   minutes** (Allan, 28 Aug). Two facts make this survivable: the TTL is
   refreshed on every write (`freshExpiry()`, `session.ts:78-326`), so it is 30
   minutes of *inactivity*, not of shopping; and nothing is held in Apaleo during
   a session, so a long session costs nobody anything. A guest who leaves to read
   a reset email and takes longer than 30 minutes loses the session and
   re-searches. Accepted risk, deliberately not designed around: the reset flow
   is unchanged and does not return the guest to the funnel.
2. **Email-status says "none", account created before submit.** Already handled:
   P2002 to `emailTaken` 409, client flips to the sign-in card.
3. **Sign-out mid-funnel, then submit.** The details route already writes the
   identity unconditionally from `getCurrentUser()`, and releases referral credit
   when the identity changed. Under mandatory accounts the signed-out branch now
   demands a password, so the walk cannot continue ownerless.
4. **Retry after the record exists.** The 409 freeze in the details route already
   blocks rewriting the email and hijacking ownership. Unchanged and still
   load-bearing.
5. **Confirmation page for the just-paid browser.** Still works via `?session=`.
   Removing the `?email=` proof does not strand a guest who has just paid.
6. **The 30 existing orphan records.** Become unreachable from the UI. Accepted:
   demo data.

## Decisions made for you

1. `/manage` find-my-booking is **deleted** rather than rebuilt as a claim path
   (reference + email, then sign in to adopt). Deletion is the smaller diff and
   the cleaner end state; the claim path is the alternative if you want the
   orphans reachable.
2. Unticked = a **session cookie** (dies with the browser) with a 24-hour
   server-side cap, rather than a shorter persistent cookie. Allan's point,
   28 Aug: a shorter persistent session still keeps a guest signed in after they
   declined to be kept signed in. CP's ticked value (6 months) is from Allan's
   notes; the 24-hour DB cap is our choice and is not guest-visible.
3. Password minimum stays at **8 characters** (see out of scope).
4. The `?email=` proof is removed from `assertBookingAccess` in the same feature
   rather than left dangling. It is the same decision as 1, expressed on the
   server.

## Open questions

None. Both questions raised during drafting were closed on 28 Aug:

1. **Price staleness (closed by the code, not by a decision).** The concern was
   that a stale `ExtraSnapshot.grossAmount` could be charged, bounded only by the
   session TTL. It cannot. The amount charged is read live from Apaleo at
   checkout (`checkout.ts:710`, `getFolioForReservation`, re-read after any
   referral allowance is posted). The snapshot is display; the folio is money. A
   stale snapshot can only produce a display that disagrees with the charge, not
   a wrong charge. The TTL was never load-bearing for prices.
2. **Account without a booking (closed as not a question).** Because the account
   is created at details submit, a guest can end up with an account and no
   booking by closing the tab at the pay step. We owe them nothing further:
   `sendWelcomeEmail` has already fired and they can sign in. No design needed.

## Acceptance check (end to end)

On the deployed environment:

1. Search and reach `/checkout/details` signed out with a brand-new email.
   Confirm the account card has no checkbox and Continue is refused with no
   password.
2. Complete the booking. Confirm the record's `userId` is non-null and the
   welcome email fired.
3. Start a second booking signed out with the same email. Confirm the Welcome
   back panel appears, there is no guest escape, and the "Forgotten password?"
   link reaches a working reset.
4. Sign in with "Keep me signed in" unticked; confirm the `up_session` cookie
   has no expiry in devtools (Session), and that it is gone after a full browser
   restart. Ticked: confirm the cookie's expiry is about 6 months out and
   survives the restart.
5. Confirm `/manage` with no session redirects to sign-in, and that My bookings
   lists the booking from step 2.
