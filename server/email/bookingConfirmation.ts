import { opensOnDate, SPA_OPEN_DAYS_BEFORE } from "@/lib/inventory";
import { VILLAGE_LOCALE_LINE, VILLAGE_NAME } from "@/content/village";
import "server-only";
import { prisma } from "../db";
import { sendEmail } from "./resend";
import { parseChildrenAges } from "../booking/session";
import { LODGES } from "@/content/lodges";
import { formatKes } from "@/lib/format";
import { OFFER_PER_LODGE, OFFER_WINDOW_DAYS } from "@/lib/repeatOffer";

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
/** UNP-6: bikes open from confirmation, spa sessions eight weeks out. */
function activitiesLine(arrival: string): string {
  const spaOpens = opensOnDate(arrival, SPA_OPEN_DAYS_BEFORE);
  const today = new Date().toISOString().slice(0, 10);
  return today >= spaOpens
    ? "Activities are open in your account: cycle hire and Forest Spa sessions, subject to availability."
    : `Cycle hire is open in your account now; Forest Spa sessions open on ${longDate(spaOpens)}, subject to availability.`;
}

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

    const greeting = session.guestFirstName ? `Hello ${session.guestFirstName},` : "Hello,";
    const reference = record.apaleoBookingId;
    const total = formatMoney(record.totalGrossAmount, record.currency);
    const manageUrl = `${appBaseUrl()}/manage`;

    // A deposit booking is just as booked; the email leads with that and
    // then says plainly what is still to pay and by when.
    const fullyPaid = record.status === "paid";
    const outstanding = Math.max(0, record.totalGrossAmount - record.paidAmount);
    const dueDate = record.balanceDueDate ? longDate(record.balanceDueDate) : null;

    const text = [
      `${greeting}`,
      ``,
      fullyPaid
        ? `Your break at ${VILLAGE_NAME} is booked and paid. We can't wait to see you.`
        : `Your break at ${VILLAGE_NAME} is booked. Your deposit is in; the balance is due ${dueDate ? `by ${dueDate}` : "before arrival"}.`,
      ``,
      `Booking reference: ${reference}`,
      `Check-in: ${longDate(session.arrival)}`,
      `Check-out: ${longDate(session.departure)}`,
      ...lodgeLines.map((line) => `Lodge: ${line}`),
      ...(fullyPaid
        ? [`Total paid: ${total}`]
        : [
            `Paid today: ${formatMoney(record.paidAmount, record.currency)}`,
            `Still to pay: ${formatMoney(outstanding, record.currency)} of ${total}${dueDate ? `, due by ${dueDate}` : ""}`,
            `Pay any time from Manage my booking.`,
          ]),
      ``,
      `And a thank-you to look forward to: as a returning guest you'll have`,
      `${formatKes(OFFER_PER_LODGE)} per lodge off your next break, booked within`,
      `${OFFER_WINDOW_DAYS} days of departing this one. Party members you invite on the`,
      `guest details page before departure share the offer.`,
      ``,
      activitiesLine(session.arrival),
      ``,
      `Manage your break (change dates, add guest names) at ${manageUrl}`,
      `by signing in with your Unity Parks account.`,
      ``,
      `Unity Parks · ${VILLAGE_LOCALE_LINE}`,
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
        ${
          fullyPaid
            ? `${greeting} your break at ${VILLAGE_NAME} is booked and paid. We can't wait to see you.`
            : `${greeting} your break at ${VILLAGE_NAME} is booked. Your deposit is in; the balance is due ${dueDate ? `by ${dueDate}` : "before arrival"}.`
        }
      </p>
      <div style="background:#f5f3ee;border-radius:6px;padding:14px 18px;margin-bottom:20px;">
        <span style="color:#4c4e4b;font-size:13px;">Booking reference</span><br/>
        <span style="color:#2c5670;font-size:22px;font-weight:700;letter-spacing:1px;">${reference}</span>
      </div>
      <table style="border-collapse:collapse;margin-bottom:20px;">
        ${row("Check-in", longDate(session.arrival))}
        ${row("Check-out", longDate(session.departure))}
        ${lodgeLines.map((line) => row("Lodge", line)).join("")}
        ${
          fullyPaid
            ? row("Total paid", total)
            : row("Paid today", formatMoney(record.paidAmount, record.currency)) +
              row(
                "Still to pay",
                `${formatMoney(outstanding, record.currency)} of ${total}${dueDate ? `, due by ${dueDate}` : ""}`,
              )
        }
      </table>
      <p style="margin:0 0 20px;color:#4c4e4b;font-size:14px;line-height:1.5;">
        And a thank-you to look forward to: as a returning guest you'll have
        <strong>${formatKes(OFFER_PER_LODGE)} per lodge off your next break</strong>,
        booked within ${OFFER_WINDOW_DAYS} days of departing this one. Party
        members you invite on the guest details page before departure share
        the offer.
      </p>
      <p style="margin:0 0 20px;color:#4c4e4b;font-size:14px;line-height:1.5;">
        ${activitiesLine(session.arrival)}
      </p>
      <p style="margin:0 0 20px;color:#4c4e4b;font-size:14px;line-height:1.5;">
        Need to change dates or add guest names? Sign in with your Unity
        Parks account to manage your break.
      </p>
      <p style="margin:0;">
        <a href="${manageUrl}" style="background:#af6408;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:10px 22px;border-radius:6px;display:inline-block;">
          Manage my booking
        </a>
      </p>
    </div>
    <div style="background:#333333;color:#bbbbbb;padding:14px 28px;font-size:12px;">
      Unity Parks · ${VILLAGE_LOCALE_LINE} · Demo environment, no real payments were taken.
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
