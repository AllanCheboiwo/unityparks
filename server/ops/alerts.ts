import "server-only";
import type { OpsAlert } from "@prisma/client";
import { prisma } from "../db";
import { sendEmail } from "../email/resend";

/**
 * Ops alerts: the durable form of "console.error and hope someone reads
 * the logs". A raise writes one row and, when OPS_ALERT_EMAIL is set,
 * fires one email; /ops/alerts lists the rows. Raising must never break
 * the flow that noticed the problem (a drift alert that 500s a settle
 * would hide the very money it is reporting), so raiseOpsAlert swallows
 * every failure after logging it.
 */

export async function raiseOpsAlert(input: {
  kind: string;
  recordId?: string | null;
  summary: string;
  /** Diagnostics object; stored as JSON, same shape the console line logs. */
  detail: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.opsAlert.create({
      data: {
        kind: input.kind,
        recordId: input.recordId ?? null,
        summary: input.summary,
        detail: JSON.stringify(input.detail),
      },
    });
  } catch (err) {
    console.error("[ops] alert row write failed", input.kind, err);
  }

  const opsEmail = process.env.OPS_ALERT_EMAIL;
  if (opsEmail) {
    // Fire-and-forget, same stance as the referral velocity alert.
    sendEmail({
      to: opsEmail,
      subject: `Ops alert: ${input.summary}`,
      text: `${input.summary}\n\n${JSON.stringify(input.detail, null, 2)}\n\nReview at /ops/alerts.`,
      html: `<p>${input.summary}</p><pre>${JSON.stringify(input.detail, null, 2)}</pre><p>Review at /ops/alerts.</p>`,
    }).catch((err) => console.error("[ops] alert email failed", err));
  }
}

/** Unresolved first (oldest at top: longest-ignored is most urgent), then
 * the most recent resolved rows for context. */
export async function alertsOverview(): Promise<{ open: OpsAlert[]; resolved: OpsAlert[] }> {
  const [open, resolved] = await Promise.all([
    prisma.opsAlert.findMany({
      where: { resolvedAt: null },
      orderBy: { createdAt: "asc" },
    }),
    prisma.opsAlert.findMany({
      where: { resolvedAt: { not: null } },
      orderBy: { resolvedAt: "desc" },
      take: 20,
    }),
  ]);
  return { open, resolved };
}

export async function resolveAlert(id: string, adminEmail: string): Promise<void> {
  // Guarded write: resolving twice keeps the first resolver's stamp.
  await prisma.opsAlert.updateMany({
    where: { id, resolvedAt: null },
    data: { resolvedAt: new Date(), resolvedBy: adminEmail },
  });
}
