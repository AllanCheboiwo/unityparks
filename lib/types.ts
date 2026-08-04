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

/** One pickable physical lodge on the location step. */
export type UnitOptionDto = {
  id: string;
  name: string;
};

/** What the location step offers for one lodge slot. */
export type LocationOffersDto = {
  slot: number;
  units: UnitOptionDto[];
  /** The choice fee as Apaleo priced it; null if the service is missing. */
  fee: { serviceId: string; amount: number; currency: string } | null;
};

/** A lodge slot's saved location choice. */
export type LocationChoiceDto = {
  choice: "unit" | "none";
  unitId: string | null;
  unitName: string | null;
  fee: number | null;
};

export type LodgeSlotSummary = {
  slot: number;
  adults: number;
  childrenAges: number[];
  partyLabel: string;
  lodge: {
    unitGroupCode: string;
    ratePlanId: string | null;
    stayGrossAmount: number | null;
    currency: string;
  } | null;
  extras: ExtraSnapshotDto[];
  /** null until the location step has been completed for this slot. */
  location: LocationChoiceDto | null;
};

export type SessionSummary = {
  sessionId: string;
  state: string;
  arrival: string;
  departure: string;
  nights: number;
  /** Whole-break totals; per-lodge parties live in `lodges`. */
  adults: number;
  partyLabel?: string;
  /** One entry per lodge. The flat lodge/extras fields mirror slot 0. */
  lodges: LodgeSlotSummary[];
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
    /** One entry per car; "" for a car the guest didn't know the plate of. */
    vehiclePlates: string[];
  } | null;
  total: number | null;
  /** Referral code applied to this walk, with its advisory discount. */
  referral: { code: string; discount: number } | null;
  /** Referral credit the guest chose to apply at the pay step. */
  credit: { amount: number } | null;
};

export type GuestRowDto = {
  slot: number;
  position: number;
  band: string;
  isLead: boolean;
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
  email: string | null;
};

export type BookingConfirmation = {
  bookingId: string;
  reservationId: string;
  status: string;
  paidAt: string | null;
  /** Set once the break is cancelled; refundAmount is what came back. */
  cancelledAt: string | null;
  refundAmount: number | null;
  totalGrossAmount: number;
  currency: string;
  /** The payment plan. Null on bookings from before the deposit feature. */
  depositAmount: number | null;
  balanceDueDate: string | null;
  /** What has actually been paid; legacy paid records report the total. */
  paidAmount: number;
  folioBalance: number;
  account: { status: "ownedByYou" | "existingAccount" | "none" };
  /** The referral discount posted to the folios at checkout, if any. */
  referral: { code: string; discount: number } | null;
  /** Referral credit the buyer applied at checkout, if any. */
  creditApplied: number | null;
  /** One entry per lodge in the booking, manifest included. */
  lodges: {
    slot: number;
    unitGroupCode: string | null;
    stayGrossAmount: number | null;
    partyLabel: string;
    extras: ExtraSnapshotDto[];
    bands: string[];
    guests: GuestRowDto[];
    /** The physical lodge Apaleo assigned at checkout, when it could. */
    assignedUnitName: string | null;
    /** The unit the guest asked for on the location step, if any. */
    requestedUnitName: string | null;
    /** The location-choice fee actually charged; null when none was. */
    locationFee: number | null;
    /** True when the chosen unit was lost to a concurrent booking and the
     *  fee was removed before payment (Center Parcs fallback policy). */
    locationFeeDropped: boolean;
  }[];
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
    /** One entry per car; "" for a car the guest didn't know the plate of. */
    vehiclePlates: string[];
  };
};
