"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { BAND_LABELS, formatDate, formatKes, nightsLabel } from "@/lib/format";
import { LODGES } from "@/content/lodges";
import type { BookingConfirmation } from "@/lib/types";
import { TurnoverCalendar } from "@/components/TurnoverCalendar";

type AmendResponse = {
  ok: boolean;
  arrival: string;
  departure: string;
  folioBalance: number;
};

type GuestRow = {
  position: number;
  band: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  email: string;
};

export function ManageClient({ bookingId }: { bookingId: string }) {
  // Proof of access rides the URL: ?session= fresh from checkout, ?email=
  // from the find-my-booking challenge. Signed-in owners need neither.
  const searchParams = useSearchParams();
  const proofPairs = new URLSearchParams();
  const proofSession = searchParams.get("session");
  const proofEmail = searchParams.get("email");
  if (proofSession) proofPairs.set("session", proofSession);
  if (proofEmail) proofPairs.set("email", proofEmail);
  const proofQuery = proofPairs.size > 0 ? `?${proofPairs.toString()}` : "";

  const [booking, setBooking] = useState<BookingConfirmation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsProof, setNeedsProof] = useState(false);
  const [newArrival, setNewArrival] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const [moved, setMoved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [guestRows, setGuestRows] = useState<GuestRow[] | null>(null);
  const [guestsBusy, setGuestsBusy] = useState(false);
  const [guestsError, setGuestsError] = useState<string | null>(null);
  const [guestsSaved, setGuestsSaved] = useState(false);

  async function load() {
    const result = await apiFetch<BookingConfirmation>(`/api/booking/${bookingId}${proofQuery}`);
    if (!result.ok) {
      if (result.status === 401) return setNeedsProof(true);
      return setError(result.error);
    }
    setBooking(result.data);
    const saved = new Map(result.data.guests.map((g) => [g.position, g]));
    setGuestRows(
      result.data.partyBands.map((band, position) => {
        const g = saved.get(position);
        return {
          position,
          band,
          firstName: g?.firstName ?? (position === 0 ? (result.data.guest.firstName ?? "") : ""),
          lastName: g?.lastName ?? (position === 0 ? (result.data.guest.lastName ?? "") : ""),
          dateOfBirth: g?.dateOfBirth ?? "",
          email: g?.email ?? "",
        };
      }),
    );
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId]);

  if (needsProof) {
    return (
      <div className="mx-auto max-w-lg text-center py-20 px-5">
        <p className="font-display text-2xl text-forest">This booking is private</p>
        <p className="mt-2 text-sm text-foreground/60">
          Sign in to your account, or find the booking with its reference and
          the lead guest&apos;s email.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Link
            href={`/login?next=/manage/${bookingId}`}
            className="rounded-lg bg-forest text-white px-6 py-2.5 text-sm font-semibold hover:bg-forest-light"
          >
            Sign in
          </Link>
          <Link
            href="/manage"
            className="rounded-lg border border-forest/25 px-6 py-2.5 text-sm font-semibold text-forest hover:bg-forest/5"
          >
            Find my booking
          </Link>
        </div>
      </div>
    );
  }
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

  const nights = Math.round(
    (Date.parse(booking.stay.departure) - Date.parse(booking.stay.arrival)) / 86_400_000,
  );
  const multi = booking.lodges.length > 1;

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

    const result = await apiFetch<AmendResponse>(`/api/booking/${bookingId}/amend${proofQuery}`, {
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
        <p className="text-xs uppercase tracking-wide text-foreground/50">
          {multi ? `Current break · ${booking.lodges.length} lodges` : "Current stay"}
        </p>
        <p className="text-sm text-foreground/60 mt-1">
          {formatDate(booking.stay.arrival)} → {formatDate(booking.stay.departure)} ·{" "}
          {nightsLabel(nights)}
        </p>
        <div className="mt-2 grid gap-1">
          {booking.lodges.map((l) => {
            const lodge = l.unitGroupCode ? LODGES[l.unitGroupCode] : null;
            return (
              <p key={l.slot} className="text-sm text-forest">
                <span className="font-medium">
                  {multi ? `Lodge ${l.slot + 1}: ` : ""}
                  {lodge?.name ?? "Lodge"}
                </span>
                <span className="text-foreground/55"> · {l.partyLabel}</span>
              </p>
            );
          })}
        </div>
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

      {multi ? (
        <div className="mt-8 rounded-2xl bg-white ring-1 ring-forest/10 shadow-sm p-5">
          <p className="font-display text-lg text-forest">Move your break</p>
          <p className="mt-1 text-sm text-foreground/60">
            To change the dates on a multi-lodge break, call our team on{" "}
            <span className="font-semibold whitespace-nowrap">+254 700 000 000</span>.
            Online date changes for a single lodge are available on single-lodge
            bookings.
          </p>
        </div>
      ) : (
      <form onSubmit={move} className="mt-8 rounded-2xl bg-white ring-1 ring-forest/10 shadow-sm p-5">
        <p className="font-display text-lg text-forest">Move your break</p>
        <p className="mt-1 text-sm text-foreground/60">
          Your whole {nights}-night break moves to a new start date. New dates
          still start on a Friday or Monday, the same rule as booking.
        </p>

        <div className="mt-4 flex flex-wrap items-start gap-4">
          <div className="rounded-xl border border-forest/15 bg-white p-3 w-full max-w-xs">
            <TurnoverCalendar
              value={newArrival || null}
              onChange={(iso) => {
                setNewArrival(iso);
                setRefusal(null);
              }}
              nights={nights}
              minDate={new Date().toISOString().slice(0, 10)}
              maxDate={addDays(new Date().toISOString().slice(0, 10), 100)}
              onDisabledPick={(reason) => setRefusal(reason)}
            />
          </div>
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
      )}

      {guestRows && (
        <div className="mt-8 rounded-2xl bg-white ring-1 ring-forest/10 shadow-sm p-5">
          <p className="font-display text-lg text-forest">Who&apos;s coming</p>
          <p className="mt-1 text-sm text-foreground/60">
            Name everyone in your party so activity passes and wristbands are
            ready at the gate. Only we store this; nothing changes on the
            reservation.
          </p>

          <div className="mt-4 grid gap-4">
            {guestRows.map((row) => (
              <div key={row.position} className="rounded-xl ring-1 ring-forest/10 p-4">
                <p className="text-sm font-semibold text-forest">
                  {BAND_LABELS[row.band] ?? row.band}
                  {row.position === 0 && (
                    <span className="ml-2 rounded-full bg-forest/10 px-2 py-0.5 text-xs font-semibold text-forest">
                      Lead booker
                    </span>
                  )}
                </p>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <input
                    aria-label="First name"
                    placeholder="First name"
                    value={row.firstName}
                    onChange={(e) =>
                      setGuestRows((prev) =>
                        prev!.map((r) =>
                          r.position === row.position ? { ...r, firstName: e.target.value } : r,
                        ),
                      )
                    }
                    className="rounded-lg border border-forest/20 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-forest/40"
                  />
                  <input
                    aria-label="Last name"
                    placeholder="Last name"
                    value={row.lastName}
                    onChange={(e) =>
                      setGuestRows((prev) =>
                        prev!.map((r) =>
                          r.position === row.position ? { ...r, lastName: e.target.value } : r,
                        ),
                      )
                    }
                    className="rounded-lg border border-forest/20 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-forest/40"
                  />
                </div>
                {row.band !== "adult" && (
                  <input
                    aria-label="Date of birth"
                    type="date"
                    value={row.dateOfBirth}
                    onChange={(e) =>
                      setGuestRows((prev) =>
                        prev!.map((r) =>
                          r.position === row.position ? { ...r, dateOfBirth: e.target.value } : r,
                        ),
                      )
                    }
                    className="mt-3 rounded-lg border border-forest/20 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-forest/40"
                  />
                )}
              </div>
            ))}
          </div>

          {guestsError && (
            <div className="mt-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
              {guestsError}
            </div>
          )}
          {guestsSaved && (
            <div className="mt-4 rounded-lg bg-moss/10 border border-moss/30 px-4 py-3 text-sm text-forest">
              Party saved.
            </div>
          )}

          <button
            type="button"
            disabled={guestsBusy}
            onClick={async () => {
              setGuestsBusy(true);
              setGuestsError(null);
              setGuestsSaved(false);
              const result = await apiFetch(`/api/booking/${bookingId}/guests${proofQuery}`, {
                method: "PUT",
                body: JSON.stringify({
                  guests: guestRows.map((row) => ({
                    position: row.position,
                    firstName: row.firstName.trim() || undefined,
                    lastName: row.lastName.trim() || undefined,
                    dateOfBirth: row.dateOfBirth || undefined,
                    email: row.email.trim() || undefined,
                  })),
                }),
              });
              setGuestsBusy(false);
              if (!result.ok) return setGuestsError(result.error);
              setGuestsSaved(true);
            }}
            className="mt-4 rounded-lg bg-forest text-white px-6 py-2.5 text-sm font-semibold hover:bg-forest-light disabled:opacity-60"
          >
            {guestsBusy ? "Saving…" : "Save party"}
          </button>
        </div>
      )}

      <div className="mt-8 text-center">
        <Link
          href={`/confirmation/${booking.bookingId}${proofQuery}`}
          className="text-sm text-lake underline underline-offset-2"
        >
          View confirmation
        </Link>
      </div>
    </div>
  );
}
