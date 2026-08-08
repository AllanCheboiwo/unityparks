import "server-only";
import { apaleo } from "./client";

/**
 * Post-booking service changes. One fact, verified live against the UPNV
 * sandbox (7 Aug 2026), drives everything built on this file:
 *
 *   book-service SETS the count absolutely. A reservation holding 2 bikes
 *   that is sent count 3 ends up with 3 bikes, not 5, and the folio
 *   re-prices to match. So "add N more" means "read the current count, book
 *   current + N", a retry of the same target converges instead of
 *   double-adding, and writing the previous count back is an exact rollback.
 *
 * Removal (the other half of a rollback, for services that weren't on the
 * reservation at all) lives in units.ts as removeReservationService.
 */

export type ReservationServiceLine = {
  serviceId: string;
  code: string;
  name: string;
  /** The per-date count. Uniform across dates for everything we book. */
  count: number;
  totalGrossAmount: number;
};

/** The services currently booked on a reservation, with their live counts. */
export async function getReservationServices(
  reservationId: string,
): Promise<ReservationServiceLine[]> {
  const data = await apaleo<{
    services?: Array<{
      service: { id: string; code: string; name: string };
      totalAmount?: { grossAmount: number };
      dates?: Array<{ serviceDate: string; count: number }>;
    }>;
  }>("GET", `/booking/v1/reservations/${encodeURIComponent(reservationId)}/services`);

  return (data?.services ?? []).map((s) => ({
    serviceId: s.service.id,
    code: s.service.code,
    name: s.service.name,
    count: Math.max(0, ...(s.dates ?? []).map((d) => d.count)),
    totalGrossAmount: s.totalAmount?.grossAmount ?? 0,
  }));
}

/**
 * Set a service's absolute count on a reservation (see the header note).
 * Apaleo prices the change straight onto the folio; the caller settles or
 * absorbs the difference. The idempotency key covers crash retries within
 * Apaleo's dedup window.
 */
export async function bookReservationService(params: {
  reservationId: string;
  serviceId: string;
  count: number;
  idempotencyKey: string;
}): Promise<void> {
  await apaleo(
    "PUT",
    `/booking/v1/reservation-actions/${encodeURIComponent(params.reservationId)}/book-service`,
    {
      body: { serviceId: params.serviceId, count: params.count },
      idempotencyKey: params.idempotencyKey,
    },
  );
}
