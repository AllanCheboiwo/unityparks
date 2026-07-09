"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, isExpired } from "@/lib/api";
import { formatDate, formatKes, nightsLabel } from "@/lib/format";
import { LODGES, TIER_ORDER } from "@/content/lodges";
import type { SessionSummary, StayOfferDto } from "@/lib/types";
import { Stepper } from "@/components/Stepper";
import { ExpiredNotice } from "@/components/ExpiredNotice";

export function LodgesClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session");
  // Bedrooms preference filters but never blocks (single-lodge only).
  const bedroomsPref = Number(searchParams.get("bedrooms") ?? 0);
  const [session, setSession] = useState<SessionSummary | null>(null);
  const [offersBySlot, setOffersBySlot] = useState<Record<number, StayOfferDto[]>>({});
  const [activeSlot, setActiveSlot] = useState(0);
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selecting, setSelecting] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    (async () => {
      const s = await apiFetch<SessionSummary>(`/api/session/${sessionId}`);
      if (isExpired(s)) return setExpired(true);
      if (!s.ok) return setError(s.error);
      const summary = s.data;
      setSession(summary);
      const firstUnchosen = summary.lodges.find((l) => !l.lodge);
      setActiveSlot(firstUnchosen ? firstUnchosen.slot : 0);
      // One offers read per lodge, each priced for that lodge's own party.
      const results = await Promise.all(
        summary.lodges.map((l) =>
          apiFetch<{ offers: StayOfferDto[]; slot: number }>(
            `/api/session/${sessionId}/offers?slot=${l.slot}`,
          ),
        ),
      );
      const map: Record<number, StayOfferDto[]> = {};
      results.forEach((r, i) => {
        if (r.ok) map[summary.lodges[i].slot] = r.data.offers;
      });
      setOffersBySlot(map);
    })();
  }, [sessionId]);

  if (!sessionId || expired) return <ExpiredNotice />;
  if (error) {
    return <p className="mx-auto max-w-2xl px-5 py-20 text-center text-red-700">{error}</p>;
  }
  if (!session) {
    return (
      <p className="mx-auto max-w-2xl px-5 py-20 text-center text-foreground/50">
        Checking live availability…
      </p>
    );
  }

  const multi = session.lodges.length > 1;
  const activeLodge = session.lodges.find((l) => l.slot === activeSlot) ?? session.lodges[0];
  const activeOffers = offersBySlot[activeSlot] ?? [];
  const offersByCode = new Map(activeOffers.map((o) => [o.unitGroupCode, o]));
  const allChosen = session.lodges.every((l) => l.lodge);
  const basketTotal = session.lodges.reduce((sum, l) => sum + (l.lodge?.stayGrossAmount ?? 0), 0);

  // A same-tier choice in another slot uses up one of that tier's units.
  const takenElsewhere = new Map<string, number>();
  for (const l of session.lodges) {
    if (l.slot !== activeSlot && l.lodge) {
      takenElsewhere.set(
        l.lodge.unitGroupCode,
        (takenElsewhere.get(l.lodge.unitGroupCode) ?? 0) + 1,
      );
    }
  }

  async function choose(offer: StayOfferDto) {
    setSelecting(offer.unitGroupCode);
    setError(null);
    const result = await apiFetch(`/api/session/${sessionId}/lodge`, {
      method: "POST",
      body: JSON.stringify({
        unitGroupCode: offer.unitGroupCode,
        ratePlanId: offer.ratePlanId,
        stayGrossAmount: offer.totalGrossAmount,
        currency: offer.currency,
        slot: activeSlot,
      }),
    });
    if (isExpired(result)) return setExpired(true);
    if (!result.ok) {
      setError(result.error);
      setSelecting(null);
      return;
    }
    const s = await apiFetch<SessionSummary>(`/api/session/${sessionId}`);
    setSelecting(null);
    if (isExpired(s)) return setExpired(true);
    if (!s.ok) return setError(s.error);
    const summary = s.data;
    setSession(summary);
    // Single lodge: straight on. Multi: advance to the next empty slot.
    if (summary.lodges.length === 1) {
      router.push(`/checkout/extras?session=${sessionId}`);
      return;
    }
    const nextUnchosen = summary.lodges.find((l) => !l.lodge);
    if (nextUnchosen) setActiveSlot(nextUnchosen.slot);
  }

  const activePartySize = activeLodge.adults + activeLodge.childrenAges.length;

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      <Stepper current="Lodge" />

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-display text-3xl text-forest">
          {multi ? (
            <>
              Choose your <em>lodges</em>
            </>
          ) : (
            <>
              Choose your <em>lodge</em>
            </>
          )}
        </h1>
        <Link href="/" className="text-xs text-lake underline underline-offset-2">
          Change dates
        </Link>
      </div>
      <p className="mt-1 text-sm text-foreground/60">
        {formatDate(session.arrival)} → {formatDate(session.departure)} ·{" "}
        {nightsLabel(session.nights)}
        {!multi && <> · {activeLodge.partyLabel}</>}
        {!multi && bedroomsPref > 1 && ` · ${bedroomsPref}+ bedrooms preferred`}
      </p>

      {/* Basket strip (multi-lodge only) */}
      {multi && (
        <div className="mt-6 rounded-2xl bg-white ring-1 ring-forest/10 shadow-sm p-4">
          <div className="flex flex-wrap gap-2">
            {session.lodges.map((l) => {
              const chosen = l.lodge ? LODGES[l.lodge.unitGroupCode] : null;
              const isActive = l.slot === activeSlot;
              return (
                <button
                  key={l.slot}
                  type="button"
                  onClick={() => setActiveSlot(l.slot)}
                  className={`flex-1 min-w-[150px] text-left rounded-xl px-4 py-3 ring-1 transition ${
                    isActive
                      ? "ring-2 ring-forest bg-sand/40"
                      : "ring-forest/15 hover:ring-forest/30"
                  }`}
                >
                  <p className="text-[11px] uppercase tracking-wide text-foreground/50">
                    Lodge {l.slot + 1} · {l.partyLabel}
                  </p>
                  {chosen ? (
                    <p className="text-sm font-semibold text-forest mt-0.5">
                      {chosen.name} · {formatKes(l.lodge!.stayGrossAmount ?? 0)}
                    </p>
                  ) : (
                    <p className="text-sm font-medium text-foreground/45 mt-0.5">Not chosen yet</p>
                  )}
                </button>
              );
            })}
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-forest/10 pt-3">
            <div className="text-sm">
              <span className="text-foreground/60">Booking total </span>
              <span className="font-display text-lg text-forest">{formatKes(basketTotal)}</span>
            </div>
            <button
              type="button"
              onClick={() => router.push(`/checkout/extras?session=${sessionId}`)}
              disabled={!allChosen}
              className="rounded-lg bg-forest text-white px-6 py-2.5 text-sm font-semibold hover:bg-forest-light disabled:opacity-40"
            >
              {allChosen ? "Continue" : "Choose every lodge to continue"}
            </button>
          </div>
        </div>
      )}

      {multi && (
        <p className="mt-6 text-sm font-semibold text-forest">
          Choosing for Lodge {activeSlot + 1} of {session.lodges.length}{" "}
          <span className="font-normal text-foreground/55">· {activeLodge.partyLabel}</span>
        </p>
      )}

      {activeOffers.length === 0 && (
        <div className="mt-6 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">
          Nothing is on sale for these dates and party. Breaks are released about
          three months ahead. Try dates a little closer to today.
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="mt-6 grid gap-6">
        {TIER_ORDER.map((code) => {
          const lodge = LODGES[code];
          const rawOffer = offersByCode.get(code);
          const taken = takenElsewhere.get(code) ?? 0;
          const remainingUnits = rawOffer ? rawOffer.availableUnits - taken : 0;
          const offer = rawOffer && remainingUnits > 0 ? rawOffer : undefined;
          const tooSmall = !offer && activePartySize > lodge.sleeps;
          const takenByOther = !offer && rawOffer !== undefined && remainingUnits <= 0;
          const belowBedroomsPref = !multi && bedroomsPref > 0 && lodge.bedrooms < bedroomsPref;
          const isChosenHere = activeLodge.lodge?.unitGroupCode === code;

          return (
            <div
              key={code}
              className={`rounded-2xl bg-white ring-1 shadow-sm overflow-hidden sm:flex ${
                isChosenHere ? "ring-2 ring-forest" : "ring-forest/10"
              } ${offer ? "" : "opacity-60"}`}
            >
              <div className="relative h-44 sm:h-auto sm:w-64 shrink-0">
                <Image src={lodge.image} alt={lodge.name} fill className="object-cover" />
              </div>

              <div className="p-5 flex-1 flex flex-col sm:flex-row sm:items-center gap-5">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <h2 className="font-display text-xl text-forest">{lodge.name}</h2>
                    {offer && offer.availableUnits > 0 && remainingUnits <= 2 && (
                      <span className="rounded-full bg-amber-100 text-amber-900 text-[11px] font-semibold px-2.5 py-0.5">
                        Only {remainingUnits} left
                      </span>
                    )}
                    {isChosenHere && (
                      <span className="rounded-full bg-moss/15 text-moss text-[11px] font-semibold px-2.5 py-0.5">
                        Chosen
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-foreground/60 italic">{lodge.tagline}</p>
                  <p className="mt-2 text-sm text-foreground/70 max-w-lg">{lodge.blurb}</p>
                  <ul className="mt-3 flex flex-wrap gap-1.5">
                    <li className="rounded-full bg-sand px-2.5 py-0.5 text-[11px] text-forest font-medium">
                      {lodge.bedrooms} bedrooms · sleeps {lodge.sleeps}
                    </li>
                    {belowBedroomsPref && (
                      <li className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] text-amber-900">
                        Fewer bedrooms than you asked for
                      </li>
                    )}
                    {lodge.features.map((f) => (
                      <li key={f} className="rounded-full bg-sand px-2.5 py-0.5 text-[11px] text-forest">
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="sm:text-right shrink-0">
                  {offer ? (
                    <>
                      <p className="text-[11px] uppercase tracking-wide text-foreground/50">
                        Total for your break
                      </p>
                      <p className="font-display text-2xl text-forest">
                        {formatKes(offer.totalGrossAmount)}
                      </p>
                      <p className="text-[11px] text-foreground/50">
                        whole lodge · {offer.cancellationName ?? "flexible"} rate
                      </p>
                      <button
                        onClick={() => choose(offer)}
                        disabled={selecting !== null}
                        className="mt-3 rounded-lg bg-forest text-white px-6 py-2 text-sm font-semibold hover:bg-forest-light disabled:opacity-60"
                      >
                        {selecting === code
                          ? "Holding…"
                          : isChosenHere
                            ? "Chosen"
                            : multi
                              ? "Add to basket"
                              : "Select"}
                      </button>
                    </>
                  ) : (
                    <p className="text-sm font-medium text-foreground/50 max-w-[160px]">
                      {tooSmall
                        ? `Sleeps up to ${lodge.sleeps}, too small for this lodge's party`
                        : takenByOther
                          ? "Taken by another lodge in your break"
                          : "Sold out for these dates"}
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
