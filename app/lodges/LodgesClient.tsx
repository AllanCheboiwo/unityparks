"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, isExpired } from "@/lib/api";
import { formatDate, formatKes, nightsLabel } from "@/lib/format";
import { LODGES, TIER_ORDER } from "@/content/lodges";
import type { SessionSummary, StayOfferDto } from "@/lib/types";
import { Stepper } from "@/components/Stepper";
import { ExpiredNotice } from "@/components/ExpiredNotice";

export function LodgesClient() {
  const router = useRouter();
  const sessionId = useSearchParams().get("session");
  const [session, setSession] = useState<SessionSummary | null>(null);
  const [offers, setOffers] = useState<StayOfferDto[] | null>(null);
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selecting, setSelecting] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    (async () => {
      const [s, o] = await Promise.all([
        apiFetch<SessionSummary>(`/api/session/${sessionId}`),
        apiFetch<{ offers: StayOfferDto[] }>(`/api/session/${sessionId}/offers`),
      ]);
      if (isExpired(s) || isExpired(o)) return setExpired(true);
      if (!s.ok) return setError(s.error);
      if (!o.ok) return setError(o.error);
      setSession(s.data);
      setOffers(o.data.offers);
    })();
  }, [sessionId]);

  if (!sessionId || expired) return <ExpiredNotice />;
  if (error) {
    return <p className="mx-auto max-w-2xl px-5 py-20 text-center text-red-700">{error}</p>;
  }
  if (!session || !offers) {
    return (
      <p className="mx-auto max-w-2xl px-5 py-20 text-center text-foreground/50">
        Checking live availability…
      </p>
    );
  }

  async function select(offer: StayOfferDto) {
    setSelecting(offer.unitGroupCode);
    const result = await apiFetch(`/api/session/${sessionId}/lodge`, {
      method: "POST",
      body: JSON.stringify({
        unitGroupCode: offer.unitGroupCode,
        ratePlanId: offer.ratePlanId,
        stayGrossAmount: offer.totalGrossAmount,
        currency: offer.currency,
      }),
    });
    if (isExpired(result)) return setExpired(true);
    if (!result.ok) {
      setError(result.error);
      setSelecting(null);
      return;
    }
    router.push(`/checkout/extras?session=${sessionId}`);
  }

  const offersByCode = new Map(offers.map((o) => [o.unitGroupCode, o]));

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      <Stepper current="Lodge" />

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-display text-3xl text-forest">
          Choose your <em>lodge</em>
        </h1>
        <a href="/" className="text-xs text-lake underline underline-offset-2">
          Change dates
        </a>
      </div>
      <p className="mt-1 text-sm text-foreground/60">
        {formatDate(session.arrival)} → {formatDate(session.departure)} ·{" "}
        {nightsLabel(session.nights)} · {session.adults}{" "}
        {session.adults === 1 ? "guest" : "guests"}
      </p>

      <div className="mt-8 grid gap-6">
        {TIER_ORDER.map((code) => {
          const lodge = LODGES[code];
          const offer = offersByCode.get(code);
          const tooSmall = !offer && session.adults > lodge.sleeps;

          return (
            <div
              key={code}
              className={`rounded-2xl bg-white ring-1 ring-forest/10 shadow-sm overflow-hidden sm:flex ${
                offer ? "" : "opacity-60"
              }`}
            >
              <div className="relative h-44 sm:h-auto sm:w-64 shrink-0">
                <Image src={lodge.image} alt={lodge.name} fill className="object-cover" />
              </div>

              <div className="p-5 flex-1 flex flex-col sm:flex-row sm:items-center gap-5">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <h2 className="font-display text-xl text-forest">{lodge.name}</h2>
                    {offer && offer.availableUnits <= 2 && (
                      <span className="rounded-full bg-amber-100 text-amber-900 text-[11px] font-semibold px-2.5 py-0.5">
                        Only {offer.availableUnits} left
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-foreground/60 italic">{lodge.tagline}</p>
                  <p className="mt-2 text-sm text-foreground/70 max-w-lg">{lodge.blurb}</p>
                  <ul className="mt-3 flex flex-wrap gap-1.5">
                    <li className="rounded-full bg-sand px-2.5 py-0.5 text-[11px] text-forest font-medium">
                      {lodge.bedrooms} bedrooms · sleeps {lodge.sleeps}
                    </li>
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
                        onClick={() => select(offer)}
                        disabled={selecting !== null}
                        className="mt-3 rounded-lg bg-forest text-white px-6 py-2 text-sm font-semibold hover:bg-forest-light disabled:opacity-60"
                      >
                        {selecting === code ? "Holding…" : "Select"}
                      </button>
                    </>
                  ) : (
                    <p className="text-sm font-medium text-foreground/50 max-w-[160px]">
                      {tooSmall
                        ? `Sleeps up to ${lodge.sleeps} — too small for your party`
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
