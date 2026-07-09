import "server-only";
import type { BookingSession } from "@prisma/client";
import { prisma } from "../db";
import { normalizeEmail } from "../auth/normalize";
import { validateStay } from "./rules";

// Generous for a demo walk-through; refreshed on every step so a session
// only dies if genuinely abandoned.
const SESSION_TTL_MS = 30 * 60 * 1000;

/** Snapshot of one chosen extra, exactly as Apaleo priced it. */
export type ExtraSnapshot = {
  serviceId: string;
  code: string;
  name: string;
  count: number;
  grossAmount: number;
};

function freshExpiry(): Date {
  return new Date(Date.now() + SESSION_TTL_MS);
}

export async function createSession(input: {
  arrival: string;
  departure: string;
  adults: number;
  childrenAges?: number[];
  // The signed-in user, when there is one. Checkout copies this onto the
  // BookingRecord, so it must be stamped here rather than read from the
  // cookie later - checkout retries can arrive logged-out.
  userId?: string | null;
}): Promise<BookingSession> {
  const check = validateStay(input.arrival, input.departure);
  if (!check.ok) throw new Error(check.reason);

  return prisma.bookingSession.create({
    data: {
      arrival: input.arrival,
      departure: input.departure,
      adults: input.adults,
      childrenAges: JSON.stringify(input.childrenAges ?? []),
      userId: input.userId ?? null,
      expiresAt: freshExpiry(),
    },
  });
}

export function parseChildrenAges(session: BookingSession): number[] {
  return JSON.parse(session.childrenAges) as number[];
}

/** Returns null for unknown or expired sessions - callers send those back to search. */
export async function getSession(id: string): Promise<BookingSession | null> {
  const session = await prisma.bookingSession.findUnique({ where: { id } });
  if (!session) return null;
  if (session.state !== "completed" && session.expiresAt < new Date()) return null;
  return session;
}

export async function chooseLodge(
  id: string,
  lodge: {
    unitGroupCode: string;
    ratePlanId: string;
    stayGrossAmount: number;
    currency: string;
  },
): Promise<BookingSession> {
  return prisma.bookingSession.update({
    where: { id },
    data: {
      ...lodge,
      // Changing lodge resets extras - they were priced for the old rate plan.
      extras: "[]",
      expiresAt: freshExpiry(),
    },
  });
}

export async function setExtras(
  id: string,
  extras: ExtraSnapshot[],
): Promise<BookingSession> {
  return prisma.bookingSession.update({
    where: { id },
    data: { extras: JSON.stringify(extras), expiresAt: freshExpiry() },
  });
}

export async function setGuestDetails(
  id: string,
  guest: {
    title?: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    dateOfBirth?: string;
    vehiclePlate?: string;
    marketingEmail?: boolean;
    marketingSms?: boolean;
  },
  // Identity snapshot: whoever is signed in NOW owns this walk (null when
  // signed out). Written unconditionally so a sign-out mid-funnel on a
  // shared machine cannot leave the previous user's stamp behind.
  userId: string | null = null,
): Promise<BookingSession> {
  return prisma.bookingSession.update({
    where: { id },
    data: {
      guestTitle: guest.title ?? null,
      guestFirstName: guest.firstName,
      guestLastName: guest.lastName,
      guestEmail: normalizeEmail(guest.email),
      guestPhone: guest.phone,
      guestDateOfBirth: guest.dateOfBirth ?? null,
      vehiclePlate: guest.vehiclePlate ?? null,
      marketingEmail: guest.marketingEmail ?? false,
      marketingSms: guest.marketingSms ?? false,
      userId,
      state: "checkout",
      expiresAt: freshExpiry(),
    },
  });
}

/**
 * Inline sign-in mid-funnel: the walk now belongs to this user, overwriting
 * any earlier stamp (shared-machine sign-out safety). Refreshes the TTL so
 * the sign-in interruption never costs the guest their basket. Completed
 * sessions are never touched - their ownership is settled.
 */
export async function stampSessionUser(id: string, userId: string): Promise<void> {
  await prisma.bookingSession.updateMany({
    where: { id, state: { not: "completed" } },
    data: { userId, expiresAt: freshExpiry() },
  });
}

export function parseExtras(session: BookingSession): ExtraSnapshot[] {
  return JSON.parse(session.extras) as ExtraSnapshot[];
}
