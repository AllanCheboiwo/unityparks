"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { TurnoverCalendar, validArrivalDows } from "@/components/TurnoverCalendar";

/**
 * The persistent "Book your break" widget. The calendar is the first layer
 * of turnover enforcement: only valid break-start days are selectable, and
 * clicking a greyed day explains the rule. Our API re-validates every search
 * (layer two) and Apaleo's restriction calendar enforces underneath (layer
 * three) — so nothing non-conformant can ever be sold, even if the UI is
 * bypassed.
 */

const BREAKS = [
  { nights: 3, label: "Weekend", sub: "3 nights · Fri → Mon" },
  { nights: 4, label: "Midweek", sub: "4 nights · Mon → Fri" },
  { nights: 7, label: "Full week", sub: "7 nights" },
] as const;

// Breaks are on sale roughly this far ahead (the sandbox price/restriction
// calendar covers ~120 days; keep the picker inside it).
const BOOKING_HORIZON_DAYS = 100;

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

type SearchResponse = { sessionId: string };

export function SearchWidget() {
  const router = useRouter();
  const [arrival, setArrival] = useState("");
  const [nights, setNights] = useState<number>(3);
  const [adults, setAdults] = useState(2);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const departure = useMemo(
    () => (arrival ? addDays(arrival, nights) : ""),
    [arrival, nights],
  );

  function changeBreak(newNights: number) {
    setNights(newNights);
    setRefusal(null);
    // A Friday start can't survive a switch to midweek (and vice versa) —
    // clear the date and reopen the calendar rather than search invalidly.
    if (arrival) {
      const dow = new Date(`${arrival}T00:00:00Z`).getUTCDay();
      if (!validArrivalDows(newNights).includes(dow)) {
        setArrival("");
        setCalendarOpen(true);
      }
    }
  }

  async function search() {
    if (!arrival) {
      setCalendarOpen(true);
      setError("Pick an arrival date to get started.");
      return;
    }
    setBusy(true);
    setError(null);
    setRefusal(null);

    const result = await apiFetch<SearchResponse>("/api/search", {
      method: "POST",
      body: JSON.stringify({ arrival, departure, adults }),
    });

    if (result.ok) {
      router.push(`/lodges?session=${result.data.sessionId}`);
      return;
    }
    if (result.refused) setRefusal(result.error);
    else setError(result.error);
    setBusy(false);
  }

  return (
    <div className="rounded-2xl bg-white shadow-xl shadow-forest/10 ring-1 ring-forest/10 p-5 sm:p-6">
      <p className="font-display text-lg text-forest mb-4">Book your break</p>

      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <span className="text-xs font-medium text-foreground/60 uppercase tracking-wide">
              Arrival
            </span>
            <button
              type="button"
              onClick={() => setCalendarOpen((open) => !open)}
              className="mt-1 w-full rounded-lg border border-forest/20 px-3 py-2.5 text-sm text-left bg-white hover:border-forest/40 focus:outline-none focus:ring-2 focus:ring-forest/40"
            >
              {arrival ? formatDate(arrival) : <span className="text-foreground/45">Choose a date…</span>}
            </button>
          </div>

          <label className="block">
            <span className="text-xs font-medium text-foreground/60 uppercase tracking-wide">
              Break
            </span>
            <select
              value={nights}
              onChange={(e) => changeBreak(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-forest/20 px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-forest/40"
            >
              {BREAKS.map((b) => (
                <option key={b.nights} value={b.nights}>
                  {b.label} — {b.sub}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-medium text-foreground/60 uppercase tracking-wide">
              Guests
            </span>
            <select
              value={adults}
              onChange={(e) => setAdults(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-forest/20 px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-forest/40"
            >
              {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                <option key={n} value={n}>
                  {n} {n === 1 ? "guest" : "guests"}
                </option>
              ))}
            </select>
          </label>
        </div>

        <button
          onClick={search}
          disabled={busy}
          className="self-end rounded-lg bg-forest text-white px-8 py-2.5 text-sm font-semibold hover:bg-forest-light transition-colors disabled:opacity-60 h-[42px]"
        >
          {busy ? "Searching…" : "Search"}
        </button>
      </div>

      {calendarOpen && (
        <div className="mt-4">
          <TurnoverCalendar
            value={arrival || null}
            onChange={(iso) => {
              setArrival(iso);
              setCalendarOpen(false);
              setRefusal(null);
              setError(null);
            }}
            nights={nights}
            minDate={today}
            maxDate={addDays(today, BOOKING_HORIZON_DAYS)}
            onDisabledPick={(reason) => setRefusal(reason)}
          />
        </div>
      )}

      {arrival && (
        <p className="mt-3 text-xs text-foreground/55">
          {formatDate(arrival)} → {formatDate(departure)}
        </p>
      )}
      <p className="mt-1 text-xs text-foreground/55">
        Breaks start and end on a <strong>Friday or Monday</strong> — our lodges
        turn over on staff changeover days.
      </p>

      {refusal && (
        <div className="mt-4 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">
          {refusal}
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}
    </div>
  );
}
