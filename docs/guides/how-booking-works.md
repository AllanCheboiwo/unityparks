# How booking works

## In one paragraph

A guest picks dates and a party. Our site checks the Friday and Monday turnover rule, then asks Apaleo, the property system, which lodges are free and what they cost. That opens a booking session, a thirty-minute basket refreshed at every step. The guest chooses a tier per lodge, optionally pays to pick a specific lodge, adds extras, enters the lead guest's details, signs in or creates an account, and names every guest. Pressing Buy now creates the real Apaleo reservation and our booking record, and the guest is sent to pay. Once money is confirmed, the booking shows as paid or deposit paid, party invitations go out, and the break appears in My account.

## Step by step

1. The guest chooses arrival, departure and party. A break holds one to three lodges, each with up to six people aged two and over. Infants sleep in cots and do not count.
2. The site refuses past dates, and any arrival or departure that is not a Friday or Monday. Apaleo has the same rule, but we answer first so the message is clear.
3. For valid dates, the site asks Apaleo for live offers: each lodge tier, its price, and how many units are free. Apaleo answers availability, not our database.
4. A booking session is created, storing the dates, each lodge's party, the signed-in account if any, and any referral code. It expires thirty minutes after the last completed step.
5. The guest chooses a tier per lodge. Changing a tier clears that lodge's extras and location choice.
6. Location step: pick a named lodge for a fee, ask for lodges side by side for the same fee, or take no preference for free. The fee is Apaleo's price.
7. Extras step: Apaleo services priced live per lodge. Activities with limited stock are sold only afterwards, from Manage my booking.
8. Details step: the lead guest enters name, email, phone and date of birth, and accepts the terms. The lead booker must be an adult on arrival day. This is also the account moment.
9. Guests step: every seat needs a first and last name, children a date of birth, adults optionally an email. Car registrations are collected here.
10. Pay step: the guest picks full payment, or a thirty percent deposit if arrival is far enough out, and presses Buy now.
11. Buy now creates one Apaleo booking with one reservation per lodge, assigns physical lodges, posts any referral discount or credit, reads the real totals back, and writes the booking record with those totals frozen. If a paid-for lodge was taken meanwhile, a comparable one is assigned and the fee removed first.
12. The guest is sent to pay. Payment has its own guide.
13. Once payment is confirmed, the status changes, one confirmation email is sent, and invitations go to party members with an email.

## The rules

- Accounts are mandatory. A signed-out guest with no account must choose a password at the details step; the account is created at once, before payment, and survives an abandoned booking. If the email already has an account, the only way forward is to sign in or reset the password.
- A signed-in guest's details form is a view of their account. Edits write back, except the email, which only changes the booking.
- Once the booking record exists, the lead details, referral code and totals are frozen, and the thirty-minute expiry stops applying.
- Invitations are created only for adult, non-lead seats, and only once the booking is deposit paid or paid. The lead's own address, or one repeated on another seat, is skipped. A booking can send at most twenty invitation emails ever.
- An invited person must sign in or register with the exact invited address, then accept. They get a read-only view: dates, lodge tier, the party's first names, and their own details. They can never pay, amend or cancel.
- Changing an invited email in Manage my booking revokes the old invitation and emails the new address. Nobody tells the dropped person.
- Extras can be added from Manage my booking while paid or deposit paid, up to the day before arrival. On a paid booking the charge settles at once; on a deposit-paid one it joins the balance.
- Statuses are created (reservation exists, nothing paid), deposit paid, paid, and cancelled. A failed status is defined but never set; failed payments sit on the payment attempt and the booking stays created.

## What can go wrong, and what happens

- Session expires before Buy now: the guest is told to search again. Nothing was reserved.
- Two tabs press Buy now together: one wins, the other resumes the same booking. Reservations are never duplicated.
- Buy now with an incomplete guest list: refused, no reservation made.
- A different account signs in mid-funnel: applied credit or a repeat-guest offer is cleared and must be re-applied.
- An invitation email fails: the invitation is released and retried next time the party is saved. Invites never fail a booking.
- A crash between reservation and record: the next Buy now resumes. A crash between removing a location fee and writing the record can undercharge the guest, which is accepted.

## What a person does

- Read the ops alerts when a payment lands on a retired order or does not match; those wait for a human.
- Handle party changes, stay length changes and lodge drops. Manage my booking only moves whole breaks to new dates.
- Sell activities in person from arrival day onwards.
- Reverse by hand any booking wrongly adopted by an account through an email match.

## For developers

- prisma/schema.prisma: the booking models.
- app/api/search/route.ts: turnover rule, Apaleo offers, session creation.
- server/booking/session.ts: the basket.
- app/api/session/[id]/details/route.ts: the account moment.
- server/booking/guests.ts: the guest manifest.
- server/booking/checkout.ts: Buy now and record creation.
- server/booking/invites.ts: invitations.
- server/booking/access.ts: who may see or change a booking.
- server/booking/extras.ts: post-booking extras and activities.
- app/api/booking/[bookingId]/route.ts: confirmation and manage data.
- app/(site)/account/page.tsx, app/(site)/manage/[bookingId]: the guest's view afterwards.
