"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, isExpired } from "@/lib/api";
import { formatDate, formatKes, formatShortDate, nightsLabel } from "@/lib/format";
import { LODGES, TIER_ORDER } from "@/content/lodges";
import { MAX_BEDROOMS, requiredBedrooms } from "@/lib/occupancy";
import type { SessionSummary, StayOfferDto } from "@/lib/types";
import { BookingBar, type BookingBarInitial } from "@/components/BookingBar";
import { ExpiredNotice } from "@/components/ExpiredNotice";

/** One candidate start date in a whole-month search, from /api/month-availability. */
type MonthDate = {
  arrival: string;
  departure: string;
  available: boolean;
  fromPrice: number | null;
  currency: string;
};

/**
 * Band counts recovered from the stored representative ages. The bands are
 * defined by age ranges (children 6-17, toddlers 2-5, infants under 2), so
 * counting by range is exact whatever representative age the server picked.
 */
function agesToBands(adults: number, ages: number[]) {
  return {
    adults,
    children: ages.filter((a) => a >= 6).length,
    toddlers: ages.filter((a) => a >= 2 && a <= 5).length,
    infants: ages.filter((a) => a < 2).length,
  };
}

export function LodgesClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session");
  // Bedrooms preference filters but never blocks (single-lodge only).
  const bedroomsPref = Number(searchParams.get("bedrooms") ?? 0);
  // A whole-month search carries ?month=; the price strip lets the guest hop
  // between that month's start dates without going back to the widget.
  const month = searchParams.get("month");
  const [session, setSession] = useState<SessionSummary | null>(null);
  const [offersBySlot, setOffersBySlot] = useState<Record<number, StayOfferDto[]>>({});
  const [activeSlot, setActiveSlot] = useState(0);
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selecting, setSelecting] = useState<string | null>(null);
  const [monthDates, setMonthDates] = useState<MonthDate[] | null>(null);
  const monthKey = useRef<string | null>(null);
  const [dateSwitching, setDateSwitching] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    // A date hop replaces the session mid-page; without this guard the old
    // session's slower fetches would land after the new one's and show the
    // previous date's prices against the new date's header.
    let stale = false;
    (async () => {
      const s = await apiFetch<SessionSummary>(`/api/session/${sessionId}`);
      if (stale) return;
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
      if (stale) return;
      const map: Record<number, StayOfferDto[]> = {};
      results.forEach((r, i) => {
        if (r.ok) map[summary.lodges[i].slot] = r.data.offers;
      });
      setOffersBySlot(map);
      setDateSwitching(false);
    })();
    return () => {
      stale = true;
    };
  }, [sessionId]);

  // One strip fetch per month/shape/party combination. Hopping between dates
  // swaps the session but not the strip, so the key check skips the refetch.
  // The result depends only on the key, so a late response is safe to keep as
  // long as the key is still current; a failed fetch clears the key so the
  // next render can retry instead of caching the failure forever.
  useEffect(() => {
    if (!month || !session) return;
    const lead = agesToBands(session.lodges[0].adults, session.lodges[0].childrenAges);
    const dow = new Date(`${session.arrival}T00:00:00Z`).getUTCDay() === 5 ? "fri" : "mon";
    const key = [month, session.nights, dow, lead.adults, lead.children, lead.toddlers, lead.infants].join("|");
    if (monthKey.current === key) return;
    monthKey.current = key;
    (async () => {
      const query = new URLSearchParams({
        month,
        nights: String(session.nights),
        dow,
        adults: String(lead.adults),
        children: String(lead.children),
        toddlers: String(lead.toddlers),
        infants: String(lead.infants),
      });
      const r = await apiFetch<{ dates: MonthDate[] }>(`/api/month-availability?${query}`);
      if (monthKey.current !== key) return; // superseded by a different strip
      if (r.ok) setMonthDates(r.data.dates);
      else monthKey.current = null;
    })();
  }, [month, session]);

  if (!sessionId || expired) return <ExpiredNotice />;
  // Only a failed initial load takes over the page. Later errors (a date hop
  // or lodge pick going wrong) show in the inline box beside the results.
  if (error && !session) {
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
      router.push(`/checkout/location?session=${sessionId}`);
      return;
    }
    const nextUnchosen = summary.lodges.find((l) => !l.lodge);
    if (nextUnchosen) setActiveSlot(nextUnchosen.slot);
  }

  // Infants sleep in cots, so they don't count against a lodge's beds.
  const activePartySize =
    activeLodge.adults + activeLodge.childrenAges.filter((a) => a >= 2).length;

  /** Hop to another start date in the month: a fresh search, same parties. */
  async function switchDate(d: MonthDate) {
    if (!session || !d.available || d.arrival === session.arrival || dateSwitching) return;
    setDateSwitching(true);
    setError(null);
    const bands = session.lodges.map((l) => agesToBands(l.adults, l.childrenAges));
    const result = await apiFetch<{ sessionId: string }>("/api/search", {
      method: "POST",
      body: JSON.stringify({
        arrival: d.arrival,
        departure: d.departure,
        ...bands[0],
        ...(bands.length > 1 ? { lodges: bands } : {}),
      }),
    });
    if (!result.ok) {
      setError(result.error);
      setDateSwitching(false);
      return;
    }
    const params = new URLSearchParams({ session: result.data.sessionId, month: month! });
    if (bedroomsPref > 0) params.set("bedrooms", String(bedroomsPref));
    router.replace(`/lodges?${params.toString()}`);
  }

  // The strip's cheapest open date wears the "Lowest price" tag.
  const openDates = (monthDates ?? []).filter((d) => d.available && d.fromPrice !== null);
  const cheapestArrival = openDates.length
    ? openDates.reduce((a, b) => (b.fromPrice! < a.fromPrice! ? b : a)).arrival
    : null;

  // The bar mirrors this search so the guest can change any part of it in
  // place, Center Parcs style. Bands are recovered from the stored ages;
  // bedrooms re-derive from each party, except a manually raised preference
  // (?bedrooms=, single-lodge only) which must survive a re-search.
  const barInitial: BookingBarInitial = {
    arrival: session.arrival,
    nights: session.nights,
    parties: session.lodges.map((l) => {
      const bands = agesToBands(l.adults, l.childrenAges);
      const required = Math.min(requiredBedrooms(bands.adults, bands.children), MAX_BEDROOMS);
      const preferred = l.slot === 0 && !multi ? bedroomsPref : 0;
      return {
        ...bands,
        bedrooms: Math.min(Math.max(required, preferred), MAX_BEDROOMS),
      };
    }),
  };

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      {/* keyed by session: a re-search swaps the session, and the fresh
          mount re-seeds the bar from the new search */}
      <div className="relative z-30 mb-8">
        <BookingBar key={session.sessionId} initial={barInitial} />
      </div>

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
      </div>
      <p className="mt-1 text-sm text-foreground/60">
        {formatDate(session.arrival)} → {formatDate(session.departure)} ·{" "}
        {nightsLabel(session.nights)}
        {!multi && <> · {activeLodge.partyLabel}</>}
        {!multi && bedroomsPref > 1 && ` · ${bedroomsPref}+ bedrooms preferred`}
      </p>

      {/* Whole-month price strip: every start date in the searched month,
          cheapest tagged, sold-out unclickable. Prices follow lodge 1. */}
      {month && monthDates && monthDates.length > 0 && (
        <div className="mt-6 flex gap-2 overflow-x-auto pb-1">
          {monthDates.map((d) => {
            const isSelected = d.arrival === session.arrival;
            const isCheapest = d.arrival === cheapestArrival;
            return (
              <button
                key={d.arrival}
                type="button"
                disabled={!d.available || isSelected || dateSwitching}
                onClick={() => switchDate(d)}
                className={`relative shrink-0 min-w-[10.5rem] rounded-xl px-4 pb-3 text-left transition ${
                  isCheapest ? "pt-7" : "pt-3"
                } ${
                  isSelected
                    ? "bg-forest ring-2 ring-forest"
                    : d.available
                      ? "bg-white ring-1 ring-forest/15 hover:ring-forest/40 disabled:opacity-60"
                      : "bg-sand/40 ring-1 ring-forest/10 opacity-60 cursor-not-allowed"
                }`}
              >
                {isCheapest && (
                  <span className="absolute top-1.5 left-4 rounded-full bg-gold text-forest text-[10px] font-semibold px-2 py-0.5">
                    Lowest price
                  </span>
                )}
                <span className={`block text-sm font-semibold ${isSelected ? "text-white" : "text-forest"}`}>
                  {formatShortDate(d.arrival)}
                </span>
                <span className={`block text-[11px] ${isSelected ? "text-white/70" : "text-foreground/55"}`}>
                  {session.nights} nights
                </span>
                <span
                  className={`block mt-0.5 text-sm font-semibold ${
                    isSelected ? "text-white" : d.available ? "text-forest" : "text-foreground/45"
                  }`}
                >
                  {d.available
                    ? `${multi ? "lodge 1 from" : "from"} ${formatKes(d.fromPrice!)}`
                    : "Sold out"}
                </span>
              </button>
            );
          })}
        </div>
      )}

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
              onClick={() => router.push(`/checkout/location?session=${sessionId}`)}
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

      <div className={`mt-6 grid gap-6 ${dateSwitching ? "opacity-50 pointer-events-none" : ""}`}>
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
              {/* Unavailable tiers go black-and-white, Center Parcs style. */}
              <div className="relative h-44 sm:h-auto sm:w-64 shrink-0">
                <Image
                  src={lodge.image}
                  alt={lodge.name}
                  fill
                  className={`object-cover ${offer ? "" : "grayscale"}`}
                />
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
