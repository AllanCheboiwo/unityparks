# How the systems fit together

## In one paragraph

The Unity Parks site is our own app, hosted on Railway with its own Postgres database. It leans on six outside services. Apaleo is the property management system and owns lodges, availability, prices, reservations and the folios where money is recorded. Pesapal collects money from guests. Zoho Books receives a copy of each confirmed payment for accounting. Payload CMS holds the marketing content. Resend sends our emails. Railway runs the whole thing. Our app owns everything in between: guest accounts, checkout sessions, referrals, extras orders, reminders, activity inventory and the ops pages. Every outside connection is to a sandbox or test account today, not a live one.

## Each system and what it owns

**Apaleo.** The property management system. Our sandbox property is called UPNV. Apaleo owns the four lodge types and their units, availability, nightly rates and the extra services. Every booking is a reservation in Apaleo, and every reservation has a folio, which is the running bill. When a guest pays, we record the payment on that folio. When a cancellation earns a refund, we record the refund there too. Our app never keeps its own copy of what is owed. It reads the folio and trusts it. The property is set up and changed by scripts that a developer runs by hand.

**Pesapal.** The payment collector. A guest paying by card or M-Pesa is sent to Pesapal's hosted payment page, then sent back to us. Coming back proves nothing, so we ask Pesapal what happened, and only that answer decides whether the payment goes on the folio. Pesapal also sends a server-to-server notice (the IPN) for guests who pay and close the browser before returning. We are on the Pesapal sandbox. There is no refund call to Pesapal anywhere in the app. A cancellation refund is recorded on the folio, but returning the money to the guest's card or phone is a manual step outside the app. Locally, a simulated provider can stand in for Pesapal.

**Zoho Books.** The accounting ledger. Each confirmed Pesapal payment queues one outbox row in our database. A pusher reads the folio fresh from Apaleo, creates or updates a Zoho invoice for the booking, and records the payment against it. It runs straight after each payment. A failed push is retried on later pushes, up to five attempts, then marked failed with an ops alert. The Zoho exports ops page has a button that retries everything. Simulated payments are never exported. Cancellations and refunds are not yet sent to Zoho.

**Payload CMS.** The content editor at /admin, with its own admin login separate from guest accounts. It owns the homepage sections, activities, seasons, FAQs, campaigns, extras descriptions and site settings. It shares the app's Postgres database but keeps its tables in a separate schema. Media goes to Cloudflare R2 in production. A seed script loads the starting content; a developer runs it by hand on a fresh database.

**Email.** Resend sends every transactional email from one sending address. The emails that exist: welcome, password reset, booking confirmation, balance receipt, balance reminder (due soon and overdue), extras receipt, booking cancellation, party invite, referral reward, repeat-guest offer, and ops alerts to a configured ops address. With no Resend key set, emails are logged and never sent.

**Railway and Postgres.** Railway hosts the app and the database and auto-deploys whenever a change is merged to the main branch on GitHub. Database changes are pushed by hand: Allan applies them locally first, then to the Railway database, then merges. Apaleo provisioning, CMS seeding, referral config and activity inventory seeding are all manual scripts.

**The ops pages.** Internal pages under /ops, each reached by typing its URL. There is no menu link. They open only for a guest account a developer has flagged as admin; anyone else sees a not-found page.

- /ops/alerts: problems the app noticed, mostly about money, with a resolve button that records that someone looked.
- /ops/zoho: the Zoho export queue and the retry button.
- /ops/reminders: open balances and a button to send balance reminders.
- /ops/repeat-offers: who is eligible for the repeat-guest offer, and a button to send the emails.
- /ops/referrals and /ops/referrals/payouts: participants, credit, releasing stuck credit, and the monthly payout list with a CSV and a mark-paid action.
- /ops/memories: the memories counter, internal only.
- /ops/inventory: activity capacity, adjustments, sweep and reconcile. Merged 8 Sep 2026; live once Railway deploys and the inventory seed is run.

**The run endpoints.** Three ops jobs can also be triggered by an outside scheduler presenting a secret: balance reminders, repeat offers, and the inventory sweep and reconcile. Each has its own secret. The Zoho retry is admin-only with no secret. No scheduler exists today, so these run only when someone presses the button.

## The rules

- Apaleo owns inventory, prices and money movement. Our app owns commercial policy: deposits, cancellation tiers, referral credit, promo codes.
- Never invent an amount a folio could tell us. Totals are read from Apaleo at the moment they matter.
- Every write to Apaleo carries a key that stops a retry creating a duplicate.
- Pesapal's redirect is not proof of payment. Only our own status check is.
- Every push to Zoho is safe to repeat. Done rows are kept as the guard against recording a payment twice.
- Nothing typed into Zoho or the CMS ever flows back into bookings.

## What can go wrong, and what happens

- Pesapal says pending or failed. The guest is sent back with a message and can try again. Nothing goes on the folio.
- Pesapal says paid but the amount or currency does not match. The booking is wedged and an ops alert is raised.
- A Zoho push fails. It is retried on the next payment anywhere in the system. After five failures it shows as failed on /ops/zoho and an alert email goes out.
- Resend is down or unconfigured. The booking still completes. The email is logged, not sent.
- Apaleo is briefly unavailable. Requests are retried once. A longer outage means checkout fails for the guest.

## What a person does

- Allan merges to main, which deploys. He pushes database changes to Railway by hand first.
- A developer runs the Apaleo scripts when the property model changes, and the seeds on any fresh database.
- Someone edits marketing content at /admin.
- An admin checks /ops/alerts, retries Zoho exports, sends reminders and repeat offers, and marks referral payouts paid after transferring the money by hand.
- Refunds to guests are sent by hand; the folio already shows the refund.

## For developers

- README.md and CLAUDE.md: stack, environment variables and house rules.
- server/apaleo/client.ts: the only file that talks to Apaleo; payments.ts posts payments, allowances and refunds.
- server/pesapal/orders.ts: create orders and read status; app/api/payments/pesapal/callback and ipn: the two ways back.
- server/booking/provider.ts: the simulated versus Pesapal switch.
- server/zoho/export.ts and wire.ts: outbox, pusher and production wiring; lib/zohoMap.ts: folio to invoice mapping.
- server/email/resend.ts: the Resend client; sibling files are the individual emails.
- payload.config.ts, cms/, server/content.ts: CMS config and the only door to its content.
- app/(site)/ops/ and app/api/ops/: ops pages and routes; scripts/make-admin.mjs: the admin flag.
- scripts/apaleo/provision.ts, scripts/seed-cms.ts, scripts/register-pesapal-ipn.mjs, scripts/setup-zoho.mjs: one-time setup.

```text
Guest
  |  searches, books, pays, manages the booking
  v
Our app (Railway + Postgres)
  |-- reads lodges, rates, availability; creates reservations;
  |   records payments and refunds on folios ----------> Apaleo (UPNV)
  |-- sends the guest to the hosted payment page,
  |   then asks what happened (callback and IPN) ------> Pesapal
  |-- queues each confirmed payment as an invoice
  |   and payment (retried, ops button) ---------------> Zoho Books
  |-- reads homepage, campaigns, settings <------------- Payload CMS (/admin)
  |-- sends confirmations, receipts, reminders,
  |   invites, offers, ops alerts ---------------------> Resend (email)
  '-- ops pages and run endpoints, admin flag or secret
```
