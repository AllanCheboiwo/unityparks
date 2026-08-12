import "server-only";
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "../db";
import { PublicError } from "../api-helpers";
import { normalizeEmail } from "../auth/normalize";
import { commissionOwed, pendingCreditBalance, vestedCreditBalance } from "./derive";
import { releaseClaim } from "./claim";
import { cancelReservationOnce } from "../apaleo/cancel";
import { isValidCodeFormat, normalizeReferralCode } from "@/lib/referral";

/**
 * Everything the /ops/referrals pages read and do. Reads are derived sums
 * over the ledger (no stored balances anywhere); actions are the few
 * writes the plan reserves for a human: onboarding an influencer, revoking
 * a code, releasing locked credit, and running a payout batch.
 */

type Db = PrismaClient | Prisma.TransactionClient;

/** Attributions per code over a rolling window; the velocity view. */
export const VELOCITY_WINDOW_DAYS = 30;
export const VELOCITY_ALERT_THRESHOLD = 10;

export async function participantsOverview() {
  const participants = await prisma.referralParticipant.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      attributions: { select: { state: true, createdAt: true, gift: true } },
    },
  });
  const since = new Date(Date.now() - VELOCITY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return Promise.all(
    participants.map(async (p) => ({
      id: p.id,
      kind: p.kind,
      name: p.name,
      email: p.email,
      phone: p.phone,
      code: p.code,
      commissionRate: p.commissionRate,
      revokedAt: p.revokedAt,
      attributionCount: p.attributions.length,
      earnedCount: p.attributions.filter((a) => a.state === "earned").length,
      recentCount: p.attributions.filter((a) => a.createdAt >= since).length,
      owed:
        p.kind === "influencer"
          ? await commissionOwed(p.id)
          : await vestedCreditBalance(p.id, prisma, new Date(), { floored: false }),
      pending: p.kind === "influencer" ? 0 : await pendingCreditBalance(p.id),
    })),
  );
}

export async function recentAttributions(limit = 50) {
  return prisma.referralAttribution.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      participant: { select: { code: true, kind: true, name: true } },
      record: {
        select: {
          apaleoBookingId: true,
          status: true,
          totalGrossAmount: true,
          currency: true,
          session: { select: { departure: true } },
        },
      },
    },
  });
}

/**
 * Credit locked in abandoned checkouts: spends whose booking sits at
 * "created" past the session's freshness window, with no release yet. The
 * one manual edge the plan accepts (6.3): created is resumable forever, so
 * only a human may decide the checkout is truly dead.
 */
export async function lockedSpends() {
  const spends = await prisma.referralLedgerEntry.findMany({
    where: { kind: "credit_spend", releasedAt: null },
    include: {
      participant: { select: { name: true, code: true } },
      spentOnSession: {
        select: {
          expiresAt: true,
          booking: { select: { apaleoBookingId: true, status: true } },
        },
      },
    },
  });
  const now = new Date();
  return spends.filter((s) => isLockedSpend(s, now));
}

/** The release criteria, one predicate so the page and the write agree. */
function isLockedSpend(
  spend: {
    releasedAt: Date | null;
    spentOnSession: { expiresAt: Date; booking: { status: string } | null } | null;
  },
  now: Date,
): boolean {
  if (spend.releasedAt) return false;
  const session = spend.spentOnSession;
  if (!session) return false;
  // Only an abandoned checkout: a booking that reached created and then
  // stopped, past the funnel's freshness window. A paid or cancelled
  // booking is not ops' to unwind here.
  return session.booking?.status === "created" && session.expiresAt < now;
}

export async function createInfluencer(input: {
  name: string;
  email?: string | null;
  phone?: string | null;
  code: string;
  commissionRate?: number | null;
}) {
  const code = normalizeReferralCode(input.code);
  if (!isValidCodeFormat(code)) {
    throw new PublicError(400, "Codes are 3-12 letters and digits.");
  }
  if (input.commissionRate != null && (input.commissionRate <= 0 || input.commissionRate >= 0.5)) {
    throw new PublicError(400, "The rate is a fraction, e.g. 0.04 for 4%.");
  }
  try {
    return await prisma.referralParticipant.create({
      data: {
        kind: "influencer",
        name: input.name.trim(),
        email: input.email ? normalizeEmail(input.email) : null,
        phone: input.phone?.trim() || null,
        code,
        commissionRate: input.commissionRate ?? null,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new PublicError(409, "That code is already taken.");
    }
    throw err;
  }
}

/** Revoking is revoking the person; codes are never reissued or deleted. */
export async function setRevoked(participantId: string, revoked: boolean) {
  await prisma.referralParticipant.update({
    where: { id: participantId },
    data: { revokedAt: revoked ? new Date() : null },
  });
}

/**
 * The ops release for locked credit. The criteria are re-checked HERE, not
 * just when the page rendered: a "created" booking is resumable forever,
 * so the guest can pay between the admin reading the list and clicking the
 * button, and releasing behind a live booking would restore credit that
 * the folio already discounted.
 */
export async function releaseSpend(entryId: string) {
  const spend = await prisma.referralLedgerEntry.findUnique({
    where: { id: entryId },
    include: {
      spentOnSession: { select: { expiresAt: true, booking: { select: { status: true } } } },
    },
  });
  if (!spend || spend.kind !== "credit_spend") {
    throw new PublicError(404, "No such credit spend.");
  }
  if (spend.releasedAt) throw new PublicError(409, "That spend was already released.");
  if (!isLockedSpend(spend, new Date())) {
    throw new PublicError(
      409,
      "That booking is no longer an abandoned checkout, so its credit is genuinely spent. Refresh the list.",
    );
  }

  // Declaring the checkout dead is the whole point, so it must actually
  // die: a "created" record is resumable forever, and giving the credit
  // back while leaving the booking payable would let the guest collect the
  // credited total AND keep the credit. Guarded flip first, and only a
  // caller that wins it releases the claim (allowPosted, because a locked
  // claim is by definition one that already reached a folio).
  const record = await prisma.bookingRecord.findFirst({
    where: { sessionId: spend.spentOnSessionId ?? "" },
    include: { reservations: true },
  });
  if (!record) throw new PublicError(409, "That booking has gone. Refresh the list.");

  const killed = await prisma.bookingRecord.updateMany({
    where: { id: record.id, status: "created" },
    data: { status: "cancelled", cancelledAt: new Date(), refundAmount: 0 },
  });
  if (killed.count === 0) {
    throw new PublicError(
      409,
      "That booking was resumed while you were looking at it, so its credit is genuinely spent. Refresh the list.",
    );
  }

  const released = await releaseClaim(spend, prisma, { allowPosted: true });
  if (!released) {
    throw new PublicError(409, "That credit was released by someone else. Refresh the list.");
  }

  // Hand the lodges back. Idempotent and best effort: the credit is
  // already home and a stuck reservation is a smaller problem than a
  // half-done ops action, so a failure here is logged, not thrown.
  for (const child of record.reservations) {
    try {
      await cancelReservationOnce(child.apaleoReservationId);
    } catch (err) {
      console.error(`[referral] could not cancel ${child.apaleoReservationId} after credit release`, err);
    }
  }
}

export type PayoutDue = {
  participantId: string;
  name: string;
  phone: string | null;
  email: string | null;
  code: string;
  owed: number;
};

/** Influencers with matured commission not yet paid out. Accepts a
 * transaction client so runPayoutBatch derives dues INSIDE its own
 * transaction: derived outside, two concurrent batches under different ids
 * would each read the same owed sums and double-pay. */
export async function payoutsDue(db: Db = prisma): Promise<PayoutDue[]> {
  const influencers = await db.referralParticipant.findMany({
    where: { kind: "influencer" },
    orderBy: { name: "asc" },
  });
  const dues: PayoutDue[] = [];
  for (const p of influencers) {
    const owed = await commissionOwed(p.id, db);
    if (owed > 0) {
      dues.push({
        participantId: p.id,
        name: p.name,
        phone: p.phone,
        email: p.email,
        code: p.code,
        owed,
      });
    }
  }
  return dues;
}

/**
 * Mark a payout batch paid: one negative payout row per influencer owed,
 * all in one transaction. Idempotent two ways: the whole batch refuses to
 * run twice under the same id, and the DB unique on (participantId,
 * payoutBatchId) makes even a racing re-run a constraint error instead of
 * a double payment. Allan moves the actual money by hand from the CSV.
 */
export async function runPayoutBatch(
  batchId: string,
  /** What the admin actually saw and transferred, from the payouts page.
   *  The batch refuses to record anything else: commission matures with
   *  every passing departure date, so a batch derived purely at click time
   *  can mark an influencer paid whose money never moved. */
  expected: Array<{ participantId: string; owed: number }>,
): Promise<{ count: number; total: number }> {
  if (!/^[a-z0-9-]{4,40}$/i.test(batchId)) {
    throw new PublicError(400, "Batch ids are short slugs, e.g. 2026-08-influencers.");
  }
  try {
    return await prisma.$transaction(
      async (tx) => {
        // Dues derived inside the transaction (Serializable), so two
        // concurrent batches cannot both read the same owed sums; one of
        // them aborts and reports a retry instead of double-paying.
        const dues = await payoutsDue(tx);
        const owedById = new Map(dues.map((d) => [d.participantId, Math.round(d.owed)]));

        // The batch records exactly what the admin paid from the CSV, not
        // whatever is owed at click time: commission matures with every
        // passing departure date, and recording a stranger's maturing
        // commission as paid would bury money that never moved. Anything
        // that matured since simply belongs to the next batch.
        for (const entry of expected) {
          const owed = owedById.get(entry.participantId) ?? 0;
          if (Math.round(entry.owed) > owed) {
            throw new PublicError(
              409,
              "One of these payouts is no longer owed in full (it was paid by another run, or a booking was cancelled). Refresh, re-export the CSV, and pay from that.",
            );
          }
        }
        const existing = await tx.referralLedgerEntry.findFirst({
          where: { kind: "payout", payoutBatchId: batchId },
          select: { id: true },
        });
        if (existing) throw new PublicError(409, `Batch ${batchId} has already been run.`);
        for (const entry of expected) {
          await tx.referralLedgerEntry.create({
            data: {
              participantId: entry.participantId,
              kind: "payout",
              amount: -Math.round(entry.owed),
              payoutBatchId: batchId,
            },
          });
        }
        return {
          count: expected.length,
          total: expected.reduce((s, e) => s + Math.round(e.owed), 0),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new PublicError(409, `Batch ${batchId} has already been run.`);
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2034") {
      throw new PublicError(409, "Another payout run was in progress. Refresh and try again.");
    }
    throw err;
  }
}
