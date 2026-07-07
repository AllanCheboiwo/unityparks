import "server-only";
import { apaleo, CHANNEL_CODE } from "./client";
import { nightsBetween } from "../booking/rules";

/**
 * Post-booking date changes. Two facts drive the shape of this file:
 *   - Apaleo validates AVAILABILITY on amendment, but not our business
 *     rules — it would happily move a stay to a Wednesday. The turnover
 *     re-validation therefore lives in our route, before this is called.
 *   - The amendment offer's total includes the booking's services, so the
 *     quote we show is the guest's real new total.
 */

type ReservationDetail = {
  id: string;
  status: string;
  arrival: string;
  departure: string;
  adults: number;
  childrenAges?: number[];
  unitGroup: { code: string };
  ratePlan: { id: string };
};

export async function getReservation(reservationId: string): Promise<ReservationDetail> {
  const res = await apaleo<ReservationDetail>(
    "GET",
    `/booking/v1/reservations/${encodeURIComponent(reservationId)}`,
  );
  if (!res) throw new Error(`Reservation ${reservationId} not found`);
  return res;
}

export type AmendmentQuote = {
  totalGrossAmount: number;
  currency: string;
  availableUnits: number;
};

/** Price the same lodge type for new dates. Null = not available then. */
export async function getAmendmentQuote(params: {
  reservationId: string;
  unitGroupCode: string;
  arrival: string;
  departure: string;
}): Promise<AmendmentQuote | null> {
  const query = new URLSearchParams({
    arrival: params.arrival,
    departure: params.departure,
    channelCode: CHANNEL_CODE,
  });
  // Amendment offers carry no top-level unitGroup — the identifiers sit
  // inside each time slice (verified against the live response).
  const data = await apaleo<{
    offers: Array<{
      totalGrossAmount: { amount: number; currency: string };
      availableUnits: number;
      timeSlices: Array<{ unitGroup?: { code: string } }>;
    }>;
  }>(
    "GET",
    `/booking/v1/reservations/${encodeURIComponent(params.reservationId)}/offers?${query}`,
  );
  const offer = data?.offers?.find(
    (o) => o.timeSlices?.[0]?.unitGroup?.code === params.unitGroupCode,
  );
  if (!offer) return null;
  return {
    totalGrossAmount: offer.totalGrossAmount.amount,
    currency: offer.totalGrossAmount.currency,
    availableUnits: offer.availableUnits,
  };
}

export async function amendReservationDates(params: {
  reservationId: string;
  arrival: string;
  departure: string;
  adults: number;
  childrenAges?: number[];
  ratePlanId: string;
}): Promise<void> {
  const nights = nightsBetween(params.arrival, params.departure);
  await apaleo("PUT", `/booking/v1/reservation-actions/${encodeURIComponent(params.reservationId)}/amend`, {
    body: {
      arrival: params.arrival,
      departure: params.departure,
      adults: params.adults,
      childrenAges: params.childrenAges?.length ? params.childrenAges : undefined,
      timeSlices: Array.from({ length: nights }, () => ({
        ratePlanId: params.ratePlanId,
      })),
    },
  });
}
