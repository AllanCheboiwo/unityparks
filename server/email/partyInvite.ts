import "server-only";

/**
 * The party-invite email (UNP-20, docs/invite-a-guest-plan.md).
 *
 * The composer's facts type carries no money field at all; that is the
 * mechanism that keeps amounts out of the email, not copy discipline. The
 * sender follows the codebase's once-only pattern: claim before composing,
 * release on failure, so the settle path can call it as often as it likes
 * and each invite is mailed exactly once. Failures are swallowed here like
 * every other email module; mail must never disturb a booking.
 */

export type PartyInviteFacts = {
  leadFirstName: string | null;
  leadLastName: string | null;
  village: string;
  arrival: string; // ISO YYYY-MM-DD
  departure: string; // ISO YYYY-MM-DD
  lodgeName: string;
  inviteUrl: string;
};

/** These emails carry one user's free text (names typed at checkout) to a
 * DIFFERENT person, so everything interpolated into the HTML is escaped.
 * The plain-text body needs nothing: mail clients render it inert. */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** "Monday, 30 November 2026" */
function longDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function composePartyInvite(facts: PartyInviteFacts): {
  subject: string;
  html: string;
  text: string;
} {
  const leadName = [facts.leadFirstName, facts.leadLastName]
    .filter(Boolean)
    .join(" ") || "The lead guest";
  const subject = `${leadName} has added you to a Unity Parks break`;
  const when = `${longDate(facts.arrival)} to ${longDate(facts.departure)}`;

  const text = [
    `${leadName} has added you to their party for a break at Unity Parks ${facts.village}.`,
    ``,
    `${facts.lodgeName}, ${when}.`,
    ``,
    `Create an account or sign in with this email address to see the booking:`,
    facts.inviteUrl,
    ``,
    `If you were not expecting this, you can ignore this email.`,
  ].join("\n");

  const html = [
    `<p>${escapeHtml(leadName)} has added you to their party for a break at Unity Parks ${escapeHtml(facts.village)}.</p>`,
    `<p><strong>${escapeHtml(facts.lodgeName)}</strong><br>${when}</p>`,
    `<p>Create an account or sign in with this email address to see the booking:</p>`,
    `<p><a href="${facts.inviteUrl}">${facts.inviteUrl}</a></p>`,
    `<p>If you were not expecting this, you can ignore this email.</p>`,
  ].join("\n");

  return { subject, html, text };
}

export type PendingPartyInvite = {
  inviteId: string;
  email: string;
  facts: PartyInviteFacts;
};

/** Storage the sender drives. The real adapter reads live, unsent invites
 * and claims sentAt with an atomic conditional update; the fake in the
 * frozen suite mirrors those semantics. */
export type PartyInviteStore = {
  loadPending(): Promise<PendingPartyInvite[]>;
  claim(inviteId: string): Promise<boolean>;
  release(inviteId: string): Promise<void>;
};

export async function sendPartyInvites(
  store: PartyInviteStore,
  send: (args: {
    to: string;
    subject: string;
    html: string;
    text: string;
  }) => Promise<{ sent: boolean }>,
): Promise<void> {
  let pending: PendingPartyInvite[];
  try {
    pending = await store.loadPending();
  } catch (err) {
    console.error("[email] party invites: load failed", err);
    return;
  }
  for (const invite of pending) {
    try {
      // Claim first: exactly one racer composes and sends.
      if (!(await store.claim(invite.inviteId))) continue;
      const mail = composePartyInvite(invite.facts);
      const result = await send({ to: invite.email, ...mail });
      if (!result.sent) await store.release(invite.inviteId);
    } catch (err) {
      console.error(`[email] party invite ${invite.inviteId} failed`, err);
      try {
        await store.release(invite.inviteId);
      } catch {
        // The claim stays; a human retries. Never propagate.
      }
    }
  }
}
