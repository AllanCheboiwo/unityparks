import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../db";
import {
  isCommissionEarnPayable,
  isCreditEarnVested,
  isSpendActive,
} from "@/lib/referral";

/**
 * Every referral balance is derived at read time from the append-only
 * ledger joined to the bookings it describes. No vesting cron, no stored
 * balances: whether value is spendable or payable is a predicate over data
 * we already hold (plan section 7). These queries are tiny at our volumes;
 * the classification itself lives in lib/referral.ts where it is tested.
 */

type Db = PrismaClient | Prisma.TransactionClient;

/** Rows + joins for one participant's credit arithmetic. */
async function loadCreditRows(db: Db, participantId: string) {
  return db.referralLedgerEntry.findMany({
    where: {
      participantId,
      kind: { in: ["credit_earn", "credit_spend", "credit_release"] },
    },
    include: {
      // Earns: the attribution tells us void state; its record and session
      // give paid status and (live) departure; its config the expiry.
      attribution: {
        include: { config: true, record: { include: { session: true } } },
      },
      // Spends: the session they rode, and whether it produced a record.
      spentOnSession: { include: { booking: { select: { status: true } } } },
    },
  });
}

/** The ids of release rows, so released (locked) spends can be paired off. */
function releasedSpendIds(rows: Awaited<ReturnType<typeof loadCreditRows>>): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.kind === "credit_release" && row.releaseOfEntryId) ids.add(row.releaseOfEntryId);
  }
  return ids;
}

/**
 * The spendable (vested) balance: SUM(amount) over vested earns, active
 * spends (stored negative) and releases. A released spend counts as active
 * regardless of its booking's fate, so the release exactly neutralises it
 * and can never double-restore.
 */
export async function vestedCreditBalance(
  participantId: string,
  db: Db = prisma,
  now: Date = new Date(),
): Promise<number> {
  const rows = await loadCreditRows(db, participantId);
  const released = releasedSpendIds(rows);
  const todayIso = now.toISOString().slice(0, 10);

  let sum = 0;
  for (const row of rows) {
    if (row.kind === "credit_earn") {
      const attribution = row.attribution;
      if (!attribution?.record?.session || !attribution.config) continue;
      if (
        isCreditEarnVested({
          attributionState: attribution.state,
          recordStatus: attribution.record.status,
          departure: attribution.record.session.departure,
          creditExpiryDays: attribution.config.creditExpiryDays,
          todayIso,
        })
      ) {
        sum += row.amount;
      }
    } else if (row.kind === "credit_spend") {
      const session = row.spentOnSession;
      const active =
        released.has(row.id) ||
        isSpendActive({
          recordStatus: session?.booking?.status ?? null,
          sessionExpiresAt: session?.expiresAt ?? new Date(0),
          now,
        });
      if (active) sum += row.amount; // stored negative
    } else {
      sum += row.amount; // credit_release, stored positive
    }
  }
  return Math.max(0, Math.round(sum));
}

/**
 * Credit earned but not yet spendable: the referred booking is fully paid
 * and alive, the stay just hasn't completed. What the account card shows
 * as "on the way". Expired earns are neither vested nor pending.
 */
export async function pendingCreditBalance(
  participantId: string,
  db: Db = prisma,
  now: Date = new Date(),
): Promise<number> {
  const rows = await loadCreditRows(db, participantId);
  const todayIso = now.toISOString().slice(0, 10);
  let sum = 0;
  for (const row of rows) {
    if (row.kind !== "credit_earn") continue;
    const attribution = row.attribution;
    if (!attribution?.record?.session) continue;
    if (attribution.state === "void" || attribution.record.status !== "paid") continue;
    if (attribution.record.session.departure < todayIso) continue; // vested or expired
    sum += row.amount;
  }
  return Math.round(sum);
}

/**
 * Commission owed to an influencer right now: payable earns (post-stay,
 * still paid, not void; commissions never expire) plus payout rows (stored
 * negative). Used by the ops payout page and the CSV.
 */
export async function commissionOwed(
  participantId: string,
  db: Db = prisma,
  now: Date = new Date(),
): Promise<number> {
  const rows = await db.referralLedgerEntry.findMany({
    where: { participantId, kind: { in: ["commission_earn", "payout"] } },
    include: {
      attribution: { include: { record: { include: { session: true } } } },
    },
  });
  const todayIso = now.toISOString().slice(0, 10);

  let sum = 0;
  for (const row of rows) {
    if (row.kind === "commission_earn") {
      const attribution = row.attribution;
      if (!attribution?.record?.session) continue;
      if (
        isCommissionEarnPayable({
          attributionState: attribution.state,
          recordStatus: attribution.record.status,
          departure: attribution.record.session.departure,
          todayIso,
        })
      ) {
        sum += row.amount;
      }
    } else {
      sum += row.amount; // payout, stored negative
    }
  }
  return Math.round(sum);
}
