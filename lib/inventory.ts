/**
 * The pure half of the activities inventory layer (UNP-6,
 * docs/activity-inventory-plan.md). Client-safe: no server imports. Window
 * math, caps, free-count derivation, the request validator that turns a
 * guest's picks into hold lines, and the checkout classification. The
 * database half (the guarded update) lives in server/inventory/holds.ts.
 *
 * Dates are property-local ISO YYYY-MM-DD strings throughout, the same
 * convention as arrival and departure.
 */

/** How long an unconfirmed hold lives. One constant, tuned in one place. */
export const HOLD_TTL_MINUTES = 30;

/** Under this many free, the card says the number; above it, nothing. */
export const LOW_STOCK_THRESHOLD = 5;

export type ResourceKind = "STOCK" | "SESSION";
export type CapRule = "adults" | "children";

/** What the validator and the card need to know about a resource. */
export type ResourceFacts = {
  id: string;
  code: string;
  name: string;
  kind: ResourceKind;
  capacity: number;
  sessionStart: string | null;
  /** Display only; optional because the validator never needs it. */
  sessionMinutes?: number | null;
  apaleoServiceCode: string;
  openDaysBefore: number | null;
  capRule: CapRule;
  active: boolean;
};

export type LodgeParty = { adults: number; childrenAges: number[] };

/** One line the placement primitive will claim. */
export type HoldLine = { resourceId: string; date: string; qty: number };

/** A guest's pick: a resource, a quantity, and for sessions the date. */
export type ActivityRequest = { resourceCode: string; qty: number; date?: string };

/** What the lodge already holds, summarised from its CONFIRMED holds. */
export type OwnedLine = { resourceCode: string; date: string; qty: number };

const DAY_MS = 86_400_000;

function toUtcMs(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}

function toIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Every night of the break: arrival through the night before departure. */
export function stayNights(arrival: string, departure: string): string[] {
  const nights: string[] = [];
  for (let ms = toUtcMs(arrival); ms < toUtcMs(departure); ms += DAY_MS) {
    nights.push(toIso(ms));
  }
  return nights;
}

/** The property-local day a windowed resource opens for a given arrival. */
export function opensOnDate(arrival: string, openDaysBefore: number): string {
  return toIso(toUtcMs(arrival) - openDaysBefore * DAY_MS);
}

export type WindowState =
  | { state: "open" }
  | { state: "opens_on"; date: string }
  | { state: "closed" };

/**
 * Whether a resource can be booked today for a break arriving on `arrival`.
 * Closed on the arrival day itself (the extras rule: the village team sells
 * in person from then on). No window means open from confirmation.
 */
export function resourceWindow(input: {
  arrival: string;
  openDaysBefore: number | null;
  todayIso: string;
}): WindowState {
  if (input.todayIso >= input.arrival) return { state: "closed" };
  if (input.openDaysBefore === null) return { state: "open" };
  const opens = opensOnDate(input.arrival, input.openDaysBefore);
  if (input.todayIso < opens) return { state: "opens_on", date: opens };
  return { state: "open" };
}

/** Free units on one resource-day. Expired holds still sit in `taken`
 *  until swept, so they are handed back here at read time. */
export function freeCount(input: { capacity: number; taken: number; expiredHeld: number }): number {
  return Math.max(0, input.capacity - input.taken + input.expiredHeld);
}

/** A whole-break hire is limited by its scarcest night. Nights nobody has
 *  touched have no row yet and count as fully free. */
export function freeForStay(input: {
  capacity: number;
  nights: string[];
  takenByDate: Record<string, { taken: number; expiredHeld: number }>;
}): number {
  let free = input.capacity;
  for (const night of input.nights) {
    const day = input.takenByDate[night];
    const here = day ? freeCount({ capacity: input.capacity, ...day }) : input.capacity;
    if (here < free) free = here;
  }
  return Math.max(0, free);
}

/** Children of two and over ride; infants sleep in a cot, the same rule
 *  per-person extras already follow. */
function ridingChildren(childrenAges: number[]): number {
  return childrenAges.filter((age) => age >= 2).length;
}

/** The most of a resource one lodge may hold, from its party. */
export function capFor(resource: Pick<ResourceFacts, "capRule">, lodge: LodgeParty): number {
  return resource.capRule === "children" ? ridingChildren(lodge.childrenAges) : lodge.adults;
}

export type ValidatedActivities = {
  ok: true;
  /** Sorted by (resourceId, date) so every caller locks rows in one order. */
  lines: HoldLine[];
  /** Per Apaleo service, how many more to book (the engine adds to owned). */
  additions: Array<{ serviceCode: string; count: number }>;
};

export type ActivityValidation = ValidatedActivities | { ok: false; reason: string };

function longDate(iso: string): string {
  return new Date(toUtcMs(iso)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Turn a lodge's picks into hold lines and Apaleo counts, or refuse. Every
 * refusal here happens before a hold is placed or Apaleo is called, and
 * names what it refused. The rules are section 5.6 of the spec: the
 * resource's window, the lodge's caps counting what it already owns, one
 * session per date per lodge, and sessions only on the stay's nights.
 */
export function validateActivityRequests(input: {
  resources: ResourceFacts[];
  lodge: LodgeParty;
  stay: { arrival: string; departure: string };
  todayIso: string;
  owned: OwnedLine[];
  requests: ActivityRequest[];
}): ActivityValidation {
  if (input.requests.length === 0) {
    return { ok: false, reason: "Pick at least one activity to add." };
  }
  const nights = stayNights(input.stay.arrival, input.stay.departure);
  const byCode = new Map(input.resources.map((r) => [r.code, r]));

  // Owned riders per stock resource (the count on any one night), owned
  // places per session resource-date, and which dates already carry a
  // session.
  const ownedStock = new Map<string, number>();
  const ownedSession = new Map<string, number>();
  const sessionDates = new Set<string>();
  for (const line of input.owned) {
    const resource = byCode.get(line.resourceCode);
    if (!resource) continue;
    if (resource.kind === "SESSION") {
      const key = `${resource.code}|${line.date}`;
      ownedSession.set(key, (ownedSession.get(key) ?? 0) + line.qty);
      sessionDates.add(line.date);
    } else {
      ownedStock.set(resource.code, Math.max(ownedStock.get(resource.code) ?? 0, line.qty));
    }
  }

  const lines: HoldLine[] = [];
  const additions = new Map<string, number>();
  const seen = new Set<string>();
  const requestedStock = new Map<string, number>();

  for (const request of input.requests) {
    const resource = byCode.get(request.resourceCode);
    if (!resource || !resource.active) {
      return { ok: false, reason: "One of those activities isn't available for this break." };
    }
    if (!Number.isInteger(request.qty) || request.qty < 1) {
      return { ok: false, reason: "Quantities must be whole numbers of at least one." };
    }

    const window = resourceWindow({
      arrival: input.stay.arrival,
      openDaysBefore: resource.openDaysBefore,
      todayIso: input.todayIso,
    });
    if (window.state === "closed") {
      return {
        ok: false,
        reason: "Activities can be added up to the day before arrival. Speak to the village team when you arrive.",
      };
    }
    if (window.state === "opens_on") {
      return {
        ok: false,
        reason: `${resource.name} opens for booking on ${longDate(window.date)}.`,
      };
    }

    const cap = capFor(resource, input.lodge);

    if (resource.kind === "SESSION") {
      if (!request.date || !nights.includes(request.date)) {
        return { ok: false, reason: `${resource.name} needs a date during your stay.` };
      }
      const key = `${resource.code}|${request.date}`;
      if (seen.has(key)) {
        return { ok: false, reason: "Each session can only appear once per request." };
      }
      seen.add(key);
      if (sessionDates.has(request.date)) {
        return {
          ok: false,
          reason: `You already have a spa session on ${longDate(request.date)}. One session per day per lodge.`,
        };
      }
      sessionDates.add(request.date);
      const owned = ownedSession.get(key) ?? 0;
      if (owned + request.qty > cap) {
        return {
          ok: false,
          reason: `${resource.name} is limited to ${cap} place${cap === 1 ? "" : "s"} for this lodge.`,
        };
      }
      lines.push({ resourceId: resource.id, date: request.date, qty: request.qty });
    } else {
      if (seen.has(resource.code)) {
        return { ok: false, reason: "Each activity can only appear once per request." };
      }
      seen.add(resource.code);
      const owned = ownedStock.get(resource.code) ?? 0;
      const already = requestedStock.get(resource.code) ?? 0;
      if (owned + already + request.qty > cap) {
        return {
          ok: false,
          reason: `${resource.name} is limited to ${cap} for this lodge${owned > 0 ? `, and you already have ${owned}` : ""}.`,
        };
      }
      requestedStock.set(resource.code, already + request.qty);
      for (const night of nights) {
        lines.push({ resourceId: resource.id, date: night, qty: request.qty });
      }
    }

    additions.set(
      resource.apaleoServiceCode,
      (additions.get(resource.apaleoServiceCode) ?? 0) + request.qty,
    );
  }

  lines.sort((a, b) =>
    a.resourceId === b.resourceId
      ? a.date.localeCompare(b.date)
      : a.resourceId.localeCompare(b.resourceId),
  );

  return {
    ok: true,
    lines,
    additions: [...additions].map(([serviceCode, count]) => ({ serviceCode, count })),
  };
}

/**
 * Checkout classification (spec 5.10). Retired services vanish; services
 * backed by an inventory resource stay, flagged as teasers with Apaleo's
 * price intact and no quantity control. The snapshot POST refuses teasers,
 * so ensureRecord never books stock nobody held.
 */
export function classifyCheckoutOffers<T extends { code: string }>(
  offers: T[],
  rules: { resourceCodes: ReadonlySet<string>; retired: ReadonlySet<string> },
): Array<T & { teaser: boolean }> {
  return offers
    .filter((offer) => !rules.retired.has(offer.code))
    .map((offer) => ({ ...offer, teaser: rules.resourceCodes.has(offer.code) }));
}

/** True when a checkout extras snapshot carries a resource-backed service. */
export function isTeaserSnapshot(
  extras: Array<{ code: string }>,
  resourceCodes: ReadonlySet<string>,
): boolean {
  return extras.some((extra) => resourceCodes.has(extra.code));
}
