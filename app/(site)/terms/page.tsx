import type { Metadata } from "next";
import Link from "next/link";

/**
 * The booking terms and the safety information, on one page: the checkout's
 * terms checkbox links here (and to #safety). Policy numbers mirror
 * docs/deposit-and-cancellation-plan.md, the source of truth; change them
 * there first.
 */

export const metadata: Metadata = {
  title: "Unity Parks | Booking terms",
  description:
    "The booking terms and conditions for a Unity Parks break, and the safety information for your stay in the village.",
};

const CANCELLATION_TIERS = [
  { when: "57 days or more", refund: "Everything you have paid, except your deposit" },
  { when: "42 to 56 days", refund: "Half of what you have paid beyond your deposit" },
  { when: "21 to 41 days", refund: "A quarter of what you have paid beyond your deposit" },
  { when: "1 to 20 days", refund: "No refund" },
  { when: "Arrival day onwards", refund: "Not cancellable online, call the team" },
] as const;

const SAFETY = [
  {
    title: "In the Water Garden",
    body: "Children must be supervised by an adult in and around the water at all times, however well they swim. Lifeguards watch the pools, but they are not a substitute for you. Please walk on the poolside, and keep glass out of the whole building.",
  },
  {
    title: "Fire pits and BBQs",
    body: "Fires belong in your lodge's fire pit and nowhere else, with firewood from the Market. Never leave a fire or BBQ burning unattended, keep children and anything flammable well back, and make sure everything is fully out before you turn in.",
  },
  {
    title: "On your bikes",
    body: "Helmets come free with every bike from The Barn, in every size, and we ask that children always wear one. The lanes are shared with people on foot, so ride at a village pace, and use lights after dark. It gets properly dark here.",
  },
  {
    title: "Wildlife and the forest edge",
    body: "The monkeys are wonderful and they are thieves. Please never feed them, keep food indoors and doors closed when you are out, and put rubbish in the closed bins. The fence along the forest reserve is there for a reason: enjoy the wild from our side of it, and keep to the marked trails.",
  },
  {
    title: "Driving after dark",
    body: "Cars are for arriving and leaving only. If you arrive after dark, drive the lanes at walking pace with dipped headlights: they are unlit, and children, walkers and the occasional bushbuck use them at all hours.",
  },
] as const;

export default function TermsPage() {
  return (
    <div>
      <section className="bg-mist">
        <div className="mx-auto max-w-6xl px-5 py-10">
          <h1 className="font-display text-4xl font-bold text-ink">
            Booking terms and conditions
          </h1>
          <p className="mt-2 max-w-2xl text-foreground/80">
            The short version of how booking with us works, in plain language.
            The <a href="#safety" className="underline">safety information</a>{" "}
            for your break is further down this page.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-10">
        <div className="max-w-3xl space-y-8">
          <div>
            <h2 className="font-display text-2xl font-bold text-ink">
              The lead booker
            </h2>
            <p className="mt-2 text-foreground">
              Every booking has a lead booker, who must be 18 or over on the
              day the break starts. The lead booker is responsible for the
              whole party and is our point of contact for everything about the
              booking.
            </p>
          </div>

          <div>
            <h2 className="font-display text-2xl font-bold text-ink">
              Paying for your break
            </h2>
            <p className="mt-2 text-foreground">
              Book 57 days or more before arrival and you choose at checkout:
              pay a 30% deposit, or pay in full. Book 56 days or fewer before
              arrival and the full amount is due at checkout.
            </p>
            <p className="mt-3 text-foreground">
              If you pay a deposit, the balance is due 8 weeks (56 days)
              before arrival. You can pay toward it any time from Manage my
              booking, all at once or in parts: part payments start at KES
              500, and a payment must either clear the balance or leave at
              least KES 500 to pay later. We never store your card and we
              never charge you automatically. Every payment is one you choose
              to make.
            </p>
          </div>

          <div>
            <h2 className="font-display text-2xl font-bold text-ink">
              If you need to cancel
            </h2>
            <p className="mt-2 text-foreground">
              Your deposit, 30% of the booking total, is never refundable,
              including when you paid in full upfront. What we refund of the
              rest depends on how far from arrival you cancel:
            </p>
            <div className="mt-4 overflow-x-auto rounded-lg border border-line">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-mist text-left">
                    <th className="px-4 py-3 font-semibold text-ink">
                      Days to arrival when you cancel
                    </th>
                    <th className="px-4 py-3 font-semibold text-ink">
                      What we refund
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {CANCELLATION_TIERS.map((tier) => (
                    <tr key={tier.when} className="border-t border-line">
                      <td className="px-4 py-3 font-semibold text-foreground">
                        {tier.when}
                      </td>
                      <td className="px-4 py-3 text-foreground">{tier.refund}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-sm text-foreground/70">
              In other words: cancel more than 8 weeks before arrival and we
              refund everything except your deposit. 6 to 8 weeks before, half
              of the balance you have paid. 3 to 6 weeks, a quarter. Less than
              3 weeks, no refund.
            </p>
          </div>

          <div>
            <h2 className="font-display text-2xl font-bold text-ink">
              Your party and your lodge
            </h2>
            <p className="mt-2 text-foreground">
              Every lodge has a maximum occupancy, shown when you book, and
              your whole party has to fit inside it. The largest lodge sleeps
              6, plus up to 2 infants in cots. We ask for your party's ages at
              booking so the lodge is ready for exactly who arrives.
            </p>
          </div>

          <div>
            <h2 className="font-display text-2xl font-bold text-ink">
              When breaks start
            </h2>
            <p className="mt-2 text-foreground">
              Breaks start on a Friday or a Monday: a weekend, a midweek, or a
              full week from either day. Check-in and check-out times are in
              your booking confirmation.
            </p>
          </div>

          <div id="repeat-guest-offer" className="scroll-mt-6">
            <h2 className="font-display text-2xl font-bold text-ink">
              Repeat Guest offer
            </h2>
            <p className="mt-2 text-foreground">
              Book a new break within 31 days of departing your last break and
              save KSh 5,000 per lodge, up to a maximum of three lodges. The
              offer is available to the account that made the previous booking
              and to any party member who accepted an invitation to that break
              before its departure date. Sign in when booking and the offer is
              applied at the point of booking. It cannot be added to an
              existing booking and cannot be used in conjunction with any
              other offer.
            </p>
          </div>

          <div>
            <h2 className="font-display text-2xl font-bold text-ink">
              A demo, honestly
            </h2>
            <p className="mt-2 text-foreground">
              Unity Parks is a demonstration environment. No real payments are
              taken anywhere on this site, and a booking here does not reserve
              a real lodge. It is the real booking experience with no money in
              it.
            </p>
          </div>
        </div>
      </section>

      <section id="safety" className="scroll-mt-6 bg-mist">
        <div className="mx-auto max-w-6xl px-5 py-10">
          <h2 className="font-display text-3xl font-bold text-ink">
            Safety information
          </h2>
          <p className="mt-2 max-w-2xl text-foreground/80">
            The village is a safe place because everyone treats it like their
            own. Here is what we ask of every party.
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {SAFETY.map((item) => (
              <div key={item.title} className="rounded-lg border border-line bg-white p-5">
                <p className="font-display text-lg font-bold text-olive">{item.title}</p>
                <p className="mt-1.5 text-sm text-foreground">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-10">
        <p className="text-foreground">
          Questions about any of this? Start with{" "}
          <Link href="/village" className="font-semibold text-navy underline underline-offset-2">
            the village
          </Link>{" "}
          page, or ask the team when you book.
        </p>
      </section>
    </div>
  );
}
