import "server-only";
import { prisma } from "../db";
import { reminderStageFor } from "@/lib/paymentPlan";
import { sendBalanceReminder, type ReminderStage } from "../email/balanceReminder";

/**
 * Deposit plan phase 2, kept deliberately schedulerless like the rest of
 * the system: this module lists which deposit-paid bookings are owed a
 * reminder and sends the due ones when asked. The ops route (or an external
 * scheduler hitting it) decides when "asked" happens; running it twice in a
 * row is free because every send claims a once-only stamp first.
 *
 * Auto-cancel of overdue bookings is deliberately NOT here: cancelling
 * money that guests still intend to pay is a policy decision for a human,
 * and the cancellation engine already exists for when they make it.
 */

export type ReminderRow = {
  recordId: string;
  reference: string;
  guestEmail: string | null;
  arrival: string;
  dueDate: string;
  outstanding: number;
  currency: string;
  /** The stage the dates put this booking in today, before stamp checks. */
  stage: ReminderStage | null;
  upcomingSentAt: Date | null;
  overdueSentAt: Date | null;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Every deposit-paid booking still owing money, soonest due first. */
export async function reminderOverview(): Promise<ReminderRow[]> {
  const records = await prisma.bookingRecord.findMany({
    where: { status: "deposit_paid", balanceDueDate: { not: null } },
    include: { session: { select: { arrival: true, guestEmail: true } } },
  });
  const today = todayIso();

  return records
    .map((record) => ({
      recordId: record.id,
      reference: record.apaleoBookingId,
      guestEmail: record.session.guestEmail,
      arrival: record.session.arrival,
      dueDate: record.balanceDueDate as string,
      outstanding: Math.max(0, Math.round(record.totalGrossAmount - record.paidAmount)),
      currency: record.currency,
      stage: reminderStageFor(today, record.balanceDueDate as string),
      upcomingSentAt: record.reminderUpcomingEmailAt,
      overdueSentAt: record.reminderOverdueEmailAt,
    }))
    .filter((row) => row.outstanding > 0)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

export type ReminderRunSummary = {
  considered: number;
  sent: Array<{ reference: string; stage: ReminderStage }>;
};

/**
 * Send every reminder that is due right now. One stage per booking per run:
 * a booking that went overdue before its "due soon" ever sent gets only the
 * overdue reminder - the earlier ship has sailed and two emails at once
 * would just be noise.
 */
export async function runBalanceReminders(): Promise<ReminderRunSummary> {
  const rows = await reminderOverview();
  const sent: ReminderRunSummary["sent"] = [];

  for (const row of rows) {
    let stage: ReminderStage | null = null;
    if (row.stage === "overdue" && !row.overdueSentAt) stage = "overdue";
    else if (row.stage === "upcoming" && !row.upcomingSentAt) stage = "upcoming";
    if (!stage) continue;

    if (await sendBalanceReminder(row.recordId, stage)) {
      sent.push({ reference: row.reference, stage });
    }
  }

  return { considered: rows.length, sent };
}
