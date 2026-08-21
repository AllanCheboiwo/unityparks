"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, isExpired } from "@/lib/api";
import { formatKes } from "@/lib/format";
import { planTogether } from "@/lib/placement";
import { LODGES } from "@/content/lodges";
import { LANES, ZONES, laneOf, type ZoneId } from "@/content/village";
import type { LocationOffersDto, SessionSummary } from "@/lib/types";
import { Stepper } from "@/components/Stepper";
import { BookingSummary, type LocationLine } from "@/components/BookingSummary";
import { ExpiredNotice } from "@/components/ExpiredNotice";
import { VillageMap } from "@/components/VillageMap";
import { CheckoutBreadcrumb } from "../Breadcrumb";
import { AlertIcon, TickIcon } from "../icons";

/**
 * The location step: choose a corner of the village (a zone), then the
 * exact lodge in it for a flat fee (from live Apaleo unit availability), or
 * "no preference" free of charge. The zone is parsed off each unit's lane
 * name ("Fig Lane 3"), so on data that predates the Mount Kenya migration
 * the step quietly falls back to the flat all-lodges list it always had.
 * Zone choice is navigation, never charged and never saved; the unit is the
 * choice. It is saved per lodge on the session; the actual unit assignment
 * happens at checkout, where a lost race falls back to a comparable lodge
 * with the fee removed.
 *
 * Multi-lodge breaks choose a placement mode first: exact picks per lodge
 * (the flow above), the paid "place our lodges together" option, or no
 * preference, the latter two applied to every lodge at once.
 */

/** One slot's in-progress choice. unitId stays null until picked. */
type Choice = { kind: "unit"; unitId: string | null } | { kind: "none" } | null;

/** How a multi-lodge break places itself. Single-lodge breaks are always "exact". */
type Mode = "exact" | "together" | "none";

export function LocationClient() {
  const router = useRouter();
  const sessionId = useSearchParams().get("session");
  const [session, setSession] = useState<SessionSummary | null>(null);
  const [offersBySlot, setOffersBySlot] = useState<Record<number, LocationOffersDto>>({});
  const [choiceBySlot, setChoiceBySlot] = useState<Record<number, Choice>>({});
  // Slots whose previously saved unit no longer exists in live availability;
  // holds the lost unit's name for the notice.
  const [staleBySlot, setStaleBySlot] = useState<Record<number, string>>({});
  // The zone filter per slot: pure navigation, never charged, never saved.
  const [zoneBySlot, setZoneBySlot] = useState<Record<number, ZoneId | null>>({});
  const [mode, setMode] = useState<Mode>("exact");
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
        } else if (saved.choice === "together") {
          // The mode carries "together" (restored below); no per-slot pick.
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
      // Restored unit choices pre-select their zone so the grid opens where
      // the guest left off.
      const zones: Record<number, ZoneId | null> = {};
      for (const l of summary.lodges) {
        const c = choices[l.slot];
        const unit =
          c?.kind === "unit" && c.unitId
            ? offers[l.slot]?.units.find((u) => u.id === c.unitId)
            : undefined;
        zones[l.slot] = unit ? (laneOf(unit.name)?.zone ?? null) : null;
      }
      // Restore the placement mode: any exact pick wins, a break saved as
      // all-together or all-none reopens on that card, anything else (mixed,
      // partial, nothing saved) starts on exact with nothing chosen.
      if (summary.lodges.length > 1) {
        const kinds = summary.lodges.map((l) => l.location?.choice ?? null);
        if (kinds.every((k) => k === "together")) {
          // A saved together break that is no longer seatable (availability
          // moved under it) falls back to exact, so the guest is never left
          // on a mode the page has stopped offering.
          const pools = summary.lodges.map((l) => offers[l.slot]?.units ?? []);
          const seatable =
            pools.every((u) => u.length > 0) && planTogether(pools)?.adjacent === true;
          setMode(seatable ? "together" : "exact");
        } else if (kinds.every((k) => k === "none")) setMode("none");
        else setMode("exact");
      }
      setOffersBySlot(offers);
      setChoiceBySlot(choices);
      setStaleBySlot(stale);
      setZoneBySlot(zones);
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
  // Together and no-preference speak for every lodge, so the per-lodge
  // picker only renders in exact mode (single-lodge breaks have no modes).
  const pickerShown = !multi || mode === "exact";
  // The per-lodge fee is the same LOCATION service everywhere; the together
  // card quotes the first slot that has one priced.
  const togetherFee =
    session.lodges.map((l) => offersBySlot[l.slot]?.fee).find((f) => f != null) ?? null;
  // Only offer placing-together when neighbouring doors are actually free
  // for these tiers today, so the fee is never sold against a break that
  // checkout would only refund.
  const togetherPossible =
    multi &&
    session.lodges.every((l) => (offersBySlot[l.slot]?.units.length ?? 0) > 0) &&
    planTogether(session.lodges.map((l) => offersBySlot[l.slot]!.units))?.adjacent === true;
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

  // Zones exist only where lane names do, that is, after the Apaleo
  // migration has renamed the units. Anything unrecognisable keeps the flat
  // list, so pre-migration data degrades to exactly the old behaviour.
  const zonesActive = activeUnits.some((u) => laneOf(u.name) !== null);
  const availableZoneIds = new Set<ZoneId>(
    activeUnits
      .map((u) => laneOf(u.name)?.zone)
      .filter((z): z is ZoneId => Boolean(z)),
  );
  const activeZone = zoneBySlot[activeSlot] ?? null;
  const shownUnits =
    zonesActive && activeZone
      ? activeUnits.filter((u) => laneOf(u.name)?.zone === activeZone)
      : activeUnits;
  const lanesToShow = LANES.filter(
    (lane) =>
      (!activeZone || lane.zone === activeZone) &&
      shownUnits.some((u) => u.name.startsWith(`${lane.name} `)),
  );
  // Mid-migration oddity: units whose names match no lane while others do.
  const unplacedUnits = shownUnits.filter((u) => !laneOf(u.name));

  function setZone(slot: number, zone: ZoneId | null) {
    setZoneBySlot((prev) => ({ ...prev, [slot]: zone }));
  }

  function setChoice(slot: number, choice: Choice) {
    setChoiceBySlot((prev) => ({ ...prev, [slot]: choice }));
  }

  /** Every lodge must have a decided choice before continuing; the together
   *  and no-preference modes decide for the whole break at once. */
  const allDecided =
    (multi && mode !== "exact") ||
    session.lodges.every((l) => {
      const c = choiceBySlot[l.slot];
      return c && (c.kind === "none" || c.unitId);
    });

  // Live fee preview for the right rail while choices are still unsaved.
  const locationOverrideBySlot: Record<number, LocationLine> = {};
  for (const l of session.lodges) {
    const offers = offersBySlot[l.slot];
    if (multi && mode !== "exact") {
      locationOverrideBySlot[l.slot] =
        mode === "together" && offers?.fee
          ? { kind: "together", fee: offers.fee.amount }
          : null;
      continue;
    }
    const c = choiceBySlot[l.slot];
    if (c?.kind === "unit" && c.unitId && offers?.fee) {
      const unit = offers.units.find((u) => u.id === c.unitId);
      locationOverrideBySlot[l.slot] = unit
        ? { kind: "unit", unitName: unit.name, fee: offers.fee.amount }
        : null;
    } else {
      locationOverrideBySlot[l.slot] = null;
    }
  }

  async function continueToExtras() {
    setBusy(true);
    setError(null);
    // Save each lodge's choice; the server derives name, service and fee
    // from Apaleo, so the body only says which unit (or that the break goes
    // together). Never downgrade a unit choice to no-preference silently:
    // allDecided gates this function, and a race the server catches (unit
    // just taken) surfaces as its error.
    for (const l of session!.lodges) {
      let body: { slot: number; choice: string; unitId?: string };
      if (multi && mode !== "exact") {
        body = { slot: l.slot, choice: mode };
      } else {
        const c = choiceBySlot[l.slot];
        if (!c) continue;
        body =
          c.kind === "unit" && c.unitId
            ? { slot: l.slot, choice: "unit", unitId: c.unitId }
            : { slot: l.slot, choice: "none" };
      }
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

  function renderModeCard(card: {
    value: Mode;
    title: string;
    copy: string;
    price?: string;
    free?: boolean;
  }) {
    const selected = mode === card.value;
    return (
      <button
        type="button"
        onClick={() => setMode(card.value)}
        aria-pressed={selected}
        className={`flex flex-col rounded-lg px-4 py-3.5 text-left transition border ${
          selected
            ? "border-navy ring-1 ring-navy bg-navy/5"
            : "border-line bg-white hover:border-navy/40"
        }`}
      >
        <span className="flex items-center gap-2">
          {selected && <TickIcon className="w-4 h-4 shrink-0 text-navy" />}
          <span className="font-semibold text-navy">{card.title}</span>
        </span>
        <span className="mt-1 text-sm text-foreground/70">{card.copy}</span>
        {card.price && (
          <span className={`mt-auto pt-2 font-bold ${card.free ? "text-leaf" : "text-ink"}`}>
            {card.price}
          </span>
        )}
      </button>
    );
  }

  function renderUnitButton(u: { id: string; name: string }) {
    const selected = activeChoice?.kind === "unit" && activeChoice.unitId === u.id;
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
  }

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
            Fancy waking up on Sunrise Ridge, or being three minutes from the
            Water Garden in The Glades? Pick your corner of the village and
            the exact lodge for your dates, or leave it with us and
            we&apos;ll choose a lovely one for you.
            {multi && " Choose below how we place the lodges in your break."}
          </p>

          {/* Placement mode: exact picks, placed together, or no preference */}
          {multi && (
            <>
              <h2 className="mt-6 text-xl font-bold text-ink">
                How should we place your lodges?
              </h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                {renderModeCard({
                  value: "exact",
                  title: "Pick your exact lodges",
                  copy: "Choose a corner of the village and the exact lodge for each part of your break.",
                })}
                {togetherPossible ? (
                  renderModeCard({
                    value: "together",
                    title: "Place our lodges together",
                    copy: "We'll pick neighbouring lodges for you. If we can't manage it for your dates, we remove the fee and still place you close.",
                    price: togetherFee ? `${formatKes(togetherFee.amount)} per lodge` : undefined,
                  })
                ) : (
                  <div className="flex flex-col rounded-lg border border-line bg-mist px-4 py-3.5 text-left">
                    <span className="font-semibold text-foreground/50">
                      Place our lodges together
                    </span>
                    <span className="mt-1 text-sm text-foreground/50">
                      No neighbouring lodges of your grades are free on these
                      dates, so we can&apos;t promise it this time.
                    </span>
                  </div>
                )}
                {renderModeCard({
                  value: "none",
                  title: "No preference",
                  copy: "We'll pick your lodges for you and tell you the numbers on your booking confirmation.",
                  price: "Free",
                  free: true,
                })}
              </div>
            </>
          )}

          {/* Per-lodge switcher */}
          {multi && pickerShown && (
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

          {/* The village map: zones are clickable once lane names exist */}
          {pickerShown && (
            <div className="mt-6 rounded-lg bg-white border border-line overflow-hidden">
              <VillageMap
                selectedZone={zonesActive ? activeZone : null}
                availableZones={zonesActive ? availableZoneIds : undefined}
                onSelectZone={
                  zonesActive && canPickUnit
                    ? (zone) => setZone(activeSlot, activeZone === zone ? null : zone)
                    : undefined
                }
              />
            </div>
          )}

          {/* Zone choice, ahead of the exact lodge. Free: the fee belongs
              to picking an exact lodge, never to picking a corner. */}
          {pickerShown && zonesActive && canPickUnit && (
            <>
              <h2 className="mt-6 text-xl font-bold text-ink">
                Choose your corner of the village
              </h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {ZONES.map((zone) => {
                  const hasUnits = availableZoneIds.has(zone.id);
                  const selected = activeZone === zone.id;
                  const note = hasUnits
                    ? zone.suits
                    : zone.live
                      ? "No free lodges on these dates"
                      : "Opens with a later phase of the village";
                  return (
                    <button
                      key={zone.id}
                      type="button"
                      disabled={!hasUnits}
                      onClick={() => setZone(activeSlot, selected ? null : zone.id)}
                      aria-pressed={selected}
                      className={`flex flex-col rounded-lg px-4 py-3 text-left transition border ${
                        selected
                          ? "border-navy ring-1 ring-navy bg-navy/5"
                          : hasUnits
                            ? "border-line bg-white hover:border-navy/40"
                            : "border-line bg-mist/60 opacity-60 cursor-not-allowed"
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        {selected && <TickIcon className="w-4 h-4 shrink-0 text-navy" />}
                        <span className="font-semibold text-navy">{zone.name}</span>
                      </span>
                      <span className="mt-1 text-sm text-foreground/70">{zone.character}</span>
                      <span className="mt-1 text-xs font-semibold text-foreground/50">{note}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {error && (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-[#b3261e]/30 bg-[#b3261e]/5 px-4 py-3 text-sm text-[#b3261e]">
              <AlertIcon />
              <span>{error}</span>
            </div>
          )}

          {pickerShown && staleBySlot[activeSlot] && (
            <div className="mt-4 rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">
              {staleBySlot[activeSlot]} is no longer available for your dates.
              Pick another lodge below, or choose no preference.
            </div>
          )}

          {/* Pick an exact lodge */}
          {pickerShown && (
            <>
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

              {canPickUnit && !zonesActive && (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {activeUnits.map((u) => renderUnitButton(u))}
                </div>
              )}

              {canPickUnit && zonesActive && (
                <div className="mt-4 grid gap-5">
                  {lanesToShow.map((lane) => (
                    <div key={lane.name}>
                      <h3 className="text-sm font-bold text-ink">
                        {lane.name}
                        {!activeZone && (
                          <span className="ml-2 font-semibold text-foreground/50">
                            {ZONES.find((z) => z.id === lane.zone)?.name}
                          </span>
                        )}
                      </h3>
                      <div className="mt-2 grid gap-3 sm:grid-cols-2">
                        {shownUnits
                          .filter((u) => u.name.startsWith(`${lane.name} `))
                          .map((u) => renderUnitButton(u))}
                      </div>
                    </div>
                  ))}
                  {unplacedUnits.length > 0 && (
                    <div>
                      {lanesToShow.length > 0 && (
                        <h3 className="text-sm font-bold text-ink">More lodges</h3>
                      )}
                      <div className="mt-2 grid gap-3 sm:grid-cols-2">
                        {unplacedUnits.map((u) => renderUnitButton(u))}
                      </div>
                    </div>
                  )}
                  {lanesToShow.length === 0 && unplacedUnits.length === 0 && (
                    <p className="text-sm text-foreground/60">
                      No free {activeTierName ?? "lodges"} in{" "}
                      {ZONES.find((z) => z.id === activeZone)?.name ?? "that corner"} for
                      these dates. Pick another corner of the village, or leave it
                      with us.
                    </p>
                  )}
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
            </>
          )}

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
