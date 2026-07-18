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
  slot: number;
  position: number;
  band: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  email: string;
};

const guestInputClass =
  "rounded-md border border-[#cccccc] bg-white px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-navy";

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
    setGuestRows(
      result.data.lodges.flatMap((lodge) => {
        const saved = new Map(lodge.guests.map((g) => [g.position, g]));
        return lodge.bands.map((band, position) => {
          const g = saved.get(position);
          const isLeadSeat = lodge.slot === 0 && position === 0;
          return {
            slot: lodge.slot,
            position,
            band,
            firstName: g?.firstName ?? (isLeadSeat ? (result.data.guest.firstName ?? "") : ""),
            lastName: g?.lastName ?? (isLeadSeat ? (result.data.guest.lastName ?? "") : ""),
            dateOfBirth: g?.dateOfBirth ?? "",
            email: g?.email ?? "",
          };
        });
      }),
    );
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId]);

  if (needsProof) {
    return (
      <div className="mx-auto max-w-lg text-center py-20 px-5">
        <p className="font-display text-2xl font-bold text-ink">This booking is private</p>
        <p className="mt-2 text-sm text-foreground">
          Sign in to your account, or find the booking with its reference and
          the lead guest&apos;s email.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Link href={`/login?next=/manage/${bookingId}`} className="btn-primary">
            Sign in
          </Link>
          <Link href="/manage" className="btn-dark-outline">
            Find my booking
          </Link>
        </div>
      </div>
    );
  }
  if (error && !booking) {
    return <p className="mx-auto max-w-2xl px-5 py-20 text-center text-[#b3261e]">{error}</p>;
  }
  if (!booking) {
    return (
      <p className="mx-auto max-w-2xl px-5 py-20 text-center text-foreground/60">
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
      <h1 className="font-display text-3xl font-bold text-ink">
        Manage your <em>booking</em>
      </h1>
      <p className="mt-2 text-sm text-foreground">
        Reference{" "}
        <span className="font-mono font-semibold tracking-widest text-navy">
          {booking.bookingId}
        </span>
      </p>

      <div className="mt-6 rounded-lg border border-line bg-white p-6">
        <p className="font-display text-xl font-bold text-ink">
          {multi ? `Your break · ${booking.lodges.length} lodges` : "Your stay"}
        </p>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-foreground">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path d="M3 10h18M8 3v4M16 3v4" />
          </svg>
          {formatDate(booking.stay.arrival)} to {formatDate(booking.stay.departure)} ·{" "}
          {nightsLabel(nights)}
        </p>
        <div className="mt-2 grid gap-1">
          {booking.lodges.map((l) => {
            const lodge = l.unitGroupCode ? LODGES[l.unitGroupCode] : null;
            return (
              <p key={l.slot} className="text-sm">
                <span className="font-semibold text-navy">
                  {multi ? `Lodge ${l.slot + 1}: ` : ""}
                  {lodge?.name ?? "Lodge"}
                </span>
                <span className="text-foreground"> · {l.partyLabel}</span>
                {l.assignedUnitName && (
                  <span className="text-foreground"> · {l.assignedUnitName}</span>
                )}
              </p>
            );
          })}
        </div>
        <div className="mt-3 flex gap-2">
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              booking.folioBalance === 0
                ? "bg-leaf text-white"
                : "border border-bronze bg-white text-bronze"
            }`}
          >
            {booking.folioBalance === 0
              ? "Folio settled"
              : `Folio balance ${formatKes(booking.folioBalance)}`}
          </span>
        </div>
      </div>

      <form onSubmit={move} className="mt-8 rounded-lg border border-line bg-white p-6">
        <p className="font-display text-xl font-bold text-ink">Move your break</p>
        <p className="mt-1 text-sm text-foreground">
          Your whole {nights}-night break
          {multi ? `, all ${booking.lodges.length} lodges,` : ""} moves to a new
          start date. New dates still start on a Friday or Monday, the same
          rule as booking.
          {multi &&
            " To change one lodge on its own or split dates, call our team on +254 700 000 000."}
        </p>

        <div className="mt-4 flex flex-wrap items-start gap-4">
          <div className="w-full max-w-xs rounded-lg border border-line bg-white p-3">
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
          <button type="submit" disabled={busy || !newArrival} className="btn-primary">
            {busy ? "Moving…" : "Move break"}
          </button>
        </div>

        {newArrival && (
          <p className="mt-2 text-xs text-foreground/70">
            New stay: {formatDate(newArrival)} to {formatDate(addDays(newArrival, nights))}
          </p>
        )}

        {refusal && (
          <div className="mt-4 rounded-md border border-bronze bg-mist px-4 py-3 text-sm text-ink">
            {refusal}
          </div>
        )}
        {error && (
          <div className="mt-4 rounded-md border border-[#b3261e]/30 bg-red-50 px-4 py-3 text-sm text-[#b3261e]">
            {error}
          </div>
        )}
        {moved && (
          <div className="mt-4 flex items-start gap-2 rounded-md border border-leaf/40 bg-mist px-4 py-3 text-sm text-olive">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0" aria-hidden>
              <path d="M4 12.5 9.5 18 20 6.5" />
            </svg>
            <span>
              Break moved. {multi ? "Every lodge is" : "Your reservation is"}{" "}
              updated in the reservation system and the folio is still settled.
            </span>
          </div>
        )}
      </form>

      {guestRows && (
        <div className="mt-8 rounded-lg border border-line bg-white p-6">
          <p className="font-display text-xl font-bold text-ink">Who&apos;s coming</p>
          <p className="mt-1 text-sm text-foreground">
            Name everyone in your party so activity passes and wristbands are
            ready at the gate. Only we store this; nothing changes on the
            reservation.
          </p>

          <div className="mt-4 grid gap-4">
            {guestRows.map((row) => (
              <div key={`${row.slot}-${row.position}`} className="rounded-lg border border-line p-4">
                <p className="text-sm font-semibold text-navy">
                  {multi ? `Lodge ${row.slot + 1} · ` : ""}
                  {BAND_LABELS[row.band] ?? row.band}
                  {row.slot === 0 && row.position === 0 && (
                    <span className="ml-2 rounded-full bg-mist px-2 py-0.5 text-xs font-semibold text-olive">
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
                          r.slot === row.slot && r.position === row.position
                            ? { ...r, firstName: e.target.value }
                            : r,
                        ),
                      )
                    }
                    className={guestInputClass}
                  />
                  <input
                    aria-label="Last name"
                    placeholder="Last name"
                    value={row.lastName}
                    onChange={(e) =>
                      setGuestRows((prev) =>
                        prev!.map((r) =>
                          r.slot === row.slot && r.position === row.position
                            ? { ...r, lastName: e.target.value }
                            : r,
                        ),
                      )
                    }
                    className={guestInputClass}
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
                          r.slot === row.slot && r.position === row.position
                            ? { ...r, dateOfBirth: e.target.value }
                            : r,
                        ),
                      )
                    }
                    className={`mt-3 ${guestInputClass}`}
                  />
                )}
              </div>
            ))}
          </div>

          {guestsError && (
            <div className="mt-4 rounded-md border border-[#b3261e]/30 bg-red-50 px-4 py-3 text-sm text-[#b3261e]">
              {guestsError}
            </div>
          )}
          {guestsSaved && (
            <div className="mt-4 flex items-center gap-2 rounded-md border border-leaf/40 bg-mist px-4 py-3 text-sm text-olive">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden>
                <path d="M4 12.5 9.5 18 20 6.5" />
              </svg>
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
              // One save per lodge. Sequential: small DB writes, no Apaleo.
              for (const lodge of booking.lodges) {
                const result = await apiFetch(`/api/booking/${bookingId}/guests${proofQuery}`, {
                  method: "PUT",
                  body: JSON.stringify({
                    slot: lodge.slot,
                    guests: guestRows
                      .filter((row) => row.slot === lodge.slot)
                      .map((row) => ({
                        position: row.position,
                        firstName: row.firstName.trim() || undefined,
                        lastName: row.lastName.trim() || undefined,
                        dateOfBirth: row.dateOfBirth || undefined,
                        email: row.email.trim() || undefined,
                      })),
                  }),
                });
                if (!result.ok) {
                  setGuestsBusy(false);
                  return setGuestsError(result.error);
                }
              }
              setGuestsBusy(false);
              setGuestsSaved(true);
            }}
            className="btn-primary mt-4"
          >
            {guestsBusy ? "Saving…" : "Save party"}
          </button>
        </div>
      )}

      <div className="mt-8 text-center">
        <Link
          href={`/confirmation/${booking.bookingId}${proofQuery}`}
          className="text-sm font-semibold text-navy underline underline-offset-2"
        >
          View confirmation
        </Link>
      </div>
    </div>
  );
}
