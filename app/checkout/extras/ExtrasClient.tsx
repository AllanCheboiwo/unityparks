"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, isExpired } from "@/lib/api";
import { formatKes } from "@/lib/format";
import type { ExtraOfferDto, ExtraSnapshotDto, SessionSummary } from "@/lib/types";
import { Stepper } from "@/components/Stepper";
import { BookingSummary } from "@/components/BookingSummary";
import { ExpiredNotice } from "@/components/ExpiredNotice";
import { CheckoutBreadcrumb } from "../Breadcrumb";
import { AlertIcon, TickIcon } from "../icons";

const PRICING_LABELS: Record<string, string> = {
  Room: "per lodge, per stay",
  Person: "per person, per stay",
  RoomPerNight: "per lodge, per night",
  PersonPerNight: "per person, per night",
};

/** A loosely keyword-matched icon per extra, falling back to a star. */
function ExtraIcon({ name }: { name: string }) {
  const n = name.toLowerCase();
  const shared = {
    className: "w-6 h-6 text-olive",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    viewBox: "0 0 24 24",
    "aria-hidden": true,
  } as const;
  if (/bike|cycle/.test(n)) {
    return (
      <svg {...shared}>
        <circle cx="6" cy="16" r="3.5" />
        <circle cx="18" cy="16" r="3.5" />
        <path d="M6 16 9.5 8h5M18 16l-3.5-8M9.5 8 13 16h-7" />
      </svg>
    );
  }
  if (/breakfast|dinner|meal|hamper|food|dining/.test(n)) {
    return (
      <svg {...shared}>
        <path d="M7 3v7M5 3v4M9 3v4M7 10v11" />
        <path d="M16 3c-1.7 0-3 2-3 5s1.3 4 3 4v9" />
      </svg>
    );
  }
  if (/bed|linen|towel|cot/.test(n)) {
    return (
      <svg {...shared}>
        <path d="M3 18v-8h18v8M3 18v2M21 18v2M3 14h18" />
        <path d="M6 10V7h12v3" />
      </svg>
    );
  }
  if (/clean|housekeep/.test(n)) {
    return (
      <svg {...shared}>
        <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" />
      </svg>
    );
  }
  if (/park|car|vehicle/.test(n)) {
    return (
      <svg {...shared}>
        <path d="M4 16v-4l2-5h12l2 5v4M4 16h16M4 16v2M20 16v2" />
        <circle cx="8" cy="16" r="0.5" />
        <circle cx="16" cy="16" r="0.5" />
      </svg>
    );
  }
  return (
    <svg {...shared}>
      <path d="m12 3 2.5 5.5L20 9.5l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-1z" />
    </svg>
  );
}

export function ExtrasClient() {
  const router = useRouter();
  const sessionId = useSearchParams().get("session");
  const [session, setSession] = useState<SessionSummary | null>(null);
  const [offersBySlot, setOffersBySlot] = useState<Record<number, ExtraOfferDto[]>>({});
  const [chosenBySlot, setChosenBySlot] = useState<Record<number, Set<string>>>({});
  const [activeSlot, setActiveSlot] = useState(0);
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    (async () => {
      const s = await apiFetch<SessionSummary>(`/api/session/${sessionId}`);
      if (isExpired(s)) return setExpired(true);
      if (!s.ok) return setError(s.error);
      const summary = s.data;
      setSession(summary);
      // One extras-offer read per lodge, priced for that lodge's rate plan.
      const results = await Promise.all(
        summary.lodges.map((l) =>
          apiFetch<{ extras: ExtraOfferDto[]; slot: number }>(
            `/api/session/${sessionId}/extras?slot=${l.slot}`,
          ),
        ),
      );
      const offers: Record<number, ExtraOfferDto[]> = {};
      const chosen: Record<number, Set<string>> = {};
      results.forEach((r, i) => {
        const slot = summary.lodges[i].slot;
        if (r.ok) offers[slot] = r.data.extras;
        // Restore previously chosen extras for this lodge.
        chosen[slot] = new Set(summary.lodges[i].extras.map((x) => x.serviceId));
      });
      setOffersBySlot(offers);
      setChosenBySlot(chosen);
    })();
  }, [sessionId]);

  if (!sessionId || expired) return <ExpiredNotice />;
  if (error && !session) {
    return (
      <p className="mx-auto max-w-2xl px-5 py-20 text-center text-[#b3261e]">{error}</p>
    );
  }
  if (!session) {
    return (
      <p className="mx-auto max-w-2xl px-5 py-20 text-center text-foreground/50">
        Pricing extras for your stay…
      </p>
    );
  }

  const multi = session.lodges.length > 1;

  function snapshotsForSlot(slot: number): ExtraSnapshotDto[] {
    const offers = offersBySlot[slot] ?? [];
    const chosen = chosenBySlot[slot] ?? new Set<string>();
    return offers
      .filter((o) => chosen.has(o.serviceId))
      .map((o) => ({
        serviceId: o.serviceId,
        code: o.code,
        name: o.name,
        count: o.count,
        grossAmount: o.totalGrossAmount,
      }));
  }

  const overrideBySlot: Record<number, ExtraSnapshotDto[]> = {};
  for (const l of session.lodges) overrideBySlot[l.slot] = snapshotsForSlot(l.slot);

  const stayTotal = session.lodges.reduce((sum, l) => sum + (l.lodge?.stayGrossAmount ?? 0), 0);
  const extrasTotal = session.lodges.reduce(
    (sum, l) => sum + overrideBySlot[l.slot].reduce((a, e) => a + e.grossAmount, 0),
    0,
  );
  // Saved on the location step; part of the running total but not editable here.
  const locationTotal = session.lodges.reduce((sum, l) => sum + (l.location?.fee ?? 0), 0);
  const anyChosen = Object.values(chosenBySlot).some((s) => s.size > 0);

  const activeOffers = offersBySlot[activeSlot] ?? [];
  const activeChosen = chosenBySlot[activeSlot] ?? new Set<string>();

  function toggle(serviceId: string) {
    setChosenBySlot((prev) => {
      const next = new Set(prev[activeSlot] ?? []);
      if (next.has(serviceId)) next.delete(serviceId);
      else next.add(serviceId);
      return { ...prev, [activeSlot]: next };
    });
  }

  async function continueToDetails() {
    setBusy(true);
    setError(null);
    // Save each lodge's extras. Sequential: small DB writes, no Apaleo calls.
    for (const l of session!.lodges) {
      const result = await apiFetch(`/api/session/${sessionId}/extras`, {
        method: "POST",
        body: JSON.stringify({ slot: l.slot, extras: snapshotsForSlot(l.slot) }),
      });
      if (isExpired(result)) return setExpired(true);
      if (!result.ok) {
        setError(result.error);
        setBusy(false);
        return;
      }
    }
    router.push(`/checkout/details?session=${sessionId}`);
  }

  // Round navy quantity buttons; the offer's count is fixed by its pricing
  // unit, so plus adds the extra and minus takes it away again.
  const qtyBtn =
    "w-8 h-8 rounded-full border border-navy text-navy flex items-center justify-center hover:bg-navy/5 disabled:border-line disabled:text-line disabled:hover:bg-transparent";

  return (
    <div className="mx-auto max-w-5xl px-5 py-8 pb-32">
      <CheckoutBreadcrumb />
      <h1 className="font-display text-[34px] leading-tight font-bold text-ink mb-5">
        Add some little extras
      </h1>
      <Stepper current="Little Extras" />

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-8 lg:items-start">
        <div>
          <p className="text-sm text-foreground/70 max-w-xl">
            The small touches guests are glad they added, all priced live for
            your stay. This step is optional.
            {multi && " Extras are added per lodge."}
          </p>

          {/* Per-lodge switcher */}
          {multi && (
            <div className="mt-5 flex flex-wrap gap-2">
              {session.lodges.map((l) => {
                const isActive = l.slot === activeSlot;
                const count = (chosenBySlot[l.slot] ?? new Set()).size;
                return (
                  <button
                    key={l.slot}
                    type="button"
                    onClick={() => setActiveSlot(l.slot)}
                    className={`inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-semibold border transition ${
                      isActive
                        ? "bg-olive text-white border-olive"
                        : "bg-white text-olive border-line hover:bg-mist"
                    }`}
                  >
                    Lodge {l.slot + 1}
                    {count > 0 && (
                      <span
                        className={`rounded-full px-1.5 text-[11px] ${
                          isActive ? "bg-white/25" : "bg-mist"
                        }`}
                      >
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          <div className="mt-6 grid gap-4">
            {activeOffers.map((extra) => {
              const added = activeChosen.has(extra.serviceId);
              return (
                <div
                  key={extra.serviceId}
                  className={`rounded-lg bg-white p-5 transition ${
                    added
                      ? "border border-navy ring-1 ring-navy"
                      : "border border-line"
                  }`}
                >
                  <div className="flex items-start gap-4">
                    <ExtraIcon name={extra.name} />
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-ink">{extra.name}</p>
                      <p className="mt-1 text-sm text-foreground/60 max-w-md">
                        {extra.description}
                      </p>
                      <p className="mt-2 text-xs text-foreground/50">
                        {PRICING_LABELS[extra.pricingUnit] ?? extra.pricingUnit}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-bold text-ink">
                        {formatKes(extra.totalGrossAmount)}
                      </p>
                      <p className="text-[11px] text-foreground/50">for your stay</p>
                      <div className="mt-2 flex items-center justify-end gap-2">
                        <button
                          type="button"
                          aria-label={`Remove ${extra.name}`}
                          disabled={!added}
                          onClick={() => added && toggle(extra.serviceId)}
                          className={qtyBtn}
                        >
                          <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none" aria-hidden>
                            <path d="M2 6h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          </svg>
                        </button>
                        <span className="w-6 text-center font-semibold text-ink tabular-nums">
                          {added ? extra.count : 0}
                        </span>
                        <button
                          type="button"
                          aria-label={`Add ${extra.name}`}
                          disabled={added}
                          onClick={() => !added && toggle(extra.serviceId)}
                          className={qtyBtn}
                        >
                          <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none" aria-hidden>
                            <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                  {added && (
                    <p className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-leaf">
                      <TickIcon className="w-3.5 h-3.5" />
                      Added to your break
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {error && (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-[#b3261e]/30 bg-[#b3261e]/5 px-4 py-3 text-sm text-[#b3261e]">
              <AlertIcon />
              <span>{error}</span>
            </div>
          )}
        </div>

        <aside className="mt-8 lg:mt-0 lg:sticky lg:top-6">
          <BookingSummary summary={session} extrasOverrideBySlot={overrideBySlot} />
        </aside>
      </div>

      {/* Running total bar */}
      <div className="fixed bottom-0 inset-x-0 bg-white/95 backdrop-blur border-t border-line z-10">
        <div className="mx-auto max-w-5xl px-5 py-3.5 flex items-center justify-between gap-4">
          <div className="text-sm">
            <span className="text-foreground/60">
              Lodges {formatKes(stayTotal)}
              {locationTotal > 0 && <> + lodge choice {formatKes(locationTotal)}</>}
              {extrasTotal > 0 && <> + extras {formatKes(extrasTotal)}</>} ·{" "}
            </span>
            <span className="font-bold text-ink">
              Total {formatKes(stayTotal + locationTotal + extrasTotal)}
            </span>
          </div>
          <button onClick={continueToDetails} disabled={busy} className="btn-primary">
            {busy ? "Saving…" : anyChosen ? "Continue" : "Continue without extras"}
          </button>
        </div>
      </div>
    </div>
  );
}
