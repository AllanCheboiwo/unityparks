"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, isExpired } from "@/lib/api";
import { formatDate, formatKes, nightsLabel, plateList } from "@/lib/format";
import {
  balanceDueDateFor,
  daysBetween,
  depositAmountFor,
  isDepositEligible,
} from "@/lib/paymentPlan";
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
  const [payment, setPayment] = useState<"full" | "deposit">("full");
  // Referral credit the signed-in guest could apply here. 0 for everyone
  // else; the server is the judge either way.
  const [creditAvailable, setCreditAvailable] = useState(0);
  const [creditBusy, setCreditBusy] = useState(false);
  // Referral code. Prefilled from the session (a /r/ link stamped it, or the
  // guest typed it here on an earlier pass) and editable until checkout
  // freezes the totals. Advisory: the server validates again at checkout.
  const [referralCode, setReferralCode] = useState("");
  const [referralBusy, setReferralBusy] = useState(false);
  const [referralStatus, setReferralStatus] = useState<
    | { state: "idle" }
    | { state: "valid"; discount: number }
    | { state: "invalid"; message: string }
  >({ state: "idle" });

  useEffect(() => {
    if (!sessionId) return;
    (async () => {
      const s = await apiFetch<SessionSummary>(`/api/session/${sessionId}`);
      if (isExpired(s)) return setExpired(true);
      if (!s.ok) return setError(s.error);
      setSession(s.data);
      if (s.data.referral) {
        setReferralCode(s.data.referral.code);
        if (s.data.referral.discount != null) {
          setReferralStatus({ state: "valid", discount: s.data.referral.discount });
        } else {
          // A code with no discount snapshot: the details step never ran its
          // revalidation (the guest reached this page by URL). Settle it now
          // so the total on the button is the one checkout will charge.
          applyReferral(s.data.referral.code);
        }
      }
      const c = await apiFetch<{ available: number; applied: boolean }>(
        `/api/session/${sessionId}/credit`,
      );
      if (c.ok) setCreditAvailable(c.data.available);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // The summary rail, the deposit split and the button amount all read from
  // the session, and what credit is offerable can change with any of it (a
  // refused apply, an untick that burned this booking's slot, a discount
  // that ate the room left for credit). So every money change re-reads both.
  async function refreshTotals() {
    const [fresh, credit] = await Promise.all([
      apiFetch<SessionSummary>(`/api/session/${sessionId}`),
      apiFetch<{ available: number }>(`/api/session/${sessionId}/credit`),
    ]);
    if (fresh.ok) setSession(fresh.data);
    if (credit.ok) setCreditAvailable(credit.data.available);
  }

  async function toggleCredit(apply: boolean) {
    if (!sessionId) return;
    setCreditBusy(true);
    const result = await apiFetch<{ applied: boolean; amount: number | null }>(
      `/api/session/${sessionId}/credit`,
      { method: "POST", body: JSON.stringify({ apply }) },
    );
    setCreditBusy(false);
    if (!result.ok) setError(result.error);
    else setError(null);
    await refreshTotals();
  }

  async function applyReferral(codeOverride?: string) {
    if (!sessionId) return;
    const code = (codeOverride ?? referralCode).trim().toUpperCase();
    setReferralBusy(true);
    const result = await apiFetch<{
      applied: boolean;
      discount: number | null;
      message?: string;
    }>(`/api/session/${sessionId}/referral`, {
      method: "POST",
      body: JSON.stringify({ code }),
    });
    setReferralBusy(false);
    if (isExpired(result)) return setExpired(true);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    if (result.data.applied && result.data.discount != null) {
      setReferralStatus({ state: "valid", discount: result.data.discount });
    } else if (result.data.message) {
      setReferralStatus({ state: "invalid", message: result.data.message });
    } else {
      setReferralStatus({ state: "idle" });
    }
    await refreshTotals();
  }

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

  const grossTotal = session.lodges.reduce(
    (sum, l) =>
      sum +
      (l.lodge?.stayGrossAmount ?? 0) +
      (l.location?.fee ?? 0) +
      l.extras.reduce((a, e) => a + e.grossAmount, 0),
    0,
  );
  // Referral discount and applied credit reach the folio as allowances at
  // checkout, so the collectable total (and the 30% deposit) shrink with
  // them. Advisory like everything else here.
  const referralDiscount = session.referral?.discount ?? 0;
  const creditApplied = session.credit?.amount ?? 0;
  const bookingTotal = Math.max(0, grossTotal - referralDiscount - creditApplied);

  // The deposit option, 57+ days out only. These numbers are advisory: the
  // server recomputes eligibility and the amount from the folio totals,
  // which can differ if a location fee is dropped at checkout.
  const daysToArrival = daysBetween(
    new Date().toISOString().slice(0, 10),
    session.arrival,
  );
  const depositEligible = isDepositEligible(daysToArrival);
  const depositChosen = depositEligible && payment === "deposit";
  const deposit = depositAmountFor(bookingTotal);
  const balanceDue = balanceDueDateFor(session.arrival);
  const paying = depositChosen ? deposit : bookingTotal;

  async function buyNow() {
    setBusy(true);
    setError(null);
    const result = await apiFetch<CheckoutResponse>(
      `/api/session/${sessionId}/checkout`,
      {
        method: "POST",
        body: JSON.stringify({ payment: depositChosen ? "deposit" : "full" }),
      },
    );
    if (isExpired(result)) return setExpired(true);
    if (!result.ok) {
      if (result.soldOut) setSoldOut(true);
      else setError(result.error);
      // A refused checkout may have removed the discount or the credit
      // server-side ("review your total and press Buy now again"), so the
      // rail, the deposit split and this button must re-render from the
      // server before the guest can press again.
      await refreshTotals();
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
                {plateList(session.guest.vehiclePlates) && (
                  <> · {plateList(session.guest.vehiclePlates)}</>
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

          {/* Money adjustments live together, directly above the total they
              change: the code first, then any credit it leaves room for. */}
          <div className="mt-4 rounded-lg bg-white border border-line p-5 text-sm text-foreground/70">
            <p className="font-semibold text-ink">Have a referral code?</p>
            <p className="mt-1 text-xs">
              If a friend or one of our partners sent you, their code takes the
              discount off this booking.
            </p>
            <div className="mt-3 flex gap-2">
              <input
                type="text"
                value={referralCode}
                onChange={(e) => {
                  setReferralCode(e.target.value.toUpperCase());
                  setReferralStatus({ state: "idle" });
                }}
                placeholder="e.g. AMINA"
                maxLength={12}
                // Locked while Buy now runs, same reason as the credit box:
                // the server is settling this booking's discount right now.
                disabled={referralBusy || busy}
                className="w-48 rounded-md border border-line px-3 py-2 uppercase"
              />
              <button
                type="button"
                onClick={() => applyReferral()}
                disabled={referralBusy || busy}
                className="btn-outline shrink-0"
              >
                {referralBusy ? "Checking…" : "Apply"}
              </button>
            </div>
            {referralStatus.state === "valid" && (
              <p className="mt-2 font-semibold text-[#536917]">
                {formatKes(referralStatus.discount)} off, already in your total
                below.
              </p>
            )}
            {referralStatus.state === "invalid" && (
              <p className="mt-2 text-[#b3261e]">{referralStatus.message}</p>
            )}
          </div>

          {(creditAvailable > 0 || creditApplied > 0) && (
            <div className="mt-4 rounded-lg bg-white border border-line p-5">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={creditApplied > 0}
                  // Locked while Buy now runs: the server is deciding this
                  // booking's credit right now, and a toggle landing in
                  // that window is a race nobody benefits from.
                  disabled={creditBusy || busy}
                  onChange={(e) => toggleCredit(e.target.checked)}
                  className="mt-1 h-4 w-4 accent-[#536917]"
                />
                <span className="flex-1 text-sm">
                  <span className="font-semibold text-ink">
                    Apply {formatKes(creditApplied > 0 ? creditApplied : creditAvailable)}{" "}
                    referral credit
                  </span>
                  <span className="mt-0.5 block text-xs text-foreground/60">
                    Earned from your referrals. It comes straight off this
                    booking&apos;s total.
                  </span>
                </span>
              </label>
            </div>
          )}

          {/* The payment handoff card */}
          <div className="mt-6 rounded-lg bg-white border border-line p-6">
            <p className="text-xl font-bold text-ink">Pay securely</p>
            <p className="mt-2 text-sm text-foreground/70">
              {depositChosen
                ? provider === "pesapal"
                  ? "Pay your deposit today and your lodge is secured. We'll hold it while you pay on Pesapal's secure page, then bring you straight back for your confirmation."
                  : "Pay your deposit today and your lodge is secured. Confirm below and your break is booked straight away."
                : provider === "pesapal"
                  ? "One payment covers your whole break. We'll hold your lodge while you pay on Pesapal's secure page, then bring you straight back for your confirmation."
                  : "One payment covers your whole break. Confirm below and your lodge is booked straight away."}
            </p>

            {/* Inside 8 weeks there is no choice to make, but the guest must
                still see what they are about to pay and why the deposit they
                may have read about isn't on offer. */}
            {!depositEligible && (
              <div className="mt-4 rounded-md border border-line bg-mist p-3 text-sm">
                <span className="font-semibold text-ink">
                  Pay in full · {formatKes(bookingTotal)}
                </span>
                <span className="mt-0.5 block text-xs text-foreground/60">
                  A 30% deposit is only offered 8 weeks or more before arrival.
                  Your break is{" "}
                  {daysToArrival === 1 ? "1 day" : `${daysToArrival} days`} away,
                  so this one is paid in full today.
                </span>
              </div>
            )}

            {depositEligible && (
              <div className="mt-4 grid gap-2">
                {(
                  [
                    {
                      value: "full",
                      label: "Pay in full",
                      amount: bookingTotal,
                      note: "Nothing more to pay before your break.",
                    },
                    {
                      value: "deposit",
                      label: "Pay a 30% deposit",
                      amount: deposit,
                      note: `The remaining ${formatKes(bookingTotal - deposit)} is due by ${formatDate(balanceDue)}. Pay any time from Manage my booking.`,
                    },
                  ] as const
                ).map((option) => (
                  <label
                    key={option.value}
                    className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 ${
                      payment === option.value
                        ? "border-olive bg-mist"
                        : "border-line bg-white"
                    }`}
                  >
                    <input
                      type="radio"
                      name="payment"
                      value={option.value}
                      checked={payment === option.value}
                      onChange={() => setPayment(option.value)}
                      className="mt-1 accent-[#536917]"
                    />
                    <span className="flex-1 text-sm">
                      <span className="font-semibold text-ink">
                        {option.label} · {formatKes(option.amount)}
                      </span>
                      <span className="mt-0.5 block text-xs text-foreground/60">
                        {option.note}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            )}

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
                  ? `Continue to payment · ${formatKes(paying)}`
                  : `Confirm booking · ${formatKes(paying)}`}
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
