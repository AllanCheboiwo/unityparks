"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import {
  MAX_BEDROOMS,
  MAX_INFANTS,
  MAX_PARTY,
  countedGuests,
  requiredBedrooms,
} from "@/lib/occupancy";
import { TurnoverCalendar, validArrivalDows } from "@/components/TurnoverCalendar";
import { VILLAGE_NAME } from "@/content/village";

/**
 * The booking bar: four fields (village, dates, lodges,
 * guests), each opening a panel that hugs the bar directly beneath it, then
 * Search. Book one, two or three lodges; each lodge has its own party, and
 * the guests panel splits into a section per lodge.
 *
 * Dates have two modes, both enforcing turnover: pick a specific start day, or
 * search a whole month for the start dates that are open. Bedrooms are derived
 * from each lodge's party (see lib/occupancy).
 */

// Just over thirteen months, so every campaign in the year ahead is bookable
// (festive included). Must stay within the window of priced nights the
// provisioning project writes into Apaleo (PRICE_WINDOW_DAYS there).
const BOOKING_HORIZON_DAYS = 400;
const MAX_LODGES = 3;

const NIGHT_OPTIONS = [3, 4, 7] as const;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// The four break shapes: each is a length plus the
// weekday it must start on (so the stay ends on a turnover day too).
const MONTH_PATTERNS = [
  { key: "3-fri", label: "3 Nights", sub: "Fri to Mon", nights: 3, dow: "fri" as const },
  { key: "4-mon", label: "4 Nights", sub: "Mon to Fri", nights: 4, dow: "mon" as const },
  { key: "7-fri", label: "7 Nights", sub: "Fri to Fri", nights: 7, dow: "fri" as const },
  { key: "7-mon", label: "7 Nights", sub: "Mon to Mon", nights: 7, dow: "mon" as const },
];

type MonthDate = {
  arrival: string;
  departure: string;
  available: boolean;
  fromPrice: number | null;
  currency: string;
};

/** One lodge's party. Bedrooms are derived but overridable up to the max. */
export type Party = {
  adults: number;
  children: number;
  toddlers: number;
  infants: number;
  bedrooms: number;
};

/**
 * Seed values for mounting the bar over an existing search (the results
 * page), so the guest sees their current search and can change any part of
 * it in place. Omitted on the home page, where the bar starts blank.
 */
export type BookingBarInitial = {
  arrival: string;
  nights: number;
  parties: Party[];
};

const DEFAULT_PARTY: Party = { adults: 2, children: 0, toddlers: 0, infants: 0, bedrooms: 1 };

function partySize(p: Party): number {
  return p.adults + p.children + p.toddlers + p.infants;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function monthLabel(value: string): string {
  const [y, m] = value.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/** "Mon 20 Jul" - the one-line date used where the stacked pair won't fit. */
function compactDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

type PanelName = "dates" | "lodges" | "guests";

type SearchResponse = { sessionId: string };

/* Small inline icons, house iconography: stroke currentColor. */

type IconProps = { className?: string };

function PinIcon({ className }: IconProps) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 21s-7-5.4-7-11a7 7 0 1 1 14 0c0 5.6-7 11-7 11z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function CalendarIcon({ className }: IconProps) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3 9.5h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function BuildingIcon({ className }: IconProps) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="4" y="3.5" width="16" height="17.5" rx="1" stroke="currentColor" strokeWidth="1.8" />
      <path d="M10 21v-4.5h4V21" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path
        d="M8.5 7.5h2m3 0h2m-7 4h2m3 0h2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PersonIcon({ className }: IconProps) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M5 20c1.4-3.4 4-5 7-5s5.6 1.6 7 5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MagnifierIcon({ className }: IconProps) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="2" />
      <path d="M19.5 19.5L15.6 15.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function TickIcon({ className }: IconProps) {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 12.5l5 5 9-11"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ArrowRightIcon({ className }: IconProps) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 12h15M13 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Chevron() {
  return (
    <svg
      className="absolute right-4 top-1/2 -translate-y-1/2 text-ink/40"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * The date treatment for the filled field: a tiny weekday label
 * above the date itself.
 */
function DateStack({ iso, showYear = true }: { iso: string; showYear?: boolean }) {
  const d = new Date(`${iso}T00:00:00Z`);
  const weekday = d.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
  const date = d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    ...(showYear ? { year: "numeric" as const } : {}),
    timeZone: "UTC",
  });
  // leading-[1.2], not leading-none: the tight line box was clipping the
  // descenders of Monday and Friday against the field's overflow edge.
  return (
    <span className="flex flex-col">
      <span className="text-[11px] leading-[1.2] text-foreground/55 mb-[2px]">{weekday}</span>
      <span className="text-[15px] font-semibold leading-[1.2] text-ink whitespace-nowrap">{date}</span>
    </span>
  );
}

function Stepper({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  const btn =
    "w-8 h-8 rounded-full border border-navy text-navy text-base font-semibold hover:bg-mist disabled:opacity-25 disabled:hover:bg-transparent";
  return (
    <div className="flex items-center gap-3">
      <button type="button" onClick={() => onChange(value - 1)} disabled={value <= min} className={btn} aria-label="Decrease">
        −
      </button>
      <span className="w-5 text-center text-base font-bold text-ink">{value}</span>
      <button type="button" onClick={() => onChange(value + 1)} disabled={value >= max} className={btn} aria-label="Increase">
        +
      </button>
    </div>
  );
}

/**
 * The age-band and bedroom steppers for one lodge's party. A lodge sleeps
 * eight: adults, children and toddlers all count toward that cap, so each of
 * those steppers stops once the party reaches eight. Infants under 2 sleep in
 * a cot, do not count toward the eight, and cap at two. Bedrooms follow the
 * party (one per two adults or children) and can be raised to the max.
 *
 * layout "stack" is the narrow single-lodge dropdown (each field a row).
 * layout "row" is the multi-lodge shape: the fields spread
 * horizontally across a wide panel, one lodge per row.
 */
function LodgeParty({
  party,
  onChange,
  layout = "stack",
}: {
  party: Party;
  onChange: (patch: Partial<Party>) => void;
  layout?: "stack" | "row";
}) {
  // Clamped to the largest lodge: a big party shares bedrooms rather than
  // demanding a fifth that no lodge has.
  const requiredBed = Math.min(requiredBedrooms(party.adults, party.children), MAX_BEDROOMS);

  // The party cap counts adults, children and toddlers. `slack` is how
  // many more of those the lodge can still take, so each stepper's max is its
  // own value plus the slack; at the cap, every one of them stops.
  const slack = MAX_PARTY - countedGuests(party.adults, party.children, party.toddlers);

  // Bedrooms follow the party both ways. If the guest has manually raised
  // bedrooms above what the party needs, we keep that choice but never let it
  // fall below the new requirement; otherwise bedrooms track the party exactly,
  // so reducing adults or children brings the count back down.
  const changeParty = (patch: Partial<Party>) => {
    const nextRequired = Math.min(
      requiredBedrooms(patch.adults ?? party.adults, patch.children ?? party.children),
      MAX_BEDROOMS,
    );
    const manuallyRaised = party.bedrooms > requiredBed;
    const bedrooms = manuallyRaised ? Math.max(party.bedrooms, nextRequired) : nextRequired;
    onChange({ ...patch, bedrooms });
  };

  const fields = [
    {
      key: "adults",
      label: "Adults",
      sub: "18+ years",
      value: party.adults,
      min: 1,
      max: party.adults + slack,
      onStep: (n: number) => changeParty({ adults: n }),
    },
    {
      key: "children",
      label: "Children",
      sub: "6 - 17 years",
      value: party.children,
      min: 0,
      max: party.children + slack,
      onStep: (n: number) => changeParty({ children: n }),
    },
    {
      key: "toddlers",
      label: "Toddlers",
      sub: "2 - 5 years",
      value: party.toddlers,
      min: 0,
      max: party.toddlers + slack,
      onStep: (n: number) => onChange({ toddlers: n }),
    },
    {
      key: "infants",
      label: "Infants",
      sub: layout === "row" ? `Under 2 · up to ${MAX_INFANTS}` : `Under 2 years · up to ${MAX_INFANTS}`,
      value: party.infants,
      min: 0,
      max: MAX_INFANTS,
      onStep: (n: number) => onChange({ infants: n }),
    },
    {
      key: "bedrooms",
      label: "Bedrooms",
      sub: layout === "row" ? "1 per 2 adults or children" : "One per two adults or children",
      value: party.bedrooms,
      min: requiredBed,
      max: MAX_BEDROOMS,
      onStep: (n: number) => onChange({ bedrooms: n }),
    },
  ];

  if (layout === "row") {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-5 gap-y-4">
        {fields.map((f) => (
          <div key={f.key}>
            <p className="text-sm font-semibold text-ink">{f.label}</p>
            <p className="text-[11px] text-foreground/55">{f.sub}</p>
            <div className="mt-2">
              <Stepper value={f.value} min={f.min} max={f.max} onChange={f.onStep} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      {fields.slice(0, 4).map((f) => (
        <div key={f.key} className="flex items-center justify-between py-2">
          <div>
            <p className="text-sm font-semibold text-ink">{f.label}</p>
            <p className="text-xs text-foreground/55">{f.sub}</p>
          </div>
          <Stepper value={f.value} min={f.min} max={f.max} onChange={f.onStep} />
        </div>
      ))}
      <p className="text-xs font-medium text-foreground/60 mt-1 mb-1">Number of bedrooms</p>
      <div className="flex items-center justify-between py-2">
        <div>
          <p className="text-sm font-semibold text-ink">Bedrooms</p>
          <p className="text-xs text-foreground/55">{fields[4].sub}</p>
        </div>
        <Stepper value={fields[4].value} min={fields[4].min} max={fields[4].max} onChange={fields[4].onStep} />
      </div>
    </>
  );
}

export function BookingBar({ initial }: { initial?: BookingBarInitial }) {
  const router = useRouter();
  const [open, setOpen] = useState<PanelName | null>(null);
  // One village in this demo, so it is fixed rather than chosen.
  const village = VILLAGE_NAME;

  // Seeded from the current search on the results page (re-mounted per
  // session via key=, so plain useState initials are enough). A month-mode
  // search still lands here as its chosen specific date; searching again
  // with a specific date deliberately drops the month price strip.
  const [dateMode, setDateMode] = useState<"specific" | "month">("specific");
  const [arrival, setArrival] = useState(initial?.arrival ?? "");
  const [nights, setNights] = useState<number>(initial?.nights ?? 4); // the widget default

  // Whole-month search: a break shape plus a month is all the widget asks.
  // The per-date narrowing lives on the results page as a price strip.
  const [monthPattern, setMonthPattern] = useState<string>("3-fri");
  const [monthValue, setMonthValue] = useState<string>("");

  // One party per lodge; a single-lodge break has one entry.
  const [parties, setParties] = useState<Party[]>(
    initial?.parties.length ? initial.parties.map((p) => ({ ...p })) : [{ ...DEFAULT_PARTY }],
  );
  const [refusal, setRefusal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const lodgeCount = parties.length;
  const today = new Date().toISOString().slice(0, 10);
  const horizonEnd = addDays(today, BOOKING_HORIZON_DAYS);
  const departure = arrival ? addDays(arrival, nights) : "";
  const totalGuests = parties.reduce((sum, p) => sum + partySize(p), 0);

  // Two year columns: this year and next.
  const thisYear = Number(today.slice(0, 4));
  const gridYears = [thisYear, thisYear + 1];

  function toggle(panel: PanelName) {
    setOpen((current) => (current === panel ? null : panel));
    setError(null);
  }

  function setLodgeCount(n: number) {
    setParties((prev) => {
      const next = prev.slice(0, n);
      while (next.length < n) next.push({ ...DEFAULT_PARTY });
      return next;
    });
  }

  function updateParty(index: number, patch: Partial<Party>) {
    setParties((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }

  function changeNights(n: number) {
    setNights(n);
    setRefusal(null);
    if (arrival) {
      const dow = new Date(`${arrival}T00:00:00Z`).getUTCDay();
      if (!validArrivalDows(n).includes(dow)) setArrival("");
    }
  }

  // A month is bookable if any of it falls inside the booking window.
  function monthSelectable(year: number, monthIndex: number): boolean {
    const mm = String(monthIndex + 1).padStart(2, "0");
    const start = `${year}-${mm}-01`;
    const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
    const end = `${year}-${mm}-${String(lastDay).padStart(2, "0")}`;
    return end >= today && start <= horizonEnd;
  }

  function clearMonth() {
    setMonthValue("");
    setMonthPattern("3-fri");
  }

  async function runSearch(arr: string, nts: number, extraParams = "") {
    if (!arr) {
      setOpen("dates");
      setError("Choose your dates to get started.");
      return;
    }
    const oversized = parties.findIndex(
      (p) => countedGuests(p.adults, p.children, p.toddlers) > MAX_PARTY,
    );
    if (oversized !== -1) {
      setOpen("guests");
      const label = lodgeCount > 1 ? `Lodge ${oversized + 1}` : "Your party";
      const counted = countedGuests(
        parties[oversized].adults,
        parties[oversized].children,
        parties[oversized].toddlers,
      );
      setError(
        `Our largest lodge sleeps ${MAX_PARTY} plus up to ${MAX_INFANTS} infants. ${label} has ${counted} guests aged 2 and over. Parties of more than six take two lodges.`,
      );
      return;
    }
    setBusy(true);
    setError(null);
    setRefusal(null);

    const lead = parties[0];
    const result = await apiFetch<SearchResponse>("/api/search", {
      method: "POST",
      body: JSON.stringify({
        arrival: arr,
        departure: addDays(arr, nts),
        adults: lead.adults,
        children: lead.children,
        toddlers: lead.toddlers,
        infants: lead.infants,
        ...(lodgeCount > 1
          ? {
              lodges: parties.map((p) => ({
                adults: p.adults,
                children: p.children,
                toddlers: p.toddlers,
                infants: p.infants,
              })),
            }
          : {}),
      }),
    });

    if (result.ok) {
      // Single-lodge bedroom preference only; multi-lodge slots filter by
      // their own party on the basket page.
      const bedroomsParam =
        lodgeCount === 1 && lead.bedrooms > 1 ? `&bedrooms=${lead.bedrooms}` : "";
      router.push(`/lodges?session=${result.data.sessionId}${bedroomsParam}${extraParams}`);
      return;
    }
    if (result.refused) setRefusal(result.error);
    else setError(result.error);
    setBusy(false);
  }

  /**
   * Month mode: price the month's candidate start dates for the chosen break
   * shape, then land on the results page with the cheapest one selected. The
   * page shows the whole month as a price strip, so the guest narrows there.
   */
  async function runMonthSearch() {
    if (!monthValue) {
      setOpen("dates");
      setError("Choose a month to get started.");
      return;
    }
    const oversized = parties.findIndex(
      (p) => countedGuests(p.adults, p.children, p.toddlers) > MAX_PARTY,
    );
    if (oversized !== -1) {
      setOpen("guests");
      const label = lodgeCount > 1 ? `Lodge ${oversized + 1}` : "Your party";
      setError(
        `Our largest lodge sleeps ${MAX_PARTY} plus up to ${MAX_INFANTS} infants. ${label} has too many guests aged 2 and over.`,
      );
      return;
    }
    const pattern = MONTH_PATTERNS.find((p) => p.key === monthPattern)!;
    setBusy(true);
    setError(null);
    setRefusal(null);
    // Priced on the first lodge's party, same as the results page's strip.
    const lead = parties[0];
    const query = new URLSearchParams({
      month: monthValue,
      nights: String(pattern.nights),
      dow: pattern.dow,
      adults: String(lead.adults),
      children: String(lead.children),
      toddlers: String(lead.toddlers),
      infants: String(lead.infants),
    });
    const result = await apiFetch<{ dates: MonthDate[] }>(`/api/month-availability?${query}`);
    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }
    const openDates = result.data.dates.filter((d) => d.available && d.fromPrice !== null);
    if (openDates.length === 0) {
      setRefusal(
        `Nothing is open for a ${pattern.label.toLowerCase()} break (${pattern.sub}) in ${monthLabel(monthValue)}. Try another month or break shape.`,
      );
      setBusy(false);
      return;
    }
    const cheapest = openDates.reduce((a, b) => (b.fromPrice! < a.fromPrice! ? b : a));
    await runSearch(cheapest.arrival, pattern.nights, `&month=${monthValue}`);
  }

  const guestsLabel =
    lodgeCount === 1 && totalGuests === parties[0].adults
      ? `${parties[0].adults} ${parties[0].adults === 1 ? "adult" : "adults"}`
      : `${totalGuests} guests`;
  const lodgesLabel = `${lodgeCount} ${lodgeCount === 1 ? "lodge" : "lodges"}`;

  // The row is shared by content width: village and dates carry long text
  // (full village name, two stacked dates with an arrow), lodges and guests
  // hold short counts. min-w-0 lets every field shrink instead of spill.
  const field = "relative flex-[0.75] min-w-0 lg:min-w-[120px]";
  const villageField = "relative flex-[1.15] min-w-0 lg:min-w-[200px]";
  const dateField = "relative flex-[1.35] min-w-0 lg:min-w-[210px]";
  const chip =
    "relative w-full h-full text-left pl-4 pr-10 py-3.5 hover:bg-mist/60 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-navy/40";
  const chipInner = "flex items-center gap-3";
  const chipIcon = "shrink-0 text-olive";
  const chipLabel = "block text-[11px] font-semibold uppercase tracking-wide text-foreground/55";
  const chipValue = "block text-base font-semibold text-ink truncate";
  const chipPlaceholder = "block text-base font-semibold text-foreground/40 truncate";
  // Hugs the bar: no top gap, square top corners so it reads as an extension.
  const panelCard =
    "absolute top-full z-40 rounded-b-xl bg-white shadow-2xl shadow-black/25 ring-1 ring-line p-5";
  const tab = "flex items-center gap-1.5 text-sm pb-2 mb-[-1px] border-b-[3px] transition-colors";
  const tabActive = "font-bold text-ink border-navy";
  const tabIdle = "text-foreground/55 border-transparent hover:text-ink";
  const pillOn = "rounded-md bg-navy text-white px-4 py-1.5 text-sm font-semibold";
  const pillOff =
    "rounded-md border border-navy bg-white text-navy px-4 py-1.5 text-sm font-semibold hover:bg-mist";

  const monthPatternLabel = () => {
    const p = MONTH_PATTERNS.find((x) => x.key === monthPattern);
    return p ? `${p.label} · ${p.sub}` : "";
  };

  return (
    <div className="relative">
      {open && (
        <button
          aria-label="Close panel"
          className="fixed inset-0 z-20 cursor-default"
          onClick={() => setOpen(null)}
        />
      )}

      {/* The bar */}
      <div className="relative z-30 rounded-xl bg-white shadow-xl shadow-black/10 ring-1 ring-line flex flex-col lg:flex-row items-stretch divide-y lg:divide-y-0 lg:divide-x divide-[#e5e2da]">
        {/* Village - one village in this demo, shown fixed */}
        <div className={villageField}>
          <div className={`${chipInner} pl-4 pr-5 py-3.5 h-full lg:rounded-l-xl`}>
            <PinIcon className={chipIcon} />
            <span className="min-w-0">
              <span className={chipLabel}>Village</span>
              <span className={chipValue}>{village}</span>
            </span>
          </div>
        </div>

        {/* Dates */}
        <div className={dateField}>
          <button
            type="button"
            onClick={() => toggle("dates")}
            aria-expanded={open === "dates"}
            className={chip}
          >
            <span className={chipInner}>
              <CalendarIcon className={chipIcon} />
              <span className="min-w-0">
                {dateMode === "month" ? (
                  monthValue ? (
                    <>
                      <span className={chipLabel}>Dates</span>
                      <span className={chipValue}>
                        {monthLabel(monthValue)} · {monthPatternLabel()}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className={chipLabel}>Dates</span>
                      <span className={chipPlaceholder}>Choose a month</span>
                    </>
                  )
                ) : arrival ? (
                  <>
                    {/* Wide screens: the stacked weekday-over-date pair.
                        Year only on departure when both share it, so the
                        pair fits the field instead of overflowing it. */}
                    <span className="hidden xl:flex items-center gap-2">
                      <DateStack
                        iso={arrival}
                        showYear={arrival.slice(0, 4) !== departure.slice(0, 4)}
                      />
                      <ArrowRightIcon className="shrink-0 text-ink/60" />
                      <DateStack iso={departure} />
                    </span>
                    {/* Narrower screens: one compact line. */}
                    <span className="xl:hidden">
                      <span className={chipLabel}>Dates</span>
                      <span className={chipValue}>
                        {compactDate(arrival)} → {compactDate(departure)}
                      </span>
                    </span>
                  </>
                ) : (
                  <>
                    <span className={chipLabel}>Dates</span>
                    <span className={chipPlaceholder}>Choose dates</span>
                  </>
                )}
              </span>
            </span>
            <Chevron />
          </button>
          {open === "dates" && (
            <div className={`${panelCard} left-0 w-[min(94vw,44rem)]`}>
              <div className="flex items-center gap-6 border-b border-line mb-4">
                <button
                  type="button"
                  onClick={() => setDateMode("specific")}
                  className={`${tab} ${dateMode === "specific" ? tabActive : tabIdle}`}
                >
                  <CalendarIcon className="shrink-0" />
                  Specific date
                </button>
                <button
                  type="button"
                  onClick={() => setDateMode("month")}
                  className={`${tab} ${dateMode === "month" ? tabActive : tabIdle}`}
                >
                  <MagnifierIcon className="shrink-0" />
                  Search whole month
                </button>
              </div>

              {dateMode === "specific" ? (
                <>
                  <div className="flex gap-2 mb-3">
                    {NIGHT_OPTIONS.map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => changeNights(n)}
                        className={nights === n ? pillOn : pillOff}
                      >
                        {n} nights
                      </button>
                    ))}
                  </div>

                  <div className="-mx-5 mb-4 bg-[#eef1f4] px-5 py-2.5 text-center text-[13px] font-bold text-navy">
                    Unity Parks breaks start on a Friday or Monday.
                  </div>

                  <TurnoverCalendar
                    value={arrival || null}
                    onChange={(iso) => {
                      setArrival(iso);
                      setRefusal(null);
                      setError(null);
                    }}
                    nights={nights}
                    minDate={today}
                    maxDate={horizonEnd}
                    onDisabledPick={(reason) => setRefusal(reason)}
                    monthsToShow={2}
                    showLegend={false}
                  />

                  {refusal && (
                    <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
                      {refusal}
                    </div>
                  )}

                  <div className="flex items-center justify-end gap-4 mt-3">
                    <button
                      type="button"
                      onClick={() => setArrival("")}
                      className="text-xs text-foreground/50 underline underline-offset-2"
                    >
                      Clear selection
                    </button>
                    <button
                      type="button"
                      onClick={() => setOpen("lodges")}
                      disabled={!arrival}
                      className="btn-primary text-sm"
                    >
                      Next
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {/* Year headers with (decorative) navigation, two years */}
                  <div className="flex items-center gap-3 mb-4">
                    <span className="w-7 text-center text-lg text-foreground/20" aria-hidden>
                      ←
                    </span>
                    <div className="flex-1 grid grid-cols-2 gap-6">
                      {gridYears.map((y) => (
                        <p key={y} className="font-display text-center text-lg font-bold text-navy">
                          {y}
                        </p>
                      ))}
                    </div>
                    <span className="w-7 text-center text-lg text-foreground/20" aria-hidden>
                      →
                    </span>
                  </div>

                  {/* Break length patterns, centered */}
                  <div className="flex justify-center gap-3 mb-5">
                    {MONTH_PATTERNS.map((p) => (
                      <div key={p.key} className="text-center">
                        <p className="text-[11px] text-foreground/55 mb-1">{p.sub}</p>
                        <button
                          type="button"
                          onClick={() => setMonthPattern(p.key)}
                          className={monthPattern === p.key ? pillOn : pillOff}
                        >
                          {p.label}
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* Two-year month grid; only in-window months are selectable */}
                  <div className="grid grid-cols-2 gap-6">
                    {gridYears.map((year) => (
                      <div key={year} className="grid grid-cols-2 gap-2 content-start">
                        {MONTH_NAMES.map((name, mi) => {
                          const selectable = monthSelectable(year, mi);
                          const value = `${year}-${String(mi + 1).padStart(2, "0")}`;
                          const selected = monthValue === value;
                          return (
                            <button
                              key={mi}
                              type="button"
                              disabled={!selectable}
                              onClick={() => setMonthValue(value)}
                              className={
                                selected
                                  ? "rounded-md bg-navy text-white text-sm font-semibold px-3 py-2"
                                  : selectable
                                    ? "rounded-md border border-navy bg-white text-navy text-sm font-semibold px-3 py-2 hover:bg-mist"
                                    : "rounded-md text-sm text-[#c9c9c9] px-3 py-2 cursor-not-allowed"
                              }
                            >
                              {name} {year}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>

                  <div className="-mx-5 mt-4 bg-[#eef1f4] px-5 py-2.5 text-center text-[13px] font-bold text-navy">
                    Unity Parks breaks start on a Friday or Monday.
                  </div>
                  <p className="mt-3 text-xs text-foreground/70">
                    Pick a break shape and a month, then hit Search. We&apos;ll
                    show every start date that&apos;s open, cheapest first.
                    Only months inside our booking window can be searched.
                  </p>

                  <div className="flex items-center justify-end gap-4 mt-3">
                    <button
                      type="button"
                      onClick={clearMonth}
                      className="text-sm text-foreground/50 underline underline-offset-2"
                    >
                      Clear selection
                    </button>
                    <button
                      type="button"
                      onClick={() => setOpen("lodges")}
                      disabled={!monthValue}
                      className="btn-primary text-sm"
                    >
                      Next
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Lodges */}
        <div className={field}>
          <button
            type="button"
            onClick={() => toggle("lodges")}
            aria-expanded={open === "lodges"}
            className={chip}
          >
            <span className={chipInner}>
              <BuildingIcon className={chipIcon} />
              <span className="min-w-0">
                <span className={chipLabel}>Lodges</span>
                <span className={chipValue}>{lodgesLabel}</span>
              </span>
            </span>
            <Chevron />
          </button>
          {open === "lodges" && (
            <div className={`${panelCard} left-0 w-[min(92vw,22rem)]`}>
              <p className="text-xs font-medium text-foreground/60 mb-1">How many lodges?</p>
              {[1, 2, 3].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setLodgeCount(n)}
                  className="w-full flex items-center justify-between rounded-lg px-2 -mx-2 py-2 text-left hover:bg-mist/60"
                >
                  <div>
                    <p className="text-sm font-semibold text-ink">
                      {n} {n === 1 ? "lodge" : "lodges"}
                    </p>
                    <p className="text-xs text-foreground/55">
                      {n === 1
                        ? "One lodge for your party"
                        : `${n} lodges, each with its own guests`}
                    </p>
                  </div>
                  <span
                    className={
                      lodgeCount === n
                        ? "w-5 h-5 rounded-full bg-navy flex items-center justify-center text-white"
                        : "w-5 h-5 rounded-full ring-1 ring-navy/30"
                    }
                  >
                    {lodgeCount === n ? <TickIcon /> : null}
                  </span>
                </button>
              ))}
              <div className="rounded-lg bg-mist px-3 py-2.5 mt-2 text-xs text-foreground">
                If you require more than {MAX_LODGES} lodges, call our team on{" "}
                <span className="font-semibold whitespace-nowrap">+254 700 000 000</span>
              </div>
              <div className="flex justify-end mt-3">
                <button
                  type="button"
                  onClick={() => setOpen("guests")}
                  className="btn-primary text-sm"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Guests */}
        <div className={field}>
          <button
            type="button"
            onClick={() => toggle("guests")}
            aria-expanded={open === "guests"}
            className={chip}
          >
            <span className={chipInner}>
              <PersonIcon className={chipIcon} />
              <span className="min-w-0">
                <span className={chipLabel}>Guests</span>
                <span className={chipValue}>{guestsLabel}</span>
              </span>
            </span>
            <Chevron />
          </button>
          {open === "guests" && (
            <div
              className={`${panelCard} max-h-[72vh] overflow-y-auto ${
                lodgeCount > 1
                  ? "right-0 w-[min(94vw,62rem)]"
                  : "left-0 w-[min(92vw,24rem)]"
              }`}
            >
              <p className="text-xs text-foreground/55 mb-2">Please enter age at time of arrival</p>

              {parties.map((party, i) => (
                <div
                  key={i}
                  className={
                    i > 0
                      ? "mt-4 pt-4 border-t border-line"
                      : lodgeCount > 1
                        ? "mt-1"
                        : ""
                  }
                >
                  {lodgeCount > 1 && (
                    <p className="font-display text-lg font-bold text-navy mb-3">Lodge {i + 1}</p>
                  )}
                  <LodgeParty
                    party={party}
                    onChange={(patch) => updateParty(i, patch)}
                    layout={lodgeCount > 1 ? "row" : "stack"}
                  />
                </div>
              ))}

              <div className="flex justify-end mt-2">
                <button
                  type="button"
                  onClick={() => setOpen(null)}
                  className="btn-primary text-sm"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Search. Corners spelled out one by one: the rounded-b-* and
            rounded-r-* shorthands both set bottom-right, and whichever loses
            paints a square ochre corner outside the bar's rounded outline. */}
        <button
          type="button"
          onClick={() => (dateMode === "month" ? runMonthSearch() : runSearch(arrival, nights))}
          disabled={busy}
          className="shrink-0 flex items-center justify-center gap-2 bg-ochre text-white px-8 text-base font-bold hover:bg-ochre-dark transition-colors disabled:opacity-60 py-4 lg:py-0 rounded-bl-xl rounded-br-xl lg:rounded-bl-none lg:rounded-tr-xl"
        >
          <MagnifierIcon className="shrink-0" />
          {busy ? "Searching…" : "Search"}
        </button>
      </div>

      {/* Bar-level messages (server refusals, guest-count limits) */}
      {(refusal || error) && open === null && (
        <div
          className={`mt-3 rounded-lg px-4 py-3 text-sm ${
            refusal
              ? "bg-amber-50 border border-amber-200 text-amber-900"
              : "bg-red-50 border border-red-200 text-red-800"
          }`}
        >
          {refusal ?? error}
        </div>
      )}
      {error && open !== null && (
        <div className="mt-3 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800 relative z-30">
          {error}
        </div>
      )}
    </div>
  );
}
