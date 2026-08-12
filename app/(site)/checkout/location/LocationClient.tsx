"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, isExpired } from "@/lib/api";
import { formatKes } from "@/lib/format";
import { LODGES } from "@/content/lodges";
import type { LocationOffersDto, SessionSummary } from "@/lib/types";
import { Stepper } from "@/components/Stepper";
import { BookingSummary } from "@/components/BookingSummary";
import { ExpiredNotice } from "@/components/ExpiredNotice";
import { CheckoutBreadcrumb } from "../Breadcrumb";
import { AlertIcon, TickIcon } from "../icons";

/**
 * The location step, naive version: pick the exact lodge
 * you'll stay in for a flat fee (from live Apaleo unit availability), or "no
 * preference" free of charge. The choice is saved per lodge on the session;
 * the actual unit assignment happens at checkout, where a lost race falls
 * back to a comparable lodge with the fee removed.
 */

/** One slot's in-progress choice. unitId stays null until picked. */
type Choice = { kind: "unit"; unitId: string | null } | { kind: "none" } | null;

export function LocationClient() {
  const router = useRouter();
  const sessionId = useSearchParams().get("session");
  const [session, setSession] = useState<SessionSummary | null>(null);
  const [offersBySlot, setOffersBySlot] = useState<Record<number, LocationOffersDto>>({});
  const [choiceBySlot, setChoiceBySlot] = useState<Record<number, Choice>>({});
  // Slots whose previously saved unit no longer exists in live availability;
  // holds the lost unit's name for the notice.
  const [staleBySlot, setStaleBySlot] = useState<Record<number, string>>({});
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
      // One availability read per lodge, each scoped to that lodge's tier.
      const results = await Promise.all(
        summary.lodges.map((l) =>
          apiFetch<LocationOffersDto>(`/api/session/${sessionId}/location?slot=${l.slot}`),
        ),
      );
      const offers: Record<number, LocationOffersDto> = {};
      const choices: Record<number, Choice> = {};
      const stale: Record<number, string> = {};
      results.forEach((r, i) => {
        const lodge = summary.lodges[i];
        if (r.ok) offers[lodge.slot] = r.data;
        // Restore a previously saved choice - but a saved unit that has
        // dropped out of live availability (taken by another guest between
        // visits, or the offers fetch failed) must NOT ride along silently:
        // clear it so Continue blocks until the guest re-picks, and say why.
        const saved = lodge.location;
        if (!saved) {
          choices[lodge.slot] = null;
        } else if (saved.choice !== "unit") {
          choices[lodge.slot] = { kind: "none" };
        } else {
          const stillOffered =
            r.ok && r.data.fee && r.data.units.some((u) => u.id === saved.unitId);
          if (stillOffered) {
            choices[lodge.slot] = { kind: "unit", unitId: saved.unitId };
          } else {
            choices[lodge.slot] = null;
            if (saved.unitName) stale[lodge.slot] = saved.unitName;
          }
        }
      });
      setOffersBySlot(offers);
      setChoiceBySlot(choices);
      setStaleBySlot(stale);
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
        Checking which lodges are free…
      </p>
    );
  }

  const multi = session.lodges.length > 1;
  const activeOffers = offersBySlot[activeSlot];
  const activeChoice = choiceBySlot[activeSlot] ?? null;
  const activeTier = session.lodges.find((l) => l.slot === activeSlot)?.lodge;
  const activeTierName = activeTier ? LODGES[activeTier.unitGroupCode]?.name : null;

  // A unit picked for one lodge is off the menu for the others.
  function takenByOtherSlots(slot: number): Set<string> {
    const taken = new Set<string>();
    for (const [s, c] of Object.entries(choiceBySlot)) {
      if (Number(s) !== slot && c?.kind === "unit" && c.unitId) taken.add(c.unitId);
    }
    return taken;
  }

  const activeUnits = (activeOffers?.units ?? []).filter(
    (u) => !takenByOtherSlots(activeSlot).has(u.id),
  );

  function setChoice(slot: number, choice: Choice) {
    setChoiceBySlot((prev) => ({ ...prev, [slot]: choice }));
  }

  /** Every lodge must have a decided choice before continuing. */
  const allDecided = session.lodges.every((l) => {
    const c = choiceBySlot[l.slot];
    return c && (c.kind === "none" || c.unitId);
  });

  // Live fee preview for the right rail while choices are still unsaved.
  const locationOverrideBySlot: Record<number, { unitName: string; fee: number } | null> = {};
  for (const l of session.lodges) {
    const c = choiceBySlot[l.slot];
    const offers = offersBySlot[l.slot];
    if (c?.kind === "unit" && c.unitId && offers?.fee) {
      const unit = offers.units.find((u) => u.id === c.unitId);
      locationOverrideBySlot[l.slot] = unit
        ? { unitName: unit.name, fee: offers.fee.amount }
        : null;
    } else {
      locationOverrideBySlot[l.slot] = null;
    }
  }

  async function continueToExtras() {
    setBusy(true);
    setError(null);
    // Save each lodge's choice; the server derives name, service and fee
    // from Apaleo, so the body only says which unit. Never downgrade a unit
    // choice to no-preference silently: allDecided gates this function, and
    // a race the server catches (unit just taken) surfaces as its error.
    for (const l of session!.lodges) {
      const c = choiceBySlot[l.slot];
      if (!c) continue;
      const body =
        c.kind === "unit" && c.unitId
          ? { slot: l.slot, choice: "unit", unitId: c.unitId }
          : { slot: l.slot, choice: "none" };
      const result = await apiFetch(`/api/session/${sessionId}/location`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (isExpired(result)) return setExpired(true);
      if (!result.ok) {
        setError(result.error);
        setBusy(false);
        return;
      }
    }
    router.push(`/checkout/extras?session=${sessionId}`);
  }

  const canPickUnit = Boolean(activeOffers?.fee) && activeUnits.length > 0;

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      <CheckoutBreadcrumb />
      <h1 className="font-display text-[34px] leading-tight font-bold text-ink mb-5">
        Choose where you&apos;ll stay
      </h1>
      <Stepper current="Location" />

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-8 lg:items-start">
        <div>
          <p className="text-sm text-foreground/70 max-w-xl">
            Fancy a favourite spot by the lake or a quiet corner of the forest?
            Take a look at the village map and pick the exact lodge for your
            dates, or leave it with us and we&apos;ll choose a lovely one for you.
            {multi && " Each lodge in your break chooses separately."}
          </p>

          {/* Per-lodge switcher */}
          {multi && (
            <div className="mt-5 flex flex-wrap gap-2">
              {session.lodges.map((l) => {
                const isActive = l.slot === activeSlot;
                const c = choiceBySlot[l.slot];
                const decided = c && (c.kind === "none" || c.unitId);
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
                    {decided && <TickIcon className="w-3.5 h-3.5" />}
                  </button>
                );
              })}
            </div>
          )}

          {/* The village map */}
          <div className="mt-6 rounded-lg bg-white border border-line overflow-hidden">
            <Image
              src="/village-map.svg"
              alt="Map of the Unity Parks Naivasha village showing the lodge areas"
              width={1200}
              height={640}
              className="w-full h-auto"
              priority
            />
          </div>

          {error && (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-[#b3261e]/30 bg-[#b3261e]/5 px-4 py-3 text-sm text-[#b3261e]">
              <AlertIcon />
              <span>{error}</span>
            </div>
          )}

          {staleBySlot[activeSlot] && (
            <div className="mt-4 rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">
              {staleBySlot[activeSlot]} is no longer available for your dates.
              Pick another lodge below, or choose no preference.
            </div>
          )}

          {/* Pick an exact lodge */}
          <div className="mt-6 flex items-baseline justify-between gap-3">
            <h2 className="text-xl font-bold text-ink">Pick your exact lodge</h2>
            {activeOffers?.fee && canPickUnit && (
              <p className="text-sm text-foreground/60 shrink-0">
                {formatKes(activeOffers.fee.amount)} per lodge
              </p>
            )}
          </div>
          <p className="mt-1 text-sm text-foreground/70 max-w-xl">
            {canPickUnit
              ? `These ${activeTierName ?? "lodge"} spots are still free for your dates, straight from live availability.`
              : activeOffers && activeUnits.length === 0
                ? `Every ${activeTierName ?? "lodge"} is spoken for on these dates, so we'll pick a great spot for you.`
                : "Lodge selection isn't available right now."}
          </p>

          {canPickUnit && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {activeUnits.map((u) => {
                const selected =
                  activeChoice?.kind === "unit" && activeChoice.unitId === u.id;
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => setChoice(activeSlot, { kind: "unit", unitId: u.id })}
                    aria-pressed={selected}
                    className={`flex items-center justify-between gap-3 rounded-lg px-4 py-3.5 text-left transition ${
                      selected
                        ? "border border-navy ring-1 ring-navy bg-navy/5"
                        : "border border-line bg-white hover:border-navy/40"
                    }`}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      {selected && <TickIcon className="w-4 h-4 shrink-0 text-navy" />}
                      <span className="font-semibold text-navy truncate">{u.name}</span>
                    </span>
                    <span className="font-bold text-ink shrink-0">
                      {formatKes(activeOffers!.fee!.amount)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* No preference */}
          <button
            type="button"
            onClick={() => setChoice(activeSlot, { kind: "none" })}
            aria-pressed={activeChoice?.kind === "none"}
            className={`mt-4 w-full flex items-start justify-between gap-3 rounded-lg px-4 py-3.5 text-left transition ${
              activeChoice?.kind === "none"
                ? "border border-navy ring-1 ring-navy bg-navy/5"
                : "border border-line bg-white hover:border-navy/40"
            }`}
          >
            <span className="min-w-0">
              <span className="flex items-center gap-2">
                {activeChoice?.kind === "none" && (
                  <TickIcon className="w-4 h-4 shrink-0 text-navy" />
                )}
                <span className="font-semibold text-navy">No preference</span>
              </span>
              <span className="mt-1 block text-sm text-foreground/70">
                We&apos;ll pick your lodge for you and tell you the number on
                your booking confirmation.
              </span>
            </span>
            <span className="font-bold text-leaf shrink-0">Free</span>
          </button>

          <div className="mt-6 flex justify-end">
            <button
              onClick={continueToExtras}
              disabled={busy || !allDecided}
              className="btn-primary"
            >
              {busy ? "Saving…" : "Continue"}
            </button>
          </div>
          {!allDecided && (
            <p className="mt-2 text-right text-xs text-foreground/50">
              {multi
                ? "Choose an option for every lodge to continue."
                : "Choose an option to continue."}
            </p>
          )}
        </div>

        <aside className="mt-8 lg:mt-0 lg:sticky lg:top-6">
          <BookingSummary summary={session} locationOverrideBySlot={locationOverrideBySlot} />
        </aside>
      </div>
    </div>
  );
}
