"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { BAND_LABELS, formatDate, formatKes, nightsLabel } from "@/lib/format";
import { isValidPartPayment, MIN_PART_PAYMENT } from "@/lib/paymentPlan";
import { LODGES } from "@/content/lodges";
import type { BookingConfirmation, ExtrasContentDto } from "@/lib/types";
import { TurnoverCalendar } from "@/components/TurnoverCalendar";
import { AddExtrasCard } from "./AddExtrasCard";

type AmendResponse = {
  ok: boolean;
  arrival: string;
  departure: string;
  folioBalance: number;
};

type CancellationQuote = {
  cancellable: boolean;
  reason: string | null;
  daysToArrival: number;
  refundPercent: number;
  refundAmount: number;
  keptAmount: number;
  paidAmount: number;
  depositKept: number;
  total: number;
  currency: string;
};

// What the guest sees after a balance payment bounced them back here.
const PAY_NOTICES: Record<string, { good: boolean; text: string }> = {
  success: { good: true, text: "Payment received. Your balance is updated below." },
  pending: {
    good: false,
    text: "We haven't seen your payment arrive yet. If you completed it, refresh in a moment; otherwise you can simply pay again below.",
  },
  failed: {
    good: false,
    text: "Your payment didn't go through and nothing was collected. You can try again below.",
  },
  error: {
    good: false,
    text: "Something went wrong while confirming your payment. Refresh in a moment before paying again.",
  },
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

export function ManageClient({
  bookingId,
  extrasContent,
}: {
  bookingId: string;
  extrasContent: Record<string, ExtrasContentDto>;
}) {
  // Proof of access rides the URL: ?session= fresh from checkout, ?email=
  // from the find-my-booking challenge. Signed-in owners need neither.
  const searchParams = useSearchParams();
  const proofPairs = new URLSearchParams();
  const proofSession = searchParams.get("session");

  if (proofSession) proofPairs.set("session", proofSession);

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
  const [quote, setQuote] = useState<CancellationQuote | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [payBusy, setPayBusy] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const payNotice = PAY_NOTICES[searchParams.get("payment") ?? ""] ?? null;

  async function load() {
    const result = await apiFetch<BookingConfirmation>(`/api/booking/${bookingId}${proofQuery}`);
    if (!result.ok) {
      if (result.status === 401) return setNeedsProof(true);
      return setError(result.error);
    }
    setBooking(result.data);
    // The cancellation quote is a pure read; paid and deposit-paid bookings
    // both have one worth showing.
    if (result.data.status === "paid" || result.data.status === "deposit_paid") {
      const q = await apiFetch<CancellationQuote>(
        `/api/booking/${bookingId}/cancel${proofQuery}`,
      );
      if (q.ok) setQuote(q.data);
    }
    // Seed the party form only on first load: reloads after a payment, a
    // move or an extras add must not wipe names typed but not yet saved.
    setGuestRows(
      (prev) =>
        prev ??
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
          Sign in to the account that made this booking to manage it.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Link href={`/login?next=/manage/${bookingId}`} className="btn-primary">
            Sign in
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
  const cancelled = booking.status === "cancelled";

  // The balance state, derived from the booking payload: one read path,
  // no second endpoint to drift from it.
  const depositPaid = booking.status === "deposit_paid";
  const outstanding = Math.max(0, Math.round(booking.totalGrossAmount - booking.paidAmount));
  const overdue =
    depositPaid &&
    outstanding > 0 &&
    booking.balanceDueDate !== null &&
    new Date().toISOString().slice(0, 10) > booking.balanceDueDate;
  const parsedCustom = customAmount.trim() === "" ? null : Number(customAmount.trim());
  const customValid =
    parsedCustom !== null && isValidPartPayment(parsedCustom, outstanding);

  function addDays(iso: string, days: number): string {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  // One balance payment attempt. No amount means "the whole outstanding
  // balance". Pesapal answers with its hosted page (a full navigation, not
  // a router push - it's another site); simulated settles on the spot.
  async function payBalance(amount?: number) {
    setPayBusy(true);
    setPayError(null);
    const result = await apiFetch<{ status: string; redirectUrl?: string }>(
      `/api/booking/${bookingId}/pay${proofQuery}`,
      {
        method: "POST",
        body: JSON.stringify(amount === undefined ? {} : { amount }),
      },
    );
    if (!result.ok) {
      setPayError(result.error);
      setPayBusy(false);
      return;
    }
    if (result.data.status === "redirect" && result.data.redirectUrl) {
      window.location.assign(result.data.redirectUrl);
      return;
    }
    setCustomAmount("");
    await load();
    setPayBusy(false);
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
          {cancelled ? (
            // After a cancellation the folio balance reads as money owed
            // (refund postings offset the payments, not the charges), so
            // the pill would mislead; the refund line below tells the truth.
            <span className="rounded-full bg-[#6b6b6b] px-3 py-1 text-xs font-semibold text-white">
              Cancelled
            </span>
          ) : (
            <>
              {depositPaid && (
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    overdue
                      ? "border border-[#b3261e] bg-white text-[#b3261e]"
                      : "border border-bronze bg-white text-bronze"
                  }`}
                >
                  {overdue
                    ? "Balance overdue"
                    : `Deposit paid · ${formatKes(outstanding)} outstanding`}
                </span>
              )}
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  booking.folioBalance === 0
                    ? "bg-leaf text-white"
                    : "border border-bronze bg-white text-bronze"
                }`}
              >
                {booking.folioBalance === 0
                  ? "Folio settled"
                  : `Folio balance ${formatKes(Math.abs(booking.folioBalance))}`}
              </span>
            </>
          )}
        </div>
      </div>

      {payNotice && !cancelled && (
        <div
          className={`mt-4 flex items-start gap-2 rounded-md border px-4 py-3 text-sm ${
            payNotice.good
              ? "border-leaf/40 bg-mist text-olive"
              : "border-amber-200 bg-amber-50 text-amber-900"
          }`}
        >
          {payNotice.good && (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0" aria-hidden>
              <path d="M4 12.5 9.5 18 20 6.5" />
            </svg>
          )}
          <span>{payNotice.text}</span>
        </div>
      )}

      {depositPaid && (
        <div className="mt-8 rounded-lg border border-line bg-white p-6">
          <p className="font-display text-xl font-bold text-ink">Your balance</p>
          <p className="mt-1 text-sm text-foreground">
            Pay towards your break any time. We never store cards or charge
            you automatically.
          </p>

          {overdue && booking.balanceDueDate && (
            <div className="mt-4 rounded-md border border-bronze bg-mist px-4 py-3 text-sm text-ink">
              Your balance was due on {formatDate(booking.balanceDueDate)}. Pay
              now to keep your break.
            </div>
          )}

          <div className="mt-4 grid gap-1 text-sm text-foreground">
            <p className="flex justify-between">
              <span>Break total</span>
              <span className="font-semibold text-ink">{formatKes(booking.totalGrossAmount)}</span>
            </p>
            <p className="flex justify-between">
              <span>Paid so far</span>
              <span className="font-semibold text-ink">{formatKes(booking.paidAmount)}</span>
            </p>
            <p className="flex justify-between border-t border-line pt-1">
              <span>Still to pay</span>
              <span className="font-bold text-ink">{formatKes(outstanding)}</span>
            </p>
            {booking.balanceDueDate && (
              <p className="flex justify-between">
                <span>Due by</span>
                <span className="font-semibold text-ink">{formatDate(booking.balanceDueDate)}</span>
              </p>
            )}
          </div>

          {payError && (
            <div className="mt-4 rounded-md border border-[#b3261e]/30 bg-red-50 px-4 py-3 text-sm text-[#b3261e]">
              {payError}
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-start gap-3">
            <button
              type="button"
              disabled={payBusy}
              onClick={() => payBalance()}
              className="btn-primary"
            >
              {payBusy ? "One moment…" : `Pay outstanding balance · ${formatKes(outstanding)}`}
            </button>
            <div>
              <div className="flex gap-2">
                <input
                  aria-label="Amount to pay"
                  type="number"
                  inputMode="numeric"
                  min={MIN_PART_PAYMENT}
                  max={outstanding}
                  placeholder="Amount (KES)"
                  value={customAmount}
                  onChange={(e) => setCustomAmount(e.target.value)}
                  className={`${guestInputClass} w-36`}
                />
                <button
                  type="button"
                  disabled={payBusy || !customValid}
                  onClick={() => payBalance(parsedCustom!)}
                  className="btn-outline text-sm disabled:opacity-50"
                >
                  Pay this amount
                </button>
              </div>
              <p className="mt-1 max-w-xs text-xs text-foreground/60">
                Minimum KES {MIN_PART_PAYMENT}, and a part payment must leave
                at least KES {MIN_PART_PAYMENT} to pay later, or clear the
                balance exactly.
              </p>
            </div>
          </div>
        </div>
      )}

      {(booking.status === "paid" || depositPaid) &&
        booking.stay.arrival > new Date().toISOString().slice(0, 10) && (
          <AddExtrasCard
            bookingId={bookingId}
            proofQuery={proofQuery}
            booking={booking}
            extrasContent={extrasContent}
            onChanged={load}
          />
        )}

      {cancelled && (
        <div className="mt-6 rounded-lg border border-line bg-mist p-6">
          <p className="font-display text-xl font-bold text-ink">This break is cancelled</p>
          <p className="mt-2 text-sm text-foreground">
            {booking.refundAmount && booking.refundAmount > 0
              ? `${formatKes(booking.refundAmount)} of ${formatKes(booking.totalGrossAmount)} was refunded under the cancellation terms.`
              : "No refund was due under the cancellation terms."}{" "}
            The lodge{booking.lodges.length > 1 ? "s are" : " is"} back on sale
            for other families.
          </p>
          <Link href="/#search" className="btn-primary mt-4 inline-block">
            Find a new break
          </Link>
        </div>
      )}

      {!cancelled && (
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
      )}

      {!cancelled && guestRows && (
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

      {!cancelled && quote && (
        <div className="mt-8 rounded-lg border border-line bg-white p-6">
          <p className="font-display text-xl font-bold text-ink">Cancel this break</p>
          <p className="mt-1 text-sm text-foreground">
            Cancel more than 8 weeks before arrival and we refund everything
            except your deposit. 6 to 8 weeks before: half of the balance
            you have paid. 3 to 6 weeks: a quarter. Less than 3 weeks: no
            refund. Deposits are non-refundable.
          </p>

          {quote.cancellable ? (
            <div className="mt-4 rounded-md bg-mist px-4 py-3 text-sm text-ink">
              Cancelling today, {quote.daysToArrival}{" "}
              {quote.daysToArrival === 1 ? "day" : "days"} before arrival:{" "}
              <span className="font-bold">
                {quote.refundAmount > 0
                  ? `we refund ${formatKes(quote.refundAmount)} of the ${formatKes(quote.paidAmount)} you've paid`
                  : "no refund is due"}
              </span>
              {quote.keptAmount > 0 && quote.refundAmount > 0 && (
                <> ({formatKes(quote.keptAmount)} cancellation charge)</>
              )}
              .
              {quote.depositKept > 0 && (
                <> Your {formatKes(quote.depositKept)} deposit is non-refundable.</>
              )}
            </div>
          ) : (
            <div className="mt-4 rounded-md border border-bronze bg-mist px-4 py-3 text-sm text-ink">
              {quote.reason}
            </div>
          )}

          {cancelError && (
            <div className="mt-4 rounded-md border border-[#b3261e]/30 bg-red-50 px-4 py-3 text-sm text-[#b3261e]">
              {cancelError}
            </div>
          )}

          {quote.cancellable &&
            (confirmingCancel ? (
              <div className="mt-4 rounded-md border border-[#b3261e]/40 bg-red-50 p-4">
                <p className="text-sm font-semibold text-ink">
                  This can&apos;t be undone. Your lodge
                  {booking.lodges.length > 1 ? "s go" : " goes"} straight back
                  on sale.
                </p>
                <div className="mt-3 flex flex-wrap gap-3">
                  <button
                    type="button"
                    disabled={cancelBusy}
                    onClick={async () => {
                      setCancelBusy(true);
                      setCancelError(null);
                      const result = await apiFetch<CancellationQuote>(
                        `/api/booking/${bookingId}/cancel${proofQuery}`,
                        { method: "POST" },
                      );
                      if (!result.ok) {
                        setCancelError(result.error);
                        setCancelBusy(false);
                        return;
                      }
                      await load();
                      setCancelBusy(false);
                      setConfirmingCancel(false);
                    }}
                    className="rounded-md bg-[#b3261e] px-5 py-2 text-sm font-semibold text-white hover:bg-[#8f1e18] disabled:opacity-60"
                  >
                    {cancelBusy ? "Cancelling…" : "Yes, cancel my break"}
                  </button>
                  <button
                    type="button"
                    disabled={cancelBusy}
                    onClick={() => setConfirmingCancel(false)}
                    className="btn-dark-outline text-sm"
                  >
                    Keep my break
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingCancel(true)}
                className="mt-4 rounded-md border border-[#b3261e] bg-white px-5 py-2 text-sm font-semibold text-[#b3261e] hover:bg-red-50"
              >
                Cancel this break
              </button>
            ))}
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
