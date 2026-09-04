"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { isQuantityExtra } from "@/lib/extras";
import { formatKes } from "@/lib/format";
import type {
  AddExtrasResultDto,
  BookingConfirmation,
  ExtrasContentDto,
  ManageExtraOfferDto,
  ManageExtrasDto,
} from "@/lib/types";

/**
 * "Add little extras" on Manage my booking - the delivery of the promise the
 * checkout extras page makes. Offers load lazily on expand (three Apaleo
 * reads per lodge), quantities are picked per lodge, and one POST per lodge
 * applies them. Paid bookings are charged on the folio at once; deposit-paid
 * bookings see the charge join their outstanding balance.
 */

export function AddExtrasCard({
  bookingId,
  proofQuery,
  booking,
  extrasContent,
  onChanged,
}: {
  bookingId: string;
  proofQuery: string;
  booking: BookingConfirmation;
  extrasContent: Record<string, ExtrasContentDto>;
  onChanged: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [quote, setQuote] = useState<ManageExtrasDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Selection keyed "slot:serviceId" -> how many more to add.
  const [picks, setPicks] = useState<Record<string, number>>({});

  const multi = booking.lodges.length > 1;

  async function loadOffers() {
    setLoading(true);
    setError(null);
    const result = await apiFetch<ManageExtrasDto>(
      `/api/booking/${bookingId}/extras${proofQuery}`,
    );
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setQuote(result.data);
  }

  function pickKey(slot: number, serviceId: string): string {
    return `${slot}:${serviceId}`;
  }

  function setPick(slot: number, serviceId: string, count: number) {
    setNotice(null);
    setPicks((prev) => {
      const next = { ...prev };
      const key = pickKey(slot, serviceId);
      if (count <= 0) delete next[key];
      else next[key] = count;
      return next;
    });
  }

  function slotTotal(slot: number): number {
    if (!quote) return 0;
    const lodge = quote.lodges.find((l) => l.slot === slot);
    if (!lodge) return 0;
    return lodge.extras.reduce(
      (sum, extra) => sum + (picks[pickKey(slot, extra.serviceId)] ?? 0) * extra.unitPrice,
      0,
    );
  }

  const grandTotal = quote
    ? quote.lodges.reduce((sum, lodge) => sum + slotTotal(lodge.slot), 0)
    : 0;

  async function submit() {
    if (!quote || grandTotal <= 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    let lastResult: AddExtrasResultDto | null = null;
    let charged = 0;

    // One POST per lodge that has picks, sequential like the guests save:
    // each is its own order with its own folio settle.
    for (const lodge of quote.lodges) {
      const additions = lodge.extras
        .map((extra) => ({
          serviceId: extra.serviceId,
          count: picks[pickKey(lodge.slot, extra.serviceId)] ?? 0,
        }))
        .filter((a) => a.count > 0);
      if (additions.length === 0) continue;

      const result = await apiFetch<AddExtrasResultDto>(
        `/api/booking/${bookingId}/extras${proofQuery}`,
        {
          method: "POST",
          body: JSON.stringify({ slot: lodge.slot, additions }),
        },
      );
      if (!result.ok) {
        // Clear picks first (drops the still-enabled submit bar), and say
        // what already went through: earlier lodges may have charged money.
        setPicks({});
        if (lastResult) {
          setNotice(
            lastResult.kind === "charge_now"
              ? `Extras for an earlier lodge went through first: ${formatKes(charged)} was charged to your booking.`
              : `Extras for an earlier lodge went through first: ${formatKes(charged)} was added to your balance.`,
          );
        }
        // The error lands after the refresh so loadOffers' reset can't wipe
        // it in the same render batch; busy holds until everything is back.
        await Promise.all([onChanged(), loadOffers()]);
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
    await Promise.all([onChanged(), loadOffers()]);
    setBusy(false);
  }

  return (
    <div className="mt-8 rounded-lg border border-line bg-white p-6">
      <p className="font-display text-xl font-bold text-ink">Add little extras</p>
      <p className="mt-1 text-sm text-foreground">
        Lodge treats like the grocery pack, firewood and early check-in can
        join your break any time until the day before you arrive. Bikes and
        spa sessions are booked under Activities above.{" "}
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
            if (!quote) loadOffers();
          }}
        >
          Browse extras
        </button>
      )}

      {open && loading && (
        <p className="mt-4 text-sm text-foreground/60">Fetching live prices…</p>
      )}

      {open && error && (
        <div className="mt-4 rounded-md border border-[#b3261e]/30 bg-red-50 px-4 py-3 text-sm text-[#b3261e]">
          {error}
          {!quote && !loading && (
            <button
              type="button"
              onClick={loadOffers}
              className="ml-3 font-semibold underline underline-offset-2"
            >
              Try again
            </button>
          )}
        </div>
      )}

      {open && quote && (
        <div className="mt-4 grid gap-5">
          {quote.lodges.map((lodge) => (
            <div key={lodge.slot}>
              {multi && (
                <p className="mb-2 text-sm font-semibold text-navy">
                  Lodge {lodge.slot + 1}
                </p>
              )}
              <div className="grid gap-2">
                {lodge.extras.map((extra) => {
                  const key = pickKey(lodge.slot, extra.serviceId);
                  const picked = picks[key] ?? 0;
                  const noun = extrasContent[extra.code]?.noun ?? "item";
                  const quantity = isQuantityExtra(extra);
                  const soldOutOfAdds = extra.maxAdd === 0;
                  return (
                    <div
                      key={extra.serviceId}
                      className="flex items-center justify-between gap-3 rounded-lg border border-line p-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-ink">{extra.name}</p>
                        <p className="text-xs text-foreground/70">
                          {formatKes(extra.unitPrice)}
                          {quantity ? ` per ${noun}` : ""}
                          {extra.ownedCount > 0 && (
                            <>
                              {" · "}
                              {quantity
                                ? `you have ${extra.ownedCount}`
                                : "already on your break"}
                            </>
                          )}
                        </p>
                      </div>
                      {quantity ? (
                        <div className="flex shrink-0 items-center gap-2">
                          <button
                            type="button"
                            aria-label={`Fewer ${extra.name}`}
                            disabled={busy || picked === 0}
                            onClick={() => setPick(lodge.slot, extra.serviceId, picked - 1)}
                            className="h-8 w-8 rounded-full border border-line text-lg leading-none text-navy disabled:opacity-40"
                          >
                            −
                          </button>
                          <span role="status" className="w-5 text-center text-sm font-semibold text-ink">
                            {picked}
                            <span className="sr-only">
                              {" "}
                              {noun}
                              {picked === 1 ? "" : "s"} selected
                            </span>
                          </span>
                          <button
                            type="button"
                            aria-label={`More ${extra.name}`}
                            disabled={busy || picked >= extra.maxAdd}
                            onClick={() => setPick(lodge.slot, extra.serviceId, picked + 1)}
                            className="h-8 w-8 rounded-full border border-line text-lg leading-none text-navy disabled:opacity-40"
                          >
                            +
                          </button>
                        </div>
                      ) : soldOutOfAdds ? (
                        <span className="shrink-0 rounded-full bg-mist px-3 py-1 text-xs font-semibold text-olive">
                          Added
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            setPick(lodge.slot, extra.serviceId, picked > 0 ? 0 : 1)
                          }
                          className={
                            picked > 0
                              ? "btn-primary shrink-0 text-sm"
                              : "btn-outline shrink-0 text-sm"
                          }
                        >
                          {picked > 0 ? "Remove" : "Add"}
                        </button>
                      )}
                    </div>
                  );
                })}
                {lodge.extras.length === 0 && (
                  <p className="text-sm text-foreground/60">
                    No extras are on offer for this lodge right now.
                  </p>
                )}
              </div>
            </div>
          ))}

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
                Extras to add:{" "}
                <span className="font-bold text-ink">{formatKes(grandTotal)}</span>
                {booking.status === "deposit_paid"
                  ? " · joins your balance"
                  : " · charged now"}
              </p>
              <button type="button" disabled={busy} onClick={submit} className="btn-primary">
                {busy ? "Adding…" : "Add to my break"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
