"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { formatKes } from "@/lib/format";
import {
  MAX_BEDROOMS,
  MAX_INFANTS,
  maxToddlers,
  requiredBedrooms,
} from "@/lib/occupancy";
import { TurnoverCalendar, validArrivalDows } from "@/components/TurnoverCalendar";

/**
 * The Center Parcs-style booking bar: four fields (village, dates, lodges,
 * guests), each opening a panel that hugs the bar directly beneath it, then
 * Search. Options the demo backend can't honour yet (multi-lodge, dogs,
 * adapted stock) are shown greyed with a "real build" tag rather than hidden.
 *
 * Dates have two modes, both enforcing turnover: pick a specific start day, or
 * search a whole month for the start dates that are open (see the
 * /api/month-availability route). Bedrooms are derived from the party (see
 * lib/occupancy).
 */

const BOOKING_HORIZON_DAYS = 100;
const MAX_LODGE_SLEEPS = 8;
const VILLAGE_NAME = "Unity Parks Naivasha";

const NIGHT_OPTIONS = [3, 4, 7] as const;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// The four break shapes, matching Center Parcs: each is a length plus the
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

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "Fri 10 Jul" - the field-sized date format. */
function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function monthLabel(value: string): string {
  const [y, m] = value.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

type PanelName = "village" | "dates" | "lodges" | "guests";

type SearchResponse = { sessionId: string };

function Chevron() {
  return (
    <svg
      className="absolute right-4 top-1/2 -translate-y-1/2 text-forest/40"
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
    "w-8 h-8 rounded-full ring-1 ring-forest/30 text-forest text-base font-semibold hover:bg-sand disabled:opacity-25 disabled:hover:bg-transparent";
  return (
    <div className="flex items-center gap-3">
      <button type="button" onClick={() => onChange(value - 1)} disabled={value <= min} className={btn} aria-label="Decrease">
        −
      </button>
      <span className="w-5 text-center text-base font-semibold text-forest">{value}</span>
      <button type="button" onClick={() => onChange(value + 1)} disabled={value >= max} className={btn} aria-label="Increase">
        +
      </button>
    </div>
  );
}

function RealBuildTag() {
  return (
    <span className="rounded-full bg-sand text-forest/60 text-[10px] font-medium px-2 py-0.5 ml-2">
      real build
    </span>
  );
}

export function BookingBar() {
  const router = useRouter();
  const [open, setOpen] = useState<PanelName | null>(null);
  const [village, setVillage] = useState<string | null>(null);

  const [dateMode, setDateMode] = useState<"specific" | "month">("specific");
  const [arrival, setArrival] = useState("");
  const [nights, setNights] = useState<number>(4); // Center Parcs' widget default

  // Whole-month search state.
  const [monthPattern, setMonthPattern] = useState<string>("3-fri");
  const [monthValue, setMonthValue] = useState<string>("");
  const [monthStep, setMonthStep] = useState<"select" | "results">("select");
  const [monthResults, setMonthResults] = useState<MonthDate[] | null>(null);
  const [monthBusy, setMonthBusy] = useState(false);
  const [monthError, setMonthError] = useState<string | null>(null);

  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [toddlers, setToddlers] = useState(0);
  const [infants, setInfants] = useState(0);
  const [bedrooms, setBedrooms] = useState(() => requiredBedrooms(2, 0));
  const [refusal, setRefusal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const horizonEnd = addDays(today, BOOKING_HORIZON_DAYS);
  const departure = arrival ? addDays(arrival, nights) : "";
  const totalGuests = adults + children + toddlers + infants;

  // Two year columns: this year and next, Center Parcs style.
  const thisYear = Number(today.slice(0, 4));
  const gridYears = [thisYear, thisYear + 1];

  // Bedrooms follow the party: one per two adults, one per two children.
  const requiredBed = requiredBedrooms(adults, children);
  const toddlerCap = maxToddlers(bedrooms);

  function toggle(panel: PanelName) {
    setOpen((current) => (current === panel ? null : panel));
    setError(null);
  }

  function raiseBedrooms(nextAdults: number, nextChildren: number) {
    setBedrooms((b) => Math.max(b, requiredBedrooms(nextAdults, nextChildren)));
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

  async function findMonth() {
    setMonthError(null);
    if (!monthValue) {
      setMonthError("Pick a month to search.");
      return;
    }
    const pattern = MONTH_PATTERNS.find((p) => p.key === monthPattern)!;
    setMonthBusy(true);
    const query = new URLSearchParams({
      month: monthValue,
      nights: String(pattern.nights),
      dow: pattern.dow,
      adults: String(adults),
      children: String(children),
      toddlers: String(toddlers),
      infants: String(infants),
    });
    const result = await apiFetch<{ dates: MonthDate[] }>(`/api/month-availability?${query}`);
    setMonthBusy(false);
    if (!result.ok) {
      setMonthError(result.error);
      return;
    }
    setMonthResults(result.data.dates);
    setMonthStep("results");
  }

  function clearMonth() {
    setMonthValue("");
    setMonthPattern("3-fri");
    setMonthResults(null);
    setMonthError(null);
    setMonthStep("select");
  }

  async function runSearch(arr: string, nts: number) {
    if (!village) {
      setOpen("village");
      setError("Choose your village to get started.");
      return;
    }
    if (!arr) {
      setOpen("dates");
      setError("Choose your dates to get started.");
      return;
    }
    if (totalGuests > MAX_LODGE_SLEEPS) {
      setOpen("guests");
      setError(`Our largest lodge sleeps ${MAX_LODGE_SLEEPS}. For bigger parties, call our team.`);
      return;
    }
    setBusy(true);
    setError(null);
    setRefusal(null);

    const result = await apiFetch<SearchResponse>("/api/search", {
      method: "POST",
      body: JSON.stringify({
        arrival: arr,
        departure: addDays(arr, nts),
        adults,
        children,
        toddlers,
        infants,
      }),
    });

    if (result.ok) {
      // Only a preference above the party's own minimum is worth passing on.
      const bedroomsParam = bedrooms > 1 ? `&bedrooms=${bedrooms}` : "";
      router.push(`/lodges?session=${result.data.sessionId}${bedroomsParam}`);
      return;
    }
    if (result.refused) setRefusal(result.error);
    else setError(result.error);
    setBusy(false);
  }

  function pickMonthDate(d: MonthDate) {
    const pattern = MONTH_PATTERNS.find((p) => p.key === monthPattern)!;
    setArrival(d.arrival);
    setNights(pattern.nights);
    runSearch(d.arrival, pattern.nights);
  }

  const guestsLabel =
    totalGuests === adults
      ? `${adults} ${adults === 1 ? "adult" : "adults"}`
      : `${totalGuests} guests`;

  const field = "relative flex-1 min-w-[160px]";
  const chip =
    "relative w-full h-full text-left pl-5 pr-10 py-4 hover:bg-sand/60 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-forest/40";
  const chipLabel = "block text-[11px] font-medium uppercase tracking-wide text-foreground/50";
  const chipValue = "block text-base font-semibold text-forest truncate";
  const chipPlaceholder = "block text-base font-semibold text-foreground/40 truncate";
  // Hugs the bar: no top gap, square top corners so it reads as an extension.
  const panelCard =
    "absolute top-full z-40 rounded-b-xl bg-white shadow-xl shadow-forest/15 ring-1 ring-forest/10 p-5";
  const tab = "text-sm pb-2 -mb-2.5 transition-colors";
  const tabActive = "font-semibold text-forest border-b-2 border-gold";
  const tabIdle = "text-foreground/50 hover:text-forest";

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
      <div className="relative z-30 rounded-2xl bg-white shadow-xl shadow-forest/10 ring-1 ring-forest/10 flex flex-col sm:flex-row items-stretch divide-y sm:divide-y-0 sm:divide-x divide-forest/10">
        {/* Village */}
        <div className={field}>
          <button
            type="button"
            onClick={() => toggle("village")}
            aria-expanded={open === "village"}
            className={`${chip} sm:rounded-l-2xl`}
          >
            <span className={chipLabel}>Village</span>
            <span className={village ? chipValue : chipPlaceholder}>
              {village ?? "Select location(s)"}
            </span>
            <Chevron />
          </button>
          {open === "village" && (
            <div className={`${panelCard} left-0 w-[min(92vw,22rem)]`}>
              <p className="text-xs font-medium text-foreground/60 mb-2">Select your village</p>
              <button
                type="button"
                onClick={() => {
                  setVillage(VILLAGE_NAME);
                  setError(null);
                  setOpen("dates");
                }}
                className="w-full flex items-center justify-between rounded-lg px-2 -mx-2 py-2 text-left hover:bg-sand/50"
              >
                <div>
                  <p className="text-sm font-semibold text-forest">{VILLAGE_NAME}</p>
                  <p className="text-xs text-foreground/55">Lake Naivasha, Kenya</p>
                </div>
                <span
                  className={
                    village
                      ? "w-5 h-5 rounded-full bg-forest flex items-center justify-center text-white text-[10px]"
                      : "w-5 h-5 rounded-full ring-1 ring-forest/25"
                  }
                >
                  {village ? "✓" : ""}
                </span>
              </button>
            </div>
          )}
        </div>

        {/* Dates */}
        <div className={field}>
          <button
            type="button"
            onClick={() => toggle("dates")}
            aria-expanded={open === "dates"}
            className={chip}
          >
            <span className={chipLabel}>Dates</span>
            {arrival ? (
              <span className={chipValue}>
                {shortDate(arrival)} → {shortDate(departure)}
              </span>
            ) : (
              <span className={chipPlaceholder}>Choose dates</span>
            )}
            <Chevron />
          </button>
          {open === "dates" && (
            <div className={`${panelCard} left-0 w-[min(94vw,44rem)]`}>
              <div className="flex items-baseline gap-6 border-b border-forest/10 pb-2 mb-4">
                <button
                  type="button"
                  onClick={() => setDateMode("specific")}
                  className={`${tab} ${dateMode === "specific" ? tabActive : tabIdle}`}
                >
                  Specific date
                </button>
                <button
                  type="button"
                  onClick={() => setDateMode("month")}
                  className={`${tab} ${dateMode === "month" ? tabActive : tabIdle}`}
                >
                  Search whole month
                </button>
              </div>

              {dateMode === "specific" ? (
                <>
                  <div className="rounded-lg bg-lake/10 text-lake text-xs font-medium px-3 py-2 mb-3">
                    Unity Parks breaks start on a Friday or Monday.
                  </div>

                  <div className="flex gap-2 mb-3">
                    {NIGHT_OPTIONS.map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => changeNights(n)}
                        className={
                          nights === n
                            ? "rounded-lg bg-forest text-white px-4 py-1.5 text-sm font-semibold"
                            : "rounded-lg ring-1 ring-forest/25 text-forest px-4 py-1.5 text-sm hover:bg-sand"
                        }
                      >
                        {n} nights
                      </button>
                    ))}
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
                      className="rounded-lg bg-forest text-white px-6 py-2 text-sm font-semibold hover:bg-forest-light disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>
                </>
              ) : monthStep === "select" ? (
                <>
                  {/* Year headers with (decorative) navigation, two years */}
                  <div className="flex items-center gap-3 mb-4">
                    <span className="w-7 text-center text-lg text-foreground/20" aria-hidden>
                      ←
                    </span>
                    <div className="flex-1 grid grid-cols-2 gap-6">
                      {gridYears.map((y) => (
                        <p key={y} className="text-center text-lg font-semibold text-forest">
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
                          onClick={() => {
                            setMonthPattern(p.key);
                            setMonthResults(null);
                          }}
                          className={
                            monthPattern === p.key
                              ? "rounded-md bg-forest text-white px-4 py-2 text-sm font-semibold"
                              : "rounded-md ring-1 ring-forest/30 text-forest px-4 py-2 text-sm font-semibold hover:bg-sand"
                          }
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
                              onClick={() => {
                                setMonthValue(value);
                                setMonthResults(null);
                              }}
                              className={
                                selected
                                  ? "rounded-md bg-forest text-white text-sm font-semibold px-3 py-2"
                                  : selectable
                                    ? "rounded-md ring-1 ring-forest/30 text-forest text-sm font-semibold px-3 py-2 hover:bg-sand"
                                    : "rounded-md text-sm text-foreground/25 px-3 py-2 cursor-not-allowed"
                              }
                            >
                              {name} {year}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 rounded-lg bg-forest/5 px-4 py-3 text-xs text-foreground/70">
                    You can book a break for a three-night weekend (Friday to
                    Monday), four-night midweek (Monday to Friday) or seven
                    nights (starting Monday or Friday). Only months inside our
                    booking window can be searched.
                  </div>

                  {monthError && (
                    <div className="mt-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-800">
                      {monthError}
                    </div>
                  )}

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
                      onClick={findMonth}
                      disabled={monthBusy}
                      className="rounded-lg bg-forest text-white px-6 py-2 text-sm font-semibold hover:bg-forest-light disabled:opacity-60"
                    >
                      {monthBusy ? "Checking…" : "Next"}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setMonthStep("select")}
                    className="text-sm text-forest underline underline-offset-2"
                  >
                    ← Choose another month
                  </button>
                  <p className="mt-2 text-sm font-semibold text-forest">
                    {monthPatternLabel()} breaks in {monthValue ? monthLabel(monthValue) : ""}
                  </p>

                  <div className="mt-3 grid gap-2 max-h-72 overflow-y-auto pr-1">
                    {monthResults && monthResults.length === 0 && (
                      <p className="text-sm text-foreground/60">
                        No breaks of that shape start in{" "}
                        {monthValue ? monthLabel(monthValue) : "that month"} within our
                        booking window. Try another month or break length.
                      </p>
                    )}
                    {monthResults?.map((d) => (
                      <div
                        key={d.arrival}
                        className={`flex items-center justify-between rounded-lg px-4 py-2.5 ring-1 ${
                          d.available ? "ring-forest/15 bg-white" : "ring-forest/10 bg-sand/40 opacity-70"
                        }`}
                      >
                        <div>
                          <p className="text-sm font-semibold text-forest">
                            {shortDate(d.arrival)} → {shortDate(d.departure)}
                          </p>
                          <p className="text-xs text-foreground/55">
                            {d.available ? `from ${formatKes(d.fromPrice!)}` : "Sold out"}
                          </p>
                        </div>
                        {d.available && (
                          <button
                            type="button"
                            onClick={() => pickMonthDate(d)}
                            disabled={busy}
                            className="rounded-lg bg-forest text-white px-5 py-1.5 text-sm font-semibold hover:bg-forest-light disabled:opacity-60"
                          >
                            {busy ? "…" : "Select"}
                          </button>
                        )}
                      </div>
                    ))}
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
            <span className={chipLabel}>Lodges</span>
            <span className={chipValue}>1 lodge</span>
            <Chevron />
          </button>
          {open === "lodges" && (
            <div className={`${panelCard} left-0 w-[min(92vw,22rem)]`}>
              <div className="flex items-center justify-between py-2">
                <div>
                  <p className="text-sm font-semibold text-forest">1 lodge</p>
                  <p className="text-xs text-foreground/55">Select 1 lodge</p>
                </div>
                <span className="w-5 h-5 rounded-full bg-forest flex items-center justify-center text-white text-[10px]">✓</span>
              </div>
              {[2, 3].map((n) => (
                <div key={n} className="flex items-center justify-between py-2 opacity-50">
                  <div>
                    <p className="text-sm font-semibold text-forest">
                      {n} lodges
                      <RealBuildTag />
                    </p>
                    <p className="text-xs text-foreground/55">Group bookings arrive with the real build</p>
                  </div>
                  <span className="w-5 h-5 rounded-full ring-1 ring-forest/25" />
                </div>
              ))}
              <div className="rounded-lg bg-sand px-3 py-2.5 mt-2 text-xs text-forest">
                If you require more than 3 lodges, call our team on{" "}
                <span className="font-semibold whitespace-nowrap">+254 700 000 000</span>
              </div>
              <div className="flex justify-end mt-3">
                <button
                  type="button"
                  onClick={() => setOpen("guests")}
                  className="rounded-lg bg-forest text-white px-6 py-2 text-sm font-semibold hover:bg-forest-light"
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
            <span className={chipLabel}>Guests</span>
            <span className={chipValue}>{guestsLabel}</span>
            <Chevron />
          </button>
          {open === "guests" && (
            <div className={`${panelCard} left-0 w-[min(92vw,24rem)]`}>
              <p className="text-xs text-foreground/55 mb-2">Please enter age at time of arrival</p>

              <div className="flex items-center justify-between py-2">
                <div>
                  <p className="text-sm font-semibold text-forest">Adults</p>
                  <p className="text-xs text-foreground/55">18+ years</p>
                </div>
                <Stepper
                  value={adults}
                  min={1}
                  max={8}
                  onChange={(n) => {
                    setAdults(n);
                    raiseBedrooms(n, children);
                    setMonthResults(null);
                  }}
                />
              </div>
              <div className="flex items-center justify-between py-2">
                <div>
                  <p className="text-sm font-semibold text-forest">Children</p>
                  <p className="text-xs text-foreground/55">6 - 17 years</p>
                </div>
                <Stepper
                  value={children}
                  min={0}
                  max={7}
                  onChange={(n) => {
                    setChildren(n);
                    raiseBedrooms(adults, n);
                    setMonthResults(null);
                  }}
                />
              </div>
              <div className="flex items-center justify-between py-2">
                <div>
                  <p className="text-sm font-semibold text-forest">Toddlers</p>
                  <p className="text-xs text-foreground/55">2 - 5 years · up to 2 share a room</p>
                </div>
                <Stepper value={toddlers} min={0} max={toddlerCap} onChange={setToddlers} />
              </div>
              <div className="flex items-center justify-between py-2">
                <div>
                  <p className="text-sm font-semibold text-forest">Infants</p>
                  <p className="text-xs text-foreground/55">Under 2 years · up to {MAX_INFANTS}</p>
                </div>
                <Stepper value={infants} min={0} max={MAX_INFANTS} onChange={setInfants} />
              </div>

              <div className="flex items-center justify-between py-2 opacity-50">
                <div>
                  <p className="text-sm font-semibold text-forest">
                    Dogs
                    <RealBuildTag />
                  </p>
                  <p className="text-xs text-foreground/55">Dog-friendly lodges arrive with the real build</p>
                </div>
                <span className="text-sm font-semibold text-forest/50 pr-1">0</span>
              </div>

              <p className="text-xs font-medium text-foreground/60 border-t border-forest/10 pt-3 mt-1 mb-1">
                Number of bedrooms
              </p>
              <div className="flex items-center justify-between py-2">
                <div>
                  <p className="text-sm font-semibold text-forest">Bedrooms</p>
                  <p className="text-xs text-foreground/55">One per two adults or children</p>
                </div>
                <Stepper
                  value={bedrooms}
                  min={requiredBed}
                  max={MAX_BEDROOMS}
                  onChange={(n) => {
                    setBedrooms(n);
                    setToddlers((t) => Math.min(t, maxToddlers(n)));
                  }}
                />
              </div>

              <div className="flex items-center justify-between py-2 opacity-50">
                <p className="text-sm font-semibold text-forest">
                  Adapted lodge required?
                  <RealBuildTag />
                </p>
                <span className="w-9 h-5 rounded-full ring-1 ring-forest/25" />
              </div>

              <div className="flex justify-end mt-2">
                <button
                  type="button"
                  onClick={() => setOpen(null)}
                  className="rounded-lg bg-forest text-white px-6 py-2 text-sm font-semibold hover:bg-forest-light"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Search */}
        <button
          type="button"
          onClick={() => runSearch(arrival, nights)}
          disabled={busy}
          className="shrink-0 bg-forest text-white px-8 text-base font-semibold hover:bg-forest-light transition-colors disabled:opacity-60 py-4 sm:py-0 rounded-b-2xl sm:rounded-b-none sm:rounded-r-2xl"
        >
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
