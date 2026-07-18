"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, isExpired } from "@/lib/api";
import { formatKes } from "@/lib/format";
import type { ExtraOfferDto, ExtraSnapshotDto, SessionSummary } from "@/lib/types";
import { Stepper } from "@/components/Stepper";
import { BookingSummary } from "@/components/BookingSummary";
import { ExpiredNotice } from "@/components/ExpiredNotice";

const PRICING_LABELS: Record<string, string> = {
  Room: "per lodge, per stay",
  Person: "per person, per stay",
  RoomPerNight: "per lodge, per night",
  PersonPerNight: "per person, per night",
};

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
  if (error) {
    return <p className="mx-auto max-w-2xl px-5 py-20 text-center text-red-700">{error}</p>;
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

  return (
    <div className="mx-auto max-w-5xl px-5 py-8 pb-32">
      <Stepper current="Little Extras" />

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-8 lg:items-start">
        <div>
          <h1 className="font-display text-3xl text-forest">
            Make it <em>effortless</em>
          </h1>
          <p className="mt-1 text-sm text-foreground/60">
            A few things guests wish they&apos;d added - all priced live for your stay.
            This step is optional.
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
                    className={`rounded-lg px-4 py-2 text-sm font-semibold ring-1 transition ${
                      isActive
                        ? "bg-forest text-white ring-forest"
                        : "text-forest ring-forest/25 hover:bg-sand"
                    }`}
                  >
                    Lodge {l.slot + 1}
                    {count > 0 && (
                      <span
                        className={`ml-2 rounded-full px-1.5 text-[11px] ${
                          isActive ? "bg-white/25" : "bg-forest/10"
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
                  className={`rounded-xl bg-white p-5 ring-1 transition-shadow ${
                    added ? "ring-2 ring-forest shadow-md" : "ring-forest/10 shadow-sm"
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-display text-lg text-forest">{extra.name}</p>
                      <p className="mt-1 text-sm text-foreground/70 max-w-md">
                        {extra.description}
                      </p>
                      <p className="mt-2 text-xs text-foreground/50">
                        {PRICING_LABELS[extra.pricingUnit] ?? extra.pricingUnit}
                        {extra.count > 1 ? ` · ${extra.count}×` : ""}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-semibold text-forest">
                        {formatKes(extra.totalGrossAmount)}
                      </p>
                      <p className="text-[11px] text-foreground/50">for your stay</p>
                      <button
                        onClick={() => toggle(extra.serviceId)}
                        className={`mt-2 rounded-lg px-5 py-1.5 text-sm font-semibold ${
                          added
                            ? "bg-sand text-forest ring-1 ring-forest/30"
                            : "bg-forest text-white hover:bg-forest-light"
                        }`}
                      >
                        {added ? "Remove" : "Add"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <aside className="mt-8 lg:mt-0 lg:sticky lg:top-20">
          <BookingSummary summary={session} extrasOverrideBySlot={overrideBySlot} />
        </aside>
      </div>

      {/* Running total bar */}
      <div className="fixed bottom-0 inset-x-0 bg-white/95 backdrop-blur border-t border-forest/10 z-10">
        <div className="mx-auto max-w-5xl px-5 py-3.5 flex items-center justify-between gap-4">
          <div className="text-sm">
            <span className="text-foreground/60">
              Lodges {formatKes(stayTotal)}
              {locationTotal > 0 && <> + lodge choice {formatKes(locationTotal)}</>}
              {extrasTotal > 0 && <> + extras {formatKes(extrasTotal)}</>} ·{" "}
            </span>
            <span className="font-semibold text-forest">
              Total {formatKes(stayTotal + locationTotal + extrasTotal)}
            </span>
          </div>
          <button
            onClick={continueToDetails}
            disabled={busy}
            className="rounded-lg bg-forest text-white px-6 py-2.5 text-sm font-semibold hover:bg-forest-light disabled:opacity-60"
          >
            {busy ? "Saving…" : anyChosen ? "Continue" : "Continue without extras"}
          </button>
        </div>
      </div>
    </div>
  );
}
