"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, isExpired } from "@/lib/api";
import { formatKes } from "@/lib/format";
import type { ExtraOfferDto, SessionSummary } from "@/lib/types";
import { Stepper } from "@/components/Stepper";
import { ExpiredNotice } from "@/components/ExpiredNotice";

const PRICING_LABELS: Record<string, string> = {
  Room: "per lodge, per stay",
  Person: "per person, per stay",
  RoomPerNight: "per lodge, per night",
  PersonPerNight: "per person, per night",
};

export function ExtrasClient() {
  const router = useRouter();
  const sessionId = useSearchParams().get("session");
  const [session, setSession] = useState<SessionSummary | null>(null);
  const [extras, setExtras] = useState<ExtraOfferDto[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    (async () => {
      const [s, e] = await Promise.all([
        apiFetch<SessionSummary>(`/api/session/${sessionId}`),
        apiFetch<{ extras: ExtraOfferDto[] }>(`/api/session/${sessionId}/extras`),
      ]);
      if (isExpired(s) || isExpired(e)) return setExpired(true);
      if (!s.ok) return setError(s.error);
      if (!e.ok) return setError(e.error);
      setSession(s.data);
      setExtras(e.data.extras);
      // Restore previously chosen extras when the guest comes back a step.
      setChosen(new Set(s.data.extras.map((x) => x.serviceId)));
    })();
  }, [sessionId]);

  const stayAmount = session?.lodge?.stayGrossAmount ?? 0;
  const extrasTotal = useMemo(
    () =>
      (extras ?? [])
        .filter((e) => chosen.has(e.serviceId))
        .reduce((sum, e) => sum + e.totalGrossAmount, 0),
    [extras, chosen],
  );

  if (!sessionId || expired) return <ExpiredNotice />;
  if (error) {
    return <p className="mx-auto max-w-2xl px-5 py-20 text-center text-red-700">{error}</p>;
  }
  if (!session || !extras) {
    return (
      <p className="mx-auto max-w-2xl px-5 py-20 text-center text-foreground/50">
        Pricing extras for your stay…
      </p>
    );
  }

  function toggle(serviceId: string) {
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(serviceId)) next.delete(serviceId);
      else next.add(serviceId);
      return next;
    });
  }

  async function continueToDetails() {
    setBusy(true);
    const snapshots = extras!
      .filter((e) => chosen.has(e.serviceId))
      .map((e) => ({
        serviceId: e.serviceId,
        code: e.code,
        name: e.name,
        count: e.count,
        grossAmount: e.totalGrossAmount,
      }));
    const result = await apiFetch(`/api/session/${sessionId}/extras`, {
      method: "POST",
      body: JSON.stringify({ extras: snapshots }),
    });
    if (isExpired(result)) return setExpired(true);
    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }
    router.push(`/checkout/details?session=${sessionId}`);
  }

  return (
    <div className="mx-auto max-w-3xl px-5 py-8 pb-32">
      <Stepper current="Extras" />

      <h1 className="font-display text-3xl text-forest">
        Make it <em>effortless</em>
      </h1>
      <p className="mt-1 text-sm text-foreground/60">
        A few things guests wish they&apos;d added - all priced live for your stay.
        This step is optional.
      </p>

      <div className="mt-8 grid gap-4">
        {extras.map((extra) => {
          const added = chosen.has(extra.serviceId);
          return (
            <div
              key={extra.serviceId}
              className={`rounded-xl bg-white p-5 ring-1 transition-shadow ${
                added ? "ring-2 ring-forest shadow-md" : "ring-forest/10 shadow-sm"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-display text-lg text-forest">{extra.name}</p>
                  <p className="mt-1 text-sm text-foreground/70 max-w-md">
                    {extra.description}
                  </p>
                  <p className="mt-2 text-xs text-foreground/50">
                    {PRICING_LABELS[extra.pricingUnit] ?? extra.pricingUnit}
                    {extra.count > 1 ? ` · ${extra.count}×` : ""}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-semibold text-forest">
                    {formatKes(extra.totalGrossAmount)}
                  </p>
                  <p className="text-[11px] text-foreground/50">for your stay</p>
                  <button
                    onClick={() => toggle(extra.serviceId)}
                    className={`mt-2 rounded-lg px-5 py-1.5 text-sm font-semibold ${
                      added
                        ? "bg-sand text-forest ring-1 ring-forest/30"
                        : "bg-forest text-white hover:bg-forest-light"
                    }`}
                  >
                    {added ? "Remove" : "Add"}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Running total bar */}
      <div className="fixed bottom-0 inset-x-0 bg-white/95 backdrop-blur border-t border-forest/10 z-10">
        <div className="mx-auto max-w-3xl px-5 py-3.5 flex items-center justify-between gap-4">
          <div className="text-sm">
            <span className="text-foreground/60">
              Lodge {formatKes(stayAmount)}
              {extrasTotal > 0 && <> + extras {formatKes(extrasTotal)}</>} ·{" "}
            </span>
            <span className="font-semibold text-forest">
              Total {formatKes(stayAmount + extrasTotal)}
            </span>
          </div>
          <button
            onClick={continueToDetails}
            disabled={busy}
            className="rounded-lg bg-forest text-white px-6 py-2.5 text-sm font-semibold hover:bg-forest-light disabled:opacity-60"
          >
            {busy ? "Saving…" : chosen.size > 0 ? "Continue" : "Continue without extras"}
          </button>
        </div>
      </div>
    </div>
  );
}
