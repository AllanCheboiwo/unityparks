import "server-only";
import { apaleo } from "./client";
import { getReservation } from "./amend";

/**
 * Cancelling a reservation in Apaleo. One action, made idempotent by
 * checking the live status first: a crash-and-retry (or a double click)
 * finds the reservation already Canceled and simply moves on, so the
 * cancel loop in server/booking/cancellation.ts can always be re-run.
 */
export async function cancelReservationOnce(reservationId: string): Promise<void> {
  const detail = await getReservation(reservationId);
  if (detail.status === "Canceled") return;
  await apaleo(
    "PUT",
    `/booking/v1/reservation-actions/${encodeURIComponent(reservationId)}/cancel`,
  );
}
