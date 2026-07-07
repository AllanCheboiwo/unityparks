/** Shapes returned by our API routes, shared by the funnel pages. */

export type StayOfferDto = {
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

export type ExtraOfferDto = {
  serviceId: string;
  code: string;
  name: string;
  description: string;
  pricingUnit: string;
  count: number;
  totalGrossAmount: number;
  currency: string;
};

export type ExtraSnapshotDto = {
  serviceId: string;
  code: string;
  name: string;
  count: number;
  grossAmount: number;
};

export type SessionSummary = {
  sessionId: string;
  state: string;
  arrival: string;
  departure: string;
  nights: number;
  adults: number;
  lodge: {
    unitGroupCode: string;
    ratePlanId: string | null;
    stayGrossAmount: number | null;
    currency: string;
  } | null;
  extras: ExtraSnapshotDto[];
  guest: {
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
    vehiclePlate: string | null;
  } | null;
  total: number | null;
};

export type BookingConfirmation = {
  bookingId: string;
  reservationId: string;
  status: string;
  paidAt: string | null;
  totalGrossAmount: number;
  currency: string;
  folioBalance: number;
  stay: {
    arrival: string;
    departure: string;
    adults: number;
    unitGroupCode: string | null;
    stayGrossAmount: number | null;
  };
  extras: ExtraSnapshotDto[];
  guest: {
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    vehiclePlate: string | null;
  };
};
