import "server-only";

/**
 * Thin Resend client, same shape as our Apaleo and Pesapal clients: plain
 * fetch, no SDK. One endpoint is all transactional email needs.
 *
 * Config:
 *   RESEND_API_KEY  required to actually send. When missing (local dev
 *                   without the key) sends are skipped and logged, never
 *                   failed, so the booking flow is identical either way.
 *   EMAIL_FROM      optional sender override. The domain must be verified
 *                   in the Resend dashboard (SPF and DKIM records).
 */

const DEFAULT_FROM = "Unity Parks <bookings@unityparks.com>";

export type SendResult =
  | { sent: true; id: string }
  | { sent: false; skipped: true }
  | { sent: false; skipped: false; error: string };

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`[email] RESEND_API_KEY not set, skipping "${params.subject}" to ${params.to}`);
    return { sent: false, skipped: true };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM ?? DEFAULT_FROM,
      to: [params.to],
      subject: params.subject,
      html: params.html,
      text: params.text,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    return { sent: false, skipped: false, error: `Resend ${res.status}: ${body.slice(0, 300)}` };
  }
  const data = (await res.json()) as { id?: string };
  return { sent: true, id: data.id ?? "unknown" };
}
