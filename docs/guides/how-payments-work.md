# How payments work

## In one paragraph

A guest reaches the pay page and, if arrival is far enough away, chooses a 30% deposit or full payment. On Buy now, the site creates the booking in Apaleo (our property management system), then sends the guest to Pesapal's hosted page to pay by card or M-Pesa. When they return, we ask Pesapal whether the money arrived, and only then record it on each lodge's Apaleo folio, the source of truth for what is owed. Any balance is paid later from Manage my booking, in one go or in parts; once the folios show nothing owed the booking is fully paid.

## Step by step

1. The pay page counts the days until arrival. At 57 days or more, the guest sees the deposit option (30% of the total, whole shillings) next to full payment. At 56 days or fewer, full payment only. It also shows the balance due date, 56 days before arrival.
2. Buy now creates one booking in Apaleo with one reservation per lodge, applies any discount, and reads each folio to learn the real total. It then saves our own booking record, in the status "created", with that total, the deposit amount and the due date. Money moves only after this, so a crash cannot leave a paid booking recorded at zero.
3. The site creates a payment attempt for the chosen amount. Only one live attempt can exist per booking, so two tabs pressing Buy now cannot produce two payable orders. The attempt becomes a Pesapal order and the browser goes to Pesapal's hosted page (today the sandbox: test card and M-Pesa payments only).
4. Pesapal sends the browser back to our callback address, and separately its server sends us an instant payment notification (IPN) for the same order. Both simply ask Pesapal what happened. The redirect proves nothing; only our own status check counts.
5. If Pesapal says the order completed, and the amount and currency match what we asked for, the attempt is marked collected. A failed or reversed order marks it failed and returns the guest to the pay page to try again. An unpaid order stays pending, and the guest is offered the same payment page.
6. The collected amount is split across the lodges in proportion to what each still owes and posted on each folio. The site then reads the folio balances back and derives the paid amount from them. Nothing owed means status "paid"; something still owed means "deposit_paid".
7. A first payment then triggers the confirmation email and party invites; a balance payment triggers a receipt email. A referral reward is granted once fully paid. A line is queued in the Zoho export outbox and pushed on a best-effort basis (see the Zoho guide).
8. From Manage my booking, a deposit-paid guest can pay the whole outstanding amount or a custom part of it, through the same attempt, check and record steps.

## The rules

- Deposit: 30% of the total, offered only at 57 or more days before arrival.
- Balance due: 56 days before arrival, stamped on every booking; the cancellation policy uses the same date.
- Part payments: at least 500 shillings, and each must either clear the balance exactly or leave at least 500 shillings to pay, so no remainder is ever too small to pay off.
- Every payment is started by the guest; nothing is charged automatically and no card details are stored.
- Statuses: "created" (nothing collected), "deposit_paid" (something paid, something owed), "paid" (folios show nothing owed).
- The folio is the truth: our record mirrors it after each payment and is never simply added to.
- Overdue is not a status; the account page derives it from the due date. Reminder emails go out only when run from the ops page or by an external scheduler.
- Idempotency, in plain terms: every attempt has its own identity, every folio post is tagged with that identity plus the lodge, and Apaleo refuses a second post with the same tag. The site also reads the folio first and skips any share already there. So retries, double clicks, and a callback racing an IPN all end in one recorded payment.
- The memories counter counts only bookings in status "paid"; deposit-paid ones do not count.
- Demo mode: without Pesapal credentials, a simulated provider is used. The attempt is created as already collected, no hosted page appears, and the folio post happens in the same click. Simulated payments never reach Zoho.

## What can go wrong, and what happens

- The guest closes the browser on Pesapal's page. The IPN still records the payment; if it never arrives, the payment sweep (every 30 minutes) asks Pesapal and records it, and pressing Buy now or Pay balance again does the same sooner.
- A crash between money collected and folio recorded. The attempt stays marked collected, and the next sweep, Buy now, callback or IPN finishes the recording without collecting again.
- A crash before Pesapal's reference was stored. Nothing on our side can find that order. The sweep retires the attempt and raises a `payment_unlinked` alert carrying the merchant reference.
- Pesapal reports a different amount to what we asked. The attempt is marked mismatch, the booking refuses new payments, and the guest is told to contact us.
- Money arrives for a booking already paid or cancelled, or on a stale payment page. It is marked excess and logged; nothing reaches the folios and a human must refund it. A chargeback after full payment is marked reversed; one on a deposit is not detected today.
- A folio changed behind our back. Recording stops, an ops alert is raised, and the guest is told to contact us and not pay again.
- Lost emails. Each confirmation or receipt is sent once and a failed send is retried, but a crash between recording the payment and sending drops that email and nobody is told. There is no resend button.
- The Zoho push fails. The outbox row stays open and the ops drain retries it later.

## What a person does

- Watch the ops alerts and logs for mismatch, excess, reversed and folio drift. None fix themselves.
- Refund excess money by hand.
- On a `payment_unlinked` alert, search Pesapal's merchant dashboard for the reference in the alert. If the guest paid, record it by hand and refund or contact them as the booking state requires.
- Balance reminders, repeat offers, the Zoho drain and the inventory runs happen daily on their own; the ops buttons remain for running one early.
- Decide whether to cancel an overdue booking. Nothing auto-cancels.
- Handle a dropped confirmation or receipt by hand.

## For developers

- lib/paymentPlan.ts: deposit, due date, part payment and refund arithmetic.
- server/booking/checkout.ts and provider.ts: Buy now, payment attempts, confirmation, folio settle, provider switch.
- server/pesapal/*.ts: Pesapal client, orders, status mapping.
- server/apaleo/payments.ts: folio payments, allowances, refunds.
- app/api/payments/pesapal/callback and ipn routes: how Pesapal tells us to check.
- app/api/booking/[bookingId]/pay/route.ts: balance payments.
- app/(site)/checkout/pay/PayClient.tsx and app/(site)/account/page.tsx: guest-facing pages.
- server/email/bookingConfirmation.ts and balanceReceipt.ts: once-only emails.
- server/zoho/wire.ts: export outbox hook. server/memories.ts: counter filter.
- prisma/schema.prisma: booking record and payment attempt shapes.
- docs/deposit-and-cancellation-plan.md: policy and known limitations.
