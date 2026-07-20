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
        <p className="font-display text-2xl font-bold text-ink">This booking is private</p>
        <p className="mt-2 text-sm text-foreground">
          Sign in to your account, or find the booking with its reference and
          the lead guest&apos;s email.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Link href={`/login?next=/confirmation/${bookingId}`} className="btn-primary">
            Sign in
          </Link>
          <Link href="/manage" className="btn-dark-outline">
            Find my booking
          </Link>
        </div>
      </div>
    );
  }
  if (error) {
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
  const settled = booking.folioBalance === 0;
  const multi = booking.lodges.length > 1;
  // The memories moment: every guest, every night, one memory in the making.
  const guestCount = booking.lodges.reduce((sum, l) => sum + l.bands.length, 0);
  const memories = guestCount * nights;

  return (
    <div className="mx-auto max-w-xl px-5 py-10">
      <div className="text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-leaf text-white">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 12.5 9.5 18 20 6.5" />
          </svg>
        </div>
        <h1 className="mt-4 font-display text-4xl font-bold text-ink">
          Your break is <em>booked</em>
        </h1>

        <div className="mx-auto mt-5 max-w-xs rounded-lg bg-navy px-6 py-4 text-white">
          <p className="text-xs uppercase tracking-wide text-white/80">Booking reference</p>
          <p className="mt-1 font-mono text-2xl tracking-[0.3em]">{booking.bookingId}</p>
        </div>

        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              booking.status === "paid"
                ? "bg-leaf text-white"
                : "border border-bronze bg-white text-bronze"
            }`}
          >
            {booking.status === "paid" ? "Paid in full" : booking.status}
          </span>
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              settled ? "bg-leaf text-white" : "border border-bronze bg-white text-bronze"
            }`}
          >
            {settled
              ? "Folio settled · balance KES 0"
              : `Folio balance ${formatKes(booking.folioBalance)}`}
          </span>
        </div>

        <div className="mt-6 rounded-lg border border-line contour-bg px-6 py-5">
          <p className="font-display text-lg font-bold text-olive">
            That is {memories} new memories on the way.
          </p>
          <p className="mt-1 text-sm text-foreground">
            Thank you for helping us reach a billion.
          </p>
        </div>
      </div>

      <div className="mt-8 divide-y divide-line rounded-lg border border-line bg-white">
        <div className="p-6">
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
        </div>

        <div className="p-6">
          {booking.lodges.map((l) => {
            const lodge = l.unitGroupCode ? LODGES[l.unitGroupCode] : null;
            return (
              <div key={l.slot} className="mt-3 first:mt-0">
                <div className="flex justify-between text-sm">
                  <span className="font-semibold text-navy">
                    {multi ? `Lodge ${l.slot + 1}: ` : ""}
                    {lodge?.name ?? "Lodge"}
                    <span className="font-normal text-foreground"> · {l.partyLabel}</span>
                  </span>
                  <span className="font-semibold text-ink">{formatKes(l.stayGrossAmount ?? 0)}</span>
                </div>
                {l.assignedUnitName && (
                  <p className="mt-1 pl-3 text-sm text-foreground">
                    You&apos;re staying in{" "}
                    <span className="font-semibold text-navy">{l.assignedUnitName}</span>
                  </p>
                )}
                {l.locationFee != null && (
                  <div className="mt-1 flex justify-between pl-3 text-sm text-foreground">
                    <span>Lodge location choice</span>
                    <span>{formatKes(l.locationFee)}</span>
                  </div>
                )}
                {l.locationFeeDropped && (
                  <p className="mt-2 rounded-md border border-bronze bg-mist px-3 py-2 text-xs text-ink">
                    {l.requestedUnitName ?? "Your chosen lodge"} was booked by
                    another guest moments before you finished checking out.
                    {l.assignedUnitName
                      ? ` We've assigned ${l.assignedUnitName} instead`
                      : " We'll assign you a comparable lodge"}{" "}
                    and the location choice fee was not charged.
                  </p>
                )}
                {l.extras.map((extra) => (
                  <div key={extra.serviceId} className="mt-1 flex justify-between pl-3 text-sm text-foreground">
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
          <div className="mt-4 flex justify-between border-t border-line pt-4 text-lg font-bold text-ink">
            <span className="font-display">Paid</span>
            <span className="font-display">{formatKes(booking.totalGrossAmount)}</span>
          </div>
        </div>

        <div className="p-6 text-sm text-foreground">
          <p className="font-display text-base font-bold text-ink">Lead guest</p>
          <p className="mt-1">
            {booking.guest.firstName} {booking.guest.lastName} · {booking.guest.email}
          </p>
          {booking.guest.vehiclePlate && (
            <p className="mt-1">
              Vehicle {booking.guest.vehiclePlate.toUpperCase()} is registered for
              automatic gate entry.
            </p>
          )}
        </div>

        <div className="p-6 text-sm text-foreground">
          <p className="font-display text-base font-bold text-ink">What happens next</p>
          <p className="mt-1">
            A confirmation email lands shortly. Twelve weeks before you arrive,
            we&apos;ll open your pre-arrival window to book activities, hire cycles
            and stock your lodge before you get here.
          </p>
        </div>

        {booking.account.status === "ownedByYou" && (
          <div className="bg-mist p-6 text-sm text-foreground">
            Saved to your account.{" "}
            <Link href="/account" className="font-semibold text-navy underline underline-offset-2">
              See all your breaks
            </Link>
          </div>
        )}
        {booking.account.status === "existingAccount" && (
          <div className="bg-mist p-6 text-sm text-foreground">
            This email has a Unity Parks account.{" "}
            <Link
              href={`/login?email=${encodeURIComponent(booking.guest.email ?? "")}&next=/account`}
              className="font-semibold text-navy underline underline-offset-2"
            >
              Sign in to see all your breaks
            </Link>
          </div>
        )}
        {booking.account.status === "none" && (
          <div className="bg-mist p-6 text-sm text-foreground">
            <Link href="/register" className="font-semibold text-navy underline underline-offset-2">
              Create a Unity Parks account
            </Link>{" "}
            with this email to see and manage your breaks any time.
          </div>
        )}
      </div>

      <div className="mt-8 flex justify-center gap-6 text-center">
        <Link
          href={`/manage/${booking.bookingId}${proofQuery}`}
          className="text-sm font-semibold text-navy underline underline-offset-2"
        >
          Manage this booking
        </Link>
        <Link href="/" className="text-sm font-semibold text-navy underline underline-offset-2">
          Back to Unity Parks
        </Link>
      </div>
    </div>
  );
}
