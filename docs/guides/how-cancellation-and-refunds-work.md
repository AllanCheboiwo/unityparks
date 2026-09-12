# How cancellation and refunds work

## In one paragraph

A guest who has paid, or paid a deposit, can cancel their own break from the manage-booking page up until the day before arrival. The refund follows a sliding scale by days to arrival, and the deposit is never part of it. On cancel, the system cancels the lodge reservations in Apaleo, records the refund on each lodge's bill there, marks the booking cancelled, frees any activity bookings, and emails the guest. Important: no money is actually sent back to the guest by the system today. The refund is recorded, not paid. Returning it through Pesapal is a manual job. Separately, deposit-paid guests get up to two balance reminder emails, but only when a person or an external scheduler triggers a run, and nobody is ever cancelled automatically for not paying.

## Step by step

1. The guest opens their booking on the manage-booking page. They must be signed in as the account that owns it, or be in the browser that just paid for it. Invited guests can view but cannot cancel. There is no staff cancel button in the site.
2. The page shows a live quote: days to arrival, refund percentage, amount coming back and amount kept. Nothing changes until the guest confirms.
3. The guest clicks cancel and confirms. The system re-reads the booking fresh, in case a balance payment landed a moment ago, and recalculates on the latest figures.
4. For each lodge, the system cancels the reservation in Apaleo. An already-cancelled lodge is skipped rather than failing.
5. For each lodge that received money, it posts a refund line onto that lodge's bill in Apaleo, split in proportion to what each lodge was paid. Each refund is tagged so a retry can never post it twice.
6. The booking is marked cancelled and the refund total stored. In the same step, any activity slots or hire items held by the booking go back to stock.
7. The system checks whether a payment sneaked in during the cancel. If so, it raises an ops alert, because the guest is now owed more than was recorded.
8. Any referral reward tied to the booking is voided.
9. A cancellation email goes to the lead guest with dates, refund figure and amount kept. Accepted invited guests get a short notice with no money details. Each email is sent once only.
10. A person then refunds the guest through Pesapal by hand. The system does not do this.

## The rules

Days are counted from today to the arrival date, in whole days.

| Days before arrival when cancelling | Refund of the amount paid beyond the deposit |
| --- | --- |
| 57 or more | 100% |
| 42 to 56 | 50% |
| 21 to 41 | 25% |
| 20 or fewer | Nothing |
| Arrival day onwards | Cannot cancel online, guest must call |

- The deposit is 30% of the booking total and is never refunded, at any tier. That applies equally to guests who paid in full, whose payment simply includes that 30%.
- The refund is calculated only on money actually paid above the deposit. A guest who has paid only the deposit gets nothing back at every tier, though cancelling still frees the lodge.
- Extras charged straight away after booking count as money paid, so they fall inside the same calculation. Extras deferred to the balance were never paid, so there is nothing to refund.
- Only paid or deposit-paid bookings can be cancelled online. Anything else sends the guest to the phone number.
- Balance reminders: "due soon" can go out in the 14 days up to and including the due date, "overdue" once it has passed. Each is sent at most once. A booking already overdue before "due soon" ever went gets only the overdue email.
- Reminders go only to deposit-paid bookings that still owe money.
- There is no automatic cancellation of overdue bookings. Only a person decides to cancel money a guest may still intend to pay.

## What can go wrong, and what happens

- The refund is recorded but not paid. The cancellation email tells the guest the money has been refunded to their original payment method. Until someone processes the Pesapal refund, that sentence is ahead of reality.
- A balance payment lands during the cancel. The cancel completes on the older paid figure, and a "mid-cancel payment" alert is written, and emailed to the ops address if one is configured. A person settles the difference.
- A payment arrives after the booking is cancelled. It is refused and flagged as excess for review.
- A lodge bill in Apaleo does not match what the site expects during a payment. The site stops, tells the guest not to pay again, and writes a "folio drift" alert. Nothing moves until a person looks.
- The cancel crashes part way through. Every step is safe to repeat, so it can simply be run again. The email goes out only once the booking is finally marked cancelled.
- An extras order is in flight when the booking is cancelled. The order is rolled back and marked failed, with an error logged, because any charge that landed sits on a cancelled bill outside the refund calculation.
- A reminder email fails to send. The "sent" stamp is released so the next run tries again.

## What a person does

- After every cancellation with a refund above zero, send the actual refund to the guest through Pesapal. The site only records it.
- Check the ops alerts page regularly. Alerts stay open until an admin resolves them, oldest at the top. Resolving means "I looked", nothing more happens.
- Trigger the balance reminders: the run button on the ops reminders page, or an external scheduler calling the same endpoint with the shared secret. Nothing runs on its own.
- Decide, case by case, whether to cancel an overdue booking.
- Handle cancellations on or after arrival day, and any booking not in a paid state, by phone.

## For developers

- `lib/paymentPlan.ts`: refund tiers, deposit rule and reminder window, as pure functions shared by pages and server.
- `server/booking/cancellation.ts`: the quote and the cancel loop (Apaleo cancel, folio refunds, status flip, activity release, drift check).
- `server/apaleo/payments.ts`: posts payments and refunds onto Apaleo folios. No Pesapal refund call exists anywhere.
- `app/api/booking/[bookingId]/cancel/route.ts`: quote (GET) and execute (POST), owner-only access.
- `server/email/bookingCancellation.ts`: the guest and invitee cancellation emails.
- `server/booking/reminders.ts` and `server/email/balanceReminder.ts`: which bookings are owed a reminder, and the once-only send.
- `app/api/ops/reminders/run/route.ts`: the reminder trigger, admin session or bearer secret.
- `server/ops/alerts.ts` and `app/(site)/ops/alerts/page.tsx`: alert writing and the ops page.
- `docs/deposit-and-cancellation-plan.md`: the original spec, partly superseded by the code.
