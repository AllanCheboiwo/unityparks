/**
 * One-off migration: rename and reprice the Naivasha-era UPNV sandbox to
 * the Mount Kenya model, in place. provision.ts only creates objects and
 * skips ones that already exist, so an already-provisioned sandbox needs
 * this sweep instead. The model is docs/village-and-content-direction.md;
 * the order and reasoning is docs/mount-kenya-sweep.md.
 *
 * What it does, in order:
 *   0. Pre-flight (read-only): future LKV/EXC reservations whose party is
 *      larger than the new maxPersons, so odd historical rows are known
 *      before they surprise anyone. Existing reservations stay valid.
 *   1. Property: name, description, address. Code, country, timezone and
 *      the 14:00/11:00 times stay: Apaleo fixes country and timezone at
 *      creation, and the frontend hardcodes the +02:00 slice boundaries.
 *   2. Unit groups: names and descriptions on all four; maxPersons LKV
 *      to 4 and EXC to 6.
 *   3. Units: lane-and-number names ("Fig Lane 3"), plus maxPersons on the
 *      LKV and EXC units (units carry their own copy).
 *   4. Rate plans: display names and descriptions follow the new type names.
 *   5. Services: EARLY copy (from noon, checkout is 11 am) and SPA copy
 *      (The Forest Spa).
 *   6. Rates: all four plans get their calendars rewritten out to the new
 *      400-day horizon. LKV and EXC land on the new 38,000 and 56,000
 *      floors; WDL and FST keep 28,000 and 42,000 (their rewrite exists
 *      only to extend the window), which is what keeps the published
 *      season from-prices true.
 *
 * BUDGET WARNING: the rate rewrite is 4 GETs + 4 PUTs, the entire
 * 8-calls-per-20-minutes rate-write budget. Run this at least 20 minutes
 * after any dry run (a dry run spends 4 GETs), and expect a 429 to mean
 * wait, then re-run: every earlier step is idempotent, so a re-run breezes
 * through the PATCHes and retries only the rates.
 *
 * Inventory and rate-plan PATCHes are not throttled like rate writes.
 *
 * Usage:
 *   npm run apaleo:migrate -- --dry-run       ← print, write nothing
 *   npm run apaleo:migrate                    ← do it
 *   npm run apaleo:migrate -- --services-only ← just step 5 (no rate writes,
 *                                               so no rate-write budget spent)
 *   npm run apaleo:migrate -- --lanes-only    ← just the lane re-map (renames
 *                                               only, no rate-write budget)
 */

// No imports remain, so this keeps the file a module with its own scope.
export {};

const DRY_RUN = process.argv.includes("--dry-run");
const SERVICES_ONLY = process.argv.includes("--services-only");
const LANES_ONLY = process.argv.includes("--lanes-only");

// ---------------------------------------------------------------------------
// Target values. Duplicated from provision.ts on purpose: importing that
// file would execute its provisioning main(). Keep the two in sync by hand;
// they should only ever change together.
// ---------------------------------------------------------------------------

const PROPERTY_ID = "UPNV";
const CURRENCY = "KES";
// Matches the frontend's 400-day booking horizon and provision.ts.
const PRICE_WINDOW_DAYS = 400;

const PROPERTY_PATCH = {
  name: "Unity Parks Mount Kenya",
  description: {
    en: "A car-free forest village of self-contained lodges on the western slopes of Mount Kenya, near Naro Moru. (Sandbox demo property.)",
    de: "Ein autofreies Walddorf mit eigenstaendigen Lodges an den Westhaengen des Mount Kenya, bei Naro Moru. (Sandbox-Demo.)",
  },
  addressLine1: "Naro Moru, Kieni West (Demo)",
  postalCode: "10105",
  city: "Naro Moru (Demo)",
};

type GroupTarget = {
  code: string;
  oldName: string;
  name: string;
  description: string;
  maxPersons: number;
  /** Every plan gets its calendar rewritten to the 400-day horizon; this is
   *  the floor it is written at. For WDL/FST it is the price they already
   *  had, so the rewrite only lengthens the window. */
  newFloorPrice: number;
};

const GROUPS: GroupTarget[] = [
  {
    code: "WDL",
    oldName: "Woodland Lodge",
    name: "Cedar Lodge 2 bedroom",
    description:
      "The lodge the village is built from. Two bedrooms sleeping 4, insulated and double glazed, with a wood-burning stove, a full kitchen and a private deck with a built-in braai, in a lane of four to six lodges around a shared green.",
    maxPersons: 4,
    newFloorPrice: 28_000, // unchanged floor: this is what keeps the season card prices true
  },
  {
    code: "FST",
    oldName: "Forest Lodge",
    name: "Cedar Lodge 3 bedroom",
    description:
      "The family Cedar. Three bedrooms sleeping 6 on the same warm spec: wood-burning stove, full kitchen, private deck with a built-in braai, and hot water that copes with a full house at six in the morning.",
    maxPersons: 6,
    newFloorPrice: 42_000, // unchanged floor
  },
  {
    code: "LKV",
    oldName: "Lakeview Lodge",
    name: "Signature Lodge 2 bedroom",
    description:
      "The cold-weather grade at two bedrooms, sleeping 4. A private outdoor hot tub facing the mountain, a wraparound deck roofed at one end, underfloor-heated bathrooms, an en-suite plus a second bathroom, and an upgraded kitchen with dishwasher and coffee machine.",
    maxPersons: 4, // down from 8
    newFloorPrice: 38_000, // down from 65,000
  },
  {
    code: "EXC",
    oldName: "Exclusive Lodge",
    name: "Signature Lodge 3 bedroom",
    description:
      "Every Signature thing at family size. Three bedrooms sleeping 6, a bigger deck and a bigger tub, en-suite plus second bathroom, underfloor-heated bathrooms and the upgraded kitchen, on a bigger plot behind a wider tree screen.",
    maxPersons: 6, // down from 8
    newFloorPrice: 56_000, // down from 95,000
  },
];

/** Lane-and-number names, index i-1 for unit <code><i>. Same table as
 *  provision.ts. Both grades appear in every lane, each as a consecutive
 *  block, so a party can be placed in genuinely neighbouring lodges. */
const UNIT_NAMES: Record<string, readonly string[]> = {
  WDL: ["Fig Lane 1", "Fig Lane 2", "Fig Lane 3", "Turaco Lane 4", "Turaco Lane 5"],
  FST: ["Olive Lane 1", "Olive Lane 2", "Olive Lane 3", "Hyrax Lane 4", "Hyrax Lane 5"],
  LKV: ["Turaco Lane 1", "Turaco Lane 2", "Turaco Lane 3", "Fig Lane 4", "Fig Lane 5"],
  EXC: ["Hyrax Lane 1", "Hyrax Lane 2", "Hyrax Lane 3", "Olive Lane 4", "Olive Lane 5"],
};

const SERVICE_PATCHES: Array<{
  code: string;
  description: string;
  note: string;
  /** Only set when the field actually changes; absent fields keep their
   *  current sandbox value. */
  name?: string;
  price?: number;
  mode?: "Arrival" | "Daily";
}> = [
  {
    code: "EARLY",
    description:
      "Access your lodge from noon rather than the standard 2 pm, so you can make the most of your first day.",
    note: "noon, not 10 am: checkout is 11 am and the morning belongs to housekeeping",
  },
  {
    code: "SPA",
    description:
      "Full access to The Forest Spa per person per day: hot pools, sauna, steam room and relaxation lounge, ten minutes uphill from the square. Towels provided.",
    note: "the Unity Spa is now The Forest Spa",
  },
  {
    code: "FIREWOOD",
    name: "Firewood Pack",
    description:
      "Seasoned hardwood logs, kindling and firelighters for the lodge fire pit. One pack, set up ready for your first evening.",
    price: 1_000,
    mode: "Arrival",
    note: "firewood only now; the braai moved to the new BBQ Pack (provision --services-only creates it)",
  },
];

// ---------------------------------------------------------------------------
// Kenyan seasonal pricing, unchanged from provision.ts. Only the LKV/EXC
// floors change; the multipliers and the turnover rule do not.
// ---------------------------------------------------------------------------

function seasonMultiplier(d: Date): number {
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  if ((month === 12 && day >= 15) || (month === 1 && day <= 5)) return 1.5; // festive peak
  if (month === 8) return 1.25; // August school holidays
  if (month === 4) return 1.15; // April school holidays
  if (month === 12 || month <= 2) return 1.3; // sunshine season
  if (month >= 3 && month <= 5) return 1.0; // long rains (the floor)
  if (month >= 6 && month <= 9) return 1.15; // cool season
  return 1.08; // short rains
}

function seasonalNightly(basePerNight: number, night: Date): number {
  return Math.round((basePerNight * seasonMultiplier(night)) / 500) * 500;
}

function isTurnoverDay(d: Date) {
  const day = d.getDay();
  return day === 1 || day === 5;
}

// ---------------------------------------------------------------------------
// Apaleo API client (same shape as provision.ts, plus JSON Patch support)
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
    throw new Error("Missing CLIENT_ID or CLIENT_SECRET in .env");
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
  if (!res.ok) throw new Error(`Token fetch failed ${res.status}: ${await res.text()}`);
  const d = (await res.json()) as { access_token: string; expires_in: number };
  _token = d.access_token;
  _tokenExpiry = Date.now() + d.expires_in * 1000;
  return _token;
}

async function api(method: string, path: string, body?: unknown, contentType = "application/json") {
  const token = await getToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": contentType,
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

type PatchOp = { op: "replace" | "add"; path: string; value: unknown };

/** JSON Patch (RFC 6902), the update dialect of Apaleo's inventory and
 *  rate-plan endpoints. In dry-run mode, prints and does nothing. */
async function patch(path: string, ops: PatchOp[], label: string) {
  if (DRY_RUN) {
    log("🩹", `[dry-run] would PATCH ${label}: ${ops.map((o) => o.path).join(", ")}`);
    return;
  }
  const { status, data } = await api("PATCH", path, ops, "application/json-patch+json");
  if (!ok(status)) {
    throw new Error(`PATCH ${label} failed (${status}): ${JSON.stringify(data)}`);
  }
  log("✅", `${label} updated (${ops.map((o) => o.path).join(", ")}).`);
}

/** Full-object replace for the endpoints that turned out not to support
 *  JSON Patch (unit groups 405 on PATCH; properties accept it fine). */
async function putJson(path: string, body: unknown, label: string) {
  if (DRY_RUN) {
    log("🩹", `[dry-run] would PUT ${label}`);
    return;
  }
  const { status, data } = await api("PUT", path, body);
  if (!ok(status)) {
    throw new Error(`PUT ${label} failed (${status}): ${JSON.stringify(data)}`);
  }
  log("✅", `${label} updated.`);
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

/** Read-only: future stays on the shrinking groups with parties above the
 *  new cap. They stay valid in Apaleo; this only makes them known. */
async function preflightOversizedReservations() {
  log("🔎", "Pre-flight: future LKV/EXC reservations above the new maxPersons…");
  const today = new Date().toISOString().slice(0, 10);
  const query = new URLSearchParams({
    propertyIds: PROPERTY_ID,
    dateFilter: "Departure",
    from: `${today}T00:00:00Z`,
    pageSize: "200",
  });
  try {
    const { status, data } = await api("GET", `/booking/v1/reservations?${query}`);
    if (!ok(status)) throw new Error(`status ${status}`);
    const reservations = ((data as any)?.reservations ?? []) as Array<any>;
    const shrinking = new Map(
      GROUPS.filter((g) => g.code === "LKV" || g.code === "EXC").map((g) => [
        `${PROPERTY_ID}-${g.code}`,
        g,
      ]),
    );
    let flagged = 0;
    for (const r of reservations) {
      const group = shrinking.get(r.unitGroup?.id);
      if (!group) continue;
      const party = (r.adults ?? 0) + (r.childrenAges?.length ?? 0);
      if (party > group.maxPersons) {
        flagged++;
        log(
          "⚠️ ",
          `  ${r.id} (${r.status}) arrives ${r.arrival?.slice(0, 10)}: party of ${party} on ${group.code}, new cap ${group.maxPersons}. Stays valid; just know it exists.`,
        );
      }
    }
    if (flagged === 0) log("✅", "  none found.");
  } catch (err) {
    // Pre-flight is information, never a blocker.
    log("⚠️ ", `  pre-flight could not run (${(err as Error).message}); continuing.`);
  }
}

async function migrateProperty() {
  const { status, data } = await api("GET", `/inventory/v1/properties/${PROPERTY_ID}`);
  if (!ok(status)) throw new Error(`Property ${PROPERTY_ID} not found (${status}).`);
  const current = (data as any)?.name?.en ?? (data as any)?.name;
  if (current === PROPERTY_PATCH.name) {
    log("✅", `Property already "${PROPERTY_PATCH.name}", still patching address/description for drift.`);
  } else {
    log("🏕️ ", `Property: "${current}" -> "${PROPERTY_PATCH.name}"`);
  }
  await patch(
    `/inventory/v1/properties/${PROPERTY_ID}`,
    [
      { op: "replace", path: "/name/en", value: PROPERTY_PATCH.name },
      { op: "replace", path: "/name/de", value: PROPERTY_PATCH.name },
      { op: "add", path: "/description/en", value: PROPERTY_PATCH.description.en },
      { op: "add", path: "/description/de", value: PROPERTY_PATCH.description.de },
      { op: "replace", path: "/location/addressLine1", value: PROPERTY_PATCH.addressLine1 },
      { op: "replace", path: "/location/postalCode", value: PROPERTY_PATCH.postalCode },
      { op: "replace", path: "/location/city", value: PROPERTY_PATCH.city },
    ],
    `property ${PROPERTY_ID}`,
  );
}

async function migrateUnitGroups() {
  for (const g of GROUPS) {
    const id = `${PROPERTY_ID}-${g.code}`;
    // Unit groups reject JSON Patch (405), so read-modify-PUT the
    // replaceable fields instead.
    const { status, data } = await api("GET", `/inventory/v1/unit-groups/${id}`);
    if (!ok(status)) throw new Error(`GET unit group ${g.code} failed (${status}).`);
    const current = data as { rank?: number };
    const body: Record<string, unknown> = {
      name: { en: g.name, de: g.name },
      description: { en: g.description, de: g.description },
      maxPersons: g.maxPersons,
    };
    if (current.rank != null) body.rank = current.rank;
    await putJson(
      `/inventory/v1/unit-groups/${id}`,
      body,
      `unit group ${g.code} -> "${g.name}" (sleeps ${g.maxPersons})`,
    );
  }
}

async function migrateUnits() {
  for (const g of GROUPS) {
    const { status, data } = await api(
      "GET",
      `/inventory/v1/units?propertyId=${PROPERTY_ID}&unitGroupId=${PROPERTY_ID}-${g.code}&pageSize=100`,
    );
    if (!ok(status)) throw new Error(`Listing units for ${g.code} failed (${status}).`);
    const units = ((data as any)?.units ?? []) as Array<{ id: string; name: string; maxPersons?: number }>;
    const targets = UNIT_NAMES[g.code];
    for (const unit of units) {
      let newName: string | null = null;
      if (targets.includes(unit.name)) {
        // Already renamed; still ensure maxPersons below if it shrank.
        newName = unit.name;
      } else {
        // "Woodland Lodge 3" -> index 3 -> targets[2]. Any name we cannot
        // place is left alone loudly rather than guessed.
        const match = unit.name.match(/(\d+)\s*$/);
        const index = match ? Number(match[1]) : NaN;
        newName = Number.isInteger(index) && index >= 1 && index <= targets.length
          ? targets[index - 1]
          : null;
        if (!newName) {
          log("⚠️ ", `  ${g.code}: cannot place unit "${unit.name}" (${unit.id}); skipping it.`);
          continue;
        }
      }
      const ops: PatchOp[] = [];
      if (unit.name !== newName) {
        ops.push({ op: "replace", path: "/name", value: newName });
        ops.push({ op: "add", path: "/description/en", value: newName });
        ops.push({ op: "add", path: "/description/de", value: newName });
      }
      if (unit.maxPersons !== g.maxPersons) {
        ops.push({ op: "replace", path: "/maxPersons", value: g.maxPersons });
      }
      if (ops.length === 0) {
        log("✅", `  ${g.code}: "${unit.name}" already done.`);
        continue;
      }
      await updateUnit(unit.id, ops, g, newName, `unit "${unit.name}" -> "${newName}"`);
    }
  }
}

/**
 * Re-map the lanes onto the consecutive-block layout in UNIT_NAMES.
 *
 * The new layout is a permutation of the same twenty names, so a door being
 * freed by one unit is a door another unit is moving into. Renaming in place
 * would put two lodges on the same name for as long as the sequence runs, so
 * every unit that has to move parks on a temporary name first and takes its
 * final one in a second pass. Idempotent: a group already sitting on its
 * targets is skipped without a single write.
 *
 * Assignment is by current name, numerically sorted, so a re-run maps the
 * same unit to the same door rather than shuffling the village.
 */
async function remapLanes() {
  for (const g of GROUPS) {
    const { status, data } = await api(
      "GET",
      `/inventory/v1/units?propertyId=${PROPERTY_ID}&unitGroupId=${PROPERTY_ID}-${g.code}&pageSize=100`,
    );
    if (!ok(status)) throw new Error(`Listing units for ${g.code} failed (${status}).`);
    const units = ((data as any)?.units ?? []) as Array<{ id: string; name: string }>;
    const targets = UNIT_NAMES[g.code];
    if (units.length !== targets.length) {
      log("⚠️ ", `  ${g.code}: ${units.length} units but ${targets.length} names; skipping the group.`);
      continue;
    }
    // Only units sitting on a name this grade no longer owns have to move,
    // and they take the doors nobody is holding. Anything already on one of
    // its grade's doors stays put, so a re-run writes nothing.
    const movers = [...units]
      .filter((u) => !targets.includes(u.name))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const free = targets.filter((t) => !units.some((u) => u.name === t));
    const moves = movers.map((unit, i) => ({ unit, target: free[i] }));
    if (moves.length === 0) {
      log("✅", `  ${g.code}: already on the block layout.`);
      continue;
    }
    for (const { unit, target } of moves) {
      await updateUnit(
        unit.id,
        nameOps(`UP-TMP-${unit.id}`),
        g,
        `UP-TMP-${unit.id}`,
        `park "${unit.name}" -> temp (heading for "${target}")`,
      );
    }
    for (const { unit, target } of moves) {
      await updateUnit(unit.id, nameOps(target), g, target, `"${unit.name}" -> "${target}"`);
    }
  }
}

/** A unit's name and both description locales move together. */
function nameOps(name: string): PatchOp[] {
  return [
    { op: "replace", path: "/name", value: name },
    { op: "add", path: "/description/en", value: name },
    { op: "add", path: "/description/de", value: name },
  ];
}

/** Units should accept JSON Patch; if they 405 like unit groups did, fall
 *  back to read-modify-PUT of the replaceable fields. */
async function updateUnit(
  unitId: string,
  ops: PatchOp[],
  g: GroupTarget,
  newName: string,
  label: string,
) {
  if (DRY_RUN) {
    log("🩹", `[dry-run] would update ${label}: ${ops.map((o) => o.path).join(", ")}`);
    return;
  }
  const { status, data } = await api(
    "PATCH",
    `/inventory/v1/units/${unitId}`,
    ops,
    "application/json-patch+json",
  );
  if (ok(status)) {
    log("✅", `${label} updated (${ops.map((o) => o.path).join(", ")}).`);
    return;
  }
  if (status !== 405) {
    throw new Error(`PATCH ${label} failed (${status}): ${JSON.stringify(data)}`);
  }
  const { status: gs, data: gd } = await api("GET", `/inventory/v1/units/${unitId}`);
  if (!ok(gs)) throw new Error(`GET unit ${unitId} failed (${gs}).`);
  const cur = gd as {
    unitGroup?: { id?: string };
    unitGroupId?: string;
    status?: { condition?: string };
    condition?: string;
  };
  await putJson(
    `/inventory/v1/units/${unitId}`,
    {
      name: newName,
      description: { en: newName, de: newName },
      unitGroupId: cur.unitGroup?.id ?? cur.unitGroupId ?? `${PROPERTY_ID}-${g.code}`,
      maxPersons: g.maxPersons,
      condition: cur.status?.condition ?? cur.condition ?? "Clean",
    },
    label,
  );
}

async function migrateRatePlans(): Promise<Map<string, string>> {
  const { status, data } = await api(
    "GET",
    `/rateplan/v1/rate-plans?propertyId=${PROPERTY_ID}&pageSize=200`,
  );
  if (!ok(status)) throw new Error(`Listing rate plans failed (${status}).`);
  const plans = ((data as any)?.ratePlans ?? []) as Array<any>;
  const planIds = new Map<string, string>();
  for (const g of GROUPS) {
    const plan = plans.find(
      (p) => p.code === `${g.code}_FLEX` && p.unitGroup?.id === `${PROPERTY_ID}-${g.code}`,
    );
    if (!plan) {
      log("⚠️ ", `Rate plan ${g.code}_FLEX not found; skipping its rename${g.newFloorPrice ? " AND its reprice" : ""}.`);
      continue;
    }
    planIds.set(g.code, plan.id);
    // Rename is cosmetic (the frontend shows content/lodges.ts names), so a
    // missing PATCH endpoint here warns rather than aborts: the reprice that
    // follows is the part that matters.
    try {
      await patch(
        `/rateplan/v1/rate-plans/${plan.id}`,
        [
          { op: "replace", path: "/name/en", value: `${g.name} Flexible` },
          { op: "replace", path: "/name/de", value: `${g.name} Flexibel` },
          {
            op: "add",
            path: "/description/en",
            value: `Standard flexible rate for the ${g.name}. 30% deposit at booking when more than 8 weeks out, balance due 8 weeks before arrival.`,
          },
          {
            op: "add",
            path: "/description/de",
            value: `Flexibler Standardtarif für die ${g.name}. 30% Anzahlung bei Buchung mehr als 8 Wochen im Voraus, Restzahlung 8 Wochen vor Anreise.`,
          },
        ],
        `rate plan ${g.code}_FLEX -> "${g.name} Flexible"`,
      );
    } catch (err) {
      log("⚠️ ", `  rename of ${g.code}_FLEX skipped (${(err as Error).message.slice(0, 80)}…). Cosmetic only; continuing.`);
    }
  }
  return planIds;
}

async function migrateServices() {
  for (const svc of SERVICE_PATCHES) {
    const id = `${PROPERTY_ID}-${svc.code}`;
    if (DRY_RUN) {
      log("🩹", `[dry-run] would update service ${svc.code} (${svc.note}).`);
      continue;
    }
    const ops: PatchOp[] = [
      { op: "replace", path: "/description/en", value: svc.description },
      { op: "replace", path: "/description/de", value: svc.description },
    ];
    if (svc.name) {
      ops.push({ op: "replace", path: "/name/en", value: svc.name });
      ops.push({ op: "replace", path: "/name/de", value: svc.name });
    }
    if (svc.price != null) {
      ops.push({
        op: "replace",
        path: "/defaultGrossPrice",
        value: { amount: svc.price, currency: CURRENCY },
      });
    }
    if (svc.mode) {
      ops.push({ op: "replace", path: "/availability/mode", value: svc.mode });
    }
    const { status, data } = await api(
      "PATCH",
      `/rateplan/v1/services/${id}`,
      ops,
      "application/json-patch+json",
    );
    if (ok(status)) {
      log("✅", `service ${svc.code} updated (${svc.note}).`);
      continue;
    }
    if (status !== 405) {
      throw new Error(`PATCH service ${svc.code} failed (${status}): ${JSON.stringify(data)}`);
    }
    // Same 405 story as unit groups: read-modify-PUT. The description is
    // guest-visible on the extras page, so this one is worth the fallback.
    const { status: gs, data: gd } = await api("GET", `/rateplan/v1/services/${id}`);
    if (!ok(gs)) throw new Error(`GET service ${svc.code} failed (${gs}).`);
    const cur = gd as {
      name: unknown;
      defaultGrossPrice: unknown;
      pricingUnit: unknown;
      postNextDay: unknown;
      availability: unknown;
      channelCodes?: unknown;
    };
    await putJson(
      `/rateplan/v1/services/${id}`,
      {
        name: svc.name ? { en: svc.name, de: svc.name } : cur.name,
        description: { en: svc.description, de: svc.description },
        defaultGrossPrice:
          svc.price != null
            ? { amount: svc.price, currency: CURRENCY }
            : cur.defaultGrossPrice,
        pricingUnit: cur.pricingUnit,
        postNextDay: cur.postNextDay,
        availability: svc.mode
          ? { ...(cur.availability as object), mode: svc.mode }
          : cur.availability,
        channelCodes: cur.channelCodes,
      },
      `service ${svc.code} (${svc.note})`,
    );
  }
}

/** Same one-GET-one-PUT shape as provision.ts, on the new floor. Prices and
 *  the Friday/Monday turnover restrictions ride in the same PUT: restrictions
 *  key off the slice's own from/to boundaries (see provision.ts for the
 *  anchoring notes, verified against the offers endpoint). */
async function rewriteRates(rpId: string, floorPrice: number, label: string) {
  const fromDate = new Date().toISOString().split("T")[0];
  const toDate = new Date(Date.now() + PRICE_WINDOW_DAYS * 86_400_000).toISOString().split("T")[0];

  const { status: gs, data: gd } = await api(
    "GET",
    `/rateplan/v1/rate-plans/${rpId}/rates?from=${fromDate}T00:00:00Z&to=${toDate}T00:00:00Z`,
  );
  if (!ok(gs)) throw new Error(`Fetch rates for ${label} failed: ${JSON.stringify(gd)}`);
  const slices = ((gd as any)?.rates ?? []) as Array<any>;
  if (slices.length === 0) {
    log("⚠️ ", `  no rate slices returned for ${label}; skipping.`);
    return;
  }
  const rates = slices.map((r) => {
    const arrivalOnThisNight = new Date(r.from);
    const departureAfterThisNight = new Date(r.to);
    return {
      from: r.from,
      to: r.to,
      price: { amount: seasonalNightly(floorPrice, arrivalOnThisNight), currency: CURRENCY },
      restrictions: {
        closed: false,
        closedOnArrival: !isTurnoverDay(arrivalOnThisNight),
        closedOnDeparture: !isTurnoverDay(departureAfterThisNight),
      },
    };
  });
  if (DRY_RUN) {
    const prices = rates.map((x) => x.price.amount);
    log(
      "🩹",
      `[dry-run] would PUT ${rates.length} nightly rates on ${label}: KES ${Math.min(...prices).toLocaleString()} to ${Math.max(...prices).toLocaleString()}.`,
    );
    return;
  }
  const { status, data } = await api("PUT", `/rateplan/v1/rate-plans/${rpId}/rates`, { rates });
  if (status === 429) {
    throw new Error(
      `Reprice ${label} hit the rate-write budget (429). Wait 20 minutes and re-run; the PATCH steps are idempotent and only the remaining rate rewrites will retry.`,
    );
  }
  if (!ok(status)) throw new Error(`Reprice ${label} failed: ${JSON.stringify(data)}`);
  const prices = rates.map((x) => x.price.amount);
  log(
    "✅",
    `  ${label}: ${rates.length} nights repriced, KES ${Math.min(...prices).toLocaleString()} to ${Math.max(...prices).toLocaleString()}/night.`,
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\n🏔️  Unity Parks – migrate UPNV to Mount Kenya${DRY_RUN ? " (DRY RUN)" : ""}\n`);

  if (LANES_ONLY) {
    log("🧭", "Lane re-map only…");
    await remapLanes();
    console.log(`\n✨  ${DRY_RUN ? "Dry run complete: nothing was written." : "Lanes re-mapped."}\n`);
    return;
  }

  if (SERVICES_ONLY) {
    log("🎁", "Service copy only…");
    await migrateServices();
    console.log(`\n✨  ${DRY_RUN ? "Dry run complete: nothing was written." : "Services updated."}\n`);
    return;
  }

  await preflightOversizedReservations();
  console.log();

  await migrateProperty();
  console.log();

  log("🏠", "Unit groups…");
  await migrateUnitGroups();
  console.log();

  log("🛏️ ", "Units (lane names, and maxPersons on LKV/EXC)…");
  await migrateUnits();
  console.log();

  log("🧭", "Lane re-map (consecutive blocks per grade)…");
  await remapLanes();
  console.log();

  log("💰", "Rate plan names…");
  const planIds = await migrateRatePlans();
  console.log();

  log("🎁", "Service copy…");
  await migrateServices();
  console.log();

  log("💸", "Rate rewrite, all four plans, out to the 400-day horizon…");
  for (const g of GROUPS) {
    const rpId = planIds.get(g.code);
    if (!rpId) continue; // already warned in migrateRatePlans
    await rewriteRates(rpId, g.newFloorPrice, `${g.code}_FLEX @ ${g.newFloorPrice.toLocaleString()}`);
  }

  console.log(
    `\n✨  ${DRY_RUN ? "Dry run complete: nothing was written." : "Migration complete."}\n` +
      `    Verify: GET /booking/v1/offers?propertyId=${PROPERTY_ID}&... shows the new names\n` +
      `    and 38,000/56,000-based prices for LKV/EXC; WDL 3-night long-rains total is still 84,000.\n`,
  );
}

main().catch((err) => {
  console.error("\n❌  Migration failed:", err.message);
  process.exit(1);
});
