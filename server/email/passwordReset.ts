import { VILLAGE_LOCALE_LINE } from "@/content/village";
import "server-only";
import { sendEmail } from "./resend";

/**
 * The password-reset email: one link, one hour, one use. The caller owns
 * token creation; this module only writes and sends the message. Errors
 * bubble up so the route can release nothing (a reset request the guest
 * never receives should simply be requested again).
 */

function appBaseUrl(): string {
  return process.env.APP_BASE_URL ?? "http://localhost:3000";
}

export async function sendPasswordResetEmail(params: {
  to: string;
  firstName: string | null;
  token: string;
}): Promise<boolean> {
  const resetUrl = `${appBaseUrl()}/reset-password?token=${params.token}`;
  const greeting = params.firstName ? `Hello ${params.firstName},` : "Hello,";

  const text = [
    greeting,
    ``,
    `Someone asked to reset the password for your Unity Parks account.`,
    `If that was you, set a new password here (the link works once and`,
    `expires in one hour):`,
    ``,
    resetUrl,
    ``,
    `If this wasn't you, ignore this email. Your password is unchanged.`,
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
      <h1 style="margin:0 0 8px;color:#1d1d1d;font-size:24px;">Reset your password</h1>
      <p style="margin:0 0 20px;color:#4c4e4b;font-size:15px;line-height:1.5;">
        ${greeting} someone asked to reset the password for your Unity Parks
        account. If that was you, set a new one below. The link works once
        and expires in one hour.
      </p>
      <p style="margin:0 0 24px;">
        <a href="${resetUrl}" style="background:#af6408;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:10px 22px;border-radius:6px;display:inline-block;">
          Choose a new password
        </a>
      </p>
      <p style="margin:0;color:#4c4e4b;font-size:13px;line-height:1.5;">
        If this wasn't you, ignore this email. Your password is unchanged.
      </p>
    </div>
    <div style="background:#333333;color:#bbbbbb;padding:14px 28px;font-size:12px;">
      Unity Parks · ${VILLAGE_LOCALE_LINE}
    </div>
  </div>
</div>`;

  const result = await sendEmail({
    to: params.to,
    subject: "Reset your Unity Parks password",
    html,
    text,
  });
  if (!result.sent && "error" in result) {
    console.error(`[email] password reset to ${params.to} failed: ${result.error}`);
    return false;
  }
  return true;
}
