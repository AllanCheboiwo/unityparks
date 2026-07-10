import "server-only";
import { apaleo, CHANNEL_CODE } from "./client";
import { nightsBetween } from "../booking/rules";
import { occupancyAges } from "../booking/party";

export type ReservationInput = {
  adults: number;
  childrenAges?: number[];
  ratePlanId: string;
  /** Apaleo service ids for this lodge's extras. */
  serviceIds: string[];
};

export type CreateBookingInput = {
  arrival: string;
  departure: string;
  /** One entry per lodge; a single-lodge break is one entry. */
  reservations: ReservationInput[];
  guest: { firstName: string; lastName: string; email: string; phone: string };
  vehiclePlate?: string;
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
  const guestComment = input.vehiclePlate
    ? `Vehicle plate for ANPR gate: ${input.vehiclePlate}`
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
      guestComment,
      // One slice per night, all on this lodge's rate plan. No amount
      // overrides: Apaleo prices from its own rates.
      timeSlices: Array.from({ length: nights }, () => ({
        ratePlanId: reservation.ratePlanId,
      })),
      services: reservation.serviceIds.map((serviceId) => ({ serviceId })),
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
