import "server-only";
import { apaleo, CHANNEL_CODE } from "./client";
import { nightsBetween } from "../booking/rules";
import { occupancyAges } from "../booking/party";

export type ReservationInput = {
  adults: number;
  childrenAges?: number[];
  ratePlanId: string;
  /** This lodge's extras: each Apaleo service id with the quantity to book.
   *  count carries the guest's chosen quantity (e.g. 3 bikes); Apaleo prices
   *  the service at count times its per-unit rate. */
  services: Array<{ serviceId: string; count: number }>;
  /**
   * Named co-guests for this lodge, shown in Apaleo's "additional guests"
   * section. The lead booker is the primaryGuest, never listed here.
   * Apaleo requires lastName; everything else is optional.
   */
  additionalGuests?: Array<{
    firstName?: string;
    lastName: string;
    email?: string;
    birthDate?: string;
  }>;
};

export type CreateBookingInput = {
  arrival: string;
  departure: string;
  /** One entry per lodge; a single-lodge break is one entry. */
  reservations: ReservationInput[];
  guest: { firstName: string; lastName: string; email: string; phone: string };
  /** One entry per car; "" is a car whose plate the guest didn't know. */
  vehiclePlates?: string[];
  /** Persisted per checkout attempt so a retry can never double-book. */
  idempotencyKey: string;
};

/**
 * One Apaleo booking holding one reservation per lodge - a single POST
 * however many lodges the break has. The returned reservation ids are in
 * payload order, so index N is lodge slot N.
 */
export async function createBooking(input: CreateBookingInput): Promise<{
  bookingId: string;
  reservationIds: string[];
}> {
  const nights = nightsBetween(input.arrival, input.departure);
  // Only registrations the guest actually gave open the gate; "don't know"
  // cars ("") carry no plate to register.
  const knownPlates = (input.vehiclePlates ?? []).map((p) => p.trim()).filter(Boolean);
  const guestComment = knownPlates.length
    ? `Vehicle plates for ANPR gate: ${knownPlates.join(", ")}`
    : undefined;

  const body = {
    booker: input.guest,
    reservations: input.reservations.map((reservation) => ({
      arrival: input.arrival,
      departure: input.departure,
      adults: reservation.adults,
      // Cot infants don't occupy a bed, so Apaleo never hears about them.
      childrenAges: occupancyAges(reservation.childrenAges ?? []).length
        ? occupancyAges(reservation.childrenAges ?? [])
        : undefined,
      channelCode: CHANNEL_CODE,
      guaranteeType: "Prepayment",
      primaryGuest: input.guest,
      additionalGuests: reservation.additionalGuests?.length
        ? reservation.additionalGuests
        : undefined,
      guestComment,
      // One slice per night, all on this lodge's rate plan. No amount
      // overrides: Apaleo prices from its own rates.
      timeSlices: Array.from({ length: nights }, () => ({
        ratePlanId: reservation.ratePlanId,
      })),
      services: reservation.services.map((s) => ({ serviceId: s.serviceId, count: s.count })),
    })),
  };

  const created = await apaleo<{ id: string; reservationIds: Array<{ id: string }> }>(
    "POST",
    "/booking/v1/bookings",
    { body, idempotencyKey: input.idempotencyKey },
  );
  if (!created) throw new Error("Apaleo returned an empty booking response");

  return {
    bookingId: created.id,
    reservationIds: created.reservationIds.map((r) => r.id),
  };
}

export type FolioSummary = {
  folioId: string;
  /** Negative while money is owed; zero when settled. */
  balance: number;
  currency: string;
};

export async function getFolioForReservation(reservationId: string): Promise<FolioSummary> {
  const data = await apaleo<{
    folios: Array<{ id: string; balance: { amount: number; currency: string } }>;
  }>("GET", `/finance/v1/folios?reservationIds=${encodeURIComponent(reservationId)}`);

  const folio = data?.folios?.[0];
  if (!folio) throw new Error(`No folio found for reservation ${reservationId}`);
  return {
    folioId: folio.id,
    balance: folio.balance.amount,
    currency: folio.balance.currency,
  };
}

export type FolioDetails = {
  folioId: string;
  currency: string;
  charges: Array<{ description: string; amount: number }>;
  allowances: Array<{ description: string; amount: number }>;
};

/**
 * The full folio for the Zoho export (UNP-5): every charge and allowance,
 * gross amounts. Read fresh at push time; the folio is the money source of
 * truth and there is no fallback to local copies. Throws on any shape
 * surprise rather than exporting a zero: a failed read just leaves the
 * export row pending with a clear error.
 */
export async function getFolioDetails(reservationId: string): Promise<FolioDetails> {
  const summary = await getFolioForReservation(reservationId);
  const folio = await apaleo<{
    charges?: Array<{ name?: string; amount?: { grossAmount?: number } }>;
    allowances?: Array<{ reason?: string; amount?: { grossAmount?: number } }>;
  }>("GET", `/finance/v1/folios/${encodeURIComponent(summary.folioId)}`);
  if (!folio) throw new Error(`Empty folio detail for ${summary.folioId}`);

  const gross = (line: { amount?: { grossAmount?: number } }, what: string): number => {
    const amount = line.amount?.grossAmount;
    if (typeof amount !== "number") {
      throw new Error(`Folio ${summary.folioId} ${what} carries no gross amount`);
    }
    return amount;
  };

  return {
    folioId: summary.folioId,
    currency: summary.currency,
    charges: (folio.charges ?? []).map((c) => ({
      description: c.name ?? "Charge",
      amount: gross(c, `charge "${c.name ?? "?"}"`),
    })),
    allowances: (folio.allowances ?? []).map((a) => ({
      description: a.reason ?? "Allowance",
      amount: gross(a, `allowance "${a.reason ?? "?"}"`),
    })),
  };
}
