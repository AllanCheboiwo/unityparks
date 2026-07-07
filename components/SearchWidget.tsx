"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";

/**
 * The persistent "Book your break" widget. Deliberately lets the guest pick
 * ANY arrival date — the refusal of a non-turnover day (from the server, and
 * ultimately from Apaleo's restriction calendar) is the point of the demo.
 */

const BREAKS = [
  { nights: 3, label: "Weekend", sub: "3 nights · Fri → Mon" },
  { nights: 4, label: "Midweek", sub: "4 nights · Mon → Fri" },
  { nights: 7, label: "Full week", sub: "7 nights" },
] as const;

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Next occurrence of a weekday (1=Mon, 5=Fri), starting tomorrow. */
function nextWeekday(dow: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() !== dow) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

type SearchResponse = { sessionId: string };

export function SearchWidget() {
  const router = useRouter();
  const [arrival, setArrival] = useState("");
  const [nights, setNights] = useState<number>(3);
  const [adults, setAdults] = useState(2);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const departure = useMemo(
    () => (arrival ? addDays(arrival, nights) : ""),
    [arrival, nights],
  );

  async function search() {
    if (!arrival) {
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
          <label className="block">
            <span className="text-xs font-medium text-foreground/60 uppercase tracking-wide">
              Arrival
            </span>
            <input
              type="date"
              value={arrival}
              min={new Date().toISOString().slice(0, 10)}
              onChange={(e) => {
                setArrival(e.target.value);
                setRefusal(null);
              }}
              className="mt-1 w-full rounded-lg border border-forest/20 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-forest/40 bg-white"
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-foreground/60 uppercase tracking-wide">
              Break
            </span>
            <select
              value={nights}
              onChange={(e) => setNights(Number(e.target.value))}
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

      <p className="mt-3 text-xs text-foreground/55">
        Breaks start and end on a <strong>Friday or Monday</strong> — our lodges
        turn over on staff changeover days.
      </p>

      {refusal && (
        <div className="mt-4 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">{refusal}</p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => {
                setArrival(nextWeekday(5));
                setRefusal(null);
              }}
              className="rounded-md bg-white border border-amber-300 px-3 py-1 text-xs font-medium hover:bg-amber-100"
            >
              Next Friday
            </button>
            <button
              onClick={() => {
                setArrival(nextWeekday(1));
                setRefusal(null);
              }}
              className="rounded-md bg-white border border-amber-300 px-3 py-1 text-xs font-medium hover:bg-amber-100"
            >
              Next Monday
            </button>
          </div>
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
