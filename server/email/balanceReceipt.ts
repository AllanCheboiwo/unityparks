import "server-only";
import { prisma } from "../db";
import { sendEmail } from "./resend";

/**
 * The receipt for a balance payment made from Manage my booking, same
 * discipline as the confirmation and cancellation emails: an atomic stamp
 * claim (on the transaction row, since a booking can have many balance
 * payments) makes it once-only, every failure is logged and swallowed, and
 * a failed send releases the claim for a retry.
 */

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

export async function sendBalanceReceipt(transactionId: string): Promise<void> {
  try {
    const claimed = await prisma.pesapalTransaction.updateMany({
      where: { id: transactionId, receiptEmailAt: null },
      data: { receiptEmailAt: new Date() },
    });
    if (claimed.count === 0) return;

    const transaction = await prisma.pesapalTransaction.findUniqueOrThrow({
      where: { id: transactionId },
      include: { record: { include: { session: true } } },
    });
    const record = transaction.record;
    const session = record.session;
    if (!session.guestEmail) {
      console.log(`[email] balance payment for ${record.apaleoBookingId} has no guest email`);
      return;
    }

    const outstanding = Math.max(0, record.totalGrossAmount - record.paidAmount);
    const settled = outstanding < 0.01;
    const greeting = session.guestFirstName ? `Hello ${session.guestFirstName},` : "Hello,";
    const reference = record.apaleoBookingId;

    const balanceLine = settled
      ? `Your break is now paid in full. Nothing left to do but count the days.`
      : `Still to pay: ${formatMoney(outstanding, record.currency)}` +
        (record.balanceDueDate ? `, due by ${longDate(record.balanceDueDate)}.` : `.`);

    const text = [
      greeting,
      ``,
      `We've received your payment of ${formatMoney(transaction.amount, transaction.currency)} towards your Unity Parks break.`,
      ``,
      `Booking reference: ${reference}`,
      `Stay: ${longDate(session.arrival)} to ${longDate(session.departure)}`,
      `Paid so far: ${formatMoney(record.paidAmount, record.currency)} of ${formatMoney(record.totalGrossAmount, record.currency)}`,
      balanceLine,
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
      <h1 style="margin:0 0 8px;color:#1d1d1d;font-size:24px;">Payment received</h1>
      <p style="margin:0 0 20px;color:#4c4e4b;font-size:15px;line-height:1.5;">
        ${greeting} we've received your payment of
        <strong>${formatMoney(transaction.amount, transaction.currency)}</strong>
        towards your Unity Parks break.
      </p>
      <table style="border-collapse:collapse;margin-bottom:20px;">
        <tr><td style="padding:6px 16px 6px 0;color:#4c4e4b;font-size:14px;">Reference</td>
            <td style="padding:6px 0;color:#1d1d1d;font-size:14px;font-weight:600;">${reference}</td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#4c4e4b;font-size:14px;">Stay</td>
            <td style="padding:6px 0;color:#1d1d1d;font-size:14px;font-weight:600;">${longDate(session.arrival)} to ${longDate(session.departure)}</td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#4c4e4b;font-size:14px;">Paid so far</td>
            <td style="padding:6px 0;color:#1d1d1d;font-size:14px;font-weight:600;">${formatMoney(record.paidAmount, record.currency)} of ${formatMoney(record.totalGrossAmount, record.currency)}</td></tr>
      </table>
      <p style="margin:0;color:#1d1d1d;font-size:15px;line-height:1.5;font-weight:600;">
        ${balanceLine}
      </p>
    </div>
    <div style="background:#333333;color:#bbbbbb;padding:14px 28px;font-size:12px;">
      Unity Parks · Lake Naivasha, Kenya · Demo environment, no real payments were taken.
    </div>
  </div>
</div>`;

    const result = await sendEmail({
      to: session.guestEmail,
      subject: settled
        ? `Your Unity Parks break is paid in full · ${reference}`
        : `Payment received · ${reference}`,
      html,
      text,
    });

    if (result.sent) {
      console.log(`[email] balance receipt for ${reference} sent to ${session.guestEmail} (${result.id})`);
      return;
    }
    if ("error" in result) {
      console.error(`[email] balance receipt for ${reference} failed: ${result.error}`);
      await prisma.pesapalTransaction.update({
        where: { id: transactionId },
        data: { receiptEmailAt: null },
      });
    }
  } catch (err) {
    console.error("[email] balance receipt crashed", err);
  }
}
