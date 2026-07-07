"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { formatDate, formatKes, nightsLabel } from "@/lib/format";
import { LODGES } from "@/content/lodges";
import type { BookingConfirmation } from "@/lib/types";

type AmendResponse = {
  ok: boolean;
  arrival: string;
  departure: string;
  folioBalance: number;
};

export function ManageClient({ bookingId }: { bookingId: string }) {
  const [booking, setBooking] = useState<BookingConfirmation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newArrival, setNewArrival] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const [moved, setMoved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    const result = await apiFetch<BookingConfirmation>(`/api/booking/${bookingId}`);
    if (!result.ok) return setError(result.error);
    setBooking(result.data);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId]);

  if (error && !booking) {
    return <p className="mx-auto max-w-2xl px-5 py-20 text-center text-red-700">{error}</p>;
  }
  if (!booking) {
    return (
      <p className="mx-auto max-w-2xl px-5 py-20 text-center text-foreground/50">
        Fetching your booking…
      </p>
    );
  }

  const lodge = booking.stay.unitGroupCode ? LODGES[booking.stay.unitGroupCode] : null;
  const nights = Math.round(
    (Date.parse(booking.stay.departure) - Date.parse(booking.stay.arrival)) / 86_400_000,
  );

  function addDays(iso: string, days: number): string {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  async function move(e: React.FormEvent) {
    e.preventDefault();
    if (!newArrival) return;
    setBusy(true);
    setRefusal(null);
    setError(null);
    setMoved(false);

    const result = await apiFetch<AmendResponse>(`/api/booking/${bookingId}/amend`, {
      method: "POST",
      body: JSON.stringify({
        arrival: newArrival,
        departure: addDays(newArrival, nights),
      }),
    });

    if (!result.ok) {
      if (result.refused) setRefusal(result.error);
      else setError(result.error);
      setBusy(false);
      return;
    }
    setMoved(true);
    setNewArrival("");
    await load();
    setBusy(false);
  }

  return (
    <div className="mx-auto max-w-xl px-5 py-10">
      <h1 className="font-display text-3xl text-forest">
        Manage your <em>booking</em>
      </h1>
      <p className="mt-1 text-sm text-foreground/60">
        Reference <span className="font-mono tracking-widest">{booking.bookingId}</span>
      </p>

      <div className="mt-6 rounded-2xl bg-white ring-1 ring-forest/10 shadow-sm p-5">
        <p className="text-xs uppercase tracking-wide text-foreground/50">Current stay</p>
        <p className="mt-1 font-medium text-forest">{lodge?.name ?? "Lodge"}</p>
        <p className="text-sm text-foreground/60">
          {formatDate(booking.stay.arrival)} → {formatDate(booking.stay.departure)}
        </p>
        <p className="text-sm text-foreground/60">
          {nightsLabel(nights)} · {booking.stay.adults}{" "}
          {booking.stay.adults === 1 ? "guest" : "guests"}
        </p>
        <div className="mt-3 flex gap-2">
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              booking.folioBalance === 0
                ? "bg-moss/15 text-moss"
                : "bg-amber-100 text-amber-900"
            }`}
          >
            {booking.folioBalance === 0
              ? "Folio settled"
              : `Folio balance ${formatKes(booking.folioBalance)}`}
          </span>
        </div>
      </div>

      <form onSubmit={move} className="mt-8 rounded-2xl bg-white ring-1 ring-forest/10 shadow-sm p-5">
        <p className="font-display text-lg text-forest">Move your break</p>
        <p className="mt-1 text-sm text-foreground/60">
          Your whole {nights}-night break moves to a new start date. New dates
          still start on a Friday or Monday — the same rule as booking.
        </p>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="text-xs font-medium text-foreground/60 uppercase tracking-wide">
              New arrival
            </span>
            <input
              type="date"
              value={newArrival}
              min={new Date().toISOString().slice(0, 10)}
              onChange={(e) => {
                setNewArrival(e.target.value);
                setRefusal(null);
              }}
              className="mt-1 rounded-lg border border-forest/20 px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-forest/40"
            />
          </label>
          <button
            type="submit"
            disabled={busy || !newArrival}
            className="rounded-lg bg-forest text-white px-6 py-2.5 text-sm font-semibold hover:bg-forest-light disabled:opacity-60"
          >
            {busy ? "Moving…" : "Move break"}
          </button>
        </div>

        {newArrival && (
          <p className="mt-2 text-xs text-foreground/50">
            New stay: {formatDate(newArrival)} → {formatDate(addDays(newArrival, nights))}
          </p>
        )}

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
        {moved && (
          <div className="mt-4 rounded-lg bg-moss/10 border border-moss/30 px-4 py-3 text-sm text-forest">
            Break moved. Your reservation is updated in the reservation system
            and the folio is still settled.
          </div>
        )}
      </form>

      <div className="mt-8 text-center">
        <Link
          href={`/confirmation/${booking.bookingId}`}
          className="text-sm text-lake underline underline-offset-2"
        >
          View confirmation
        </Link>
      </div>
    </div>
  );
}
