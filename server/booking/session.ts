import "server-only";
import type { BookingSession, SessionLodge } from "@prisma/client";
import { prisma } from "../db";
import { normalizeEmail } from "../auth/normalize";
import { validateStay } from "./rules";

/** A session with its lodges, cheapest-slot-first. Most callers want this. */
export type SessionWithLodges = BookingSession & { lodges: SessionLodge[] };

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

/**
 * The location step's choice for one lodge. "unit" carries the picked lodge
 * plus the fee exactly as Apaleo's service offer priced it; "together" pays
 * the same fee per lodge for checkout to seat the break's lodges side by
 * side (no unit until then); "none" is the free no-preference option.
 */
export type LocationChoice =
  | { choice: "none" }
  | {
      choice: "unit";
      unitId: string;
      unitName: string;
      serviceId: string;
      fee: number;
    }
  | { choice: "together"; serviceId: string; fee: number };

function freshExpiry(): Date {
  return new Date(Date.now() + SESSION_TTL_MS);
}

export async function createSession(input: {
  arrival: string;
  departure: string;
  // One entry per lodge in the break; a single-lodge booking is one entry.
  parties: Array<{ adults: number; childrenAges?: number[] }>;
  // The signed-in user, when there is one. Checkout copies this onto the
  // BookingRecord, so it must be stamped here rather than read from the
  // cookie later - checkout retries can arrive logged-out.
  userId?: string | null;
  // Referral code from the up_ref cookie, stamped for the same reason as
  // userId: the funnel never reads the cookie after this point. Editable
  // at the details step until a BookingRecord freezes it.
  referralCode?: string | null;
}): Promise<SessionWithLodges> {
  const check = validateStay(input.arrival, input.departure);
  if (!check.ok) throw new Error(check.reason);
  if (input.parties.length < 1 || input.parties.length > 3) {
    throw new Error("A break has between one and three lodges.");
  }

  // Legacy mirror: the session-level party columns hold the whole break's
  // totals so existing single-lodge readers stay sensible during the
  // multi-lodge transition.
  const totalAdults = input.parties.reduce((sum, p) => sum + p.adults, 0);
  const allChildrenAges = input.parties.flatMap((p) => p.childrenAges ?? []);

  return prisma.bookingSession.create({
    data: {
      arrival: input.arrival,
      departure: input.departure,
      adults: totalAdults,
      childrenAges: JSON.stringify(allChildrenAges),
      userId: input.userId ?? null,
      referralCode: input.referralCode ?? null,
      expiresAt: freshExpiry(),
      lodges: {
        create: input.parties.map((party, slot) => ({
          slot,
          adults: party.adults,
          childrenAges: JSON.stringify(party.childrenAges ?? []),
        })),
      },
    },
    include: { lodges: { orderBy: { slot: "asc" } } },
  });
}

/** Works on a session (whole-break totals) or a single lodge's party. */
export function parseChildrenAges(source: { childrenAges: string }): number[] {
  return JSON.parse(source.childrenAges) as number[];
}

/** Returns null for unknown or expired sessions - callers send those back to search. */
export async function getSession(id: string): Promise<SessionWithLodges | null> {
  const session = await prisma.bookingSession.findUnique({
    where: { id },
    include: { lodges: { orderBy: { slot: "asc" } } },
  });
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
  slot = 0,
): Promise<void> {
  const { currency, ...tier } = lodge;
  await prisma.sessionLodge.update({
    where: { sessionId_slot: { sessionId: id, slot } },
    // Changing lodge resets extras (priced for the old rate plan) and the
    // location choice (the picked unit belongs to the old tier).
    data: {
      ...tier,
      extras: "[]",
      locationChoice: null,
      locationUnitId: null,
      locationUnitName: null,
      locationServiceId: null,
      locationFee: null,
    },
  });
  await prisma.bookingSession.update({
    where: { id },
    data: {
      // Legacy mirror of slot 0 during the multi-lodge transition; currency
      // lives at session level either way.
      ...(slot === 0 ? { ...tier, extras: "[]" } : {}),
      currency,
      expiresAt: freshExpiry(),
    },
  });
}

export async function setExtras(
  id: string,
  extras: ExtraSnapshot[],
  slot = 0,
): Promise<void> {
  await prisma.sessionLodge.update({
    where: { sessionId_slot: { sessionId: id, slot } },
    data: { extras: JSON.stringify(extras) },
  });
  await prisma.bookingSession.update({
    where: { id },
    data: {
      ...(slot === 0 ? { extras: JSON.stringify(extras) } : {}),
      expiresAt: freshExpiry(),
    },
  });
}

/** Save one lodge's location choice. No flat mirror: location never existed
 *  on the legacy single-lodge columns, so there is nothing to keep in step. */
export async function setLocation(
  id: string,
  location: LocationChoice,
  slot = 0,
): Promise<void> {
  const data =
    location.choice === "unit"
      ? {
          locationChoice: "unit",
          locationUnitId: location.unitId,
          locationUnitName: location.unitName,
          locationServiceId: location.serviceId,
          locationFee: location.fee,
        }
      : location.choice === "together"
        ? {
            locationChoice: "together",
            locationUnitId: null,
            locationUnitName: null,
            locationServiceId: location.serviceId,
            locationFee: location.fee,
          }
        : {
            locationChoice: "none",
            locationUnitId: null,
            locationUnitName: null,
            locationServiceId: null,
            locationFee: null,
          };
  await prisma.sessionLodge.update({
    where: { sessionId_slot: { sessionId: id, slot } },
    data,
  });
  await prisma.bookingSession.update({
    where: { id },
    data: { expiresAt: freshExpiry() },
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
    marketingEmail?: boolean;
    marketingSms?: boolean;
    addressLine1?: string;
    addressLine2?: string;
    townCity?: string;
    county?: string;
    postcode?: string;
    country?: string;
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
      marketingEmail: guest.marketingEmail ?? false,
      marketingSms: guest.marketingSms ?? false,
      guestAddressLine1: guest.addressLine1 ?? null,
      guestAddressLine2: guest.addressLine2 ?? null,
      guestTownCity: guest.townCity ?? null,
      guestCounty: guest.county ?? null,
      guestPostcode: guest.postcode ?? null,
      guestCountry: guest.country ?? null,
      userId,
      state: "checkout",
      expiresAt: freshExpiry(),
    },
  });
}

/**
 * The break's car registrations, captured on the Guest Details step. One entry
 * per car ("" for "don't know the registration"), "[]" for no car. Break-level
 * like Center Parcs - one set of cars for the whole party. Never touches state:
 * details has already moved the session to "checkout" by this point.
 */
export async function setVehicles(id: string, plates: string[]): Promise<void> {
  await prisma.bookingSession.update({
    where: { id },
    data: { vehiclePlates: JSON.stringify(plates), expiresAt: freshExpiry() },
  });
}

/**
 * The referral fields, written by the details and referral routes. Guarded
 * here rather than trusted to callers: once a BookingRecord exists the folio
 * totals are frozen and a late code change could never be honoured, so the
 * write refuses via the relation filter and the stale code simply keeps its
 * stamp. referralDiscount is the advisory display snapshot from validation;
 * ensureRecord recomputes from config and never reads it for money.
 *
 * Returns false when the write was refused, so a caller that needs to tell
 * the guest "too late" can.
 */
export async function setReferralOnSession(
  id: string,
  referral: { code: string | null; discount: number | null },
): Promise<boolean> {
  const written = await prisma.bookingSession.updateMany({
    where: { id, booking: null },
    data: {
      referralCode: referral.code,
      referralDiscount: referral.discount,
    },
  });
  return written.count > 0;
}

/**
 * What the break costs before any referral discount or credit: the sum of
 * every lodge's stay, extras and location fee. The advisory basis the pay
 * step's cap rule works against, shared so the credit and referral routes
 * cannot drift apart on what "the total" means.
 */
export function sessionSnapshotTotal(session: SessionWithLodges): number {
  return session.lodges.reduce(
    (sum, l) =>
      sum +
      (l.stayGrossAmount ?? 0) +
      parseExtras(l).reduce((a, e) => a + e.grossAmount, 0) +
      (l.locationFee ?? 0),
    0,
  );
}

/**
 * Inline sign-in mid-funnel: the walk now belongs to this user, overwriting
 * any earlier stamp (shared-machine sign-out safety). Refreshes the TTL so
 * the sign-in interruption never costs the guest their basket. Completed
 * sessions are never touched - their ownership is settled.
 */
export async function stampSessionUser(id: string, userId: string): Promise<void> {
  // A different identity taking over the walk drops any applied referral
  // credit first: credit is bound to the account that applied it, and a
  // stale application would spend the wrong pool at checkout. The ledger
  // claim itself is released by the checkout/credit paths that own it;
  // here we only stop the display flags carrying over.
  await prisma.bookingSession.updateMany({
    where: { id, state: { not: "completed" }, userId: { not: userId } },
    data: {
      applyCredit: false,
      creditAmount: null,
      // The repeat-guest offer is account state too (UNP-7): a snapshot
      // applied by the previous identity must not survive the handover.
      // The claim's own membership re-check is the money backstop; this
      // stops the display carrying over, same as the credit flags.
      repeatOfferRecordId: null,
      repeatOfferDiscount: null,
    },
  });
  // Expired sessions are dead everywhere else (getSession refuses them),
  // and a dead session's credit spend has already been counted back into
  // the pool, so resurrecting one here would re-activate spent credit.
  await prisma.bookingSession.updateMany({
    where: { id, state: { not: "completed" }, expiresAt: { gte: new Date() } },
    data: { userId, expiresAt: freshExpiry() },
  });
}

/** Works on a session (slot-0 mirror) or a single lodge's own extras. */
export function parseExtras(session: { extras: string }): ExtraSnapshot[] {
  return JSON.parse(session.extras) as ExtraSnapshot[];
}

/** The break's saved car registrations: one entry per car, "" for "don't
 *  know the registration", "[]" for no car. */
export function parseVehiclePlates(source: { vehiclePlates: string }): string[] {
  return JSON.parse(source.vehiclePlates) as string[];
}
