"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { formatDate, formatKes, nightsLabel } from "@/lib/format";
import { LODGES } from "@/content/lodges";
import type { BookingConfirmation } from "@/lib/types";

export function ConfirmationClient({ bookingId }: { bookingId: string }) {
  const [booking, setBooking] = useState<BookingConfirmation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const result = await apiFetch<BookingConfirmation>(`/api/booking/${bookingId}`);
      if (!result.ok) return setError(result.error);
      setBooking(result.data);
    })();
  }, [bookingId]);

  if (error) {
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
  const settled = booking.folioBalance === 0;

  return (
    <div className="mx-auto max-w-xl px-5 py-10">
      <div className="text-center">
        <div className="mx-auto w-14 h-14 rounded-full bg-moss/15 flex items-center justify-center">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M4 12.5 L9.5 18 L20 6.5" stroke="#4d7c0f" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h1 className="mt-4 font-display text-3xl text-forest">
          Your break is <em>booked</em>
        </h1>
        <p className="mt-2 text-sm text-foreground/60">
          Booking reference
        </p>
        <p className="font-mono text-2xl tracking-[0.3em] text-forest mt-1">
          {booking.bookingId}
        </p>

        <div className="mt-4 flex justify-center gap-2 flex-wrap">
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              booking.status === "paid"
                ? "bg-moss/15 text-moss"
                : "bg-amber-100 text-amber-900"
            }`}
          >
            {booking.status === "paid" ? "Paid in full" : booking.status}
          </span>
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              settled ? "bg-moss/15 text-moss" : "bg-amber-100 text-amber-900"
            }`}
          >
            {settled
              ? "Folio settled — balance KES 0"
              : `Folio balance ${formatKes(booking.folioBalance)}`}
          </span>
        </div>
      </div>

      <div className="mt-8 rounded-2xl bg-white ring-1 ring-forest/10 shadow-sm divide-y divide-forest/10">
        <div className="p-5">
          <p className="text-xs uppercase tracking-wide text-foreground/50">Your stay</p>
          <p className="mt-1 font-medium text-forest">{lodge?.name ?? "Lodge"}</p>
          <p className="text-sm text-foreground/60">
            {formatDate(booking.stay.arrival)} → {formatDate(booking.stay.departure)}
          </p>
          <p className="text-sm text-foreground/60">
            {nightsLabel(nights)} · {booking.stay.adults}{" "}
            {booking.stay.adults === 1 ? "guest" : "guests"}
          </p>
        </div>

        <div className="p-5">
          <div className="flex justify-between text-sm">
            <span>Lodge, whole break</span>
            <span className="font-medium">
              {formatKes(booking.stay.stayGrossAmount ?? 0)}
            </span>
          </div>
          {booking.extras.map((extra) => (
            <div key={extra.serviceId} className="flex justify-between text-sm mt-2">
              <span>
                {extra.name}
                {extra.count > 1 ? ` ×${extra.count}` : ""}
              </span>
              <span className="font-medium">{formatKes(extra.grossAmount)}</span>
            </div>
          ))}
          <div className="flex justify-between mt-4 pt-4 border-t border-forest/10">
            <span className="font-display text-forest">Paid</span>
            <span className="font-display text-forest">
              {formatKes(booking.totalGrossAmount)}
            </span>
          </div>
        </div>

        <div className="p-5 text-sm text-foreground/60">
          <p className="text-xs uppercase tracking-wide text-foreground/50 mb-1">
            Lead guest
          </p>
          <p>
            {booking.guest.firstName} {booking.guest.lastName} · {booking.guest.email}
          </p>
          {booking.guest.vehiclePlate && (
            <p className="mt-1">
              Vehicle {booking.guest.vehiclePlate.toUpperCase()} — registered for
              automatic gate entry.
            </p>
          )}
        </div>

        <div className="p-5 text-sm text-foreground/60">
          <p className="text-xs uppercase tracking-wide text-foreground/50 mb-1">
            What happens next
          </p>
          <p>
            A confirmation email lands shortly. Twelve weeks before you arrive,
            we&apos;ll open your pre-arrival window — book activities, hire cycles
            and stock your lodge before you get here.
          </p>
        </div>
      </div>

      <div className="mt-8 text-center">
        <Link href="/" className="text-sm text-lake underline underline-offset-2">
          Back to Unity Parks
        </Link>
      </div>
    </div>
  );
}
