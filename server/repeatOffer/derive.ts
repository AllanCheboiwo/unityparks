import "server-only";
import { prisma } from "../db";
import { qualifyingStay, type StayFacts } from "./eligibility";
import { OFFER_LODGE_CAP, OFFER_PER_LODGE, offerDeadline } from "@/lib/repeatOffer";

/**
 * The executor half of eligibility: load the facts, let the pure policy
 * (./eligibility.ts) decide. Everything money-relevant is decided in pure
 * code; the queries here only bound the read.
 */

/** Property-local today (+02:00), the same discipline as the manifest rule. */
export function propertyTodayIso(now = new Date()): string {
  return new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Candidate stays for a user: paid records they own or hold a live
 * accepted invite on. Window, manifest and membership fine-print run in
 * qualifyingStay, not in SQL. */
const STAY_SELECT = {
  id: true,
  userId: true,
  status: true,
  session: { select: { departure: true } },
  invites: {
    select: { acceptedByUserId: true, revokedAt: true, createdAt: true },
  },
} as const;

type StayRow = {
  id: string;
  userId: string | null;
  status: string;
  session: { departure: string };
  invites: Array<{ acceptedByUserId: string | null; revokedAt: Date | null; createdAt: Date }>;
};

function toStayFacts(record: StayRow): StayFacts {
  return {
    recordId: record.id,
    ownerUserId: record.userId,
    status: record.status,
    departure: record.session.departure,
    invites: record.invites.map((invite) => ({
      acceptedByUserId: invite.acceptedByUserId,
      revokedAt: invite.revokedAt ? invite.revokedAt.toISOString() : null,
      createdAtIso: invite.createdAt.toISOString(),
    })),
  };
}

export async function stayFactsForUser(userId: string): Promise<StayFacts[]> {
  const records = await prisma.bookingRecord.findMany({
    where: {
      status: "paid",
      OR: [
        { userId },
        { invites: { some: { acceptedByUserId: userId, revokedAt: null } } },
      ],
    },
    select: STAY_SELECT,
  });
  return records.map(toStayFacts);
}

/** Fresh facts for one earning stay, for the claim's re-check. */
export async function stayFactsById(recordId: string): Promise<StayFacts | null> {
  const record = await prisma.bookingRecord.findUnique({
    where: { id: recordId },
    select: STAY_SELECT,
  });
  return record ? toStayFacts(record) : null;
}

/** This session's redemption row while it is still PENDING, else null.
 * A PENDING row means a checkout attempt is (or was) in flight and its
 * allowance may already sit on the folios: the row, not the session
 * snapshot, is the money truth (server/repeatOffer/claim.ts). */
export async function pendingRedemptionForSession(sessionId: string) {
  const row = await prisma.repeatGuestRedemption.findUnique({ where: { sessionId } });
  return row && row.status === "PENDING" ? row : null;
}

export type OfferView = {
  earnedByRecordId: string;
  departure: string;
  deadline: string; // last day to book
  perLodge: number;
  maxLodges: number;
};

/** The signed-in user's live offer, or null. Drives the pay-step card and
 * the account card; the claim re-derives independently at checkout. */
export async function offerForUser(
  userId: string | null,
  todayIso: string = propertyTodayIso(),
): Promise<OfferView | null> {
  if (!userId) return null;
  const stay = qualifyingStay({ userId, stays: await stayFactsForUser(userId), todayIso });
  if (!stay) return null;
  return {
    earnedByRecordId: stay.recordId,
    departure: stay.departure,
    deadline: offerDeadline(stay.departure),
    perLodge: OFFER_PER_LODGE,
    maxLodges: OFFER_LODGE_CAP,
  };
}
