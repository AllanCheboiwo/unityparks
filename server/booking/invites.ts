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
  stay: { arrival: string; departure: string; adults: number; unitGroupCode: string };
  lodges: Array<{
    slot: number;
    unitGroupCode: string;
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
    status:
      dto.status === "cancelled" || dto.cancelledAt ? "cancelled" : "confirmed",
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
