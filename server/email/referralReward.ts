import { VILLAGE_LOCALE_LINE } from "@/content/village";
import "server-only";
import { participantEffectiveContact } from "@/lib/referral";
import { prisma } from "../db";
import { sendEmail } from "./resend";

/**
 * The referrer's "reward on the way" email, sent once per attribution when
 * the referred booking becomes fully paid. Same discipline as the booking
 * confirmation: atomic claim of the rewardEmailAt stamp before composing,
 * released only on a failed send, every failure logged and swallowed so
 * email can never disturb a payment.
 *
 * The reward is phrased as EXPECTED from the stay's departure date: an
 * amendment can move that date and a cancellation can void the reward
 * after this email is sent, the same accepted window as the confirmation
 * email (docs/referral-system-plan.md 6.1).
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

export async function sendReferralReward(recordId: string): Promise<void> {
  try {
    const attribution = await prisma.referralAttribution.findUnique({
      where: { recordId },
      include: {
        participant: { include: { user: { select: { email: true, phone: true } } } },
        record: { include: { session: { select: { departure: true } } } },
      },
    });
    // Only an earned attribution with someone to write to gets an email.
    // Gift attributions never earn, and a participant without an email
    // simply has no inbox; neither consumes the stamp.
    if (!attribution || attribution.state !== "earned") return;
    // Clients are written to at their account's CURRENT address, falling
    // back to the claim-era copy; influencers have no account and keep
    // stored fields (one copy instead of two, plan section 8).
    const toEmail = participantEffectiveContact(attribution.participant).email;
    if (!toEmail) return;

    const claimed = await prisma.referralAttribution.updateMany({
      where: { id: attribution.id, rewardEmailAt: null },
      data: { rewardEmailAt: new Date() },
    });
    if (claimed.count === 0) return;

    const { participant } = attribution;
    const isInfluencer = participant.kind === "influencer";
    const amount = formatMoney(Math.round(attribution.rewardAmount), attribution.record.currency);
    const vestDate = longDate(attribution.record.session.departure);
    const firstName = participant.name.split(" ")[0] || participant.name;
    const accountUrl = `${appBaseUrl()}/account`;

    const text = [
      `Hello ${firstName},`,
      ``,
      `Someone booked a Unity Parks break with your code ${participant.code}.`,
      ``,
      isInfluencer
        ? `Your commission of ${amount} is expected once their stay completes, from ${vestDate}. It joins your next monthly payout.`
        : `Your resort credit of ${amount} is expected once their stay completes, from ${vestDate}. It will be ready to spend on your own next break.`,
      ``,
      isInfluencer
        ? `We'll include the details in your payout statement.`
        : `See your code and credit any time at ${accountUrl}`,
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
      <h1 style="margin:0 0 8px;color:#1d1d1d;font-size:24px;">Your code just worked</h1>
      <p style="margin:0 0 20px;color:#4c4e4b;font-size:15px;line-height:1.5;">
        Hello ${firstName}, someone booked a Unity Parks break with your code
        <strong>${participant.code}</strong>.
      </p>
      <div style="background:#f5f3ee;border-radius:6px;padding:14px 18px;margin-bottom:20px;">
        <span style="color:#4c4e4b;font-size:13px;">${isInfluencer ? "Commission expected" : "Resort credit expected"}</span><br/>
        <span style="color:#2c5670;font-size:22px;font-weight:700;">${amount}</span><br/>
        <span style="color:#4c4e4b;font-size:13px;">from ${vestDate}, once the stay completes</span>
      </div>
      <p style="margin:0;color:#4c4e4b;font-size:14px;line-height:1.5;">
        ${
          isInfluencer
            ? "It joins your next monthly payout, and the details will be in your statement."
            : `It will be ready to spend on your own next break. See your code and credit any time in <a href="${accountUrl}" style="color:#af6408;">your account</a>.`
        }
      </p>
    </div>
    <div style="background:#333333;color:#bbbbbb;padding:14px 28px;font-size:12px;">
      Unity Parks · ${VILLAGE_LOCALE_LINE} · Demo environment, no real payments were taken.
    </div>
  </div>
</div>`;

    const result = await sendEmail({
      to: toEmail,
      subject: `Your referral code ${participant.code} just earned ${amount}`,
      html,
      text,
    });

    if (result.sent) {
      console.log(`[email] referral reward for ${participant.code} sent to ${toEmail} (${result.id})`);
      return;
    }
    if ("error" in result) {
      console.error(`[email] referral reward for ${participant.code} failed: ${result.error}`);
      await prisma.referralAttribution.update({
        where: { id: attribution.id },
        data: { rewardEmailAt: null },
      });
    }
  } catch (err) {
    console.error("[email] referral reward crashed", err);
  }
}
