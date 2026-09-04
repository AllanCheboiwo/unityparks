import { VILLAGE_LOCALE_LINE } from "@/content/village";
import "server-only";
import { prisma } from "../db";
import { sendEmail } from "./resend";
import type { PricedAddition } from "@/lib/extras";

/**
 * The receipt for extras added after booking, same discipline as the other
 * guest emails: an atomic stamp claim on the order row makes it once-only,
 * every failure is logged and swallowed, and a failed send releases the
 * claim for a retry.
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

export async function sendExtrasReceipt(orderId: string): Promise<void> {
  try {
    const claimed = await prisma.extrasOrder.updateMany({
      where: { id: orderId, status: "settled", emailAt: null },
      data: { emailAt: new Date() },
    });
    if (claimed.count === 0) return;

    const order = await prisma.extrasOrder.findUniqueOrThrow({
      where: { id: orderId },
      include: { record: { include: { session: true } } },
    });
    const record = order.record;
    const session = record.session;
    if (!session.guestEmail) {
      console.log(`[email] extras for ${record.apaleoBookingId} have no guest email`);
      return;
    }

    const additions = JSON.parse(order.additions) as PricedAddition[];
    // UNP-6: what the holds say, so a spa line carries its day and time and
    // a bike line says it covers the whole break.
    const holds = await prisma.inventoryHold.findMany({
      where: { orderId, status: "CONFIRMED" },
      include: { resource: { select: { name: true, kind: true, sessionStart: true } } },
      orderBy: [{ resourceId: "asc" }, { date: "asc" }],
    });
    const activityLines: string[] = [];
    const seenStock = new Set<string>();
    for (const hold of holds) {
      if (hold.resource.kind === "SESSION") {
        activityLines.push(
          `${hold.resource.name} on ${longDate(hold.date)}: ${hold.qty} place${hold.qty === 1 ? "" : "s"}`,
        );
      } else if (!seenStock.has(hold.resourceId)) {
        seenStock.add(hold.resourceId);
        activityLines.push(`${hold.resource.name} x ${hold.qty}, for the whole of your break`);
      }
    }
    const amount = order.chargedDelta ?? order.expectedDelta;
    const outstanding = Math.max(0, record.totalGrossAmount - record.paidAmount);
    const greeting = session.guestFirstName ? `Hello ${session.guestFirstName},` : "Hello,";
    const reference = record.apaleoBookingId;

    const moneyLine =
      order.kind === "charge_now"
        ? `We've charged ${formatMoney(amount, order.currency)} to your booking, which stays paid in full.`
        : `${formatMoney(amount, order.currency)} has been added to your balance. Still to pay: ${formatMoney(outstanding, record.currency)}` +
          (record.balanceDueDate ? `, due by ${longDate(record.balanceDueDate)}.` : `.`);

    const itemLines = additions.map(
      (a) =>
        `${a.name}${a.addCount > 1 ? ` x ${a.addCount}` : ""}: ${formatMoney(a.amount, order.currency)}`,
    );

    const text = [
      greeting,
      ``,
      `Your little extras are booked for your Unity Parks break.`,
      ``,
      `Booking reference: ${reference}`,
      `Stay: ${longDate(session.arrival)} to ${longDate(session.departure)}`,
      ...itemLines,
      ...activityLines,
      moneyLine,
      ``,
      `Unity Parks · ${VILLAGE_LOCALE_LINE}`,
      `Demo environment: no real payments were taken.`,
    ].join("\n");

    const itemRows =
      additions
        .map(
          (a) => `
        <tr><td style="padding:6px 16px 6px 0;color:#4c4e4b;font-size:14px;">${a.name}${a.addCount > 1 ? ` x ${a.addCount}` : ""}</td>
            <td style="padding:6px 0;color:#1d1d1d;font-size:14px;font-weight:600;">${formatMoney(a.amount, order.currency)}</td></tr>`,
        )
        .join("") +
      activityLines
        .map(
          (line) => `
        <tr><td colspan="2" style="padding:2px 0 6px;color:#4c4e4b;font-size:13px;">${line}</td></tr>`,
        )
        .join("");

    const html = `
<div style="margin:0;padding:24px 12px;background:#f5f3ee;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #d9d6cf;border-radius:8px;overflow:hidden;">
    <div style="background:#536917;color:#ffffff;padding:20px 28px;">
      <div style="font-size:20px;font-weight:700;">Unity Parks</div>
    </div>
    <div style="padding:28px;">
      <h1 style="margin:0 0 8px;color:#1d1d1d;font-size:24px;">Your little extras are booked</h1>
      <p style="margin:0 0 20px;color:#4c4e4b;font-size:15px;line-height:1.5;">
        ${greeting} the extras below are added to your break from
        ${longDate(session.arrival)}.
      </p>
      <table style="border-collapse:collapse;margin-bottom:20px;">
        <tr><td style="padding:6px 16px 6px 0;color:#4c4e4b;font-size:14px;">Reference</td>
            <td style="padding:6px 0;color:#1d1d1d;font-size:14px;font-weight:600;">${reference}</td></tr>
        ${itemRows}
      </table>
      <p style="margin:0;color:#1d1d1d;font-size:15px;line-height:1.5;font-weight:600;">
        ${moneyLine}
      </p>
    </div>
    <div style="background:#333333;color:#bbbbbb;padding:14px 28px;font-size:12px;">
      Unity Parks · ${VILLAGE_LOCALE_LINE} · Demo environment, no real payments were taken.
    </div>
  </div>
</div>`;

    const result = await sendEmail({
      to: session.guestEmail,
      subject: `Extras added to your break · ${reference}`,
      html,
      text,
    });

    if (result.sent) {
      console.log(`[email] extras receipt for ${reference} sent to ${session.guestEmail} (${result.id})`);
      return;
    }
    if ("error" in result) {
      console.error(`[email] extras receipt for ${reference} failed: ${result.error}`);
      await prisma.extrasOrder.update({
        where: { id: orderId },
        data: { emailAt: null },
      });
    }
  } catch (err) {
    console.error("[email] extras receipt crashed", err);
  }
}
