"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { formatDate, formatKes, nightsLabel } from "@/lib/format";
import { LODGES } from "@/content/lodges";
import type { BookingConfirmation } from "@/lib/types";

export function ConfirmationClient({ bookingId }: { bookingId: string }) {
  // Proof of access rides the URL: ?session= fresh from checkout, ?email=
  // when arriving from the find-my-booking challenge via the manage page.
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

  useEffect(() => {
    (async () => {
      const result = await apiFetch<BookingConfirmation>(`/api/booking/${bookingId}${proofQuery}`);
      if (!result.ok) {
        if (result.status === 401) return setNeedsProof(true);
        return setError(result.error);
      }
      setBooking(result.data);
    })();
  }, [bookingId, proofQuery]);

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
            href={`/login?next=/confirmation/${bookingId}`}
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

  const nights = Math.round(
    (Date.parse(booking.stay.departure) - Date.parse(booking.stay.arrival)) / 86_400_000,
  );
  const settled = booking.folioBalance === 0;
  const multi = booking.lodges.length > 1;

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
              ? "Folio settled · balance KES 0"
              : `Folio balance ${formatKes(booking.folioBalance)}`}
          </span>
        </div>
      </div>

      <div className="mt-8 rounded-2xl bg-white ring-1 ring-forest/10 shadow-sm divide-y divide-forest/10">
        <div className="p-5">
          <p className="text-xs uppercase tracking-wide text-foreground/50">
            {multi ? `Your break · ${booking.lodges.length} lodges` : "Your stay"}
          </p>
          <p className="text-sm text-foreground/60 mt-1">
            {formatDate(booking.stay.arrival)} → {formatDate(booking.stay.departure)} ·{" "}
            {nightsLabel(nights)}
          </p>
        </div>

        <div className="p-5">
          {booking.lodges.map((l) => {
            const lodge = l.unitGroupCode ? LODGES[l.unitGroupCode] : null;
            return (
              <div key={l.slot} className="mt-3 first:mt-0">
                <div className="flex justify-between text-sm">
                  <span className="font-medium text-forest">
                    {multi ? `Lodge ${l.slot + 1}: ` : ""}
                    {lodge?.name ?? "Lodge"}
                    <span className="font-normal text-foreground/55"> · {l.partyLabel}</span>
                  </span>
                  <span className="font-medium">{formatKes(l.stayGrossAmount ?? 0)}</span>
                </div>
                {l.assignedUnitName && (
                  <p className="text-sm mt-1 pl-3 text-foreground/70">
                    You&apos;re staying in <span className="font-medium text-forest">{l.assignedUnitName}</span>
                  </p>
                )}
                {l.locationFee != null && (
                  <div className="flex justify-between text-sm mt-1 pl-3 text-foreground/70">
                    <span>Lodge location choice</span>
                    <span>{formatKes(l.locationFee)}</span>
                  </div>
                )}
                {l.locationFeeDropped && (
                  <p className="mt-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
                    {l.requestedUnitName ?? "Your chosen lodge"} was booked by
                    another guest moments before you finished checking out.
                    {l.assignedUnitName
                      ? ` We've assigned ${l.assignedUnitName} instead`
                      : " We'll assign you a comparable lodge"}{" "}
                    and the location choice fee was not charged.
                  </p>
                )}
                {l.extras.map((extra) => (
                  <div key={extra.serviceId} className="flex justify-between text-sm mt-1 pl-3 text-foreground/70">
                    <span>
                      {extra.name}
                      {extra.count > 1 ? ` ×${extra.count}` : ""}
                    </span>
                    <span>{formatKes(extra.grossAmount)}</span>
                  </div>
                ))}
              </div>
            );
          })}
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
              Vehicle {booking.guest.vehiclePlate.toUpperCase()} is registered for
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
            we&apos;ll open your pre-arrival window to book activities, hire cycles
            and stock your lodge before you get here.
          </p>
        </div>

        {booking.account.status === "ownedByYou" && (
          <div className="p-5 text-sm text-forest bg-forest/5">
            Saved to your account.{" "}
            <Link href="/account" className="underline underline-offset-2">
              See all your breaks
            </Link>
          </div>
        )}
        {booking.account.status === "existingAccount" && (
          <div className="p-5 text-sm text-forest bg-forest/5">
            This email has a Unity Parks account.{" "}
            <Link
              href={`/login?email=${encodeURIComponent(booking.guest.email ?? "")}&next=/account`}
              className="underline underline-offset-2"
            >
              Sign in to see all your breaks
            </Link>
          </div>
        )}
        {booking.account.status === "none" && (
          <div className="p-5 text-sm text-forest bg-forest/5">
            <Link href="/register" className="underline underline-offset-2">
              Create a Unity Parks account
            </Link>{" "}
            with this email to see and manage your breaks any time.
          </div>
        )}
      </div>

      <div className="mt-8 text-center flex justify-center gap-6">
        <Link
          href={`/manage/${booking.bookingId}${proofQuery}`}
          className="text-sm text-lake underline underline-offset-2"
        >
          Manage this booking
        </Link>
        <Link href="/" className="text-sm text-lake underline underline-offset-2">
          Back to Unity Parks
        </Link>
      </div>
    </div>
  );
}
