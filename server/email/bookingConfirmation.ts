import "server-only";
import { prisma } from "../db";
import { sendEmail } from "./resend";
import { parseChildrenAges } from "../booking/session";
import { LODGES } from "@/content/lodges";

/**
 * The booking-confirmation email, sent once per booking the moment its
 * folio settles. Callers never await failure: every path in here logs and
 * returns, because a missed email must not disturb a paid booking.
 *
 * Once-only across the callback/IPN settle race: the confirmationEmailAt
 * stamp is claimed with an atomic updateMany before composing anything.
 * Exactly one racer wins the claim; a failed send releases the claim so a
 * later attempt (or a human) can retry.
 */

function appBaseUrl(): string {
  return process.env.APP_BASE_URL ?? "http://localhost:3000";
}

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

export async function sendBookingConfirmation(recordId: string): Promise<void> {
  try {
    // Claim first. count === 0 means another settle path already claimed
    // (or sent) this booking's email; stop silently.
    const claimed = await prisma.bookingRecord.updateMany({
      where: { id: recordId, confirmationEmailAt: null },
      data: { confirmationEmailAt: new Date() },
    });
    if (claimed.count === 0) return;

    const record = await prisma.bookingRecord.findUniqueOrThrow({
      where: { id: recordId },
      include: { reservations: { orderBy: { slot: "asc" } }, session: { include: { lodges: true } } },
    });
    const session = record.session;

    if (!session.guestEmail) {
      console.log(`[email] booking ${record.apaleoBookingId} has no guest email, nothing to send`);
      return;
    }

    // One line per lodge: tier name plus the assigned unit when known.
    const lodges = session.lodges.length
      ? session.lodges
      : [{ slot: 0, unitGroupCode: session.unitGroupCode, adults: session.adults, childrenAges: session.childrenAges }];
    const lodgeLines = lodges.map((lodge) => {
      const tier = lodge.unitGroupCode ? (LODGES[lodge.unitGroupCode]?.name ?? lodge.unitGroupCode) : "Lodge";
      const unit = record.reservations.find((r) => r.slot === lodge.slot)?.assignedUnitName;
      const party = lodge.adults + parseChildrenAges(lodge).length;
      return `${tier}${unit ? ` (${unit})` : ""} · ${party} ${party === 1 ? "guest" : "guests"}`;
    });

    const nights = Math.round(
      (Date.parse(`${session.departure}T00:00:00Z`) - Date.parse(`${session.arrival}T00:00:00Z`)) / 86_400_000,
    );
    const totalGuests = lodges.reduce((sum, l) => sum + l.adults + parseChildrenAges(l).length, 0);
    const memories = totalGuests * nights;

    const greeting = session.guestFirstName ? `Hello ${session.guestFirstName},` : "Hello,";
    const reference = record.apaleoBookingId;
    const total = formatMoney(record.totalGrossAmount, record.currency);
    const manageUrl = `${appBaseUrl()}/manage`;

    const text = [
      `${greeting}`,
      ``,
      `Your break at Unity Parks Naivasha is booked and paid. We can't wait to see you.`,
      ``,
      `Booking reference: ${reference}`,
      `Check-in: ${longDate(session.arrival)}`,
      `Check-out: ${longDate(session.departure)}`,
      ...lodgeLines.map((line) => `Lodge: ${line}`),
      `Total paid: ${total}`,
      ``,
      `Manage your break (change dates, add guest names) at ${manageUrl}`,
      `using your booking reference and this email address.`,
      ``,
      `That is ${memories} new ${memories === 1 ? "memory" : "memories"} on the way. Thank you for helping us reach a billion.`,
      ``,
      `Unity Parks · Lake Naivasha, Kenya`,
      `Demo environment: no real payments were taken.`,
    ].join("\n");

    const row = (label: string, value: string) =>
      `<tr><td style="padding:6px 16px 6px 0;color:#4c4e4b;font-size:14px;">${label}</td>` +
      `<td style="padding:6px 0;color:#1d1d1d;font-size:14px;font-weight:600;">${value}</td></tr>`;

    const html = `
<div style="margin:0;padding:24px 12px;background:#f5f3ee;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #d9d6cf;border-radius:8px;overflow:hidden;">
    <div style="background:#536917;color:#ffffff;padding:20px 28px;">
      <div style="font-size:20px;font-weight:700;">Unity Parks</div>
    </div>
    <div style="padding:28px;">
      <h1 style="margin:0 0 8px;color:#1d1d1d;font-size:24px;">Your break is booked</h1>
      <p style="margin:0 0 20px;color:#4c4e4b;font-size:15px;line-height:1.5;">
        ${greeting} your break at Unity Parks Naivasha is booked and paid.
        We can't wait to see you.
      </p>
      <div style="background:#f5f3ee;border-radius:6px;padding:14px 18px;margin-bottom:20px;">
        <span style="color:#4c4e4b;font-size:13px;">Booking reference</span><br/>
        <span style="color:#2c5670;font-size:22px;font-weight:700;letter-spacing:1px;">${reference}</span>
      </div>
      <table style="border-collapse:collapse;margin-bottom:20px;">
        ${row("Check-in", longDate(session.arrival))}
        ${row("Check-out", longDate(session.departure))}
        ${lodgeLines.map((line) => row("Lodge", line)).join("")}
        ${row("Total paid", total)}
      </table>
      <p style="margin:0 0 20px;color:#4c4e4b;font-size:14px;line-height:1.5;">
        Need to change dates or add guest names? Manage your break with your
        booking reference and this email address.
      </p>
      <p style="margin:0 0 24px;">
        <a href="${manageUrl}" style="background:#af6408;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:10px 22px;border-radius:6px;display:inline-block;">
          Manage my booking
        </a>
      </p>
      <p style="margin:0;color:#647e1b;font-size:14px;font-weight:600;">
        That is ${memories} new ${memories === 1 ? "memory" : "memories"} on the way.
        Thank you for helping us reach a billion.
      </p>
    </div>
    <div style="background:#333333;color:#bbbbbb;padding:14px 28px;font-size:12px;">
      Unity Parks · Lake Naivasha, Kenya · Demo environment, no real payments were taken.
    </div>
  </div>
</div>`;

    const result = await sendEmail({
      to: session.guestEmail,
      subject: `Your Unity Parks break is booked · ${reference}`,
      html,
      text,
    });

    if (result.sent) {
      console.log(`[email] confirmation for ${reference} sent to ${session.guestEmail} (${result.id})`);
      return;
    }
    if ("error" in result) {
      // Release the claim so the email can be retried later; the booking
      // itself is untouched.
      console.error(`[email] confirmation for ${reference} failed: ${result.error}`);
      await prisma.bookingRecord.update({
        where: { id: recordId },
        data: { confirmationEmailAt: null },
      });
    }
  } catch (err) {
    console.error("[email] confirmation crashed", err);
  }
}
