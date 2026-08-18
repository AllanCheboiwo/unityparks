/**
 * Unity Parks – Apaleo Sandbox Provisioning Script
 * -------------------------------------------------
 * Creates a Test-status Unity Parks property modelled on the Center Parcs
 * structure, set in a car-free forest village on the western slopes of
 * Mount Kenya. The source of truth for the model is
 * docs/village-and-content-direction.md.
 *
 *   2 grades x 2 sizes = 4 lodge types  ×  5 units each  =  20 lodges
 *   1 flexible KES rate plan per type
 *   6 extras (services) on the enhancements page
 *   Friday + Monday turnover restrictions, 13-month rolling window
 *
 * Usage (from the frontend repo root; credentials are the CLIENT_ID and
 * CLIENT_SECRET already in .env):
 *   npm run apaleo:provision
 *
 * Safe to re-run: every step checks whether the object already exists
 * and skips creation if it does.
 *
 * Refresh just the calendar (extend the window):
 *   npm run apaleo:provision -- --reset-restrictions-only
 *
 * One-off rename and reprice of an already-provisioned Naivasha-era
 * sandbox to the Mount Kenya model (this script only creates, never
 * updates, so existing objects need the migration):
 *   npm run apaleo:migrate
 */

// No imports remain (tsx --env-file supplies the environment), so this
// keeps the file a module with its own scope.
export {};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PROPERTY_ID = "UPNV"; // opaque code from the Naivasha era; kept, re-coding means re-provisioning everything
const PROPERTY_NAME = "Unity Parks Mount Kenya";
const CURRENCY = "KES";
// Kept on purpose: Apaleo fixes country and timezone at creation, and the
// frontend hardcodes the +02:00 time-slice boundaries (server/apaleo/units.ts).
// All demo logic is date-based, so both are cosmetic. Do not change either
// without re-provisioning everything, frontend included.
const COUNTRY = "DE";
const TIMEZONE = "Europe/Berlin";

/**
 * Lodge types — two axes and nothing else. Size is a number (2 or 3
 * bedrooms), grade is a name. Cedar is the base spec (every lodge gets a
 * wood-burning stove); Signature is the seven things: private hot tub
 * facing the mountain, wraparound deck roofed at one end, underfloor-heated
 * bathrooms, en-suite plus second bathroom, upgraded kitchen, better linen,
 * bigger plot with a wider tree screen.
 *
 * The ladder explains itself out loud: a bedroom costs about half as much
 * again, and Signature costs about a third more. Prices are the long-rains
 * floor, per lodge per night. Codes are opaque leftovers from the Naivasha
 * era and stay as they are: re-coding means re-provisioning every unit,
 * rate plan and rate for no guest-visible gain.
 */
const UNIT_GROUPS = [
  {
    code: "WDL",
    name: "Cedar Lodge 2 bedroom",
    description:
      "The lodge the village is built from. Two bedrooms sleeping 4, insulated and double glazed, with a wood-burning stove, a full kitchen and a private deck with a built-in braai, in a lane of four to six lodges around a shared green.",
    maxPersons: 4,
    pricePerNight: 28_000,
  },
  {
    code: "FST",
    name: "Cedar Lodge 3 bedroom",
    description:
      "The family Cedar. Three bedrooms sleeping 6 on the same warm spec: wood-burning stove, full kitchen, private deck with a built-in braai, and hot water that copes with a full house at six in the morning.",
    maxPersons: 6,
    pricePerNight: 42_000,
  },
  {
    code: "LKV",
    name: "Signature Lodge 2 bedroom",
    description:
      "The cold-weather grade at two bedrooms, sleeping 4. A private outdoor hot tub facing the mountain, a wraparound deck roofed at one end, underfloor-heated bathrooms, an en-suite plus a second bathroom, and an upgraded kitchen with dishwasher and coffee machine.",
    maxPersons: 4,
    pricePerNight: 38_000,
  },
  {
    code: "EXC",
    name: "Signature Lodge 3 bedroom",
    description:
      "Every Signature thing at family size. Three bedrooms sleeping 6, a bigger deck and a bigger tub, en-suite plus second bathroom, underfloor-heated bathrooms and the upgraded kitchen, on a bigger plot behind a wider tree screen.",
    maxPersons: 6,
    pricePerNight: 56_000,
  },
] as const;

const UNITS_PER_GROUP = 5; // 20 lodges in total

/**
 * Lane-and-number unit names: guests navigate by place, not product, so no
 * grade appears in a name. Index i-1 names unit <code><i> (WDL03 is
 * UNIT_NAMES.WDL[2]). Fig and Olive Lanes sit in The Glades, Turaco and
 * Hyrax Lanes on Sunrise Ridge; the frontend maps lane to zone. Both grades
 * appear in every lane, so grade and place stay independent.
 */
const UNIT_NAMES: Record<string, readonly string[]> = {
  WDL: ["Fig Lane 1", "Fig Lane 5", "Olive Lane 2", "Turaco Lane 3", "Hyrax Lane 5"],
  FST: ["Fig Lane 2", "Olive Lane 1", "Olive Lane 5", "Turaco Lane 4", "Hyrax Lane 2"],
  LKV: ["Fig Lane 3", "Olive Lane 3", "Turaco Lane 1", "Turaco Lane 5", "Hyrax Lane 3"],
  EXC: ["Fig Lane 4", "Olive Lane 4", "Turaco Lane 2", "Hyrax Lane 1", "Hyrax Lane 4"],
};

/**
 * Extras — the enhancements page.
 * Modelled on Center Parcs' add-ons (early arrival, cycle hire, grocery
 * essentials, activity passes) adapted for the Unity Parks offering.
 */
const ALL_DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

const SERVICES = [
  {
    code: "EARLY",
    name: "Early Check-In",
    // Noon, not earlier: checkout is 11 am and every arrival day is also a
    // departure day, so the morning belongs to housekeeping. There is no
    // late-checkout mirror of this service, and there never will be.
    description:
      "Access your lodge from noon rather than the standard 2 pm, so you can make the most of your first day.",
    price: 4_500,
    pricingUnit: "Room" as const, // flat per lodge
    mode: "Arrival" as const,
    serviceType: "Other" as const,
  },
  {
    code: "GROCERY",
    name: "Grocery Welcome Pack",
    description:
      "A curated pack of fresh essentials: bread, eggs, milk, fruit, coffee and basics, stocked in your lodge before you arrive.",
    price: 3_500,
    pricingUnit: "Room" as const,
    mode: "Arrival" as const,
    serviceType: "FoodAndBeverages" as const,
  },
  {
    code: "FIREWOOD",
    name: "Firewood & BBQ Pack",
    description:
      "Seasoned hardwood logs, charcoal, firelighters, and a full meat selection for an evening braai on the deck.",
    price: 2_200,
    pricingUnit: "Room" as const,
    mode: "Daily" as const,
    serviceType: "FoodAndBeverages" as const,
  },
  {
    code: "CYCLE",
    name: "Cycle Hire",
    description:
      "A quality mountain bike per person, with helmet and lock, for the duration of your stay. Explore 15 km of dedicated trails through the forest.",
    price: 800,
    pricingUnit: "Person" as const,
    mode: "Daily" as const,
    serviceType: "Other" as const,
  },
  {
    code: "SPA",
    name: "Spa Day Pass",
    description:
      "Full access to The Forest Spa per person per day: hot pools, sauna, steam room and relaxation lounge, ten minutes uphill from the square. Towels provided.",
    price: 1_500,
    pricingUnit: "Person" as const,
    mode: "Daily" as const,
    serviceType: "Other" as const,
  },
  {
    // The location-step fee: charged once per lodge when the guest picks a
    // specific lodge number rather than "no preference". The chosen unit
    // itself is stored app-side; this service is only the folio line item.
    // Not shown on the enhancements page - the app filters it out by code.
    code: "LOCATION",
    name: "Lodge Location Choice",
    description:
      "Choose the exact lodge you will stay in from the village map, subject to availability at time of booking.",
    price: 2_500,
    pricingUnit: "Room" as const,
    mode: "Arrival" as const,
    serviceType: "Other" as const,
  },
] as const;

// How many months ahead to push the restriction calendar. Thirteen-plus
// months since 17 Aug 2026, matching the frontend's 400-day booking horizon
// (BOOKING_HORIZON_DAYS in components/BookingBar.tsx): the whole year ahead,
// festive included, stays bookable. The restriction PUT grows to roughly
// 1,200 records; if Apaleo ever rejects it as too large, split the PUT.
const RESTRICTION_MONTHS = 14;
const PRICE_WINDOW_DAYS = 400; // one GET + one PUT per rate plan, whatever the length

// ---------------------------------------------------------------------------
// Kenyan seasonal pricing (docs/content-strategy.md).
// Each tier's pricePerNight is the LONG RAINS floor; every night's rate is
// floor x multiplier, rounded to the nearest KES 500. Campaign windows
// (festive, school holidays) override their underlying season. The homepage
// season cards must quote the matching 3-night Woodland floor per season.
// ---------------------------------------------------------------------------

function seasonMultiplier(d: Date): number {
  const month = d.getUTCMonth() + 1; // 1-12
  const day = d.getUTCDate();

  // Campaign overlays first
  if ((month === 12 && day >= 15) || (month === 1 && day <= 5)) return 1.5; // festive peak
  if (month === 8) return 1.25; // August school holidays
  if (month === 4) return 1.15; // April school holidays

  // Seasons
  if (month === 12 || month <= 2) return 1.3; // sunshine season
  if (month >= 3 && month <= 5) return 1.0; // long rains (the floor)
  if (month >= 6 && month <= 9) return 1.15; // cool season
  return 1.08; // short rains (Oct-Nov)
}

function seasonalNightly(basePerNight: number, night: Date): number {
  return Math.round((basePerNight * seasonMultiplier(night)) / 500) * 500;
}

// ---------------------------------------------------------------------------
// Apaleo API client
// ---------------------------------------------------------------------------

const TOKEN_URL = "https://identity.apaleo.com/connect/token";
const BASE_URL = "https://api.apaleo.com";

let _token: string | null = null;
let _tokenExpiry = 0;

async function getToken(): Promise<string> {
  if (_token && Date.now() < _tokenExpiry - 30_000) return _token;

  const clientId = process.env.CLIENT_ID;
  const clientSecret = process.env.CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing CLIENT_ID or CLIENT_SECRET in .env\n" +
        "Copy .env.example to .env and fill in your credentials.",
    );
  }

  const creds = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${creds}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok)
    throw new Error(`Token fetch failed ${res.status}: ${await res.text()}`);

  const d = (await res.json()) as { access_token: string; expires_in: number };
  _token = d.access_token;
  _tokenExpiry = Date.now() + d.expires_in * 1000;
  return _token;
}

async function api(method: string, path: string, body?: unknown) {
  const token = await getToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

const ok = (s: number) => s >= 200 && s < 300;
const log = (emoji: string, msg: string) => console.log(`${emoji}  ${msg}`);

// ---------------------------------------------------------------------------
// Provisioning steps
// ---------------------------------------------------------------------------

async function ensureProperty() {
  log("🏕️ ", `Checking property ${PROPERTY_ID}…`);
  const { status } = await api(
    "GET",
    `/inventory/v1/properties/${PROPERTY_ID}`,
  );
  if (status === 200) {
    log("✅", "Property already exists, skipping.");
    return;
  }

  const { status: s, data } = await api("POST", "/inventory/v1/properties", {
    code: PROPERTY_ID,
    name: { en: PROPERTY_NAME, de: PROPERTY_NAME },
    description: {
      en: "A car-free forest village of self-contained lodges on the western slopes of Mount Kenya, near Naro Moru. (Sandbox demo property.)",
      de: "Ein autofreies Walddorf mit eigenstaendigen Lodges an den Westhaengen des Mount Kenya, bei Naro Moru. (Sandbox-Demo.)",
    },
    currencyCode: CURRENCY,
    location: {
      addressLine1: "Naro Moru, Kieni West (Demo)",
      postalCode: "10105",
      city: "Naro Moru (Demo)",
      countryCode: COUNTRY,
    },
    timeZone: TIMEZONE,
    defaultCheckInTime: "14:00",
    defaultCheckOutTime: "11:00",
    paymentTerms: {
      en: "30% deposit at booking, balance due 10 weeks before arrival.",
      de: "30% Anzahlung bei Buchung, Restbetrag 10 Wochen vor Anreise.",
    },
    companyName: "Unity Parks",
    taxId: "DEMO-TAX-001",
    commercialRegisterEntry: "DEMO-REG-001",
  });
  if (!ok(s))
    throw new Error(`Create property failed: ${JSON.stringify(data)}`);
  log("✅", `Property ${PROPERTY_ID} – "${PROPERTY_NAME}" created.`);
}

async function ensureUnitGroup(g: (typeof UNIT_GROUPS)[number]) {
  const id = `${PROPERTY_ID}-${g.code}`;
  log("🏠", `Checking lodge type ${g.code} (${g.name})…`);
  const { status } = await api("GET", `/inventory/v1/unit-groups/${id}`);
  if (status === 200) {
    log("✅", `${g.code} already exists, skipping.`);
    return;
  }

  const { status: s, data } = await api("POST", "/inventory/v1/unit-groups", {
    propertyId: PROPERTY_ID,
    code: g.code,
    name: { en: g.name, de: g.name },
    description: { en: g.description, de: g.description },
    maxPersons: g.maxPersons,
    type: "Bedroom",
  });
  if (!ok(s))
    throw new Error(
      `Create unit group ${g.code} failed: ${JSON.stringify(data)}`,
    );
  log("✅", `${g.code} – "${g.name}" (sleeps ${g.maxPersons}) created.`);
}

async function ensureUnits(
  groupCode: string,
  groupName: string,
  maxPersons: number,
  count: number,
) {
  // Unit ids are auto-generated by Apaleo (e.g. UPNV-HBO), so existence can't
  // be tested by GETting a guessed id — that 404s every run and the script
  // re-creates all units. List the group's units once and match by name,
  // the only stable identifier the script controls.
  const { status: listStatus, data: listData } = await api(
    "GET",
    `/inventory/v1/units?propertyId=${PROPERTY_ID}&unitGroupId=${PROPERTY_ID}-${groupCode}&pageSize=100`,
  );
  const existingNames = new Set<string>(
    listStatus === 200
      ? (((listData as { units?: Array<{ name: string }> }).units) ?? []).map((u) => u.name)
      : [],
  );

  for (let i = 1; i <= count; i++) {
    const unitCode = `${groupCode}${String(i).padStart(2, "0")}`;
    // Lane and number, never the product name; falls back to the group name
    // only if the table and the unit count ever drift apart.
    const unitName = UNIT_NAMES[groupCode]?.[i - 1] ?? `${groupName} ${i}`;
    log("🛏️ ", `Checking lodge ${unitCode}…`);
    if (existingNames.has(unitName)) {
      log("✅", `"${unitName}" already exists, skipping.`);
      continue;
    }

    const { status: s, data } = await api("POST", "/inventory/v1/units", {
      propertyId: PROPERTY_ID,
      unitGroupId: `${PROPERTY_ID}-${groupCode}`,
      code: unitCode,
      name: unitName,
      description: { en: unitName, de: unitName },
      maxPersons,
      condition: "Clean",
    });
    if (!ok(s))
      throw new Error(
        `Create unit ${unitCode} failed: ${JSON.stringify(data)}`,
      );
    log("✅", `Lodge ${unitCode} created.`);
  }
}

// Cache the shared cancellation policy id and overnight time-slice definition id
let _cancelPolicyId: string | null = null;
let _overnightTsdId: Record<string, string> = {};

async function ensureCancellationPolicy(): Promise<string> {
  if (_cancelPolicyId) return _cancelPolicyId;

  // Apaleo ships default cancellation policies on every property.
  // Use the most flexible existing one rather than creating a new one.
  const { status, data } = await api(
    "GET",
    `/rateplan/v1/cancellation-policies?propertyId=${PROPERTY_ID}`,
  );
  if (!ok(status))
    throw new Error(
      `Fetch cancellation policies failed: ${JSON.stringify(data)}`,
    );

  const policies = (data as any)?.cancellationPolicies ?? [];
  if (policies.length === 0) {
    throw new Error(
      "No cancellation policies found on the property. Create one in the Apaleo UI under Rates > Policies > Cancellation.",
    );
  }
  // Prefer one whose code/name hints at flexibility, else take the first
  const flex =
    policies.find(
      (p: any) =>
        /flex/i.test(p.code ?? "") ||
        /flex/i.test(JSON.stringify(p.name ?? "")),
    ) ?? policies[0];

  _cancelPolicyId = flex.id;
  log("📄", `Using existing cancellation policy: ${flex.id}`);
  return flex.id;
}

let _noShowPolicyId: string | null = null;
async function getNoShowPolicyId(): Promise<string> {
  if (_noShowPolicyId) return _noShowPolicyId;
  const { status, data } = await api(
    "GET",
    `/rateplan/v1/no-show-policies?propertyId=${PROPERTY_ID}`,
  );
  if (!ok(status))
    throw new Error(`Fetch no-show policies failed: ${JSON.stringify(data)}`);
  const policies = (data as any)?.noShowPolicies ?? [];
  if (policies.length === 0) {
    throw new Error("No no-show policies found on the property.");
  }
  _noShowPolicyId = policies[0].id;
  log("📄", `Using existing no-show policy: ${policies[0].id}`);
  return policies[0].id;
}

async function getOvernightTimeSliceDefinitionId(): Promise<string> {
  if (_overnightTsdId[PROPERTY_ID]) return _overnightTsdId[PROPERTY_ID];

  const { status, data } = await api(
    "GET",
    `/settings/v1/properties/${PROPERTY_ID}/time-slice-definitions`,
  );
  if (!ok(status))
    throw new Error(`Fetch time-slice defs failed: ${JSON.stringify(data)}`);

  const defs = (data as any)?.timeSliceDefinitions ?? [];
  const overnight = defs.find((d: any) => d.template === "OverNight");
  if (!overnight)
    throw new Error("No OverNight time-slice definition found on property.");

  _overnightTsdId[PROPERTY_ID] = overnight.id;
  return overnight.id;
}

async function findRatePlanId(
  rpCode: string,
  groupCode: string,
): Promise<string | null> {
  const { data } = await api(
    "GET",
    `/rateplan/v1/rate-plans?propertyId=${PROPERTY_ID}&pageSize=200`,
  );
  const plans = (data as any)?.ratePlans ?? [];
  const match = plans.find(
    (p: any) =>
      p.code === rpCode && p.unitGroup?.id === `${PROPERTY_ID}-${groupCode}`,
  );
  return match ? match.id : null;
}

async function ensureRatePlan(g: (typeof UNIT_GROUPS)[number]) {
  const rpCode = `${g.code}_FLEX`; // underscores only, no hyphen
  log("💰", `Checking rate plan ${rpCode}…`);

  const existingId = await findRatePlanId(rpCode, g.code);
  if (existingId) {
    log("✅", `Rate plan ${rpCode} already exists (${existingId}).`);
    await setRatePlanPrices(existingId, g.pricePerNight);
    return;
  }

  const cancellationPolicyId = await ensureCancellationPolicy();
  const noShowPolicyId = await getNoShowPolicyId();
  const timeSliceDefinitionId = await getOvernightTimeSliceDefinitionId();

  const { status: s, data } = await api("POST", "/rateplan/v1/rate-plans", {
    propertyId: PROPERTY_ID,
    unitGroupId: `${PROPERTY_ID}-${g.code}`,
    code: rpCode,
    name: { en: `${g.name} Flexible`, de: `${g.name} Flexibel` },
    description: {
      en: `Standard flexible rate for the ${g.name}. 30% deposit at booking when more than 8 weeks out, balance due 8 weeks before arrival.`,
      de: `Flexibler Standardtarif für die ${g.name}. 30% Anzahlung bei Buchung mehr als 8 Wochen im Voraus, Restzahlung 8 Wochen vor Anreise.`,
    },
    channelCodes: ["Direct", "Ibe"],
    minGuaranteeType: "Prepayment",
    priceCalculationMode: "Truncate",
    timeSliceDefinitionId,
    cancellationPolicyId,
    noShowPolicyId,
    isSubjectToCityTax: false,
    accountingConfigs: [
      {
        vatType: "Without",
        serviceType: "Accommodation",
        validFrom: "1970-01-01",
      },
    ],
    // Per-lodge flat pricing: each additional adult up to capacity adds nothing.
    surcharges: Array.from({ length: g.maxPersons - 1 }, (_, i) => ({
      adults: i + 2,
      type: "Absolute",
      value: 0,
    })),
  });
  if (!ok(s))
    throw new Error(
      `Create rate plan ${rpCode} failed: ${JSON.stringify(data)}`,
    );
  const newId = (data as any)?.id ?? (await findRatePlanId(rpCode, g.code));
  log("✅", `Rate plan ${rpCode} created (${newId}).`);

  // Set the nightly price across the booking window
  if (newId) await setRatePlanPrices(newId, g.pricePerNight);
}

async function setRatePlanPrices(rpId: string, pricePerNight: number) {
  // Apaleo insists the rate `from`/`to` match its exact time-slice boundaries
  // (built around the 14:00 check-in / 11:00 check-out times, not midnight).
  // So we must FETCH the existing slices and reuse their boundaries verbatim.
  // To respect the 8-calls-per-20-min limit, this is exactly ONE GET and ONE
  // PUT per rate plan.
  const fromDate = new Date().toISOString().split("T")[0];
  const toDate = new Date(Date.now() + PRICE_WINDOW_DAYS * 86_400_000)
    .toISOString()
    .split("T")[0];

  const { status: gs, data: gd } = await api(
    "GET",
    `/rateplan/v1/rate-plans/${rpId}/rates?from=${fromDate}T00:00:00Z&to=${toDate}T00:00:00Z`,
  );
  if (!ok(gs))
    throw new Error(`Fetch rates for ${rpId} failed: ${JSON.stringify(gd)}`);

  const slices = (gd as any)?.rates ?? [];
  if (slices.length === 0) {
    log("⚠️ ", `  ↳ No rate slices returned for ${rpId}; skipping price.`);
    return;
  }

  // Reuse each slice's exact from/to. Fill in the price AND the Friday/Monday
  // turnover restrictions in the same call. Restrictions live on the rate, not
  // on a separate endpoint.
  //
  // Anchoring (verified empirically against the offers endpoint):
  //   - closedOnArrival applies to stays STARTING with this night, so it keys
  //     off the slice's `from` date.
  //   - closedOnDeparture applies to stays ENDING with this night, i.e. the
  //     guest departs on the slice's `to` morning — so it keys off `to`.
  //     Keying it off `from` shifts the rule a day and blocks every valid
  //     Fri/Mon departure while allowing Sat/Tue.
  const rates = slices.map((r: any) => {
    const arrivalOnThisNight = new Date(r.from);
    const departureAfterThisNight = new Date(r.to);
    return {
      from: r.from,
      to: r.to,
      // pricePerNight is the long-rains floor; each night gets its seasonal rate.
      price: {
        amount: seasonalNightly(pricePerNight, arrivalOnThisNight),
        currency: CURRENCY,
      },
      restrictions: {
        closed: false,
        closedOnArrival: !isTurnoverDay(arrivalOnThisNight),
        closedOnDeparture: !isTurnoverDay(departureAfterThisNight),
      },
    };
  });

  const { status, data } = await api(
    "PUT",
    `/rateplan/v1/rate-plans/${rpId}/rates`,
    { rates },
  );
  if (!ok(status))
    throw new Error(
      `Set prices/restrictions for ${rpId} failed: ${JSON.stringify(data)}`,
    );
  const openDays = rates.filter(
    (x: any) => !x.restrictions.closedOnArrival,
  ).length;
  const prices = rates.map((x: any) => x.price.amount);
  log(
    "✅",
    `  ↳ Seasonal prices + turnover set on ${rates.length} nights (${openDays} open for arrival, KES ${Math.min(...prices).toLocaleString()} to ${Math.max(...prices).toLocaleString()}/night).`,
  );
}

async function ensureService(svc: (typeof SERVICES)[number]) {
  const svcId = `${PROPERTY_ID}-${svc.code}`;
  log("🎁", `Checking service ${svc.code} (${svc.name})…`);
  const { status } = await api("GET", `/rateplan/v1/services/${svcId}`);
  if (status === 200) {
    log("✅", `${svc.code} already exists, skipping.`);
    return;
  }

  const { status: s, data } = await api("POST", "/rateplan/v1/services", {
    propertyId: PROPERTY_ID,
    code: svc.code,
    name: { en: svc.name, de: svc.name },
    description: { en: svc.description, de: svc.description },
    channelCodes: ["Direct", "Ibe"],
    pricingUnit: svc.pricingUnit,
    serviceType: svc.serviceType,
    vatType: "Without",
    postNextDay: false,
    availability: {
      mode: svc.mode,
      daysOfWeek: [...ALL_DAYS],
    },
    defaultGrossPrice: { amount: svc.price, currency: CURRENCY },
    accountingConfigs: [
      {
        vatType: "Without",
        serviceType: svc.serviceType,
        validFrom: "1970-01-01",
      },
    ],
  });
  if (!ok(s))
    throw new Error(
      `Create service ${svc.code} failed: ${JSON.stringify(data)}`,
    );
  log(
    "✅",
    `Service ${svc.code} – "${svc.name}" created — ${CURRENCY} ${svc.price.toLocaleString()}.`,
  );
}

// ---------------------------------------------------------------------------
// Restriction calendar — close arrival and departure on every day that is
// NOT a Friday (5) or Monday (1), so guests can only check in or out on
// staff turnover days.
// ---------------------------------------------------------------------------

function isTurnoverDay(d: Date) {
  const day = d.getDay();
  return day === 1 || day === 5;
}

function addDays(d: Date, n: number) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function toDateStr(d: Date) {
  return d.toISOString().split("T")[0];
}

async function applyRestrictions() {
  log("📅", "Fetching rate plans to build the restriction calendar…");

  const { data: rpData } = await api(
    "GET",
    `/rateplan/v1/rate-plans?propertyId=${PROPERTY_ID}`,
  );
  const ratePlanIds: string[] = ((rpData as any)?.ratePlans ?? []).map(
    (r: any) => r.id as string,
  );

  if (ratePlanIds.length === 0) {
    log("⚠️ ", "No rate plans found. Run the full provisioning first.");
    return;
  }

  log(
    "📅",
    `Applying Friday/Monday turnover restrictions across ${RESTRICTION_MONTHS} months…`,
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(today);
  end.setMonth(end.getMonth() + RESTRICTION_MONTHS);

  // Build all restriction objects upfront
  const restrictions: object[] = [];
  let cursor = new Date(today);
  while (cursor <= end) {
    if (!isTurnoverDay(cursor)) {
      const dateStr = toDateStr(cursor);
      for (const rpId of ratePlanIds) {
        restrictions.push({
          ratePlanId: rpId,
          from: dateStr,
          to: dateStr,
          closedOnArrival: true,
          closedOnDeparture: true,
        });
      }
    }
    cursor = addDays(cursor, 1);
  }

  // Apaleo restriction endpoint is rate-limited too, so send everything in a
  // SINGLE PUT. One record per (rate plan, non-turnover date). If the payload
  // is rejected as too large, raise MAX_PER_CALL handling below.
  log("📅", `  ${restrictions.length} restriction records in one call…`);
  const { status, data } = await api("PUT", "/rateplan/v1/restrictions", {
    restrictions,
  });
  if (!ok(status)) {
    throw new Error(`Restrictions PUT failed: ${JSON.stringify(data)}`);
  }

  const days = Math.round((end.getTime() - today.getTime()) / 86_400_000);
  log(
    "✅",
    `Restrictions applied: Friday + Monday arrivals/departures only, ${days} days ahead.`,
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const resetOnly = process.argv.includes("--reset-restrictions-only");
  const servicesOnly = process.argv.includes("--services-only");

  console.log("\n🚀  Unity Parks – Apaleo Sandbox Provisioning");
  console.log("     Mount Kenya Demo Property\n");

  if (servicesOnly) {
    // Create any missing services without touching rate plans: a full run
    // re-writes every price calendar, which burns the whole 8-calls/20-min
    // rate-write budget for nothing when only a service was added.
    log("🎁", "Ensuring services only…");
    for (const svc of SERVICES) {
      await ensureService(svc);
    }
    console.log("\n✨  Services ensured.\n");
    return;
  }

  if (resetOnly) {
    log("💰", "Refreshing prices + turnover restrictions on all rate plans…");
    for (const ug of UNIT_GROUPS) {
      const id = await findRatePlanId(`${ug.code}_FLEX`, ug.code);
      if (id) await setRatePlanPrices(id, ug.pricePerNight);
    }
    console.log("\n✨  Prices and restriction calendar refreshed.\n");
    return;
  }

  // 1. Property
  await ensureProperty();
  console.log();

  // 2. Lodge types + individual lodges
  for (const ug of UNIT_GROUPS) {
    await ensureUnitGroup(ug);
    await ensureUnits(ug.code, ug.name, ug.maxPersons, UNITS_PER_GROUP);
    console.log();
  }

  // 3. Rate plans
  log("💰", "Setting up rate plans…");
  for (const ug of UNIT_GROUPS) {
    await ensureRatePlan(ug);
  }
  console.log();

  // 4. Extras
  log("🎁", "Setting up services (enhancements page)…");
  for (const svc of SERVICES) {
    await ensureService(svc);
  }
  console.log();

  console.log(`
╔═══════════════════════════════════════════════════════════╗
║  ✨  Provisioning complete                                ║
╠═══════════════════════════════════════════════════════════╣
║  Property   : ${PROPERTY_ID} – ${PROPERTY_NAME.padEnd(26)} ║
║  Lodge types: ${String(UNIT_GROUPS.length).padEnd(42)} ║
║                                                           ║
║  Cedar Lodge 2 bedroom     – KES 28,000+  (sleeps 4)     ║
║  Cedar Lodge 3 bedroom     – KES 42,000+  (sleeps 6)     ║
║  Signature Lodge 2 bedroom – KES 38,000+  (sleeps 4)     ║
║  Signature Lodge 3 bedroom – KES 56,000+  (sleeps 6)     ║
║                                                           ║
║  Units      : ${String(UNIT_GROUPS.length * UNITS_PER_GROUP).padEnd(42)} ║
║  Extras     : Early check-in, Grocery pack, Firewood/BBQ ║
║               Cycle hire, Spa day pass, Location choice   ║
║  Calendar   : Fri + Mon only, 13 months ahead            ║
╠═══════════════════════════════════════════════════════════╣
║  Next: verify in Swagger                                  ║
║  GET /inventory/v1/properties/${PROPERTY_ID.padEnd(28)} ║
║  GET /booking/v1/offers?propertyId=${PROPERTY_ID}&...     ║
╚═══════════════════════════════════════════════════════════╝
`);
}

main().catch((err) => {
  console.error("\n❌  Provisioning failed:", err.message);
  process.exit(1);
});
