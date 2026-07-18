"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, isExpired } from "@/lib/api";
import { formatDate, formatKes, nightsLabel } from "@/lib/format";
import { LODGES } from "@/content/lodges";
import type { SessionSummary } from "@/lib/types";
import { Stepper } from "@/components/Stepper";
import { BookingSummary } from "@/components/BookingSummary";
import { ExpiredNotice } from "@/components/ExpiredNotice";
import { CheckoutBreadcrumb } from "../Breadcrumb";
import { AlertIcon } from "../icons";

type CheckoutResponse =
  | { status: "redirect"; redirectUrl: string }
  | { status: string; bookingId: string };

// What the guest sees after Pesapal bounced them back without a paid booking.
const PAYMENT_NOTICES: Record<string, string> = {
  failed:
    "Your payment didn't go through and nothing was collected. Your lodge is still reserved - try again below.",
  pending:
    "We haven't seen your payment arrive yet. If you completed it, press the button below and we'll check again; otherwise you can simply pay again.",
  error:
    "Something went wrong while confirming your payment. Press the button below to pick up where you left off.",
};

export function PayClient({ provider }: { provider: "simulated" | "pesapal" }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session");
  const paymentNotice = PAYMENT_NOTICES[searchParams.get("payment") ?? ""] ?? null;
  const [session, setSession] = useState<SessionSummary | null>(null);
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [soldOut, setSoldOut] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    (async () => {
      const s = await apiFetch<SessionSummary>(`/api/session/${sessionId}`);
      if (isExpired(s)) return setExpired(true);
      if (!s.ok) return setError(s.error);
      setSession(s.data);
    })();
  }, [sessionId]);

  // Browser back from Pesapal can restore this page from the bfcache with
  // busy still true, which would leave the button dead. pageshow with
  // persisted=true is exactly that restore.
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) setBusy(false);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  if (!sessionId || expired) return <ExpiredNotice />;
  if (error && !session) {
    return (
      <p className="mx-auto max-w-2xl px-5 py-20 text-center text-[#b3261e]">{error}</p>
    );
  }
  if (!session) {
    return (
      <p className="mx-auto max-w-2xl px-5 py-20 text-center text-foreground/50">
        Preparing your summary…
      </p>
    );
  }

  const multi = session.lodges.length > 1;
  const allChosen = session.lodges.every((l) => l.lodge);

  // Guests can land here by URL before every lodge has been chosen.
  if (!allChosen) {
    return (
      <div className="mx-auto max-w-lg px-5 py-20">
        <div className="rounded-lg bg-mist border border-line px-6 py-10 text-center">
          <p className="font-display text-2xl font-bold text-ink">
            {multi ? "Finish choosing your lodges" : "Your basket is empty"}
          </p>
          <p className="mt-2 text-sm text-foreground/70">
            Choose {multi ? "every lodge" : "a lodge"} first, then come back to pay.
          </p>
          <a href={`/lodges?session=${sessionId}`} className="btn-primary mt-6">
            {multi ? "Back to lodges" : "Choose a lodge"}
          </a>
        </div>
      </div>
    );
  }

  const bookingTotal = session.lodges.reduce(
    (sum, l) =>
      sum +
      (l.lodge?.stayGrossAmount ?? 0) +
      (l.location?.fee ?? 0) +
      l.extras.reduce((a, e) => a + e.grossAmount, 0),
    0,
  );

  async function buyNow() {
    setBusy(true);
    setError(null);
    const result = await apiFetch<CheckoutResponse>(
      `/api/session/${sessionId}/checkout`,
      { method: "POST" },
    );
    if (isExpired(result)) return setExpired(true);
    if (!result.ok) {
      if (result.soldOut) setSoldOut(true);
      else setError(result.error);
      setBusy(false);
      return;
    }
    // Real payments: the lodge is reserved and Pesapal's hosted page takes
    // it from here. A full navigation, not a router push - it's another site.
    if (result.data.status === "redirect" && "redirectUrl" in result.data) {
      window.location.assign(result.data.redirectUrl);
      return;
    }
    // Carry the session id: it is the fresh-from-checkout proof of access,
    // so the confirmation page never greets the buyer with a challenge.
    if ("bookingId" in result.data) {
      router.push(`/confirmation/${result.data.bookingId}?session=${sessionId}`);
    }
  }

  if (soldOut) {
    return (
      <div className="mx-auto max-w-lg px-5 py-20">
        <div className="rounded-lg bg-mist border border-line px-6 py-10 text-center">
          <p className="font-display text-2xl font-bold text-ink">
            Someone beat you to that lodge
          </p>
          <p className="mt-2 text-sm text-foreground/70">
            It was booked while you were checking out. Your dates are still
            good. Pick another lodge.
          </p>
          <a href={`/lodges?session=${sessionId}`} className="btn-primary mt-6">
            Back to lodges
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      <CheckoutBreadcrumb />
      <h1 className="font-display text-[34px] leading-tight font-bold text-ink mb-5">
        Pay for your break
      </h1>
      <Stepper current="Payment" />

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-8 lg:items-start">
        {/* On mobile the summary sits above the button - nobody should press
            pay without the total in view. */}
        <aside className="lg:order-2 lg:sticky lg:top-6">
          <BookingSummary summary={session} />
        </aside>

        <div className="mt-6 lg:mt-0 lg:order-1 max-w-xl">
          <div className="rounded-lg bg-white border border-line divide-y divide-line">
            <div className="p-5">
              <p className="text-xl font-bold text-ink">
                {multi ? `Your break, ${session.lodges.length} lodges` : "Your stay"}
              </p>
              <p className="text-sm text-foreground/60 mt-1">
                {formatDate(session.arrival)} to {formatDate(session.departure)} ·{" "}
                {nightsLabel(session.nights)}
              </p>
            </div>

            {session.lodges.map((l) => {
              const lodge = l.lodge ? LODGES[l.lodge.unitGroupCode] : null;
              return (
                <div key={l.slot} className="p-5">
                  {multi && (
                    <p className="text-xs uppercase tracking-wide text-foreground/50">
                      Lodge {l.slot + 1}
                    </p>
                  )}
                  <p className="mt-0.5 font-semibold text-navy">
                    {lodge?.name ?? l.lodge?.unitGroupCode}
                  </p>
                  <p className="text-sm text-foreground/60">
                    {l.partyLabel} · whole lodge
                  </p>
                  <p className="text-xs text-foreground/50 mt-1">
                    {l.location?.choice === "unit" && l.location.unitName
                      ? `Your pick: ${l.location.unitName} (lodge number confirmed at booking)`
                      : "Lodge number: no preference, assigned at booking"}
                  </p>
                  {l.extras.length > 0 && (
                    <p className="text-xs text-foreground/50 mt-1">
                      Extras: {l.extras.map((e) => e.name).join(", ")}
                    </p>
                  )}
                </div>
              );
            })}

            {session.guest && (
              <div className="p-5 text-sm text-foreground/60">
                <p className="text-xs uppercase tracking-wide text-foreground/50 mb-1">
                  Lead guest
                </p>
                {session.guest.firstName} {session.guest.lastName} ·{" "}
                {session.guest.email}
                {session.guest.vehiclePlate && (
                  <> · plate {session.guest.vehiclePlate.toUpperCase()}</>
                )}
              </div>
            )}
          </div>

          {paymentNotice && !error && (
            <div className="mt-4 rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">
              {paymentNotice}
            </div>
          )}

          {error && (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-[#b3261e]/30 bg-[#b3261e]/5 px-4 py-3 text-sm text-[#b3261e]">
              <AlertIcon />
              <span>{error}</span>
            </div>
          )}

          {/* The payment handoff card */}
          <div className="mt-6 rounded-lg bg-white border border-line p-6">
            <p className="text-xl font-bold text-ink">Pay securely</p>
            <p className="mt-2 text-sm text-foreground/70">
              {provider === "pesapal"
                ? "One payment covers your whole break. We'll hold your lodge while you pay on Pesapal's secure page, then bring you straight back for your confirmation."
                : "One payment covers your whole break. Confirm below and your lodge is booked straight away."}
            </p>
            <button
              onClick={buyNow}
              disabled={busy}
              className="btn-primary btn-hero mt-4 w-full"
            >
              {busy
                ? provider === "pesapal"
                  ? "One moment…"
                  : "Confirming your booking…"
                : provider === "pesapal"
                  ? `Continue to payment · ${formatKes(bookingTotal)}`
                  : `Confirm booking · ${formatKes(bookingTotal)}`}
            </button>
            <p className="mt-3 text-center text-xs text-foreground/50">
              {provider === "pesapal"
                ? "You'll finish paying on Pesapal's secure page (sandbox). Card and M-Pesa test payments only - no real money moves."
                : "Demo environment: your booking is real in our reservation system, but no money moves."}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
