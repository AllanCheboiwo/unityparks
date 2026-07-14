import "server-only";
import { apaleo, CHANNEL_CODE, PROPERTY_ID } from "./client";
import { occupancyAges } from "@/server/booking/party";

/** A lodge tier priced for the whole break - one card on the results page. */
export type StayOffer = {
  unitGroupCode: string;
  unitGroupName: string;
  maxPersons: number;
  ratePlanId: string;
  cancellationName: string | null;
  cancellationDescription: string | null;
  totalGrossAmount: number;
  currency: string;
  availableUnits: number;
};

type ApaleoOffersResponse = {
  offers: Array<{
    unitGroup: { code: string; name: string; maxPersons: number };
    ratePlan: { id: string };
    totalGrossAmount: { amount: number; currency: string };
    availableUnits: number;
    cancellationFee?: { name?: string; description?: string };
  }>;
};

export async function getStayOffers(params: {
  arrival: string;
  departure: string;
  adults: number;
  childrenAges?: number[];
}): Promise<StayOffer[]> {
  const query = new URLSearchParams({
    propertyId: PROPERTY_ID,
    arrival: params.arrival,
    departure: params.departure,
    adults: String(params.adults),
    channelCode: CHANNEL_CODE,
  });
  // Cot infants don't take a bed, so they never count toward maxPersons.
  const bedAges = occupancyAges(params.childrenAges ?? []);
  if (bedAges.length) {
    query.set("childrenAges", bedAges.join(","));
  }
  const data = await apaleo<ApaleoOffersResponse>("GET", `/booking/v1/offers?${query}`);
  if (!data?.offers) return []; // 204 = nothing bookable for these dates

  return data.offers
    .map((o) => ({
      unitGroupCode: o.unitGroup.code,
      unitGroupName: o.unitGroup.name,
      maxPersons: o.unitGroup.maxPersons,
      ratePlanId: o.ratePlan.id,
      cancellationName: o.cancellationFee?.name ?? null,
      cancellationDescription: o.cancellationFee?.description ?? null,
      totalGrossAmount: o.totalGrossAmount.amount,
      currency: o.totalGrossAmount.currency,
      availableUnits: o.availableUnits,
    }))
    .sort((a, b) => a.totalGrossAmount - b.totalGrossAmount);
}

/** An add-on priced for this specific stay - one card on the extras page. */
export type ExtraOffer = {
  serviceId: string;
  code: string;
  name: string;
  description: string;
  pricingUnit: string; // Room | Person | RoomPerNight | PersonPerNight
  count: number; // how many Apaleo will book by default (e.g. per person)
  totalGrossAmount: number;
  currency: string;
};

type ApaleoServiceOffersResponse = {
  services: Array<{
    service: {
      id: string;
      code: string;
      name: string;
      description: string;
      pricingUnit: string;
    };
    count: number;
    totalAmount: { grossAmount: number; currency: string };
  }>;
};

export async function getExtraOffers(params: {
  ratePlanId: string;
  arrival: string;
  departure: string;
  adults: number;
  childrenAges?: number[];
}): Promise<ExtraOffer[]> {
  const query = new URLSearchParams({
    ratePlanId: params.ratePlanId,
    arrival: params.arrival,
    departure: params.departure,
    adults: String(params.adults),
    channelCode: CHANNEL_CODE,
  });
  // Same cot rule as stays: per-person extras never count infants either.
  const bedAges = occupancyAges(params.childrenAges ?? []);
  if (bedAges.length) {
    query.set("childrenAges", bedAges.join(","));
  }
  const data = await apaleo<ApaleoServiceOffersResponse>(
    "GET",
    `/booking/v1/service-offers?${query}`,
  );
  if (!data?.services) return [];

  return data.services.map((s) => ({
    serviceId: s.service.id,
    code: s.service.code,
    name: s.service.name,
    description: s.service.description,
    pricingUnit: s.service.pricingUnit,
    count: s.count,
    totalGrossAmount: s.totalAmount.grossAmount,
    currency: s.totalAmount.currency,
  }));
}
