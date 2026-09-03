import "server-only";
import { formatKes } from "@/lib/format";

/**
 * The post-stay repeat-guest offer email (UNP-7, docs/promo-codes-plan.md).
 *
 * The facts type carries no booking reference; the account is the claim,
 * so the email says sign in. The sender claims the offerEmailSentAt stamp
 * before composing, and the stamp STAYS on failure: this is a marketing
 * email, a double send is worse than a missed one, and the ops overview
 * lists stamped-but-possibly-unsent records for a manual decision. That is
 * deliberately NOT the partyInvite release-on-failure pattern.
 */

/** House pattern (see partyInvite.ts): anything user-typed that reaches
 * HTML gets escaped, even when today's only recipient is the typist. */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export type RepeatOfferFacts = {
  firstName: string | null;
  perLodgeAmount: number; // KES
  maxLodges: number;
  deadline: string; // ISO YYYY-MM-DD, last day to book
  accountUrl: string;
};

/** "Friday, 2 October 2026" */
function longDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function composeRepeatOffer(facts: RepeatOfferFacts): {
  subject: string;
  html: string;
  text: string;
} {
  const amount = formatKes(facts.perLodgeAmount);
  const subject = `${amount} per lodge off your next Unity Parks break`;
  const greeting = facts.firstName ? `Hello ${facts.firstName},` : "Hello,";
  const greetingHtml = facts.firstName ? `Hello ${escapeHtml(facts.firstName)},` : "Hello,";
  const deadline = longDate(facts.deadline);

  const text = [
    greeting,
    ``,
    `Thank you for staying with us. As a returning guest you have ${amount} off per lodge on your next break, up to ${facts.maxLodges} lodges.`,
    ``,
    `Book by ${deadline}: just sign in and the offer is applied at the pay step.`,
    facts.accountUrl,
    ``,
    `The offer is also available to party members who accepted their invitation to your last break.`,
  ].join("\n");

  const html = [
    `<p>${greetingHtml}</p>`,
    `<p>Thank you for staying with us. As a returning guest you have <strong>${amount} off per lodge</strong> on your next break, up to ${facts.maxLodges} lodges.</p>`,
    `<p>Book by <strong>${deadline}</strong>: just sign in and the offer is applied at the pay step.</p>`,
    `<p><a href="${facts.accountUrl}">${facts.accountUrl}</a></p>`,
    `<p>The offer is also available to party members who accepted their invitation to your last break.</p>`,
  ].join("\n");

  return { subject, html, text };
}

export type PendingOfferNotice = {
  recordId: string;
  email: string;
  facts: RepeatOfferFacts;
};

/** Storage the sender drives. The real adapter selects notifiable records
 * (server/repeatOffer/notify.ts) and claims offerEmailSentAt with an
 * atomic conditional update; the fake in the frozen suite mirrors those
 * semantics. Deliberately no release(): the stamp stays on failure, and a
 * release hook would invite someone to wire the double-send path back in. */
export type RepeatOfferStore = {
  loadPending(): Promise<PendingOfferNotice[]>;
  claim(recordId: string): Promise<boolean>;
};

export async function sendRepeatOfferNotices(
  store: RepeatOfferStore,
  send: (args: {
    to: string;
    subject: string;
    html: string;
    text: string;
  }) => Promise<{ sent: boolean }>,
): Promise<void> {
  let pending: PendingOfferNotice[];
  try {
    pending = await store.loadPending();
  } catch (err) {
    console.error("[email] repeat offers: load failed", err);
    return;
  }
  for (const notice of pending) {
    try {
      // Claim first: exactly one racer composes and sends. The stamp stays
      // whatever happens next; the ops overview owns failed sends.
      if (!(await store.claim(notice.recordId))) continue;
      const mail = composeRepeatOffer(notice.facts);
      const result = await send({ to: notice.email, ...mail });
      if (!result.sent) {
        console.error(`[email] repeat offer ${notice.recordId}: send refused, stamp kept`);
      }
    } catch (err) {
      console.error(`[email] repeat offer ${notice.recordId} failed, stamp kept`, err);
    }
  }
}
