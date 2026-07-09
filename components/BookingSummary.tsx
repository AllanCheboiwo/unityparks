"use client";

import { formatDate, formatKes } from "@/lib/format";
import { LODGES } from "@/content/lodges";
import type { ExtraSnapshotDto, SessionSummary } from "@/lib/types";

/**
 * The persistent right-rail summary shown through the whole checkout, Center
 * Parcs style. One block per lodge (name, party, price, its extras) over a
 * dark booking-total bar. Pure props, no fetching. The extras step passes its
 * in-progress selection per lodge as extrasOverrideBySlot so the numbers move
 * as items are added.
 */
export function BookingSummary({
  summary,
  extrasOverrideBySlot,
}: {
  summary: SessionSummary;
  extrasOverrideBySlot?: Record<number, ExtraSnapshotDto[]>;
}) {
  const lodges = summary.lodges;
  const multi = lodges.length > 1;

  const extrasFor = (slot: number, saved: ExtraSnapshotDto[]) =>
    extrasOverrideBySlot?.[slot] ?? saved;

  const total = lodges.reduce((sum, l) => {
    const extras = extrasFor(l.slot, l.extras).reduce((a, e) => a + e.grossAmount, 0);
    return sum + (l.lodge?.stayGrossAmount ?? 0) + extras;
  }, 0);

  const sectionHeader =
    "flex items-center justify-between px-4 py-3 text-sm font-semibold text-forest bg-forest/5";

  return (
    <div className="rounded-2xl bg-white ring-1 ring-forest/10 shadow-sm overflow-hidden">
      <p className="px-4 py-3 font-display text-lg text-forest">Your booking summary</p>

      {/* Shared trip facts */}
      <div className="px-4 py-3 text-sm border-b border-forest/10">
        <p className="text-xs uppercase tracking-wide text-foreground/50">Location</p>
        <p className="text-foreground/80">Naivasha</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-foreground/50">Check in</p>
            <p className="text-foreground/80">{formatDate(summary.arrival)}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-foreground/50">Check out</p>
            <p className="text-foreground/80">{formatDate(summary.departure)}</p>
          </div>
        </div>
      </div>

      {lodges.map((l) => {
        const lodge = l.lodge ? LODGES[l.lodge.unitGroupCode] : null;
        const extras = extrasFor(l.slot, l.extras);
        return (
          <div key={l.slot}>
            <div className={sectionHeader}>
              <span>{multi ? `Lodge ${l.slot + 1}` : "Accommodation"}</span>
              <span>{formatKes(l.lodge?.stayGrossAmount ?? 0)}</span>
            </div>
            <div className="px-4 py-3 text-sm border-b border-forest/10">
              <p className="text-foreground/80 font-medium">{lodge?.name ?? "Lodge not chosen"}</p>
              <p className="text-xs text-foreground/55 mt-0.5">{l.partyLabel}</p>
              {extras.length > 0 && (
                <div className="mt-2 pt-2 border-t border-forest/10">
                  {extras.map((e) => (
                    <div key={e.serviceId} className="flex justify-between gap-3 mt-1 first:mt-0">
                      <span className="text-foreground/80">
                        {e.count > 1 ? `${e.count} ` : ""}
                        {e.name}
                      </span>
                      <span className="font-medium shrink-0">{formatKes(e.grossAmount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}

      <div className="flex items-center justify-between px-4 py-3.5 bg-forest text-white">
        <span className="font-semibold">Booking total</span>
        <span className="font-display text-lg">{formatKes(total)}</span>
      </div>
    </div>
  );
}
