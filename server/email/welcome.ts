import { VILLAGE_LOCALE_LINE } from "@/content/village";
import "server-only";
import { sendEmail } from "./resend";

/**
 * The welcome email, sent once when an account is created (standalone
 * register or the checkout checkbox). Fire-and-forget at both call sites:
 * an account exists whether or not this arrives, so a send failure is
 * logged and never surfaced to the guest.
 */

function appBaseUrl(): string {
  return process.env.APP_BASE_URL ?? "http://localhost:3000";
}

export async function sendWelcomeEmail(params: {
  to: string;
  firstName: string | null;
}): Promise<boolean> {
  const accountUrl = `${appBaseUrl()}/account`;
  const greeting = params.firstName ? `Hello ${params.firstName},` : "Hello,";

  const text = [
    greeting,
    ``,
    `Welcome to Unity Parks. Your account is ready.`,
    ``,
    `Your bookings and extras all live in one place, so you can see and`,
    `manage your breaks any time:`,
    ``,
    accountUrl,
    ``,
    `We look forward to seeing you in the forest.`,
    ``,
    `Unity Parks · ${VILLAGE_LOCALE_LINE}`,
  ].join("\n");

  const html = `
<div style="margin:0;padding:24px 12px;background:#f5f3ee;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #d9d6cf;border-radius:8px;overflow:hidden;">
    <div style="background:#536917;color:#ffffff;padding:20px 28px;">
      <div style="font-size:20px;font-weight:700;">Unity Parks</div>
    </div>
    <div style="padding:28px;">
      <h1 style="margin:0 0 8px;color:#1d1d1d;font-size:24px;">Welcome to Unity Parks</h1>
      <p style="margin:0 0 20px;color:#4c4e4b;font-size:15px;line-height:1.5;">
        ${greeting} your account is ready. Your bookings and extras all live
        in one place, so you can see and manage your breaks any time.
      </p>
      <p style="margin:0 0 24px;">
        <a href="${accountUrl}" style="background:#af6408;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:10px 22px;border-radius:6px;display:inline-block;">
          See my account
        </a>
      </p>
      <p style="margin:0;color:#4c4e4b;font-size:13px;line-height:1.5;">
        We look forward to seeing you in the forest.
      </p>
    </div>
    <div style="background:#333333;color:#bbbbbb;padding:14px 28px;font-size:12px;">
      Unity Parks · ${VILLAGE_LOCALE_LINE}
    </div>
  </div>
</div>`;

  const result = await sendEmail({
    to: params.to,
    subject: "Welcome to Unity Parks",
    html,
    text,
  });
  if (!result.sent && "error" in result) {
    console.error(`[email] welcome to ${params.to} failed: ${result.error}`);
    return false;
  }
  return true;
}
