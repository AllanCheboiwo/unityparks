"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, isExpired } from "@/lib/api";
import { formatKes } from "@/lib/format";
import type {
  ExtraOfferDto,
  ExtraSnapshotDto,
  ExtrasContentDto,
  SessionSummary,
} from "@/lib/types";
import { Stepper } from "@/components/Stepper";
import { BookingSummary } from "@/components/BookingSummary";
import { ExpiredNotice } from "@/components/ExpiredNotice";
import { CheckoutBreadcrumb } from "../Breadcrumb";
import { AlertIcon, TickIcon } from "../icons";

/** Upper bound on the quantity stepper. Generous for bikes and spa passes,
 *  and the sandbox services have no availability cap of their own. */
const MAX_QTY = 8;

/** Per-person services are bought by the unit (a bike, a pass), so they get a
 *  quantity stepper. Per-lodge services (Room) are one per break, so they get
 *  a single Add to Basket. */
function isQuantity(extra: ExtraOfferDto): boolean {
  return extra.pricingUnit.startsWith("Person");
}

/** The price of one unit for this stay: Apaleo's total divided by its default
 *  count. For a 2-adult party a KES 6,400 cycle offer (count 2) is KES 3,200
 *  a bike. Always exact, since the total is count times the per-unit price. */
function unitPrice(extra: ExtraOfferDto): number {
  return extra.count > 0
    ? Math.round(extra.totalGrossAmount / extra.count)
    : extra.totalGrossAmount;
}

/** A loosely keyword-matched icon per extra, the fallback when a card has no
 *  photo in the CMS. */
function ExtraIcon({ name }: { name: string }) {
  const n = name.toLowerCase();
  const shared = {
    className: "w-8 h-8 text-olive",
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
  if (/spa|towel|pool/.test(n)) {
    return (
      <svg {...shared}>
        <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" />
      </svg>
    );
  }
  if (/food|grocery|hamper|meal|firewood|bbq|braai/.test(n)) {
    return (
      <svg {...shared}>
        <path d="M7 3v7M5 3v4M9 3v4M7 10v11" />
        <path d="M16 3c-1.7 0-3 2-3 5s1.3 4 3 4v9" />
      </svg>
    );
  }
  return (
    <svg {...shared}>
      <path d="m12 3 2.5 5.5L20 9.5l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-1z" />
    </svg>
  );
}

export function ExtrasClient({
  extrasContent,
}: {
  extrasContent: Record<string, ExtrasContentDto>;
}) {
  const router = useRouter();
  const sessionId = useSearchParams().get("session");
  const [session, setSession] = useState<SessionSummary | null>(null);
  const [offersBySlot, setOffersBySlot] = useState<Record<number, ExtraOfferDto[]>>({});
  // Per lodge slot: serviceId -> chosen quantity. One-off items sit at 0 or 1.
  const [chosenBySlot, setChosenBySlot] = useState<Record<number, Record<string, number>>>({});
  const [activeSlot, setActiveSlot] = useState(0);
  // Which cards have "More information" open, keyed by serviceId.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
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
      const chosen: Record<number, Record<string, number>> = {};
      results.forEach((r, i) => {
        const slot = summary.lodges[i].slot;
        if (r.ok) offers[slot] = r.data.extras;
        // Restore previously chosen extras (snapshot count = chosen quantity).
        chosen[slot] = Object.fromEntries(
          summary.lodges[i].extras.map((x) => [x.serviceId, x.count]),
        );
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

  function chosenCount(slot: number): number {
    return Object.values(chosenBySlot[slot] ?? {}).filter((q) => q > 0).length;
  }

  function snapshotsForSlot(slot: number): ExtraSnapshotDto[] {
    const offers = offersBySlot[slot] ?? [];
    const qtys = chosenBySlot[slot] ?? {};
    return offers.flatMap((o) => {
      const q = qtys[o.serviceId] ?? 0;
      if (q <= 0) return [];
      const grossAmount = isQuantity(o) ? q * unitPrice(o) : o.totalGrossAmount;
      const count = isQuantity(o) ? q : o.count;
      return [{ serviceId: o.serviceId, code: o.code, name: o.name, count, grossAmount }];
    });
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
  const anyChosen = session.lodges.some((l) => chosenCount(l.slot) > 0);

  const activeOffers = offersBySlot[activeSlot] ?? [];
  const activeQtys = chosenBySlot[activeSlot] ?? {};

  function setQty(serviceId: string, q: number) {
    const next = Math.max(0, Math.min(MAX_QTY, q));
    setChosenBySlot((prev) => {
      const slotMap = { ...(prev[activeSlot] ?? {}) };
      if (next <= 0) delete slotMap[serviceId];
      else slotMap[serviceId] = next;
      return { ...prev, [activeSlot]: slotMap };
    });
  }

  function toggleInfo(serviceId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(serviceId)) next.delete(serviceId);
      else next.add(serviceId);
      return next;
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

  // Round quantity buttons, Center Parcs style.
  const qtyBtn =
    "w-9 h-9 rounded-full border border-navy text-navy flex items-center justify-center shrink-0 hover:bg-navy/5 disabled:border-line disabled:text-line disabled:hover:bg-transparent";

  return (
    <div className="mx-auto max-w-5xl px-5 py-8 pb-32">
      <CheckoutBreadcrumb />
      <h1 className="font-display text-[34px] leading-tight font-bold text-ink mb-5">
        Recommended little extras
      </h1>
      <Stepper current="Little Extras" />

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-8 lg:items-start">
        <div>
          <p className="text-sm text-foreground/70 max-w-xl">
            Add something special to make your break even better. Don&apos;t worry
            if you can&apos;t decide now, you can add as many as you like once
            you&apos;ve booked, from Manage my booking.
            {multi && " Extras are added per lodge."}
          </p>

          {/* Per-lodge switcher */}
          {multi && (
            <div className="mt-5 flex flex-wrap gap-2">
              {session.lodges.map((l) => {
                const isActive = l.slot === activeSlot;
                const count = chosenCount(l.slot);
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

          <div className="mt-6 grid gap-5">
            {activeOffers.map((extra) => {
              const content = extrasContent[extra.code];
              const quantity = isQuantity(extra);
              const qty = activeQtys[extra.serviceId] ?? 0;
              const added = qty > 0;
              const unit = unitPrice(extra);
              const noun = content?.noun ?? "item";
              const open = expanded.has(extra.serviceId);
              const badge = quantity ? `From ${formatKes(unit)}` : formatKes(extra.totalGrossAmount);
              return (
                <div
                  key={extra.serviceId}
                  className={`overflow-hidden rounded-lg bg-white transition ${
                    added ? "border border-navy ring-1 ring-navy" : "border border-line"
                  }`}
                >
                  <div className="flex flex-col sm:flex-row">
                    {/* Photo with the price badge, Center Parcs style */}
                    <div className="relative aspect-[16/10] sm:aspect-auto sm:w-52 shrink-0">
                      {content?.image ? (
                        <Image
                          src={content.image.url}
                          alt={content.image.alt}
                          fill
                          sizes="(max-width: 640px) 100vw, 208px"
                          className="object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-mist">
                          <ExtraIcon name={extra.name} />
                        </div>
                      )}
                      <span className="absolute left-3 top-3 rounded bg-white/95 px-2.5 py-1 text-sm font-semibold text-ink shadow-sm">
                        {badge}
                      </span>
                    </div>

                    {/* Title, description and the control */}
                    <div className="flex-1 p-5">
                      <p className="text-lg font-bold text-ink">{extra.name}</p>
                      <p className="mt-1 text-sm text-foreground/70">{extra.description}</p>

                      {extra.teaser ? (
                        <p className="mt-4 text-sm text-foreground/70">
                          Book from your account after checkout, subject to availability.
                        </p>
                      ) : quantity ? (
                        <div className="mt-4 flex items-center gap-4">
                          <button
                            type="button"
                            aria-label={`Fewer ${extra.name}`}
                            disabled={qty <= 0}
                            onClick={() => setQty(extra.serviceId, qty - 1)}
                            className={qtyBtn}
                          >
                            <svg viewBox="0 0 12 12" className="w-3.5 h-3.5" fill="none" aria-hidden>
                              <path d="M2 6h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                            </svg>
                          </button>
                          <div className="flex-1 text-center">
                            <p className="font-semibold text-ink tabular-nums">
                              {qty} {noun}
                              {qty === 1 ? "" : "s"}
                            </p>
                            <p className="text-xs text-foreground/50">
                              {formatKes(unit)} per {noun}
                            </p>
                          </div>
                          <button
                            type="button"
                            aria-label={`More ${extra.name}`}
                            disabled={qty >= MAX_QTY}
                            onClick={() => setQty(extra.serviceId, qty + 1)}
                            className={qtyBtn}
                          >
                            <svg viewBox="0 0 12 12" className="w-3.5 h-3.5" fill="none" aria-hidden>
                              <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                            </svg>
                          </button>
                        </div>
                      ) : added ? (
                        <div className="mt-4 flex items-center justify-between gap-3">
                          <span className="flex items-center gap-1.5 text-sm font-semibold text-leaf">
                            <TickIcon className="w-4 h-4" />
                            Added to your break
                          </span>
                          <button
                            type="button"
                            onClick={() => setQty(extra.serviceId, 0)}
                            className="text-sm text-navy underline underline-offset-2"
                          >
                            Remove
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setQty(extra.serviceId, 1)}
                          className="btn-primary mt-4"
                        >
                          Add to Basket
                        </button>
                      )}
                    </div>
                  </div>

                  {/* More information expander */}
                  {content && content.more.length > 0 && (
                    <>
                      <button
                        type="button"
                        onClick={() => toggleInfo(extra.serviceId)}
                        aria-expanded={open}
                        className="flex w-full items-center justify-center gap-1.5 border-t border-line px-5 py-3 text-sm font-semibold text-navy hover:bg-mist"
                      >
                        More Information
                        <svg
                          viewBox="0 0 24 24"
                          className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden
                        >
                          <path d="m6 9 6 6 6-6" />
                        </svg>
                      </button>
                      {open && (
                        <div className="grid gap-4 border-t border-line px-5 py-5">
                          {content.more.map((section) => (
                            <div key={section.heading}>
                              <p className="font-bold text-ink">{section.heading}</p>
                              <p className="mt-1 text-sm text-foreground/70">{section.body}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
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
