import "server-only";
import { apaleo, CHANNEL_CODE } from "./client";
import { nightsBetween } from "../booking/rules";

export type CreateBookingInput = {
  arrival: string;
  departure: string;
  adults: number;
  ratePlanId: string;
  /** Apaleo service ids for the chosen extras. */
  serviceIds: string[];
  guest: { firstName: string; lastName: string; email: string; phone: string };
  vehiclePlate?: string;
  /** Persisted per checkout attempt so a retry can never double-book. */
  idempotencyKey: string;
};

export async function createBooking(input: CreateBookingInput): Promise<{
  bookingId: string;
  reservationId: string;
}> {
  const nights = nightsBetween(input.arrival, input.departure);
  const guestComment = input.vehiclePlate
    ? `Vehicle plate for ANPR gate: ${input.vehiclePlate}`
    : undefined;

  const body = {
    booker: input.guest,
    reservations: [
      {
        arrival: input.arrival,
        departure: input.departure,
        adults: input.adults,
        channelCode: CHANNEL_CODE,
        guaranteeType: "Prepayment",
        primaryGuest: input.guest,
        guestComment,
        // One slice per night, all on the chosen rate plan. No amount
        // overrides: Apaleo prices from its own rates.
        timeSlices: Array.from({ length: nights }, () => ({
          ratePlanId: input.ratePlanId,
        })),
        services: input.serviceIds.map((serviceId) => ({ serviceId })),
      },
    ],
  };

  const created = await apaleo<{ id: string; reservationIds: Array<{ id: string }> }>(
    "POST",
    "/booking/v1/bookings",
    { body, idempotencyKey: input.idempotencyKey },
  );
  if (!created) throw new Error("Apaleo returned an empty booking response");

  return { bookingId: created.id, reservationId: created.reservationIds[0].id };
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
