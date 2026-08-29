import "server-only";

/**
 * Invite-a-guest policy (UNP-20, docs/invite-a-guest-plan.md), pure logic.
 *
 * planReconcile answers, for one booking, which invites to revoke and which
 * to create. The prisma executor around it owns transactions, token minting
 * and the invitedUserId mirror; every decision lives here so the frozen
 * suite can hold it still. decideAccept is the accept page's decision
 * table. redactBookingForInvitee builds the read-only view an invited
 * guest may see: an allow-list, so a new money field on the owner DTO is
 * hidden by default rather than leaked by default.
 *
 * Emails in every input are already normalized (lowercased) by saveGuests
 * and the User schema; nothing here re-normalizes.
 */

/** Lifetime cap on invite rows per booking. Seats are bounded by the booked
 * party, but churning one seat's email would otherwise mail strangers
 * without limit on an owner's say-so. */
export const INVITE_LIFETIME_CAP = 20;

export type SeatRow = {
  guestId: string;
  slot: number;
  position: number;
  isLead: boolean;
  email: string | null;
};

export type InviteRow = {
  id: string;
  guestId: string;
  email: string;
  revokedAt: Date | null;
  acceptedAt: Date | null;
  acceptedByUserId: string | null;
};

export type ReconcileInput = {
  cancelled: boolean;
  leadEmail: string | null;
  /** The lodges' current booked shape, partyBands per slot. An invite only
   * lives on a seat that is an adult, non-lead seat inside this shape. */
  bandsBySlot: Record<number, string[]>;
  seats: SeatRow[];
  invites: InviteRow[];
};

export type ReconcilePlan = {
  revoke: string[];
  create: Array<{ guestId: string; email: string }>;
};

export function planReconcile(input: ReconcileInput): ReconcilePlan {
  // A cancelled booking's invites are dead by derivation already; touching
  // them would only churn rows.
  if (input.cancelled) return { revoke: [], create: [] };

  // Which address each seat should hold an invite for, walking seats in
  // (slot, position) order so "the earlier seat" is well defined for both
  // the lead-address drop and the duplicate collapse.
  const ordered = [...input.seats].sort(
    (a, b) => a.slot - b.slot || a.position - b.position,
  );
  const used = new Set<string>();
  if (input.leadEmail) used.add(input.leadEmail);
  const desired = new Map<string, string>(); // guestId -> email
  for (const seat of ordered) {
    const bands = input.bandsBySlot[seat.slot];
    const fits =
      !seat.isLead &&
      bands !== undefined &&
      seat.position < bands.length &&
      bands[seat.position] === "adult";
    if (!fits || !seat.email || used.has(seat.email)) continue;
    used.add(seat.email);
    desired.set(seat.guestId, seat.email);
  }

  // Revoke every live invite that no longer matches its seat's desired
  // address, whatever the reason: email changed, email cleared, seat fell
  // outside the shape, or the address collapsed onto an earlier seat.
  const revoke: string[] = [];
  const satisfied = new Set<string>(); // guestIds with a matching live invite
  for (const invite of input.invites) {
    if (invite.revokedAt) continue;
    if (desired.get(invite.guestId) === invite.email) {
      satisfied.add(invite.guestId);
    } else {
      revoke.push(invite.id);
    }
  }

  // Create for every desired address not already carried by a live invite,
  // stopping at the lifetime cap. Revoked rows count toward the cap: it
  // bounds emails ever sent, not invites currently live.
  const create: ReconcilePlan["create"] = [];
  let total = input.invites.length;
  for (const seat of ordered) {
    const email = desired.get(seat.guestId);
    if (!email || satisfied.has(seat.guestId)) continue;
    if (total >= INVITE_LIFETIME_CAP) break;
    create.push({ guestId: seat.guestId, email });
    total += 1;
  }
  return { revoke, create };
}

/** The one spelling of "is this booking dead": a cancelled status or a
 * cancellation stamp. Every surface (accept page, accept route, redaction)
 * asks this instead of re-deriving it. */
export function bookingCancelled(record: {
  status: string;
  cancelledAt: Date | string | null;
}): boolean {
  return record.status === "cancelled" || record.cancelledAt !== null;
}

/** "a***@example.com": enough to recognise your own address, no more. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  return `${local?.[0] ?? ""}***@${domain ?? ""}`;
}

export type AcceptDecision = "accept" | "already" | "wrong-email" | "unavailable";

/**
 * The accept page's decision table. Revocation and cancellation dominate
 * everything, so a dead token answers the same to every account and leaks
 * nothing; then prior acceptance; then the address binding.
 */
export function decideAccept(
  invite: InviteRow | null,
  ctx: { userId: string; userEmail: string; bookingCancelled: boolean },
): AcceptDecision {
  if (!invite || invite.revokedAt || ctx.bookingCancelled) return "unavailable";
  if (invite.acceptedAt) {
    return invite.acceptedByUserId === ctx.userId ? "already" : "unavailable";
  }
  if (invite.email !== ctx.userEmail) return "wrong-email";
  return "accept";
}

/** The slice of the owner booking DTO the redaction reads. Everything else
 * on the DTO is invisible to this function by construction. */
type OwnerView = {
  bookingId: string;
  reservationId: string;
  status: string;
  cancelledAt: string | Date | null;
  stay: { arrival: string; departure: string; adults: number; unitGroupCode: string | null };
  lodges: Array<{
    slot: number;
    unitGroupCode: string | null;
    partyLabel: string;
    bands: string[];
    assignedUnitName: string | null;
    guests: Array<{
      slot: number;
      position: number;
      band: string;
      isLead: boolean;
      firstName: string | null;
      lastName: string | null;
      dateOfBirth: string | null;
      email: string | null;
    }>;
  }>;
  guest: { firstName: string | null };
};

/**
 * The read-only view for an accepted invitee: dates, village-level facts,
 * lodge tier, the party's first names, and the viewer's own details. Built
 * as an allow-list; no spread of the input anywhere.
 */
export function redactBookingForInvitee(dto: OwnerView, viewerEmail: string) {
  return {
    bookingId: dto.bookingId,
    reservationId: dto.reservationId,
    status: bookingCancelled(dto) ? "cancelled" : "confirmed",
    stay: {
      arrival: dto.stay.arrival,
      departure: dto.stay.departure,
      adults: dto.stay.adults,
      unitGroupCode: dto.stay.unitGroupCode,
    },
    lodges: dto.lodges.map((lodge) => ({
      slot: lodge.slot,
      unitGroupCode: lodge.unitGroupCode,
      partyLabel: lodge.partyLabel,
      bands: lodge.bands,
      assignedUnitName: lodge.assignedUnitName,
      guests: lodge.guests.map((guest) => {
        const own = guest.email !== null && guest.email === viewerEmail;
        return {
          slot: guest.slot,
          position: guest.position,
          band: guest.band,
          isLead: guest.isLead,
          firstName: guest.firstName,
          lastName: own ? guest.lastName : null,
          dateOfBirth: own ? guest.dateOfBirth : null,
          email: own ? guest.email : null,
        };
      }),
    })),
    guest: { firstName: dto.guest.firstName },
  };
}

// ---------------------------------------------------------------------------
// Prisma executors. Thin by design: every decision above is frozen under
// test; these load state, apply plans and mint tokens, nothing more.
// ---------------------------------------------------------------------------

import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { partyBands } from "./guests";
import { sendPartyInvites, type PartyInviteStore } from "../email/partyInvite";
import { sendEmail } from "../email/resend";
import { VILLAGE_NAME } from "@/content/village";
import { LODGES } from "@/content/lodges";

function appBaseUrl(): string {
  return process.env.APP_BASE_URL ?? "http://localhost:3000";
}

/**
 * Bring one booking's invites in line with its guest manifest, then mail
 * whatever is pending. Never throws: a booking must never fail because an
 * invite could not be written. Serializable so the callback/IPN
 * double-settle cannot create two live invites for one seat; the losing
 * racer's conflict is swallowed because the winner did the same work.
 */
export async function reconcileInvites(recordId: string): Promise<void> {
  try {
    // The whole read-plan-apply runs inside one Serializable transaction:
    // the read set is what gives a concurrent reconcile (callback vs IPN)
    // a conflict to abort on. Planning from a read taken outside the
    // transaction would let two insert-only racers both commit a live
    // invite for the same seat.
    await prisma.$transaction(
      async (tx) => {
        const record = await tx.bookingRecord.findUnique({
          where: { id: recordId },
          include: {
            session: { include: { lodges: true, guests: true } },
            invites: true,
          },
        });
        if (!record) return;
        // Invites exist only for bookings money has moved on (the spec's
        // deposit_paid-or-paid trigger). This also keeps a cancelled
        // booking's leftover unsent invites from ever being mailed: the
        // sender below never runs for it.
        if (record.status !== "deposit_paid" && record.status !== "paid") return;

        const bandsBySlot: Record<number, string[]> = {};
        for (const lodge of record.session.lodges) {
          bandsBySlot[lodge.slot] = partyBands(lodge);
        }
        const plan = planReconcile({
          cancelled: record.cancelledAt !== null,
          leadEmail: record.session.guestEmail?.toLowerCase() ?? null,
          bandsBySlot,
          seats: record.session.guests.map((g) => ({
            guestId: g.id,
            slot: g.slot,
            position: g.position,
            isLead: g.isLead,
            email: g.email,
          })),
          invites: record.invites,
        });
        if (plan.revoke.length === 0 && plan.create.length === 0) return;

        const now = new Date();
        if (plan.revoke.length > 0) {
          await tx.bookingInvite.updateMany({
            where: { id: { in: plan.revoke } },
            data: { revokedAt: now },
          });
          // The mirror follows the live invite: cleared on revoke.
          await tx.sessionGuest.updateMany({
            where: {
              id: {
                in: record.invites
                  .filter((i) => plan.revoke.includes(i.id))
                  .map((i) => i.guestId),
              },
            },
            data: { invitedUserId: null },
          });
        }
        for (const create of plan.create) {
          await tx.bookingInvite.create({
            data: {
              id: randomBytes(32).toString("base64url"),
              recordId,
              guestId: create.guestId,
              email: create.email,
            },
          });
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    await sendPartyInvites(prismaInviteStore(recordId), sendEmail);
  } catch (err) {
    console.error(`[invites] reconcile for record ${recordId} failed`, err);
  }
}

/** The sender's storage, over prisma. Pending means live and unsent; the
 * claim is the same atomic conditional update every email stamp uses. */
function prismaInviteStore(recordId: string): PartyInviteStore {
  return {
    async loadPending() {
      const record = await prisma.bookingRecord.findUnique({
        where: { id: recordId },
        include: {
          session: { include: { lodges: true } },
          invites: {
            where: { revokedAt: null, sentAt: null },
            include: { guest: true },
          },
        },
      });
      // The status gate again, for the sender's own callers: a released
      // claim must never be mailed once the booking stops being live.
      if (!record || (record.status !== "deposit_paid" && record.status !== "paid")) {
        return [];
      }
      return record.invites.map((invite) => {
        // The invited seat's own lodge names the tier in the email.
        const lodge = record.session.lodges.find(
          (l) => l.slot === invite.guest.slot,
        );
        return {
          inviteId: invite.id,
          email: invite.email,
          facts: {
            leadFirstName: record.session.guestFirstName,
            leadLastName: record.session.guestLastName,
            village: VILLAGE_NAME,
            arrival: record.session.arrival,
            departure: record.session.departure,
            lodgeName:
              LODGES[lodge?.unitGroupCode ?? ""]?.name ??
              lodge?.unitGroupCode ??
              "your lodge",
            inviteUrl: `${appBaseUrl()}/invite/${invite.id}`,
          },
        };
      });
    },
    async claim(inviteId) {
      const claimed = await prisma.bookingInvite.updateMany({
        where: { id: inviteId, sentAt: null },
        data: { sentAt: new Date() },
      });
      return claimed.count === 1;
    },
    async release(inviteId) {
      await prisma.bookingInvite.updateMany({
        where: { id: inviteId },
        data: { sentAt: null },
      });
    },
  };
}

/** One invite with what the accept page needs to decide. */
export async function loadInviteForAccept(token: string) {
  return prisma.bookingInvite.findUnique({
    where: { id: token },
    // Only what the page and route read: the record and its session facts.
    include: { record: { include: { session: true } } },
  });
}

/**
 * The accept executor: one conditional update, so an accept racing a revoke
 * resolves in the database. Returns whether this call won; a loser re-reads
 * state and lets decideAccept name what happened.
 */
export async function acceptInvite(token: string, userId: string): Promise<boolean> {
  try {
    return await prisma.$transaction(async (tx) => {
      const won = await tx.bookingInvite.updateMany({
        where: { id: token, acceptedAt: null, revokedAt: null },
        data: { acceptedAt: new Date(), acceptedByUserId: userId },
      });
      if (won.count !== 1) return false;
      const invite = await tx.bookingInvite.findUniqueOrThrow({ where: { id: token } });
      // The mirror follows the live invite: set on accept.
      await tx.sessionGuest.update({
        where: { id: invite.guestId },
        data: { invitedUserId: userId },
      });
      return true;
    });
  } catch (err) {
    // A seat deletion can cascade the invite away between the claim and
    // the mirror write (P2025). That is a lost race, not a server error:
    // the caller re-reads and answers the uniform unavailable copy.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return false;
    }
    throw err;
  }
}
