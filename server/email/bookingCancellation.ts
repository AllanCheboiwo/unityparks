import { VILLAGE_LOCALE_LINE, VILLAGE_NAME } from "@/content/village";
import "server-only";
import { prisma } from "../db";
import { sendEmail } from "./resend";
import { depositAmountFor } from "@/lib/paymentPlan";

/**
 * The cancellation email, same discipline as the confirmation one: an
 * atomic stamp claim makes it once-only, every failure is logged and
 * swallowed, and a failed send releases the claim for a retry.
 */

/** "Monday, 20 July 2026" */
function longDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatMoney(amount: number, currency: string): string {
  return `${currency} ${amount.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
}

export async function sendBookingCancellation(recordId: string): Promise<void> {
  try {
    const claimed = await prisma.bookingRecord.updateMany({
      where: { id: recordId, cancellationEmailAt: null },
      data: { cancellationEmailAt: new Date() },
    });
    if (claimed.count === 0) return;

    const record = await prisma.bookingRecord.findUniqueOrThrow({
      where: { id: recordId },
      include: {
        session: true,
        // Accepted invitees get their own money-free notice below.
        invites: { where: { acceptedAt: { not: null }, revokedAt: null } },
      },
    });
    const session = record.session;
    if (!session.guestEmail) {
      console.log(`[email] cancelled booking ${record.apaleoBookingId} has no guest email`);
      return;
    }

    // What actually went in is the refund base: legacy records (born before
    // the deposit feature) store paidAmount 0 while being fully paid.
    const paid = record.paidAmount > 0 ? record.paidAmount : record.totalGrossAmount;
    const refunded = record.refundAmount ?? 0;
    const kept = paid - refunded;
    const deposit = Math.min(
      record.depositAmount ?? depositAmountFor(record.totalGrossAmount),
      paid,
    );
    const greeting = session.guestFirstName ? `Hello ${session.guestFirstName},` : "Hello,";
    const reference = record.apaleoBookingId;

    const refundLine =
      refunded > 0
        ? `We have refunded ${formatMoney(refunded, record.currency)} to your original payment method.` +
          (kept > 0
            ? ` A cancellation charge of ${formatMoney(kept, record.currency)} applied under the cancellation terms. Deposits are non-refundable.`
            : "")
        : kept <= deposit + 0.01
          ? `Your ${formatMoney(deposit, record.currency)} deposit is non-refundable, so no refund was due.`
          : `No refund was due this close to arrival under the cancellation terms.`;

    const text = [
      greeting,
      ``,
      `Your break at ${VILLAGE_NAME} is cancelled.`,
      ``,
      `Booking reference: ${reference}`,
      `Was: ${longDate(session.arrival)} to ${longDate(session.departure)}`,
      refundLine,
      ``,
      `We'd love to welcome you another time. The forest isn't going anywhere.`,
      ``,
      `Unity Parks · ${VILLAGE_LOCALE_LINE}`,
      `Demo environment: no real payments were taken.`,
    ].join("\n");

    const html = `
<div style="margin:0;padding:24px 12px;background:#f5f3ee;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #d9d6cf;border-radius:8px;overflow:hidden;">
    <div style="background:#536917;color:#ffffff;padding:20px 28px;">
      <div style="font-size:20px;font-weight:700;">Unity Parks</div>
    </div>
    <div style="padding:28px;">
      <h1 style="margin:0 0 8px;color:#1d1d1d;font-size:24px;">Your break is cancelled</h1>
      <p style="margin:0 0 20px;color:#4c4e4b;font-size:15px;line-height:1.5;">
        ${greeting} your break at ${VILLAGE_NAME} is cancelled.
      </p>
      <table style="border-collapse:collapse;margin-bottom:20px;">
        <tr><td style="padding:6px 16px 6px 0;color:#4c4e4b;font-size:14px;">Reference</td>
            <td style="padding:6px 0;color:#1d1d1d;font-size:14px;font-weight:600;">${reference}</td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#4c4e4b;font-size:14px;">Was</td>
            <td style="padding:6px 0;color:#1d1d1d;font-size:14px;font-weight:600;">${longDate(session.arrival)} to ${longDate(session.departure)}</td></tr>
      </table>
      <p style="margin:0 0 20px;color:#1d1d1d;font-size:15px;line-height:1.5;font-weight:600;">
        ${refundLine}
      </p>
      <p style="margin:0;color:#4c4e4b;font-size:14px;line-height:1.5;">
        We'd love to welcome you another time. The forest isn't going anywhere.
      </p>
    </div>
    <div style="background:#333333;color:#bbbbbb;padding:14px 28px;font-size:12px;">
      Unity Parks · ${VILLAGE_LOCALE_LINE} · Demo environment, no real payments were taken.
    </div>
  </div>
</div>`;

    const result = await sendEmail({
      to: session.guestEmail,
      subject: `Your Unity Parks break is cancelled · ${reference}`,
      html,
      text,
    });

    if (result.sent) {
      console.log(`[email] cancellation for ${reference} sent to ${session.guestEmail} (${result.id})`);
      // The invitee notices ride the same once-per-booking claim and are
      // best effort: a failed one is logged, never re-claimed, so the
      // owner's email can never be sent twice on its account.
      const notice = composeInviteeCancellation({
        leadFirstName: session.guestFirstName,
        village: VILLAGE_NAME,
        arrival: session.arrival,
        departure: session.departure,
      });
      for (const invite of record.invites) {
        const inviteeResult = await sendEmail({ to: invite.email, ...notice });
        if (!inviteeResult.sent) {
          console.error(`[email] invitee cancellation for ${reference} to ${invite.email} not sent`);
        }
      }
      return;
    }
    if ("error" in result) {
      console.error(`[email] cancellation for ${reference} failed: ${result.error}`);
      await prisma.bookingRecord.update({
        where: { id: recordId },
        data: { cancellationEmailAt: null },
      });
    }
  } catch (err) {
    console.error("[email] cancellation crashed", err);
  }
}

/**
 * The invitee's cancellation notice (UNP-20, finding C): dates, village and
 * the lead guest's name, never money. The owner's email above carries the
 * refund amount; this facts type cannot, by construction.
 */
export type InviteeCancellationFacts = {
  leadFirstName: string | null;
  village: string;
  arrival: string; // ISO YYYY-MM-DD
  departure: string; // ISO YYYY-MM-DD
};

export function composeInviteeCancellation(facts: InviteeCancellationFacts): {
  subject: string;
  html: string;
  text: string;
} {
  const lead = facts.leadFirstName || "The lead guest";
  const subject = `A Unity Parks break you were invited to has been cancelled`;
  const when = `${inviteeLongDate(facts.arrival)} to ${inviteeLongDate(facts.departure)}`;
  const text = [
    `${lead} has cancelled the break at Unity Parks ${facts.village} that you were invited to.`,
    ``,
    `${when}.`,
    ``,
    `You do not need to do anything.`,
  ].join("\n");
  const html = [
    `<p>${lead} has cancelled the break at Unity Parks ${facts.village} that you were invited to.</p>`,
    `<p>${when}</p>`,
    `<p>You do not need to do anything.</p>`,
  ].join("\n");
  return { subject, html, text };
}

/** "Monday, 30 November 2026" */
function inviteeLongDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
