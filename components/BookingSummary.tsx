"use client";

import { Fragment, useState } from "react";
import { formatDate, formatKes } from "@/lib/format";
import { LODGES } from "@/content/lodges";
import { VILLAGE_NAME } from "@/content/village";
import type { ExtraSnapshotDto, SessionSummary } from "@/lib/types";

/** A lodge's location line as the rail shows it: the picked unit plus fee,
 *  or the placed-together fee (no unit until checkout seats the group). */
export type LocationLine =
  | { kind: "unit"; unitName: string; fee: number }
  | { kind: "together"; fee: number }
  | null;

/**
 * The persistent right-rail summary shown through the whole checkout, Center
 * Parcs style. A "Your booking summary" panel over a shared facts strip
 * (village + dates), then per lodge a collapsible "Accommodation" section and,
 * when it has any, a "Little extras" section - each with a right-aligned
 * subtotal - closing on a dark "Booking total" bar that stays in view.
 *
 * Pure props, no fetching. The extras step passes its in-progress selection per
 * lodge as extrasOverrideBySlot so the numbers move as items are added; the
 * location step does the same with locationOverrideBySlot. Section subtotals
 * and the grand total are all derived from those overrides, so the rail updates
 * live as the guest edits.
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
  const [panelOpen, setPanelOpen] = useState(true);

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
    if (l.location?.choice === "unit" && l.location.unitName && l.location.fee != null) {
      return { kind: "unit", unitName: l.location.unitName, fee: l.location.fee };
    }
    if (l.location?.choice === "together" && l.location.fee != null) {
      return { kind: "together", fee: l.location.fee };
    }
    return null;
  };

  const grossTotal = lodges.reduce((sum, l) => {
    const extras = extrasFor(l.slot, l.extras).reduce((a, e) => a + e.grossAmount, 0);
    return sum + (l.lodge?.stayGrossAmount ?? 0) + extras + (locationFor(l)?.fee ?? 0);
  }, 0);
  // Advisory, like every number here: the folio is the money truth, these
  // rows keep the rail honest with what checkout will collect.
  const referralDiscount = summary.referral?.discount ?? 0;
  const creditApplied = summary.credit?.amount ?? 0;
  const total = Math.max(0, grossTotal - referralDiscount - creditApplied);

  const row = "flex justify-between gap-3";
  const label = "text-foreground/60";
  const value = "font-semibold text-ink text-right";

  return (
    <div className="rounded-lg bg-white border border-line overflow-hidden text-sm">
      {/* Collapsible panel header */}
      <button
        type="button"
        onClick={() => setPanelOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-mist text-left"
      >
        <span className="font-display font-bold text-olive">Your booking summary</span>
        <Chevron open={panelOpen} />
      </button>

      {panelOpen && (
        <>
          {/* Shared trip facts (one break, one set of dates) */}
          <div className="px-4 py-3 grid gap-1.5 border-b border-line">
            <div className={row}>
              <span className={label}>Village</span>
              <span className={value}>{VILLAGE_NAME}</span>
            </div>
            <div className={row}>
              <span className={label}>Check In</span>
              <span className={value}>{formatDate(summary.arrival)}</span>
            </div>
            <div className={row}>
              <span className={label}>Check Out</span>
              <span className={value}>{formatDate(summary.departure)}</span>
            </div>
          </div>

          {lodges.map((l) => {
            const lodge = l.lodge ? LODGES[l.lodge.unitGroupCode] : null;
            const stay = l.lodge?.stayGrossAmount ?? 0;
            const location = locationFor(l);
            const extras = extrasFor(l.slot, l.extras);
            const extrasTotal = extras.reduce((a, e) => a + e.grossAmount, 0);
            return (
              <Fragment key={l.slot}>
                <Section
                  title={multi ? `Lodge ${l.slot + 1}` : "Accommodation"}
                  amount={stay + (location?.fee ?? 0)}
                >
                  <div className={row}>
                    <span className="font-semibold text-ink">
                      {lodge?.name ?? "Lodge not chosen"}
                    </span>
                    <span className={value}>{formatKes(stay)}</span>
                  </div>
                  {location && (
                    <div className={row}>
                      <span className={label}>
                        {location.kind === "unit"
                          ? `Lodge choice: ${location.unitName}`
                          : "Lodges placed together"}
                      </span>
                      <span className={value}>{formatKes(location.fee)}</span>
                    </div>
                  )}
                  <p className={label}>{l.partyLabel}</p>
                </Section>

                {extras.length > 0 && (
                  <Section title="Little extras" amount={extrasTotal}>
                    {extras.map((e) => (
                      <div key={e.serviceId} className={row}>
                        <span className={label}>
                          {e.count > 1 ? `${e.count} x ` : ""}
                          {e.name}
                        </span>
                        <span className={value}>{formatKes(e.grossAmount)}</span>
                      </div>
                    ))}
                  </Section>
                )}
              </Fragment>
            );
          })}

          {(referralDiscount > 0 || creditApplied > 0) && (
            <div className="px-4 py-3 grid gap-1.5 border-b border-line">
              {referralDiscount > 0 && (
                <div className={row}>
                  <span className={label}>
                    Referral discount{summary.referral ? ` (${summary.referral.code})` : ""}
                  </span>
                  <span className={value}>-{formatKes(referralDiscount)}</span>
                </div>
              )}
              {creditApplied > 0 && (
                <div className={row}>
                  <span className={label}>Referral credit applied</span>
                  <span className={value}>-{formatKes(creditApplied)}</span>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Booking total, always in view */}
      <div className="flex items-center justify-between px-4 py-3.5 bg-navy text-white">
        <span className="text-base font-bold">Booking total</span>
        <span className="text-base font-bold">{formatKes(total)}</span>
      </div>
    </div>
  );
}

/** A collapsible summary section: bold olive title on the left, right-aligned
 *  subtotal, chevron, and a body that folds away. Open by default. */
function Section({
  title,
  amount,
  children,
}: {
  title: string;
  amount: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border-b border-line">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="font-display font-bold text-olive">{title}</span>
        <span className="flex items-center gap-2">
          <span className="font-semibold text-ink">{formatKes(amount)}</span>
          <Chevron open={open} />
        </span>
      </button>
      {open && <div className="px-4 pb-3 grid gap-1.5">{children}</div>}
    </div>
  );
}

/** Down-chevron when open, rotated to point right when closed. */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 12 12"
      className={`w-3 h-3 text-olive transition-transform ${open ? "" : "-rotate-90"}`}
      fill="none"
      aria-hidden
    >
      <path
        d="M2 4.5 6 8l4-3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
