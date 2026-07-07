import "server-only";
import type { BookingSession } from "@prisma/client";
import { prisma } from "../db";
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
}): Promise<BookingSession> {
  const check = validateStay(input.arrival, input.departure);
  if (!check.ok) throw new Error(check.reason);

  return prisma.bookingSession.create({
    data: {
      arrival: input.arrival,
      departure: input.departure,
      adults: input.adults,
      childrenAges: JSON.stringify(input.childrenAges ?? []),
      expiresAt: freshExpiry(),
    },
  });
}

export function parseChildrenAges(session: BookingSession): number[] {
  return JSON.parse(session.childrenAges) as number[];
}

/** Returns null for unknown or expired sessions — callers send those back to search. */
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
      // Changing lodge resets extras — they were priced for the old rate plan.
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
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    vehiclePlate?: string;
  },
): Promise<BookingSession> {
  return prisma.bookingSession.update({
    where: { id },
    data: {
      guestFirstName: guest.firstName,
      guestLastName: guest.lastName,
      guestEmail: guest.email,
      guestPhone: guest.phone,
      vehiclePlate: guest.vehiclePlate ?? null,
      state: "checkout",
      expiresAt: freshExpiry(),
    },
  });
}

export function parseExtras(session: BookingSession): ExtraSnapshot[] {
  return JSON.parse(session.extras) as ExtraSnapshot[];
}
