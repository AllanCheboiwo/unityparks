import "server-only";
import { prisma } from "../db";
import { sendEmail } from "./resend";

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
      include: { session: true },
    });
    const session = record.session;
    if (!session.guestEmail) {
      console.log(`[email] cancelled booking ${record.apaleoBookingId} has no guest email`);
      return;
    }

    const refunded = record.refundAmount ?? 0;
    const kept = record.totalGrossAmount - refunded;
    const greeting = session.guestFirstName ? `Hello ${session.guestFirstName},` : "Hello,";
    const reference = record.apaleoBookingId;

    const refundLine =
      refunded > 0
        ? `We have refunded ${formatMoney(refunded, record.currency)} to your original payment method.` +
          (kept > 0
            ? ` A cancellation charge of ${formatMoney(kept, record.currency)} applied under the cancellation terms.`
            : "")
        : `No refund was due this close to arrival under the cancellation terms.`;

    const text = [
      greeting,
      ``,
      `Your break at Unity Parks Naivasha is cancelled.`,
      ``,
      `Booking reference: ${reference}`,
      `Was: ${longDate(session.arrival)} to ${longDate(session.departure)}`,
      refundLine,
      ``,
      `We'd love to welcome you another time. The forest isn't going anywhere.`,
      ``,
      `Unity Parks · Lake Naivasha, Kenya`,
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
        ${greeting} your break at Unity Parks Naivasha is cancelled.
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
      Unity Parks · Lake Naivasha, Kenya · Demo environment, no real payments were taken.
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
