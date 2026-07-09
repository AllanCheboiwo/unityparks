import "server-only";
import type { SessionGuest, SessionLodge } from "@prisma/client";
import { prisma } from "../db";
import { PublicError } from "../api-helpers";
import { normalizeEmail } from "../auth/normalize";
import { parseChildrenAges } from "./session";

export type GuestInput = {
  position: number;
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  email?: string;
};

/**
 * The party shape one lodge's manifest must match, derived from what was
 * booked. Adults come first (slot 0 position 0 is the lead booker), then
 * children by their stored ages. Age thresholds mirror the search bands.
 */
export function partyBands(party: { adults: number; childrenAges: string }): string[] {
  const bands = Array<string>(party.adults).fill("adult");
  for (const age of parseChildrenAges(party)) {
    bands.push(age >= 6 ? "child" : age >= 2 ? "toddler" : "infant");
  }
  return bands;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Save one lodge's manifest: upsert-by-position inside a transaction,
 * deleting leftover rows, so row ids stay stable across edits (the
 * invite-a-guest seam depends on that). Counts are locked to that lodge's
 * booked party: changing the party is an amend concern, never a manifest
 * edit. Names and DOBs are optional - the card displays gaps instead of
 * rejecting them, so a break can always be saved.
 */
export async function saveGuests(
  lodge: SessionLodge,
  guests: GuestInput[],
): Promise<void> {
  const bands = partyBands(lodge);
  if (guests.length > bands.length) {
    throw new PublicError(
      400,
      `This lodge has ${bands.length} ${bands.length === 1 ? "guest" : "guests"}. Remove the extra rows.`,
    );
  }
  const seen = new Set<number>();
  for (const guest of guests) {
    if (guest.position < 0 || guest.position >= bands.length || seen.has(guest.position)) {
      throw new PublicError(400, "Guest rows do not match your party. Refresh and try again.");
    }
    seen.add(guest.position);
    if (guest.dateOfBirth && !ISO_DATE.test(guest.dateOfBirth)) {
      throw new PublicError(400, "Dates of birth need the YYYY-MM-DD format.");
    }
  }

  await prisma.$transaction(async (tx) => {
    for (const guest of guests) {
      const data = {
        band: bands[guest.position],
        // The lead booker is the first adult of the first lodge.
        isLead: lodge.slot === 0 && guest.position === 0,
        firstName: guest.firstName?.trim() || null,
        lastName: guest.lastName?.trim() || null,
        dateOfBirth: guest.dateOfBirth || null,
        email: guest.email ? normalizeEmail(guest.email) : null,
      };
      await tx.sessionGuest.upsert({
        where: {
          sessionId_slot_position: {
            sessionId: lodge.sessionId,
            slot: lodge.slot,
            position: guest.position,
          },
        },
        create: {
          sessionId: lodge.sessionId,
          slot: lodge.slot,
          position: guest.position,
          ...data,
        },
        update: data,
      });
    }
    await tx.sessionGuest.deleteMany({
      where: {
        sessionId: lodge.sessionId,
        slot: lodge.slot,
        position: { notIn: guests.map((g) => g.position) },
      },
    });
  });
}

export async function loadGuests(sessionId: string): Promise<SessionGuest[]> {
  return prisma.sessionGuest.findMany({
    where: { sessionId },
    orderBy: [{ slot: "asc" }, { position: "asc" }],
  });
}

/** The wire shape shared by the funnel step and the manage card. */
export function guestRowDto(guest: SessionGuest) {
  return {
    slot: guest.slot,
    position: guest.position,
    band: guest.band,
    isLead: guest.isLead,
    firstName: guest.firstName,
    lastName: guest.lastName,
    dateOfBirth: guest.dateOfBirth,
    email: guest.email,
  };
}
