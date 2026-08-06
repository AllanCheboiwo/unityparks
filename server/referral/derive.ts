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
  options: { floored?: boolean } = {},
): Promise<number> {
  const rows = await loadCreditRows(db, participantId);
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
      // A released spend still counts, so its paired positive release row
      // neutralises it exactly once and can never double-restore.
      const active =
        row.releasedAt !== null ||
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
  // Floored for redemption and guest display; ops passes floored: false so
  // a negative pool (the farming signal) is visible, not hidden (plan 9).
  return options.floored === false ? Math.round(sum) : Math.max(0, Math.round(sum));
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

export type RewardHistoryRow = {
  id: string;
  createdAt: Date;
  amount: number;
  /** vested | pending | expired | lost (the referred booking unravelled) */
  state: string;
  /** The stay whose completion the reward waits on. */
  departure: string | null;
};

/**
 * The account card's reward history: one row per earn, classified with the
 * same predicates the balances use, so what a guest reads always adds up
 * to what they can spend.
 */
export async function creditHistory(
  participantId: string,
  db: Db = prisma,
  now: Date = new Date(),
): Promise<RewardHistoryRow[]> {
  const rows = await loadCreditRows(db, participantId);
  const todayIso = now.toISOString().slice(0, 10);
  return rows
    .filter((row) => row.kind === "credit_earn")
    .map((row) => {
      const attribution = row.attribution;
      const departure = attribution?.record?.session?.departure ?? null;
      let state = "lost";
      if (attribution?.record && attribution.config && departure) {
        const ctx = {
          attributionState: attribution.state,
          recordStatus: attribution.record.status,
          departure,
          creditExpiryDays: attribution.config.creditExpiryDays,
          todayIso,
        };
        if (isCreditEarnVested(ctx)) state = "vested";
        else if (attribution.state !== "void" && attribution.record.status === "paid") {
          state = departure >= todayIso ? "pending" : "expired";
        }
      }
      return {
        id: row.id,
        createdAt: row.createdAt,
        amount: Math.round(row.amount),
        state,
        departure,
      };
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
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
