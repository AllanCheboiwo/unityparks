"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { TurnoverCalendar, validArrivalDows } from "@/components/TurnoverCalendar";

/**
 * The Center Parcs-style booking bar: four chips (village → dates → lodges →
 * guests), each opening a panel, then Search. Options the demo backend can't
 * honour yet (multi-lodge, dogs, adapted stock, whole-month search) are shown
 * greyed with a "real build" tag rather than hidden — the funnel shape is the
 * product story.
 *
 * The dates panel is the first layer of turnover enforcement: only valid
 * break-start days are selectable. Our API re-validates, Apaleo enforces
 * underneath.
 */

const BOOKING_HORIZON_DAYS = 100;
const MAX_LODGE_SLEEPS = 8;

const NIGHT_OPTIONS = [3, 4, 7] as const;

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "Fri 10 Jul" — the chip-sized date format. */
function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

type PanelName = "village" | "dates" | "lodges" | "guests";

type SearchResponse = { sessionId: string };

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
    "w-7 h-7 rounded-full ring-1 ring-forest/30 text-forest text-sm font-semibold hover:bg-sand disabled:opacity-25 disabled:hover:bg-transparent";
  return (
    <div className="flex items-center gap-2.5">
      <button type="button" onClick={() => onChange(value - 1)} disabled={value <= min} className={btn} aria-label="Decrease">
        −
      </button>
      <span className="w-5 text-center text-sm font-semibold text-forest">{value}</span>
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
  const [arrival, setArrival] = useState("");
  const [nights, setNights] = useState<number>(4); // Center Parcs' widget default
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [toddlers, setToddlers] = useState(0);
  const [infants, setInfants] = useState(0);
  const [bedrooms, setBedrooms] = useState(0); // 0 = no preference
  const [refusal, setRefusal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const departure = useMemo(() => (arrival ? addDays(arrival, nights) : ""), [arrival, nights]);
  const totalGuests = adults + children + toddlers + infants;

  function toggle(panel: PanelName) {
    setOpen((current) => (current === panel ? null : panel));
    setError(null);
  }

  function changeNights(n: number) {
    setNights(n);
    setRefusal(null);
    if (arrival) {
      const dow = new Date(`${arrival}T00:00:00Z`).getUTCDay();
      if (!validArrivalDows(n).includes(dow)) setArrival("");
    }
  }

  async function search() {
    if (!arrival) {
      setOpen("dates");
      setError("Choose your dates to get started.");
      return;
    }
    if (totalGuests > MAX_LODGE_SLEEPS) {
      setOpen("guests");
      setError(`Our largest lodge sleeps ${MAX_LODGE_SLEEPS} — for bigger parties, call our team.`);
      return;
    }
    setBusy(true);
    setError(null);
    setRefusal(null);

    const result = await apiFetch<SearchResponse>("/api/search", {
      method: "POST",
      body: JSON.stringify({ arrival, departure, adults, children, toddlers, infants }),
    });

    if (result.ok) {
      const bedroomsParam = bedrooms > 0 ? `&bedrooms=${bedrooms}` : "";
      router.push(`/lodges?session=${result.data.sessionId}${bedroomsParam}`);
      return;
    }
    if (result.refused) setRefusal(result.error);
    else setError(result.error);
    setBusy(false);
  }

  const guestsLabel =
    totalGuests === adults
      ? `${adults} ${adults === 1 ? "adult" : "adults"}`
      : `${totalGuests} guests`;

  const chip =
    "flex-1 min-w-[130px] text-left px-4 py-2.5 hover:bg-sand/60 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-forest/40";
  const chipLabel = "block text-[10px] font-medium uppercase tracking-wide text-foreground/50";
  const chipValue = "block text-sm font-semibold text-forest truncate";
  const panelCard =
    "absolute top-full mt-2 z-30 rounded-xl bg-white shadow-xl shadow-forest/15 ring-1 ring-forest/10 p-4";

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
      <div className="relative z-30 rounded-2xl bg-white shadow-xl shadow-forest/10 ring-1 ring-forest/10 flex flex-wrap sm:flex-nowrap items-stretch divide-x divide-forest/10 overflow-hidden">
        <button type="button" onClick={() => toggle("village")} aria-expanded={open === "village"} className={chip}>
          <span className={chipLabel}>Village</span>
          <span className={chipValue}>Naivasha ▾</span>
        </button>
        <button type="button" onClick={() => toggle("dates")} aria-expanded={open === "dates"} className={chip}>
          <span className={chipLabel}>Dates</span>
          <span className={chipValue}>
            {arrival ? `${shortDate(arrival)} → ${shortDate(departure)}` : "Choose dates ▾"}
          </span>
        </button>
        <button type="button" onClick={() => toggle("lodges")} aria-expanded={open === "lodges"} className={chip}>
          <span className={chipLabel}>Lodges</span>
          <span className={chipValue}>1 lodge ▾</span>
        </button>
        <button type="button" onClick={() => toggle("guests")} aria-expanded={open === "guests"} className={chip}>
          <span className={chipLabel}>Guests</span>
          <span className={chipValue}>{guestsLabel} ▾</span>
        </button>
        <button
          type="button"
          onClick={search}
          disabled={busy}
          className="shrink-0 bg-forest text-white px-7 text-sm font-semibold hover:bg-forest-light transition-colors disabled:opacity-60 py-3.5 sm:py-0 w-full sm:w-auto"
        >
          {busy ? "Searching…" : "Search"}
        </button>
      </div>

      {/* Village panel */}
      {open === "village" && (
        <div className={`${panelCard} left-0 w-full max-w-sm`}>
          <p className="text-xs font-medium text-foreground/60 mb-3">Our villages (select 1)</p>
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="text-sm font-semibold text-forest">Unity Parks Naivasha</p>
              <p className="text-xs text-foreground/55">Lake Naivasha, Kenya</p>
            </div>
            <span className="w-5 h-5 rounded-full bg-forest flex items-center justify-center text-white text-[10px]">✓</span>
          </div>
          <div className="flex items-center justify-between py-2 opacity-50">
            <div>
              <p className="text-sm font-semibold text-forest">
                More villages
                <RealBuildTag />
              </p>
              <p className="text-xs text-foreground/55">The next parks join here as they open</p>
            </div>
            <span className="w-5 h-5 rounded-full ring-1 ring-forest/25" />
          </div>
          <div className="flex justify-end mt-3">
            <button
              type="button"
              onClick={() => setOpen("dates")}
              className="rounded-lg bg-forest text-white px-6 py-2 text-sm font-semibold hover:bg-forest-light"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Dates panel */}
      {open === "dates" && (
        <div className={`${panelCard} left-0 right-0`}>
          <div className="flex items-baseline gap-5 border-b border-forest/10 pb-2 mb-3">
            <span className="text-sm font-semibold text-forest border-b-2 border-gold pb-2 -mb-2.5">
              Specific date
            </span>
            <span className="text-sm text-foreground/40">
              Search whole month
              <RealBuildTag />
            </span>
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

          <div className="rounded-lg bg-lake/10 text-lake text-xs font-medium px-3 py-2 mb-3">
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
            maxDate={addDays(today, BOOKING_HORIZON_DAYS)}
            onDisabledPick={(reason) => setRefusal(reason)}
            monthsToShow={2}
            showLegend={false}
          />

          <p className="text-[11px] text-foreground/50 mt-3 max-w-lg">
            You can book a break for a three-night weekend (Friday to Monday),
            four-night midweek (Monday to Friday) or seven nights (starting
            Monday or Friday).
          </p>

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
        </div>
      )}

      {/* Lodges panel */}
      {open === "lodges" && (
        <div className={`${panelCard} left-0 sm:left-auto sm:right-0 w-full max-w-sm`}>
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

      {/* Guests panel */}
      {open === "guests" && (
        <div className={`${panelCard} left-0 sm:left-auto sm:right-0 w-full max-w-sm`}>
          <p className="text-xs text-foreground/55 mb-2">Please enter age at time of arrival</p>

          <div className="flex items-center justify-between py-2">
            <div>
              <p className="text-sm font-semibold text-forest">Adults</p>
              <p className="text-xs text-foreground/55">18+ years</p>
            </div>
            <Stepper value={adults} min={1} max={8} onChange={setAdults} />
          </div>
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="text-sm font-semibold text-forest">Children</p>
              <p className="text-xs text-foreground/55">6 – 17 years</p>
            </div>
            <Stepper value={children} min={0} max={7} onChange={setChildren} />
          </div>
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="text-sm font-semibold text-forest">Toddlers</p>
              <p className="text-xs text-foreground/55">2 – 5 years</p>
            </div>
            <Stepper value={toddlers} min={0} max={7} onChange={setToddlers} />
          </div>
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="text-sm font-semibold text-forest">Infants</p>
              <p className="text-xs text-foreground/55">Under 2 years</p>
            </div>
            <Stepper value={infants} min={0} max={7} onChange={setInfants} />
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
              <p className="text-xs text-foreground/55">{bedrooms === 0 ? "No preference" : `At least ${bedrooms}`}</p>
            </div>
            <Stepper value={bedrooms} min={0} max={4} onChange={setBedrooms} />
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
