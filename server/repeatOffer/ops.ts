import "server-only";
import { prisma } from "../db";
import { sendEmail } from "../email/resend";
import {
  sendRepeatOfferNotices,
  type PendingOfferNotice,
  type RepeatOfferStore,
} from "../email/repeatOffer";
import { isOfferNotifiable } from "./notify";
import { isSweepablePending } from "./claim";
import { propertyTodayIso } from "./derive";
import { OFFER_LODGE_CAP, OFFER_PER_LODGE, offerDeadline } from "@/lib/repeatOffer";

/**
 * The ops job behind POST /api/ops/repeat-offers/run: sweep dead-checkout
 * PENDING rows past the 24h Apaleo boundary, then send the post-stay
 * reminder to notifiable leads. Stamp-first and run-twice-safe throughout;
 * an overlapping run costs nothing.
 */

function appBaseUrl(): string {
  return (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

export async function runRepeatOffers(): Promise<{
  considered: number;
  sent: number;
  swept: number;
}> {
  // Sweep first: a swept row can no longer be adopted, which is exactly
  // right strictly past the dedup boundary and forbidden inside it
  // (isSweepablePending owns that line).
  const nowIso = new Date().toISOString();
  const pendings = await prisma.repeatGuestRedemption.findMany({
    where: { status: "PENDING" },
    select: { id: true, status: true, createdAt: true },
  });
  const sweepIds = pendings
    .filter((row) =>
      isSweepablePending(
        { status: row.status, createdAtIso: row.createdAt.toISOString() },
        nowIso,
      ),
    )
    .map((row) => row.id);
  const swept =
    sweepIds.length === 0
      ? 0
      : (
          await prisma.repeatGuestRedemption.updateMany({
            // Conditional on PENDING again: a checkout confirming right now
            // must win over the sweep.
            where: { id: { in: sweepIds }, status: "PENDING" },
            data: { status: "RELEASED" },
          })
        ).count;

  // Notify: paid, unstamped, owned records; the pure predicate applies the
  // window and consent rules.
  const todayIso = propertyTodayIso();
  const candidates = await prisma.bookingRecord.findMany({
    where: { status: "paid", offerEmailSentAt: null, userId: { not: null } },
    select: {
      id: true,
      status: true,
      session: { select: { departure: true } },
      user: { select: { email: true, firstName: true, marketingEmail: true } },
    },
  });
  const notices: PendingOfferNotice[] = candidates
    .filter(
      (candidate) =>
        candidate.user &&
        isOfferNotifiable(
          {
            status: candidate.status,
            departure: candidate.session.departure,
            leadMarketingEmail: candidate.user.marketingEmail,
            offerEmailSentAt: null,
          },
          todayIso,
        ),
    )
    .map((candidate) => ({
      recordId: candidate.id,
      email: candidate.user!.email,
      facts: {
        firstName: candidate.user!.firstName,
        perLodgeAmount: OFFER_PER_LODGE,
        maxLodges: OFFER_LODGE_CAP,
        deadline: offerDeadline(candidate.session.departure),
        accountUrl: `${appBaseUrl()}/account`,
      },
    }));

  let sent = 0;
  const store: RepeatOfferStore = {
    loadPending: async () => notices,
    claim: async (recordId) => {
      const claimed = await prisma.bookingRecord.updateMany({
        where: { id: recordId, offerEmailSentAt: null },
        data: { offerEmailSentAt: new Date() },
      });
      return claimed.count === 1;
    },
    // Stamp-stays: the sender never calls this (spec section 9).
    release: async () => {},
  };
  await sendRepeatOfferNotices(store, async (args) => {
    const result = await sendEmail(args);
    if (result.sent) sent += 1;
    return result;
  });

  return { considered: candidates.length, sent, swept };
}

export type RepeatOfferOverviewRow = {
  recordId: string;
  leadEmail: string | null;
  departure: string;
  deadline: string;
  notifiedAt: string | null;
  redemptions: number;
};

/** The /ops/repeat-offers read-out: every paid stay still inside its
 * window, its notification state and how many times it has been claimed.
 * A read-out, not a control panel: there is nothing to revoke. */
export async function repeatOfferOverview(): Promise<RepeatOfferOverviewRow[]> {
  const todayIso = propertyTodayIso();
  const records = await prisma.bookingRecord.findMany({
    where: { status: "paid" },
    select: {
      id: true,
      offerEmailSentAt: true,
      session: { select: { departure: true } },
      user: { select: { email: true } },
      redemptionsEarned: { select: { status: true } },
    },
  });
  return records
    .filter((record) => {
      const departed = record.session.departure < todayIso;
      return departed && offerDeadline(record.session.departure) >= todayIso;
    })
    .map((record) => ({
      recordId: record.id,
      leadEmail: record.user?.email ?? null,
      departure: record.session.departure,
      deadline: offerDeadline(record.session.departure),
      notifiedAt: record.offerEmailSentAt ? record.offerEmailSentAt.toISOString() : null,
      redemptions: record.redemptionsEarned.filter((r) => r.status === "CONFIRMED").length,
    }))
    .sort((a, b) => (a.departure < b.departure ? 1 : -1));
}
