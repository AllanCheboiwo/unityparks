"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { formatDate, formatKes, formatShortDate } from "@/lib/format";
import { LOW_STOCK_THRESHOLD } from "@/lib/inventory";
import type {
  ActivitiesDto,
  ActivityResourceDto,
  AddExtrasResultDto,
  BookingConfirmation,
  ManageAdditionDto,
  ManageExtrasDto,
} from "@/lib/types";

/**
 * Activities on Manage my booking (UNP-6): bikes for the whole break and
 * spa sessions by day and start time, with real availability. The counts
 * come from our own inventory (a local read, loaded at once); prices come
 * from Apaleo's live offers, loaded when the guest opens the card. A
 * displayed count is a display, never a promise: the add is the moment of
 * truth, and a refusal there names the item and re-quotes.
 */

type Pick = { resource: ActivityResourceDto; date: string | null; qty: number };

function pickKey(slot: number, code: string, date: string | null): string {
  return `${slot}:${code}:${date ?? ""}`;
}

/** "three-hour" from the resource's own minutes, so the ops form is the
 *  source of truth for the copy too. */
function sessionLengthWords(activities: ActivitiesDto | null): string {
  const minutes = activities?.lodges[0]?.resources.find((r) => r.kind === "SESSION")?.sessionMinutes;
  if (!minutes) return "";
  const hours = minutes / 60;
  const words = ["", "one", "two", "three", "four", "five", "six"];
  return Number.isInteger(hours) && hours < words.length ? `${words[hours]}-hour` : `${minutes}-minute`;
}

function stockNote(free: number): string | null {
  if (free === 0) return "Sold out for your dates";
  if (free <= LOW_STOCK_THRESHOLD) return `${free} left for your dates`;
  return null;
}

export function ActivitiesCard({
  bookingId,
  proofQuery,
  booking,
  onChanged,
}: {
  bookingId: string;
  proofQuery: string;
  booking: BookingConfirmation;
  onChanged: () => Promise<void>;
}) {
  const [activities, setActivities] = useState<ActivitiesDto | null>(null);
  const [quote, setQuote] = useState<ManageExtrasDto | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [picks, setPicks] = useState<Record<string, Pick>>({});

  const multi = booking.lodges.length > 1;

  async function loadAvailability() {
    const result = await apiFetch<ActivitiesDto>(`/api/booking/${bookingId}/activities${proofQuery}`);
    if (result.ok) setActivities(result.data);
    else setError(result.error);
  }

  async function loadPrices() {
    setLoading(true);
    setError(null);
    const result = await apiFetch<ManageExtrasDto>(`/api/booking/${bookingId}/extras${proofQuery}`);
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setQuote(result.data);
  }

  useEffect(() => {
    // Same shape as ManageClient's initial load.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadAvailability();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId, proofQuery]);

  function setPick(slot: number, resource: ActivityResourceDto, date: string | null, qty: number) {
    setNotice(null);
    setPicks((prev) => {
      const next = { ...prev };
      const key = pickKey(slot, resource.code, date);
      if (qty <= 0) delete next[key];
      else next[key] = { resource, date, qty };
      return next;
    });
  }

  function priceOf(resource: ActivityResourceDto): number | null {
    return quote?.activityOffers[resource.apaleoServiceCode]?.unitPrice ?? null;
  }

  function slotTotal(slot: number): number {
    return Object.entries(picks)
      .filter(([key]) => key.startsWith(`${slot}:`))
      .reduce((sum, [, pick]) => sum + (priceOf(pick.resource) ?? 0) * pick.qty, 0);
  }

  const grandTotal = activities
    ? activities.lodges.reduce((sum, lodge) => sum + slotTotal(lodge.slot), 0)
    : 0;

  /** Another session already sits on this date for this lodge, owned or picked. */
  function dateTaken(slot: number, resources: ActivityResourceDto[], date: string, except: string): boolean {
    for (const resource of resources) {
      if (resource.kind !== "SESSION" || resource.code === except) continue;
      if (resource.sessions?.some((s) => s.date === date && s.owned > 0)) return true;
      if (picks[pickKey(slot, resource.code, date)]) return true;
    }
    return false;
  }

  async function submit() {
    if (!quote || !activities || grandTotal <= 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    let lastResult: AddExtrasResultDto | null = null;
    let charged = 0;

    for (const lodge of activities.lodges) {
      const additions: ManageAdditionDto[] = Object.entries(picks)
        .filter(([key]) => key.startsWith(`${lodge.slot}:`))
        .map(([, pick]) => {
          const offer = quote.activityOffers[pick.resource.apaleoServiceCode];
          return {
            serviceId: offer?.serviceId ?? "",
            count: pick.qty,
            resourceCode: pick.resource.code,
            date: pick.date ?? undefined,
          };
        });
      if (additions.length === 0) continue;

      const result = await apiFetch<AddExtrasResultDto>(
        `/api/booking/${bookingId}/extras${proofQuery}`,
        { method: "POST", body: JSON.stringify({ slot: lodge.slot, additions }) },
      );
      if (!result.ok) {
        setPicks({});
        if (lastResult) {
          setNotice(
            lastResult.kind === "charge_now"
              ? `Activities for an earlier lodge went through first: ${formatKes(charged)} was charged to your booking.`
              : `Activities for an earlier lodge went through first: ${formatKes(charged)} was added to your balance.`,
          );
        }
        await Promise.all([onChanged(), loadAvailability(), loadPrices()]);
        setError(result.error);
        setBusy(false);
        return;
      }
      lastResult = result.data;
      charged += result.data.amount;
    }

    setPicks({});
    if (lastResult) {
      setNotice(
        lastResult.kind === "charge_now"
          ? `Done. ${formatKes(charged)} was charged to your booking, which stays paid in full.`
          : `Done. ${formatKes(charged)} was added to your balance; the new amount still to pay is ${formatKes(
              Math.max(0, Math.round(lastResult.totalGrossAmount - lastResult.paidAmount)),
            )}.`,
      );
    }
    // Prices cannot have changed (the engine only settles when the folio
    // matched the quote), so only the local availability is re-read.
    await Promise.all([onChanged(), loadAvailability()]);
    setBusy(false);
  }

  const stepper = (
    slot: number,
    resource: ActivityResourceDto,
    date: string | null,
    max: number,
    label: string,
  ) => {
    const picked = picks[pickKey(slot, resource.code, date)]?.qty ?? 0;
    return (
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          aria-label={`Fewer ${label}`}
          disabled={busy || picked === 0}
          onClick={() => setPick(slot, resource, date, picked - 1)}
          className="h-8 w-8 rounded-full border border-line text-lg leading-none text-navy disabled:opacity-40"
        >
          −
        </button>
        <span role="status" className="w-5 text-center text-sm font-semibold text-ink">
          {picked}
        </span>
        <button
          type="button"
          aria-label={`More ${label}`}
          disabled={busy || picked >= max}
          onClick={() => setPick(slot, resource, date, picked + 1)}
          className="h-8 w-8 rounded-full border border-line text-lg leading-none text-navy disabled:opacity-40"
        >
          +
        </button>
      </div>
    );
  };

  return (
    <div className="mt-8 rounded-lg border border-line bg-white p-6">
      <p className="font-display text-xl font-bold text-ink">Activities</p>
      <p className="mt-1 text-sm text-foreground">
        Bikes for the whole of your break, and {sessionLengthWords(activities)} Forest
        Spa sessions by day and start time. Both are limited, so book early.{" "}
        {booking.status === "deposit_paid"
          ? "Anything you add joins your outstanding balance."
          : "Anything you add is charged to your booking straight away."}
      </p>

      {!open && (
        <button
          type="button"
          className="btn-primary mt-4"
          onClick={() => {
            setOpen(true);
            if (!quote) loadPrices();
          }}
        >
          Book activities
        </button>
      )}

      {open && (loading || !activities) && !error && (
        <p className="mt-4 text-sm text-foreground/60">Checking availability and prices…</p>
      )}

      {error && (
        <div className="mt-4 rounded-md border border-[#b3261e]/30 bg-red-50 px-4 py-3 text-sm text-[#b3261e]">
          {error}
          {open && !quote && !loading && (
            <button type="button" onClick={loadPrices} className="ml-3 font-semibold underline underline-offset-2">
              Try again
            </button>
          )}
        </div>
      )}

      {open && activities && quote && (
        <div className="mt-4 grid gap-6">
          {activities.lodges.map((lodge) => {
            const stock = lodge.resources.filter((r) => r.kind === "STOCK");
            const sessions = lodge.resources.filter((r) => r.kind === "SESSION");
            const spaWindow = sessions[0]?.window;
            return (
              <div key={lodge.slot}>
                {multi && (
                  <p className="mb-2 text-sm font-semibold text-navy">Lodge {lodge.slot + 1}</p>
                )}

                <div className="grid gap-2">
                  {stock.map((resource) => {
                    const price = priceOf(resource);
                    const free = resource.free ?? 0;
                    const max = Math.max(0, Math.min(resource.cap - resource.owned, free));
                    const note = stockNote(free);
                    return (
                      <div
                        key={resource.code}
                        className="flex items-center justify-between gap-3 rounded-lg border border-line p-3"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-ink">{resource.name}</p>
                          <p className="text-xs text-foreground/70">
                            {price !== null ? `${formatKes(price)} per bike, whole break` : "Price on request"}
                            {resource.owned > 0 && ` · you have ${resource.owned}`}
                            {resource.cap - resource.owned <= 0 && resource.owned > 0 && " · all riders covered"}
                          </p>
                          {note && (
                            <p className={`mt-1 text-xs font-semibold ${free === 0 ? "text-[#b3261e]" : "text-bronze"}`}>
                              {note}
                            </p>
                          )}
                        </div>
                        {resource.window.state === "open" && max > 0 && price !== null
                          ? stepper(lodge.slot, resource, null, max, resource.name)
                          : resource.window.state === "opens_on"
                            ? <span className="text-xs text-foreground/60">Opens {formatDate(resource.window.date)}</span>
                            : null}
                      </div>
                    );
                  })}
                </div>

                {sessions.length > 0 && (
                  <div className="mt-4">
                    <p className="text-sm font-semibold text-ink">Forest Spa sessions</p>
                    {spaWindow?.state === "opens_on" ? (
                      <p className="mt-1 text-sm text-foreground/70">
                        Spa sessions open on {formatDate(spaWindow.date)}, eight weeks before you arrive.
                      </p>
                    ) : (
                      <div className="mt-2 overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-xs uppercase tracking-wide text-foreground/50">
                              <th className="py-1 pr-3 font-semibold">Day</th>
                              {sessions.map((s) => (
                                <th key={s.code} className="py-1 pr-3 font-semibold">
                                  {s.sessionStart}
                                  {priceOf(s) !== null && (
                                    <span className="ml-1 font-normal normal-case text-foreground/60">
                                      {formatKes(priceOf(s) as number)} a place
                                    </span>
                                  )}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {activities.nights.map((date) => (
                              <tr key={date} className="border-t border-line">
                                <td className="py-2 pr-3 text-ink">{formatShortDate(date)}</td>
                                {sessions.map((resource) => {
                                  const cell = resource.sessions?.find((s) => s.date === date);
                                  const free = cell?.free ?? 0;
                                  const owned = cell?.owned ?? 0;
                                  const blocked = dateTaken(lodge.slot, lodge.resources, date, resource.code);
                                  const max = Math.max(0, Math.min(resource.cap - owned, free));
                                  const price = priceOf(resource);
                                  return (
                                    <td key={resource.code} className="py-2 pr-3">
                                      {owned > 0 ? (
                                        <span className="rounded-full bg-mist px-3 py-1 text-xs font-semibold text-olive">
                                          {owned} place{owned === 1 ? "" : "s"} booked
                                        </span>
                                      ) : free === 0 ? (
                                        <span className="text-xs font-semibold text-[#b3261e]">Sold out</span>
                                      ) : blocked ? (
                                        <span className="text-xs text-foreground/50">One session a day</span>
                                      ) : price !== null && max > 0 ? (
                                        <div className="flex items-center gap-2">
                                          {stepper(lodge.slot, resource, date, max, `${resource.name} on ${formatShortDate(date)}`)}
                                          {free <= LOW_STOCK_THRESHOLD && (
                                            <span className="text-xs font-semibold text-bronze">{free} left</span>
                                          )}
                                        </div>
                                      ) : null}
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {notice && (
            <div className="flex items-start gap-2 rounded-md border border-leaf/40 bg-mist px-4 py-3 text-sm text-olive">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0" aria-hidden>
                <path d="M4 12.5 9.5 18 20 6.5" />
              </svg>
              <span>{notice}</span>
            </div>
          )}

          {grandTotal > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
              <p className="text-sm text-foreground">
                Activities to add: <span className="font-bold text-ink">{formatKes(grandTotal)}</span>
                {booking.status === "deposit_paid" ? " · joins your balance" : " · charged now"}
              </p>
              <button type="button" disabled={busy} onClick={submit} className="btn-primary">
                {busy ? "Booking…" : "Book activities"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
