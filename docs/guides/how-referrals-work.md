# How referrals work

## In one paragraph

A referrer gives a friend a code. The friend books their first Unity Parks break with it and gets a fixed amount off the bill. Once the friend has paid in full and their stay has ended, the referrer earns a reward: resort credit for an ordinary guest, or cash commission for an influencer. Credit is spent on the referrer's next booking. Commission is paid by hand each month from a CSV. Every earn, spend, payout and release is a signed line in a ledger, and every balance is added up from those lines when someone looks. Nothing stores a running total.

## Step by step

1. A signed-in guest presses "Get my referral code" on their account page and receives a permanent six-character code (no confusable letters like O and 0) plus a share link. Influencers do not sign up online; an admin adds them on the ops page with a vanity code such as AMINA after vetting.
2. The referrer shares the code or link. Opening the link stores the code in a browser cookie for 30 days and lands on the homepage; starting a search copies it onto the booking. The code can also be typed at the details step or pay page.
3. The code is checked when typed, and again at checkout. It must exist, not be revoked, not belong to the person staying, and the lead guest must be a first-time guest. Only the checkout check is binding.
4. When the friend presses Buy now, the discount is posted to the Apaleo bill as an allowance, a negative line, before the booking's totals are frozen. Deposit, card payment, balance and refunds then simply see a smaller bill. With more than one lodge, the discount is split in proportion to cost.
5. A record of the referral is saved with the booking, with the discount, reward and rates frozen at that moment. Later programme changes never rewrite old bookings.
6. When the booking becomes fully paid, the reward line is written to the ledger and a "your code just worked" email goes out once, saying the reward is expected from the friend's departure date. A failed email is logged and retried on the next payment event; it never blocks a payment.
7. Once that date has passed, with the booking still paid and not cancelled, the reward vests: credit becomes spendable, commission payable. There is no nightly job; vesting is worked out on the spot whenever a balance is shown.
8. On the referrer's next booking, while signed in, the pay page offers their vested credit. Ticking it writes a spend line; at checkout that amount is posted as a second allowance. Unticking before checkout releases the spend.
9. For influencers, an admin exports the CSV, moves the money by hand (M-Pesa or bank), then marks the batch paid, which writes one negative payout line per influencer.

## The rules

These numbers are seeded into the programme configuration, a dated list: to change one, a developer adds a new dated row and never edits an old one. A fresh database needs the seed run, or every code is refused as "programme not running".

| Setting | Since 4 Aug 2026 | Since 25 Aug 2026 |
| --- | --- | --- |
| Guest discount | KSh 5,000 | KSh 5,000 |
| Client credit per referral | KSh 5,000 | KSh 5,000 |
| Influencer commission | 4% of lodging after discount | 5% of lodging after discount, ex 16% VAT |
| Credit expiry | 365 days from the friend's departure | 365 days from the friend's departure |

Rules that live in code, not configuration:

- One commission rate for every influencer; a per-person rate exists in the data but nothing reads it.
- Commission never expires. Credit does.
- Discount, credit and any repeat-guest offer together must leave at least KSh 500 to collect, or checkout refuses and asks the guest to review and try again.
- A referrer booking for someone else while signed in is a gift: the friend gets the discount, the referrer earns nothing.
- Cancellation kills the reward. Credit spent on a cancelled booking simply stops counting; that is the refund.
- Velocity: a code reaching 10 referred bookings in 30 days is flagged on the ops page, logged, and emailed to the ops address if one is set. Nothing freezes automatically; a human decides.
- The public code checker is rate-limited: 10 tries a minute, a ten-minute cooldown after 15 wrong codes.

## What can go wrong, and what happens

- A friend's booking is created but never paid. Credit spent on it is locked, because that booking can be resumed at any time. Only an admin can release it, and doing so cancels the dead booking in the same action.
- The friend cancels after the reward email was sent. The email said "expected"; the reward is voided and the account page shows "Their booking was cancelled".
- The referrer's balance changes between the pay page and checkout. Checkout refuses rather than quietly applying less.
- Two tabs check out the same booking. The ledger allows one spend per booking, so the loser adopts the winner's claim or is refused.
- Self-referral with a second email address is not detected; only email and phone are compared. An accepted limit.
- The KRA PIN column in the payout CSV is always blank; onboarding never collects it. The accountant fills it in and handles withholding tax.

## What a person does

- Guest: sign in, claim a code, share the link. Watch "Credit to spend" and "On the way" on the account page.
- Referred friend: open the link or type the code, book, pay.
- Influencer: nothing online. They get the reward email, then money.
- Admin, at /ops/referrals: see every participant, referral counts, the 30-day velocity badge and what is owed. Onboard an influencer, revoke or reinstate anyone, release locked credit.
- Admin, at /ops/referrals/payouts: export the CSV, pay by hand, mark the batch paid under a name that can only be used once.
- Signed out: sent to login. Signed in but not an admin: a 404 page, deliberately, so the ops area stays quiet.

## For developers

- lib/referral.ts: pure rules (code format, split, credit cap, commission maths, vesting).
- server/referral/validate.ts: the code check shared by hint and checkout.
- server/referral/checkout.ts: posts allowances, commits the credit claim.
- server/referral/claim.ts: spend claim lifecycle.
- server/referral/derive.ts: balances and history summed from the ledger.
- server/referral/ops.ts: admin actions, velocity constants, payout batch.
- server/booking/checkout.ts, server/booking/cancellation.ts: earn on full payment, void on cancel.
- server/email/referralReward.ts: the once-only reward email.
- app/r/[code]/route.ts, app/api/referral/, app/api/ops/referrals/, app/api/session/[id]/credit/route.ts: link, cookie and HTTP surfaces.
- app/(site)/ops/referrals/, app/(site)/account/ReferralCard.tsx: the pages.
- scripts/seed-referral-config.ts, prisma/schema.prisma: configured numbers, data shape.
- docs/referral-system-plan.md: intent; code wins where they differ.
