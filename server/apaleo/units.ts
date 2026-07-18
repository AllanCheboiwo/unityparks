import "server-only";
import { apaleo, PROPERTY_ID } from "./client";

/**
 * Everything the location step needs from Apaleo: which physical lodges are
 * free for a stay, assigning one to a reservation, and removing the location
 * fee service when a chosen lodge is lost to a concurrent booking.
 */

/** The fee service's code; its id is `UPNV-LOCATION`. The extras page filters
 *  this code out - the fee is sold by the location step, never as an extra. */
export const LOCATION_SERVICE_CODE = "LOCATION";

/** One pickable lodge on the location step. */
export type UnitOption = {
  id: string; // Apaleo unit id, e.g. UPNV-EBP
  name: string; // e.g. "Lakeview Lodge 3"
};

// The property runs 14:00 check-in / 11:00 check-out in a +02:00 timezone
// (verified against the time slices Apaleo returns for its reservations).
// The availability window must match those boundaries exactly: a wider
// window would wrongly exclude units with back-to-back turnover bookings.
const CHECK_IN_TIME = "T14:00:00+02:00";
const CHECK_OUT_TIME = "T11:00:00+02:00";

type ApaleoUnitAvailability = {
  units: Array<{
    id: string;
    name: string;
    unitGroup?: { id: string; code?: string };
  }>;
};

/**
 * The units of one tier that are genuinely free for the whole stay, by
 * Apaleo's own availability math (existing assignments and out-of-service
 * periods both excluded).
 */
export async function getAvailableUnits(params: {
  arrival: string; // ISO date
  departure: string; // ISO date
  unitGroupCode: string; // bare tier code, e.g. "LKV"
}): Promise<UnitOption[]> {
  const query = new URLSearchParams({
    propertyId: PROPERTY_ID,
    from: `${params.arrival}${CHECK_IN_TIME}`,
    to: `${params.departure}${CHECK_OUT_TIME}`,
    pageSize: "100",
  });
  const data = await apaleo<ApaleoUnitAvailability>(
    "GET",
    `/availability/v1/units?${query}`,
  );
  const groupId = `${PROPERTY_ID}-${params.unitGroupCode}`;
  return (data?.units ?? [])
    .filter((u) => u.unitGroup?.id === groupId)
    .map((u) => ({ id: u.id, name: u.name }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

type ApaleoAssignedUnit = { unit: { id: string; name: string } };
type ApaleoAutoAssignResult = {
  timeSlices: Array<{ unit: { id: string; name: string } }>;
};

/**
 * Assign one specific unit. Apaleo refuses (422) if the unit is occupied for
 * the reservation's timeframe; re-assigning the unit it already holds is a
 * plain 200, so checkout retries are safe.
 */
export async function assignSpecificUnit(
  reservationId: string,
  unitId: string,
): Promise<UnitOption> {
  const data = await apaleo<ApaleoAssignedUnit>(
    "PUT",
    `/booking/v1/reservation-actions/${reservationId}/assign-unit/${unitId}`,
  );
  if (!data?.unit) throw new Error(`Assigning unit ${unitId} returned no unit`);
  return { id: data.unit.id, name: data.unit.name };
}

/** Let Apaleo pick any free unit in the reservation's own unit group. */
export async function autoAssignUnit(reservationId: string): Promise<UnitOption | null> {
  const data = await apaleo<ApaleoAutoAssignResult>(
    "PUT",
    `/booking/v1/reservation-actions/${reservationId}/assign-unit`,
  );
  const unit = data?.timeSlices?.[0]?.unit;
  return unit ? { id: unit.id, name: unit.name } : null;
}

/** The unit currently assigned to a reservation, if any. */
export async function getAssignedUnit(reservationId: string): Promise<UnitOption | null> {
  const data = await apaleo<{ unit?: { id: string; name: string } }>(
    "GET",
    `/booking/v1/reservations/${reservationId}`,
  );
  return data?.unit ? { id: data.unit.id, name: data.unit.name } : null;
}

/**
 * Remove a service from a reservation, so its charge leaves the folio.
 * Apaleo answers 204 even when the service is already gone, so calling this
 * twice (checkout retry) is harmless.
 */
export async function removeReservationService(
  reservationId: string,
  serviceId: string,
): Promise<void> {
  await apaleo(
    "DELETE",
    `/booking/v1/reservations/${reservationId}/services?serviceId=${encodeURIComponent(serviceId)}`,
  );
}
