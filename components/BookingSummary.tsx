"use client";

import { formatDate, formatKes } from "@/lib/format";
import { LODGES } from "@/content/lodges";
import type { ExtraSnapshotDto, SessionSummary } from "@/lib/types";

/** A lodge's location line as the rail shows it: picked unit plus fee. */
export type LocationLine = { unitName: string; fee: number } | null;

/**
 * The persistent right-rail summary shown through the whole checkout, Center
 * Parcs style. One block per lodge (name, party, price, location choice, its
 * extras) under a mist "Your break" header, closing on a bold total row.
 * Pure props, no fetching. The extras step passes its in-progress selection
 * per lodge as extrasOverrideBySlot so the numbers move as items are added;
 * the location step does the same with locationOverrideBySlot.
 */
export function BookingSummary({
  summary,
  extrasOverrideBySlot,
  locationOverrideBySlot,
}: {
  summary: SessionSummary;
  extrasOverrideBySlot?: Record<number, ExtraSnapshotDto[]>;
  locationOverrideBySlot?: Record<number, LocationLine>;
}) {
  const lodges = summary.lodges;
  const multi = lodges.length > 1;

  const extrasFor = (slot: number, saved: ExtraSnapshotDto[]) =>
    extrasOverrideBySlot?.[slot] ?? saved;

  // The location step passes a complete map (explicit null = no fee), so the
  // prop's presence decides, not the per-slot value. A saved choice whose fee
  // was dropped at checkout (fee null) shows no line: the confirmation's
  // notice tells that story, the running totals must not.
  const locationFor = (l: SessionSummary["lodges"][number]): LocationLine => {
    if (locationOverrideBySlot !== undefined) {
      return locationOverrideBySlot[l.slot] ?? null;
    }
    return l.location?.choice === "unit" && l.location.unitName && l.location.fee != null
      ? { unitName: l.location.unitName, fee: l.location.fee }
      : null;
  };

  const total = lodges.reduce((sum, l) => {
    const extras = extrasFor(l.slot, l.extras).reduce((a, e) => a + e.grossAmount, 0);
    return sum + (l.lodge?.stayGrossAmount ?? 0) + extras + (locationFor(l)?.fee ?? 0);
  }, 0);

  const row = "flex justify-between gap-3 text-sm";
  const label = "text-foreground/60";
  const value = "font-semibold text-ink text-right";

  return (
    <div className="rounded-lg bg-white border border-line overflow-hidden">
      {/* Mist header strip */}
      <p className="px-4 py-3 bg-mist font-display font-bold text-olive">Your break</p>

      {/* Shared trip facts */}
      <div className="px-4 py-3 grid gap-1.5 border-b border-line">
        <div className={row}>
          <span className={label}>Village</span>
          <span className={value}>Unity Parks Naivasha</span>
        </div>
        <div className={row}>
          <span className={label}>Check in</span>
          <span className={value}>{formatDate(summary.arrival)}</span>
        </div>
        <div className={row}>
          <span className={label}>Check out</span>
          <span className={value}>{formatDate(summary.departure)}</span>
        </div>
      </div>

      {lodges.map((l) => {
        const lodge = l.lodge ? LODGES[l.lodge.unitGroupCode] : null;
        const extras = extrasFor(l.slot, l.extras);
        const location = locationFor(l);
        return (
          <div key={l.slot} className="px-4 py-3 grid gap-1.5 border-b border-line">
            <div className={row}>
              <span className="font-semibold text-ink">
                {multi ? `Lodge ${l.slot + 1}: ` : ""}
                {lodge?.name ?? "Lodge not chosen"}
              </span>
              <span className={value}>{formatKes(l.lodge?.stayGrossAmount ?? 0)}</span>
            </div>
            <p className="text-sm text-foreground/60">{l.partyLabel}</p>
            {location && (
              <div className={row}>
                <span className={label}>Lodge choice: {location.unitName}</span>
                <span className={value}>{formatKes(location.fee)}</span>
              </div>
            )}
            {extras.map((e) => (
              <div key={e.serviceId} className={row}>
                <span className={label}>
                  {e.count > 1 ? `${e.count} x ` : ""}
                  {e.name}
                </span>
                <span className={value}>{formatKes(e.grossAmount)}</span>
              </div>
            ))}
          </div>
        );
      })}

      {/* Total row */}
      <div className="flex items-center justify-between px-4 py-3.5">
        <span className="text-lg font-bold text-ink">Total</span>
        <span className="text-lg font-bold text-ink">{formatKes(total)}</span>
      </div>
    </div>
  );
}
