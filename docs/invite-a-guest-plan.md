# Invite a guest to a booking (UNP-20)

Status: implementing

Linear: UNP-20 "Invite guests to a booking (party accounts, shared itinerary seam)"
Tier: full path (touches the Prisma schema, auth identity, and adds a new subsystem)

Plan approved: 29 Aug 2026, Allan wrote "plan approved"
Tests approved: 29 Aug 2026, commit 18ddcfc, Allan wrote "tests approved"

## The problem (from the Linear issue)

Center Parcs' mechanism for a "registered member of the party": at the guest
details step you enter a party member's email address. If they have no account
they are prompted to create one; if they do, the booking links to their account
automatically. Invited guests then see a shared itinerary and can book their own
activities, restaurants and spa.

Beyond itineraries, this is how CP can say the repeat-guest offer is usable by
anyone in your previous party: party membership is verifiable because party
members hold accounts linked to the booking.

The seam already exists and is dormant: `SessionGuest.email` ("the invite-a-guest
seam, unused today") and `SessionGuest.invitedUserId` ("always null today; filled
when invites ship").

## Interview notes

### Round 1, Allan, 29 Aug 2026

1. **Entry point.** The guest-details page, next to the other guest fields, with
   copy explaining what adding an email does. Invite email should go out only
   once the booking is really happening, because the lead guest can cancel.
2. **What invited guests get.** Updates on the booking, nothing more. Activities
   are UNP-6 and not built, so there is nothing to book yet.
3. **Account or not.** Allan's guess: no account means email updates only; an
   account means they can sign in and later add activities.
4. **Who is invitable.** Adults only for now.
5. **Changing an invited email.** Stop sending updates to the old address, send
   the new one an immediate notification and all later updates. The lead guest
   tells the dropped person personally; we do not email them about it.
6. **Duplicate emails.** If the address is already the lead guest's or another
   party member's, treat it as the same inbox, do not double up.
7. **UNP-7.** Out of scope. This ships the seam; UNP-7 consumes it later.

### What Center Parcs actually does (checked 29 Aug 2026)

- Invites are entered "on the guest details page of the booking process, or on
  the edit guest details page within your account". Two entry points, not one.
- "If they don't already have a Center Parcs account, they'll be prompted to
  create one. If they already have an account, your booking will automatically
  be linked to it."
- There is an explicit acceptance step: "registered guests must have accepted
  the invite on their web account" before the app experience works. So CP's
  model is account + accept, not passive email updates.
- Changing a wrong email on a booking is a contact-centre job at CP, not
  self-serve. No pattern for us to copy there.

Sources: https://help.centerparcs.co.uk/Website_Navigation_or_Account_Support/Can_other_guests_on_my_booking,_book_their_own_activities
and .../How_will_I_be_able_to_invite_my_guests_to_the_booking

### Round 2, Allan, 29 Aug 2026

- Use CP's implementation for everything CP documents: two entry points,
  account required, explicit acceptance, no passive email-updates tier.
- Invite email fires when the booking first reaches `deposit_paid` or `paid`,
  not at full payment. Cancellation is handled by revoking access, not by
  delaying the email.
- An accepted invitee sees a read-only booking view: dates, village, lodge
  tier, party first names, their own details. Never the total, the deposit or
  balance, the payment status detail, other guests' dates of birth, or the
  extras and cancel controls.

## What this ships

An adult on someone else's booking can be invited by email, create or sign in
to an account, accept, and then see that booking read-only under their own
account. `SessionGuest.invitedUserId` stops being dormant, which is what UNP-7
needs later to say "anyone in your previous party" and mean it.

## Out of scope

- Activities, restaurant and spa booking by invitees. That is UNP-6; this
  issue only builds the identity they will need.
- Any UNP-7 rework. The repeat-guest offer keeps its current rules; this
  leaves it a verified-party-membership seam to read when it is built.
- Invitees inviting other people. Only the booking's owner invites.
- Children, toddlers and infants. Adults only.
- Self-serve email correction by the invitee. Only the lead guest edits the
  manifest, exactly as today.
- Email verification of the lead booker. `claimByEmail` already links on an
  unverified address (documented trust note); invites do not make that worse
  because an invite is bound to its address, see below.

## Inputs, outputs, invariants

**Input.** An email address typed into an adult, non-lead seat on the guests
step or on the manage page's guest card.

**Output.** At most one live invite per seat, one email per invite, and on
acceptance a `User` linked to that seat.

Invariants:

1. No invite row exists before a `BookingRecord` exists. The funnel's
   `SessionGuest.email` is intent; `BookingInvite` is the fact.
2. An invite is bound to the address it was sent to. Accepting requires being
   signed in as an account whose email equals the invited address.
3. One live invite per seat. Changing a seat's email revokes the old invite
   (and the access it granted) and issues a new one.
4. Acceptance grants read-only access to that one booking, and nothing else.
   Every mutating route stays owner-only, byte for byte.
5. Access ends when the booking is cancelled. It survives checkout, so party
   membership stays readable after the stay for UNP-7.
6. Emails are claimed atomically before composing, like every other email in
   this codebase, so no invite is sent twice.

## Data model

New model, following the AuthSession and PasswordResetToken pattern where the
row id IS the bearer token:

```prisma
model BookingInvite {
  id        String   @id            // 256 random bits; the token in the link
  createdAt DateTime @default(now())

  recordId String
  record   BookingRecord @relation(fields: [recordId], references: [id])

  // The seat this invite belongs to. Not unique: revoke-and-reissue means a
  // seat accumulates rows over its life, at most one of them live. The
  // one-live-invite rule is enforced inside the reconcile transaction,
  // claimed like the email stamps so a callback/IPN double-settle cannot
  // create two. Cascade: when an amend deletes the seat, its invites (and
  // the access they granted) die with it.
  guestId String
  guest   SessionGuest  @relation(fields: [guestId], references: [id], onDelete: Cascade)

  email String                      // normalized snapshot of the invited address

  sentAt     DateTime?              // claimed before composing, released on failure
  acceptedAt DateTime?
  revokedAt  DateTime?

  acceptedByUserId String?
  acceptedBy       User?   @relation(fields: [acceptedByUserId], references: [id])
}
```

`SessionGuest` gains the back-relation and keeps `email` and `invitedUserId`
unchanged in shape. `invitedUserId` is set in the same transaction as `acceptedAt` and cleared in
the same transaction as `revokedAt`, so it always mirrors the live accepted
invite. Its comment changes from "always null today" to a note that
`BookingInvite` is authoritative, this column is only the cheap read for
UNP-7, and access checks never consult it.

No expiry column. An invite's validity is derived: `revokedAt` is null, and
the booking is not cancelled. A link that never gets used simply stays usable
for as long as the booking does, which is what a party member would expect.

## How it works

**1. Typing the email.** `app/(site)/checkout/guests/GuestsClient.tsx` already
renders an email input on every seat and already sends it through. Three
changes: render it only for adult, non-lead seats; add the explanatory copy
CP has ("we will email them so they can see the booking"); and show an inline
note, not an error, when the address duplicates the lead's or another seat's.

The same card on `app/(site)/manage/[bookingId]/ManageClient.tsx` gets the
same field and copy. That is CP's second entry point.

**2. Materialising invites.** A new `server/booking/invites.ts` owns one
idempotent function, `reconcileInvites(recordId)`:

- for each adult, non-lead seat with an email, after dropping any address
  equal to the lead booker's and any duplicate of an earlier seat's,
  ensure a live invite whose `email` matches;
- when a seat's stored email no longer matches its live invite, set
  `revokedAt` on the old row and create a new one;
- when a seat's email is cleared, revoke without replacing;
- revoke any invite whose seat no longer fits the lodge's current party
  shape (position beyond the band count, or band no longer adult);
- never touch invites on a cancelled booking.

Called from exactly three places: the settle path in
`server/booking/checkout.ts` right after `sendBookingConfirmation`, the
post-booking guests route after `saveGuests`, and the amend route after a
successful amend.

**3. Sending.** `server/email/partyInvite.ts`, one new template. Sent per
unsent, unrevoked invite, claiming `sentAt` with an atomic `updateMany` first
and releasing it on failure, exactly like `confirmationEmailAt`. The email
carries the lead booker's name, the village, the dates, the lodge tier and the
link, and no money at all. Failure never disturbs the payment path.

**4. Accepting.** New route `app/(site)/invite/[token]/page.tsx` plus
`app/api/invite/[token]/accept/route.ts`:

| State | What the page does |
| --- | --- |
| Token unknown, revoked, or booking cancelled | "This invitation is no longer available." No detail, no confirmation the token ever existed |
| Valid, signed out | Shows who invited them, the village and the dates; Sign in and Create an account, both returning here |
| Valid, signed in, email matches | Accept button; POST runs one conditional update requiring `acceptedAt IS NULL AND revokedAt IS NULL`, setting `acceptedAt`, `acceptedByUserId` and `SessionGuest.invitedUserId` in one transaction, then redirects to the booking. A losing racer against a revoke sees the unavailable page |
| Valid, signed in, email differs | "This invitation was sent to a\*\*\*@example.com. Sign in with that account." Never auto-accepts |
| Already accepted by this user | Straight to the booking |

**5. Reading the booking.** `server/booking/access.ts` gains
`resolveBookingAccess(record, proof)` returning `{ role: "owner" | "invitee" }`
or throwing the same 401/404 it throws today. Invitee is derived from the
invite table only: an invite on this record with `acceptedByUserId` equal to
the user, `revokedAt` null, booking not cancelled. Never from
`invitedUserId`. `assertBookingAccess` keeps its
exact current signature and behaviour and is reimplemented as "resolve, then
demand owner", so every mutating route and the whole UNP-19 frozen suite are
untouched. Only two callers ask for the role: `GET /api/booking/[bookingId]`
and the manage page.

**6. Redaction.** For `role: "invitee"` the booking DTO drops
`totalGrossAmount`, `depositAmount`, `balanceDueDate`, `paidAmount`,
`paymentId`, the entire extras list, and every other guest's
`dateOfBirth` and `lastName`. `status` collapses to `confirmed` or
`cancelled`. The manage client hides Add extras, Pay balance, Amend, Cancel
and the guest-editing card when the role is invitee.

**7. Cancellation.** Accepted invitees get their own money-free cancellation
notice (dates, village, "cancelled by the lead guest"), never the owner's
email, which contains the refund amount. Both sends live inside the existing
once-per-booking claim. Access dies the moment `cancelledAt` is set, because
validity is derived rather than stored.

## Files touched

| File | Change |
| --- | --- |
| `prisma/schema.prisma` | new `BookingInvite`, relations on `SessionGuest`, `BookingRecord`, `User`; comment fix on `invitedUserId` |
| `server/booking/invites.ts` | new: reconcile, revoke, accept, list-for-record |
| `server/email/partyInvite.ts` | new template |
| `server/booking/access.ts` | add `resolveBookingAccess`; `assertBookingAccess` unchanged externally |
| `server/booking/checkout.ts` | call `reconcileInvites` after the confirmation email |
| `server/email/bookingCancellation.ts` | money-free invitee variant, same once-only claim |
| `app/api/booking/[bookingId]/guests/route.ts` | reconcile after `saveGuests` |
| `app/api/booking/[bookingId]/amend/route.ts` | reconcile after a successful amend |
| `app/(site)/account/page.tsx` | list invited bookings, badge, no money |
| `app/api/booking/[bookingId]/route.ts` | role-aware DTO |
| `app/api/invite/[token]/accept/route.ts` | new |
| `app/(site)/invite/[token]/page.tsx` | new |
| `app/(site)/checkout/guests/GuestsClient.tsx` | adults only, copy, duplicate hint |
| `app/(site)/manage/[bookingId]/ManageClient.tsx` | invite field, invitee-mode hiding |
| `app/(site)/login`, `app/(site)/register` | carry `?invite=` through and return to it |

## Edge cases

1. **Booking never paid.** No record, so no invite, so no email. Exactly what
   Allan asked for.
2. **Lead guest's own address in a party seat.** No invite. They already own
   the booking; a second door to it would be pointless.
3. **Same address in two seats.** One invite, on the earlier seat. The
   second seat is simply not invited, and the UI says so.
4. **Address changed after acceptance.** Old invite revoked, so the accepted
   user loses access immediately; the new address gets a fresh invite. The
   dropped person is not emailed, per Allan: the lead guest tells them.
5. **Address changed back.** A new invite row with a new token. The old link
   stays dead.
6. **Invitee registers with a different address than the one invited.** No
   access. The invite is bound to the address it was sent to.
7. **Invitee already owns another booking.** Unrelated. Roles are per record.
8. **Invitee is invited to two bookings.** Two invites, two accepts, both
   listed under their account.
9. **Two browsers accepting the same token at once.** The accept is a single
   conditional update on `acceptedAt IS NULL`; the loser is redirected to the
   booking rather than shown an error.
10. **Booking amended, party shrinks.** `saveGuests` deletes leftover seats;
    the reconcile that follows sees a seat with no email and revokes.
11. **Cancelled then a new booking made.** Different record, different
    invites. Nothing is reused.
12. **`RESEND_API_KEY` unset locally.** `sendEmail` skips and logs, and
    the invite row still exists with `sentAt` set, so the token can be pasted
    by hand in dev. Documented, not accidental.

## Failure modes

- **Resend down at settle.** The claim is released, the payment is untouched,
  and the next reconcile (any manage-page guest save) retries. No ops job is
  added for this; the demo does not need one.
- **Reconcile throws mid-settle.** It is called after the payment and after
  the confirmation email, and wrapped so it cannot propagate. A booking must
  never fail because an invite could not be written.
- **Token guessing.** 256 bits from `randomBytes`, same as the auth cookie.
- **Invite spam.** Seats are bounded by the booked party (at most 20 rows,
  adults only), but an owner could churn one seat's email repeatedly to mail
  strangers. Cap: at most 20 invite rows per booking across its life; past
  that, reconcile revokes but does not create, and the manage card says the
  limit is reached.
- **Enumeration.** Every bad token path returns the same copy. The accept
  route rate-limits per IP through the existing `lib/rateLimit.ts`.

## Decisions made for you

1. `BookingInvite` is a new table rather than four more columns on
   `SessionGuest`, so the token follows the row-id-is-the-token pattern the
   codebase already uses twice, and so a revoked invite keeps its history.
2. `SessionGuest.invitedUserId` is written as a mirror of the authoritative
   invite row, in the same transaction, because the schema comment promised
   it and UNP-7 wants a one-column read.
3. `assertBookingAccess` is not changed. A new sibling returns the role. This
   keeps the UNP-19 frozen suite green and keeps every mutating route
   owner-only by construction rather than by review.
4. Invites have no expiry.
5. Duplicate and self addresses are handled silently on the server and
   explained in the UI, rather than blocking the save.
6. Accepted invitees get a money-free cancellation notice but nothing on
   balance reminders or extras receipts, because those are money.
7. The invite email contains the dates, village and lodge tier so that
   someone who never signs up still knows where to turn up.
8. Rate limit and a 20-invite lifetime cap per booking, neither of which CP
   documents. They exist because we email arbitrary addresses on a stranger's
   say-so.

### Round 3, Allan, 29 Aug 2026 (grilling)

- Email changes stay self-serve on the manage page. CP routes wrong-email
  fixes through their contact centre; we have no contact centre and already
  have self-serve manifest edits. Parity is for guest-facing behaviour, not
  support-desk limitations.
- Two seats may carry two different addresses, each invited independently.
  Dedup only collapses the same address appearing twice.
- No email to a revoked address, confirmed. Same person on a new address is
  covered by the fresh invite; a dropped person just finds the link showing
  the neutral unavailable page.

### Adversarial pass, 29 Aug 2026

A. Revoke clears `SessionGuest.invitedUserId` in the same transaction, and
   accept sets it. The column always mirrors the live accepted invite;
   without this, UNP-7 would read a dropped guest as a verified party member.
B. The invitee role is derived only from the invite table: an invite on the
   record with `acceptedByUserId` equal to the user, `revokedAt` null, and
   the booking not cancelled. `invitedUserId` is never consulted for access.
C. Cancellation notice to invitees is its own money-free template (dates,
   village, "cancelled by the lead guest"). The owner's cancellation email
   contains the refund amount, which invitees must never see. Same
   once-per-booking claim covers both sends.
D. Known accepted risk: registration does not verify email ownership, so a
   holder of a leaked invite link could register the invited address and
   accept. Narrow: it needs a leaked link, an invited address with no
   account yet, and winning the registration race, and it is loud because
   the real invitee then finds their address already in use. Same trust gap
   as `claimByEmail`. Accepted for the sandbox demo; the fix is deferred
   email verification, filed as UNP-21 (verify-later for lead bookers and
   invitees, gating invite-accept and claimByEmail on verified status).
E. Accept is one conditional update requiring `acceptedAt IS NULL AND
   revokedAt IS NULL`, so an accept racing a revoke resolves
   deterministically in the database, never in application code.

Second pass:

F. The amend route calls `reconcileInvites` after a successful amend, and
   reconcile revokes any invite whose seat no longer fits the lodge's
   current party shape (position beyond the band count, or band no longer
   adult). Without this, a person amended off the break keeps read access
   until the next manifest save.
G. The account page lists invited bookings too: records with a live accepted
   invite for the signed-in user, shown with an "invited" badge, no money
   column, linking to the read-only manage view.

### Agreed fixes from self-attack

1. No `@unique` on `BookingInvite.guestId`. "At most one live invite per
   seat" is enforced inside the reconcile transaction, claimed like the email
   stamps so a callback/IPN double-settle cannot create two live invites.
2. `BookingInvite.guest` gets `onDelete: Cascade` so a party-shrinking amend
   can delete seats. Revocation history for a deleted seat dies with it.
3. Redaction is server-side in the DTO builder, per role. Invitees get no
   extras data at all, not a de-priced version. Client hiding is cosmetic on
   top, never the mechanism.

## Open questions

None open.

## Acceptance check (end to end, against the deployed environment)

1. Book a two-adult break, put a real second address on the adult seat, pay
   the deposit.
2. Confirm the invite email arrives, and that it contains no money.
3. Open the link signed out: it shows the village and dates, not the price.
4. Register from the link with the invited address, accept.
5. The booking appears on the new account's bookings list with an "invited"
   badge and no money column, and opens read-only: no total, no deposit, no
   balance, no extras or cancel controls, no other guest's DOB.
6. As the lead guest, change that seat's email. The first link and the first
   account's access both die; the new address receives a fresh invite.
7. Cancel the booking. The accepted invitee's access dies and they receive
   the money-free cancellation notice, not the owner's refund email.
