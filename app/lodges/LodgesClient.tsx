"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
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

/* Small inline icons, stroke currentColor, per the house iconography. */

function TickIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden className="mt-1 shrink-0 text-leaf">
      <path d="M4 13l5 5L20 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function PersonIcon({ className }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5 20c1.2-3.4 3.9-5 7-5s5.8 1.6 7 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** Funnel hero band: scenic image, soft dark overlay, centred white title. */
function FunnelHero({ title }: { title: string }) {
  return (
    <div
      className="relative h-[240px] md:h-[300px] bg-cover bg-center"
      style={{ backgroundImage: "url(/photos/band-lake.jpg)" }}
    >
      <div className="absolute inset-0 bg-black/25" />
      <div className="relative flex h-full items-center justify-center px-5">
        <h1 className="font-display text-4xl md:text-[44px] font-bold text-white text-center">{title}</h1>
      </div>
    </div>
  );
}

/** Breadcrumb line: olive links, current page grey. */
function Breadcrumb({ current }: { current: string }) {
  return (
    <nav aria-label="Breadcrumb" className="mx-auto max-w-5xl px-5 pt-4 text-sm">
      <Link href="/" className="text-olive hover:underline">
        Unity Parks
      </Link>
      <span className="mx-2 text-foreground/40">/</span>
      <span className="text-foreground/60">{current}</span>
    </nav>
  );
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
    return (
      <div>
        <FunnelHero title="Choose your lodge" />
        <div className="mx-auto max-w-lg px-5 py-16">
          <div className="rounded-lg bg-mist border border-line px-6 py-10 text-center">
            <CalendarIcon className="mx-auto h-8 w-8 text-olive" />
            <p className="mt-3 font-display text-xl font-bold text-ink">We could not load your search</p>
            <p className="mt-1 text-sm text-foreground/60">{error}</p>
            <Link href="/" className="btn-outline mt-5">
              Back to search
            </Link>
          </div>
        </div>
      </div>
    );
  }
  if (!session) {
    return (
      <div>
        <FunnelHero title="Choose your lodge" />
        <p className="mx-auto max-w-2xl px-5 py-20 text-center text-foreground/50">
          Checking live availability…
        </p>
      </div>
    );
  }

  const multi = session.lodges.length > 1;
  const activeLodge = session.lodges.find((l) => l.slot === activeSlot) ?? session.lodges[0];
  // The per-person price anchor counts everyone with a bed: adults plus
  // children aged 2 and over. Cot infants ride free, same as occupancy.
  const activeHeads = Math.max(
    1,
    activeLodge.adults + activeLodge.childrenAges.filter((age) => age >= 2).length,
  );
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
  // place. Bands are recovered from the stored ages;
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

  const pageTitle = multi ? "Choose your lodges" : "Choose your lodge";

  return (
    <div>
      <FunnelHero title={pageTitle} />

      {/* Search-again band: the same booking bar, seeded with this search,
          on the full-width olive funnel band. Keyed by session: a re-search
          swaps the session, and the fresh mount re-seeds the bar. */}
      <div className="bg-olive py-4 md:py-5">
        <div className="relative z-30 mx-auto max-w-5xl px-5">
          <BookingBar key={session.sessionId} initial={barInitial} />
        </div>
      </div>

      <Breadcrumb current={pageTitle} />

      <div className="mx-auto max-w-5xl px-5 pb-12 pt-3">
        <p className="flex items-center gap-2 text-sm text-foreground/60">
          <CalendarIcon className="text-olive" />
          {formatDate(session.arrival)} to {formatDate(session.departure)} ·{" "}
          {nightsLabel(session.nights)}
          {!multi && <> · {activeLodge.partyLabel}</>}
          {!multi && bedroomsPref > 1 && ` · ${bedroomsPref}+ bedrooms preferred`}
        </p>

        {/* Whole-month price strip: a pill per start date in the searched
            month, cheapest tagged, sold-out greyed. Prices follow lodge 1. */}
        {month && monthDates && monthDates.length > 0 && (
          <div className="mt-5 flex gap-2 overflow-x-auto pb-1">
            {monthDates.map((d) => {
              const isSelected = d.arrival === session.arrival;
              const isCheapest = d.arrival === cheapestArrival;
              return (
                <button
                  key={d.arrival}
                  type="button"
                  disabled={!d.available || isSelected || dateSwitching}
                  onClick={() => switchDate(d)}
                  className={`relative shrink-0 min-w-[10rem] rounded-lg border px-4 pb-3 text-left transition ${
                    isCheapest ? "pt-7" : "pt-3"
                  } ${
                    isSelected
                      ? "bg-navy border-navy"
                      : d.available
                        ? "bg-white border-line hover:border-navy disabled:opacity-60"
                        : "bg-mist border-line opacity-60 cursor-not-allowed"
                  }`}
                >
                  {isCheapest && (
                    <span className="absolute top-1.5 left-4 rounded-full bg-ochre text-white text-[10px] font-semibold px-2 py-0.5">
                      Lowest price
                    </span>
                  )}
                  <span className={`block text-sm font-semibold ${isSelected ? "text-white" : "text-ink"}`}>
                    {formatShortDate(d.arrival)}
                  </span>
                  <span className={`block text-[11px] ${isSelected ? "text-white/70" : "text-foreground/55"}`}>
                    {nightsLabel(session.nights)}
                  </span>
                  <span
                    className={`block mt-0.5 text-sm font-semibold ${
                      isSelected ? "text-white" : d.available ? "text-navy" : "text-foreground/45"
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

        {/* Basket strip (multi-lodge only): one navy pill per lodge slot. */}
        {multi && (
          <div className="mt-6 rounded-lg bg-white border border-line p-4">
            <div className="flex flex-wrap gap-2">
              {session.lodges.map((l) => {
                const chosen = l.lodge ? LODGES[l.lodge.unitGroupCode] : null;
                const isActive = l.slot === activeSlot;
                return (
                  <button
                    key={l.slot}
                    type="button"
                    onClick={() => setActiveSlot(l.slot)}
                    className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${
                      isActive
                        ? "bg-navy border-navy text-white"
                        : "bg-white border-navy text-navy hover:bg-navy/5"
                    }`}
                  >
                    {chosen && (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden className={isActive ? "text-white" : "text-leaf"}>
                        <path d="M4 13l5 5L20 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                    <span>
                      Lodge {l.slot + 1}:{" "}
                      {chosen ? (
                        <>
                          {chosen.name} · {formatKes(l.lodge!.stayGrossAmount ?? 0)}
                        </>
                      ) : (
                        <span className={isActive ? "text-white/80 font-normal" : "text-foreground/50 font-normal"}>
                          not chosen yet
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
              <div className="text-sm">
                <span className="text-foreground/60">Booking total </span>
                <span className="font-display text-lg font-bold text-ink">{formatKes(basketTotal)}</span>
              </div>
              <button
                type="button"
                onClick={() => router.push(`/checkout/location?session=${sessionId}`)}
                disabled={!allChosen}
                className="btn-primary"
              >
                {allChosen ? "Continue" : "Choose every lodge to continue"}
              </button>
            </div>
          </div>
        )}

        {multi && (
          <p className="mt-6 text-sm font-semibold text-ink">
            Choosing for Lodge {activeSlot + 1} of {session.lodges.length}{" "}
            <span className="font-normal text-foreground/55">· {activeLodge.partyLabel}</span>
          </p>
        )}

        {activeOffers.length === 0 && (
          <div className="mt-6 rounded-lg bg-mist border border-line px-6 py-10 text-center">
            <CalendarIcon className="mx-auto h-8 w-8 text-olive" />
            <p className="mt-3 font-display text-xl font-bold text-ink">
              Nothing is on sale for these dates and party
            </p>
            <p className="mx-auto mt-1 max-w-md text-sm text-foreground/60">
              Breaks are released about three months ahead. Try dates a little
              closer to today.
            </p>
            <Link href="/" className="btn-outline mt-5">
              Back to search
            </Link>
          </div>
        )}

        {error && (
          <div className="mt-4 flex items-start gap-3 rounded-lg bg-mist border border-line px-4 py-3 text-sm">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden className="mt-0.5 shrink-0 text-ochre-dark">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
              <path d="M12 7.5v5.5M12 16.5v.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <p className="text-ink">{error}</p>
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
                className={`overflow-hidden rounded-lg bg-white border sm:flex ${
                  isChosenHere ? "border-olive ring-1 ring-olive" : "border-line"
                } ${offer ? "" : "opacity-60"}`}
              >
                {/* Unavailable tiers go black-and-white. */}
                <div className="relative aspect-[4/3] sm:aspect-auto sm:w-[38%] shrink-0">
                  <Image
                    src={lodge.image}
                    alt={lodge.name}
                    fill
                    className={`object-cover ${offer ? "" : "grayscale"}`}
                  />
                </div>

                <div className="flex flex-1 flex-col gap-5 p-6 sm:flex-row">
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-3">
                      <h2 className="font-display text-[22px] font-bold text-navy">{lodge.name}</h2>
                      {offer && offer.availableUnits > 0 && remainingUnits <= 2 && (
                        <span className="rounded-full bg-ochre/10 text-ochre-dark text-[11px] font-semibold px-2.5 py-0.5">
                          Only {remainingUnits} left
                        </span>
                      )}
                      {isChosenHere && (
                        <span className="rounded-full bg-leaf/15 text-leaf text-[11px] font-semibold px-2.5 py-0.5">
                          Chosen
                        </span>
                      )}
                    </div>
                    <p className="text-sm italic text-foreground/60">{lodge.tagline}</p>
                    <p className="mt-2 max-w-lg text-sm text-foreground/70">{lodge.blurb}</p>
                    <ul className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-2">
                      {lodge.features.map((f) => (
                        <li key={f} className="flex items-start gap-2 text-sm text-foreground/80">
                          <TickIcon />
                          {f}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-3 flex items-center gap-2 text-sm text-foreground/70">
                      <PersonIcon className="text-olive" />
                      Sleeps {lodge.sleeps} · {lodge.bedrooms} bedrooms
                    </p>
                    {belowBedroomsPref && (
                      <p className="mt-2 text-[13px] text-ochre-dark">
                        Fewer bedrooms than you asked for
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-col justify-center sm:w-48 sm:items-end sm:border-l sm:border-line sm:pl-6 sm:text-right">
                    {offer ? (
                      <>
                        <p className="text-[13px] text-foreground/60">
                          {nightsLabel(session.nights)} from
                        </p>
                        <p className="text-[26px] font-bold text-ink">
                          {formatKes(offer.totalGrossAmount)}
                        </p>
                        <p className="text-[13px] text-foreground/60">per lodge</p>
                        <p className="text-[12px] text-foreground/50">
                          about{" "}
                          {formatKes(offer.totalGrossAmount / session.nights / activeHeads)}{" "}
                          per person per night
                        </p>
                        <p className="mt-1 text-xs text-foreground/50">
                          {offer.cancellationName ?? "flexible"} rate
                        </p>
                        <button
                          onClick={() => choose(offer)}
                          disabled={selecting !== null}
                          className="btn-primary mt-4 whitespace-nowrap"
                        >
                          {selecting === code
                            ? "Holding…"
                            : isChosenHere
                              ? "Chosen"
                              : multi
                                ? "Add to basket"
                                : "Choose this lodge"}
                        </button>
                      </>
                    ) : (
                      <p className="max-w-[180px] text-sm font-medium text-foreground/50">
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
    </div>
  );
}
