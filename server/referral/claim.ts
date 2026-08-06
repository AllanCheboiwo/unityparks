import "server-only";
import { Prisma, type PrismaClient, type ReferralLedgerEntry } from "@prisma/client";
import { prisma } from "../db";

/**
 * The credit_spend claim lifecycle. One session may ever claim one spend
 * (unique spentOnSessionId), and that row carries its own state, so the two
 * actors who race over it - the guest toggling credit off, and a checkout
 * committing it to a folio - both take a GUARDED WRITE ON THE SAME ROW.
 * The database serializes them; the loser's guard returns count 0 and it
 * backs off honestly. Nothing else in the codebase may decide a claim's
 * fate by reading a second row, which is what let credit be released and
 * spent at the same time (plan 6.3).
 *
 * States, all on the spend row:
 *   fresh              releasedAt null, postingStartedAt null
 *   committed          postingStartedAt set: it is on a folio, no release
 *   released           releasedAt set: back in the pool, never re-usable
 */

type Db = PrismaClient | Prisma.TransactionClient;

/** The session's claim, whatever its state (null when never claimed). */
export function findClaim(sessionId: string, db: Db = prisma) {
  return db.referralLedgerEntry.findUnique({ where: { spentOnSessionId: sessionId } });
}

/** A claim still owed to this booking: not released. */
export function isLiveClaim(claim: ReferralLedgerEntry | null): claim is ReferralLedgerEntry {
  return claim !== null && claim.releasedAt === null;
}

/**
 * Give a claim back to the pool: mark the row and append the paired
 * credit_release value entry, in one transaction so a crash can never
 * leave one without the other. Refuses (false) when the claim is already
 * released, or when a checkout has committed it to a folio.
 *
 * allowPosted is for ops only. A committed claim is normally untouchable
 * (its money is on a bill someone may still pay), but the locked-credit
 * case in plan 6.3 is exactly a committed claim on a checkout that died,
 * and a human has judged it dead. The ops caller must make that booking
 * unresumable in the same breath, or the guest could still pay the
 * discounted total after their credit went home.
 */
export async function releaseClaim(
  claim: ReferralLedgerEntry,
  db: Db = prisma,
  options: { allowPosted?: boolean } = {},
): Promise<boolean> {
  const run = async (tx: Db) => {
    const marked = await tx.referralLedgerEntry.updateMany({
      where: {
        id: claim.id,
        releasedAt: null,
        ...(options.allowPosted ? {} : { postingStartedAt: null }),
      },
      data: { releasedAt: new Date() },
    });
    if (marked.count === 0) return false;
    // createMany + skipDuplicates is ON CONFLICT DO NOTHING, so a paired
    // row that somehow exists cannot abort this transaction (a caught
    // P2002 would still poison it and roll the mark back).
    await tx.referralLedgerEntry.createMany({
      data: [
        {
          participantId: claim.participantId,
          kind: "credit_release",
          amount: Math.abs(claim.amount),
          releaseOfEntryId: claim.id,
        },
      ],
      skipDuplicates: true,
    });
    return true;
  };
  // Callers inside a transaction pass their own client; everyone else gets
  // one here so the mark and the value entry commit together.
  return "$transaction" in db ? db.$transaction((tx) => run(tx)) : run(db);
}

/**
 * Commit a claim to this checkout, immediately before its folio allowance
 * is posted. False means the guest released it first, so the caller must
 * refuse rather than post: the pool already has the credit back.
 */
export async function markClaimPosting(claimId: string, db: Db = prisma): Promise<boolean> {
  const marked = await db.referralLedgerEntry.updateMany({
    where: { id: claimId, releasedAt: null },
    data: { postingStartedAt: new Date() },
  });
  return marked.count > 0;
}
