"use client";

import { useState } from "react";
import { formatDate, formatKes } from "@/lib/format";
import { LODGES } from "@/content/lodges";
import type { ExtraSnapshotDto, SessionSummary } from "@/lib/types";

/**
 * The persistent right-rail summary shown through the whole checkout,
 * Center Parcs style: collapsible Accommodation and Little extras sections
 * over a dark booking-total bar. Pure props, no fetching: pages pass the
 * session summary they already load. The extras step passes its in-progress
 * selection as extrasOverride so the numbers move as items are added.
 */
export function BookingSummary({
  summary,
  extrasOverride,
}: {
  summary: SessionSummary;
  extrasOverride?: ExtraSnapshotDto[];
}) {
  const [stayOpen, setStayOpen] = useState(true);
  const [extrasOpen, setExtrasOpen] = useState(true);

  const lodge = summary.lodge ? LODGES[summary.lodge.unitGroupCode] : null;
  const stayAmount = summary.lodge?.stayGrossAmount ?? 0;
  const extras = extrasOverride ?? summary.extras;
  const extrasTotal = extras.reduce((sum, e) => sum + e.grossAmount, 0);
  const total = extrasOverride ? stayAmount + extrasTotal : (summary.total ?? stayAmount + extrasTotal);

  const sectionHeader =
    "w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-forest bg-forest/5";

  return (
    <div className="rounded-2xl bg-white ring-1 ring-forest/10 shadow-sm overflow-hidden">
      <p className="px-4 py-3 font-display text-lg text-forest">Your booking summary</p>

      <button type="button" onClick={() => setStayOpen((o) => !o)} className={sectionHeader}>
        <span>Accommodation</span>
        <span className="flex items-center gap-2">
          {formatKes(stayAmount)}
          <span aria-hidden className="text-foreground/40">{stayOpen ? "▴" : "▾"}</span>
        </span>
      </button>
      {stayOpen && (
        <div className="px-4 py-3 text-sm border-b border-forest/10">
          <p className="text-xs uppercase tracking-wide text-foreground/50">Location</p>
          <p className="text-foreground/80">Naivasha</p>
          <p className="mt-2 text-xs uppercase tracking-wide text-foreground/50">Accommodation</p>
          <p className="text-foreground/80">{lodge?.name ?? "Lodge"}</p>
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
          <p className="mt-2 text-xs uppercase tracking-wide text-foreground/50">Guests</p>
          <p className="text-foreground/80">
            {summary.partyLabel ?? `${summary.adults} ${summary.adults === 1 ? "adult" : "adults"}`}
          </p>
        </div>
      )}

      {extras.length > 0 && (
        <>
          <button type="button" onClick={() => setExtrasOpen((o) => !o)} className={sectionHeader}>
            <span>Little extras</span>
            <span className="flex items-center gap-2">
              {formatKes(extrasTotal)}
              <span aria-hidden className="text-foreground/40">{extrasOpen ? "▴" : "▾"}</span>
            </span>
          </button>
          {extrasOpen && (
            <div className="px-4 py-3 text-sm border-b border-forest/10">
              {extras.map((extra) => (
                <div key={extra.serviceId} className="flex justify-between gap-3 mt-1 first:mt-0">
                  <span className="text-foreground/80">
                    {extra.count > 1 ? `${extra.count} ` : ""}
                    {extra.name}
                  </span>
                  <span className="font-medium shrink-0">{formatKes(extra.grossAmount)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <div className="flex items-center justify-between px-4 py-3.5 bg-forest text-white">
        <span className="font-semibold">Booking total</span>
        <span className="font-display text-lg">{formatKes(total)}</span>
      </div>
    </div>
  );
}
