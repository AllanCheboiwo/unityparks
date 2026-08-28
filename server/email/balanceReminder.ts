import { VILLAGE_LOCALE_LINE } from "@/content/village";
import "server-only";
import { prisma } from "../db";
import { sendEmail } from "./resend";

/**
 * Balance reminders, deposit plan phase 2: "due soon" inside the 14-day
 * window, "overdue" once the due date has passed. Same discipline as every
 * other guest email: an atomic stamp claim (one per stage, on the record)
 * makes each stage once-only, failures are logged and swallowed, a failed
 * send releases the claim. There is deliberately no scheduler here; the ops
 * reminders route decides when this runs.
 */

export type ReminderStage = "upcoming" | "overdue";

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

function appBaseUrl(): string {
  return process.env.APP_BASE_URL ?? "http://localhost:3000";
}

/** Returns true when the reminder was processed and stamped: handed to
 *  Resend, or skipped-without-a-key with the stamp kept so local walks
 *  behave exactly like production. False = not due, raced, or failed. */
export async function sendBalanceReminder(
  recordId: string,
  stage: ReminderStage,
): Promise<boolean> {
  const stampField = stage === "upcoming" ? "reminderUpcomingEmailAt" : "reminderOverdueEmailAt";
  let claimedHere = false;
  try {
    // The claim carries the status filter: a booking that got paid (or
    // cancelled) between listing and sending must not claim a stamp.
    const claimed = await prisma.bookingRecord.updateMany({
      where: { id: recordId, status: "deposit_paid", [stampField]: null },
      data: { [stampField]: new Date() },
    });
    if (claimed.count === 0) return false;
    claimedHere = true;

    const record = await prisma.bookingRecord.findUniqueOrThrow({
      where: { id: recordId },
      include: { session: true },
    });
    const session = record.session;
    const outstanding = Math.max(0, record.totalGrossAmount - record.paidAmount);
    if (!session.guestEmail || outstanding < 0.01 || !record.balanceDueDate) {
      // Nothing to chase after all: release so a future run re-evaluates.
      await prisma.bookingRecord.update({
        where: { id: recordId },
        data: { [stampField]: null },
      });
      return false;
    }

    const greeting = session.guestFirstName ? `Hello ${session.guestFirstName},` : "Hello,";
    const reference = record.apaleoBookingId;
    const dueDate = longDate(record.balanceDueDate);
    const amount = formatMoney(outstanding, record.currency);
    const manageUrl = `${appBaseUrl()}/manage`;

    const lead =
      stage === "upcoming"
        ? `Your break from ${longDate(session.arrival)} is coming up, and the balance of ${amount} is due by ${dueDate}.`
        : `The balance of ${amount} for your break from ${longDate(session.arrival)} was due by ${dueDate}.`;
    const action =
      stage === "upcoming"
        ? `Pay all of it, or any part of it (KES 500 minimum), from Manage my booking. We never store cards or charge you automatically.`
        : `Please pay it from Manage my booking to keep your break. Nothing is cancelled automatically, but our team may be in touch about overdue balances.`;

    const text = [
      greeting,
      ``,
      lead,
      ``,
      `Booking reference: ${reference}`,
      `Still to pay: ${amount}`,
      `Due by: ${dueDate}`,
      ``,
      action,
      `Manage your booking: ${manageUrl} (sign in with your Unity Parks account)`,
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
      <h1 style="margin:0 0 8px;color:#1d1d1d;font-size:24px;">${
        stage === "upcoming" ? "Your balance is due soon" : "Your balance is overdue"
      }</h1>
      <p style="margin:0 0 20px;color:#4c4e4b;font-size:15px;line-height:1.5;">
        ${greeting} ${lead}
      </p>
      <table style="border-collapse:collapse;margin-bottom:20px;">
        <tr><td style="padding:6px 16px 6px 0;color:#4c4e4b;font-size:14px;">Reference</td>
            <td style="padding:6px 0;color:#1d1d1d;font-size:14px;font-weight:600;">${reference}</td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#4c4e4b;font-size:14px;">Still to pay</td>
            <td style="padding:6px 0;color:#1d1d1d;font-size:14px;font-weight:600;">${amount}</td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#4c4e4b;font-size:14px;">Due by</td>
            <td style="padding:6px 0;color:#1d1d1d;font-size:14px;font-weight:600;">${dueDate}</td></tr>
      </table>
      <p style="margin:0 0 20px;color:#1d1d1d;font-size:15px;line-height:1.5;">
        ${action}
      </p>
      <a href="${manageUrl}" style="display:inline-block;background:#0a3d62;color:#ffffff;padding:12px 24px;border-radius:6px;font-size:15px;font-weight:600;text-decoration:none;">
        Manage my booking
      </a>
    </div>
    <div style="background:#333333;color:#bbbbbb;padding:14px 28px;font-size:12px;">
      Unity Parks · ${VILLAGE_LOCALE_LINE} · Demo environment, no real payments were taken.
    </div>
  </div>
</div>`;

    const result = await sendEmail({
      to: session.guestEmail,
      subject:
        stage === "upcoming"
          ? `Your balance is due soon · ${reference}`
          : `Your balance is overdue · ${reference}`,
      html,
      text,
    });

    if (result.sent) {
      console.log(`[email] ${stage} reminder for ${reference} sent to ${session.guestEmail} (${result.id})`);
      return true;
    }
    if ("error" in result) {
      console.error(`[email] ${stage} reminder for ${reference} failed: ${result.error}`);
      await prisma.bookingRecord.update({
        where: { id: recordId },
        data: { [stampField]: null },
      });
    }
    // Skipped sends (no RESEND_API_KEY) keep the claim: local walks should
    // behave like production without emailing anyone twice later.
    return result.sent === false && result.skipped === true;
  } catch (err) {
    // A transport-level failure (DNS, reset connection) rejects rather than
    // returning an error result, so the release above never runs. Give the
    // claim back here too, or this booking would never be chased again.
    console.error(`[email] ${stage} reminder crashed`, err);
    if (claimedHere) {
      await prisma.bookingRecord
        .update({ where: { id: recordId }, data: { [stampField]: null } })
        .catch((releaseErr) =>
          console.error(`[email] ${stage} reminder could not release its stamp`, releaseErr),
        );
    }
    return false;
  }
}
