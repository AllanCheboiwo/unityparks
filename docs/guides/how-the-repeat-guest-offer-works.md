# How the repeat-guest offer works (and why there are no promo codes)

## In one paragraph

Unity Parks has no typed promotional codes. There is no box at checkout for a campaign code and no list of codes in the system. The only code a guest can type is a referral code, which is for first-time guests only. What the site does have is a repeat-guest offer. Anyone who was a verified member of a fully paid stay gets KSh 5,000 off each lodge of a new booking, up to three lodges, if they book within 31 days of leaving. The offer is not a code. It lives on the guest's account: they sign in, and the discount is waiting at the pay step for one click.

## Step by step

1. A party finishes a stay that is fully paid and not cancelled. From the day after departure the offer exists. Nothing is issued to create it.
2. It is held by the account that made the booking, plus anyone who accepted an invitation to that stay, provided the invitation was sent before departure and not withdrawn. Someone invited after departure gets nothing.
3. The booking confirmation email already mentions the offer and the invite-before-departure rule.
4. After departure, a reminder email can go to the lead guest, once per stay, only if they ticked the marketing email box at checkout. It gives the amount and the last day to book.
5. That email is not automatic. It goes out when an admin presses "Send offer emails now" on the repeat-offers ops page, or when an outside scheduler calls the same run with a secret key. No scheduler is set up today.
6. A returning guest books as normal. At the pay step, if signed in with a live offer, a card names the amount and deadline with an Apply button. The account page shows the same card. Nobody else sees anything.
7. Apply stamps the offer onto the booking in progress. The guest can remove it before paying.
8. On Buy now, the system re-checks everything: signed in, still a member, stay still paid, window open, amount unchanged. If all holds it records a pending claim, then places the discount on the bill in Apaleo as an allowance on each lodge's folio, split in proportion to each lodge's cost. The bill is re-read, so the total, the 30 per cent deposit and any later refund all see the discounted figure.
9. When the booking record is created the claim becomes confirmed.
10. If a checkout dies before that, the claim stays pending. The next ops run sweeps pending claims older than 24 hours and marks them released. Younger ones are left so a retry can pick up the same claim.

## The rules

| Setting | Value |
| --- | --- |
| Discount per lodge of the new booking | KSh 5,000 |
| Maximum lodges that earn it | 3 (KSh 15,000 at most) |
| Booking window | 31 days after departure, from the day after |
| Uses per earning stay | Unlimited, one per new booking |
| Reminder email per stay | Once, lead guest, marketing consent needed |
| Minimum left to pay after all discounts | KSh 500 |
| Stale pending claim sweep | Older than 24 hours |

- The offer and a referral code cannot ride the same booking. Whichever is applied first blocks the other, with a message saying which to remove. The clash is rare, since referral codes refuse returning guests.
- Referral credit, which is money already earned, can sit alongside the offer. Together they may never take the amount to collect below KSh 500; the offer shrinks to protect that floor. There is no other minimum spend.
- The window is about when the new booking is made, not when the new stay happens.
- Cancelling a discounted booking gives nothing back. The earning stay's window keeps running for the rest of the party.
- Marketing consent affects only the email, never the offer itself.
- The offer cannot be added to a booking that already exists.

## What can go wrong, and what happens

- The window closes, the stay is cancelled, or the invitation is withdrawn mid-checkout. The claim is refused, the discount is removed, and the guest is asked to review the new total and press Buy now again. Full price is never charged silently.
- The basket changes so the discount differs from the amount shown. Same refusal, in either direction. The guest can re-apply.
- Someone else signs in on the same booking. The offer is cleared and a claim by another account is refused.
- A checkout crashes after the discount reached Apaleo. A retry adopts the pending claim, and Apaleo ignores duplicate postings for 24 hours, so the bill is not discounted twice.
- The reminder email fails to send. The stay is still marked as notified, deliberately, because a double marketing email is worse than a missed one. There is no re-send button.
- A party member who stayed but was never invited has no offer and there is no override.

## What a person does

- Guests: sign in, book, press Apply at the pay step.
- Lead guests: invite party members on the guest details page before departure so they share the offer.
- Admin: open the repeat-offers ops page and press "Send offer emails now". Pressing it twice is harmless. Setting up a real scheduler is still undone.
- Changing the amount, cap or window needs a developer; they are fixed in code.

## For developers

- lib/repeatOffer.ts: constants, window and cap maths.
- server/repeatOffer/eligibility.ts and derive.ts: membership rules and their database reads.
- server/repeatOffer/claim.ts: the claim decision and the sweep rule.
- server/repeatOffer/checkout.ts: decide, post allowances, confirm, refusal messages.
- server/booking/instrument.ts: the shared discount-instrument seam.
- server/booking/checkout.ts: where both instruments are wired in.
- app/api/session/[id]/repeat-offer/route.ts: pay-step apply and remove.
- server/repeatOffer/ops.ts and server/email/repeatOffer.ts: reminder run and template.
- app/api/ops/repeat-offers/run/route.ts and app/(site)/ops/repeat-offers/: admin trigger and read-out.
- prisma/schema.prisma: the redemption model and stamps.
- docs/promo-codes-plan.md: the spec; its acceptance steps were never run live.
