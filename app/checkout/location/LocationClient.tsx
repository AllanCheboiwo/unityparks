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

/**
 * The Center Parcs-style location step, naive version: pick the exact lodge
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
    return <p className="mx-auto max-w-2xl px-5 py-20 text-center text-red-700">{error}</p>;
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

  /** Every lodge must have a decided choice, Center Parcs style. */
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
      <Stepper current="Location" />

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-8 lg:items-start">
        <div>
          <h1 className="font-display text-3xl text-forest">
            Choose where you&apos;d like to <em>stay</em>
          </h1>
          <p className="mt-1 text-sm text-foreground/60 max-w-xl">
            If you&apos;d like to pick the exact lodge for your stay, take a look
            at the village map and choose from the lodges still free for your
            dates. Or just select no preference and let us pick for you.
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
                    className={`rounded-lg px-4 py-2 text-sm font-semibold ring-1 transition ${
                      isActive
                        ? "bg-forest text-white ring-forest"
                        : "text-forest ring-forest/25 hover:bg-sand"
                    }`}
                  >
                    Lodge {l.slot + 1}
                    {decided && (
                      <span
                        className={`ml-2 rounded-full px-1.5 text-[11px] ${
                          isActive ? "bg-white/25" : "bg-forest/10"
                        }`}
                      >
                        ✓
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* The village map */}
          <div className="mt-6 rounded-2xl bg-white ring-1 ring-forest/10 shadow-sm overflow-hidden">
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
            <div className="mt-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
              {error}
            </div>
          )}

          {staleBySlot[activeSlot] && (
            <div className="mt-4 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">
              {staleBySlot[activeSlot]} is no longer available for your dates.
              Pick another lodge below, or choose no preference.
            </div>
          )}

          {/* The two options */}
          <div className="mt-6 grid gap-4">
            <label
              className={`rounded-xl bg-white p-5 ring-1 transition-shadow ${
                activeChoice?.kind === "unit"
                  ? "ring-2 ring-forest shadow-md"
                  : "ring-forest/10 shadow-sm"
              } ${canPickUnit ? "cursor-pointer" : "opacity-60"}`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="radio"
                  name={`location-${activeSlot}`}
                  checked={activeChoice?.kind === "unit"}
                  disabled={!canPickUnit}
                  onChange={() => setChoice(activeSlot, { kind: "unit", unitId: null })}
                  className="mt-1 accent-[#1e3a29]"
                />
                <div className="flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="font-display text-lg text-forest">Select lodge number</p>
                    {activeOffers?.fee && (
                      <p className="font-semibold text-forest shrink-0">
                        {formatKes(activeOffers.fee.amount)}
                      </p>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-foreground/70 max-w-md">
                    {canPickUnit
                      ? `Pick the exact ${activeTierName ?? "lodge"} you'll stay in, straight from live availability.`
                      : activeOffers && activeUnits.length === 0
                        ? `Every ${activeTierName ?? "lodge"} is spoken for on these dates, so we'll pick a great spot for you.`
                        : "Lodge selection isn't available right now."}
                  </p>
                  {activeChoice?.kind === "unit" && canPickUnit && (
                    <select
                      value={activeChoice.unitId ?? ""}
                      onChange={(e) =>
                        setChoice(activeSlot, { kind: "unit", unitId: e.target.value || null })
                      }
                      className="mt-3 w-full max-w-sm rounded-lg ring-1 ring-forest/25 border-0 bg-white px-3 py-2.5 text-sm text-forest focus:outline-none focus-visible:ring-2 focus-visible:ring-forest/50"
                    >
                      <option value="">Please select from available lodges</option>
                      {activeUnits.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            </label>

            <label
              className={`rounded-xl bg-white p-5 ring-1 transition-shadow cursor-pointer ${
                activeChoice?.kind === "none"
                  ? "ring-2 ring-forest shadow-md"
                  : "ring-forest/10 shadow-sm"
              }`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="radio"
                  name={`location-${activeSlot}`}
                  checked={activeChoice?.kind === "none"}
                  onChange={() => setChoice(activeSlot, { kind: "none" })}
                  className="mt-1 accent-[#1e3a29]"
                />
                <div>
                  <p className="font-display text-lg text-forest">
                    No preference <span className="text-sm text-foreground/55">(free of charge)</span>
                  </p>
                  <p className="mt-1 text-sm text-foreground/70 max-w-md">
                    We&apos;ll pick your lodge for you and tell you the number on
                    your booking confirmation.
                  </p>
                </div>
              </div>
            </label>
          </div>

          <div className="mt-6 flex justify-end">
            <button
              onClick={continueToExtras}
              disabled={busy || !allDecided}
              className="rounded-lg bg-forest text-white px-8 py-2.5 text-sm font-semibold hover:bg-forest-light disabled:opacity-40"
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

        <aside className="mt-8 lg:mt-0 lg:sticky lg:top-20">
          <BookingSummary summary={session} locationOverrideBySlot={locationOverrideBySlot} />
        </aside>
      </div>
    </div>
  );
}
