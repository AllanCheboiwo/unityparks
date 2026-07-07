"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, isExpired } from "@/lib/api";
import { formatDate, formatKes, nightsLabel } from "@/lib/format";
import { LODGES } from "@/content/lodges";
import type { SessionSummary } from "@/lib/types";
import { Stepper } from "@/components/Stepper";
import { ExpiredNotice } from "@/components/ExpiredNotice";

type CheckoutResponse = { bookingId: string; status: string };

export function PayClient() {
  const router = useRouter();
  const sessionId = useSearchParams().get("session");
  const [session, setSession] = useState<SessionSummary | null>(null);
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [soldOut, setSoldOut] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    (async () => {
      const s = await apiFetch<SessionSummary>(`/api/session/${sessionId}`);
      if (isExpired(s)) return setExpired(true);
      if (!s.ok) return setError(s.error);
      setSession(s.data);
    })();
  }, [sessionId]);

  if (!sessionId || expired) return <ExpiredNotice />;
  if (error && !session) {
    return <p className="mx-auto max-w-2xl px-5 py-20 text-center text-red-700">{error}</p>;
  }
  if (!session) {
    return (
      <p className="mx-auto max-w-2xl px-5 py-20 text-center text-foreground/50">
        Preparing your summary…
      </p>
    );
  }

  const lodge = session.lodge ? LODGES[session.lodge.unitGroupCode] : null;

  async function buyNow() {
    setBusy(true);
    setError(null);
    const result = await apiFetch<CheckoutResponse>(
      `/api/session/${sessionId}/checkout`,
      { method: "POST" },
    );
    if (isExpired(result)) return setExpired(true);
    if (!result.ok) {
      if (result.soldOut) setSoldOut(true);
      else setError(result.error);
      setBusy(false);
      return;
    }
    router.push(`/confirmation/${result.data.bookingId}`);
  }

  if (soldOut) {
    return (
      <div className="mx-auto max-w-lg text-center py-20 px-5">
        <p className="font-display text-2xl text-forest">
          Someone beat you to that lodge
        </p>
        <p className="mt-2 text-sm text-foreground/60">
          It was booked while you were checking out. Your dates are still
          good — pick another lodge.
        </p>
        <a
          href={`/lodges?session=${sessionId}`}
          className="inline-block mt-6 rounded-lg bg-forest text-white px-6 py-2.5 text-sm font-semibold hover:bg-forest-light"
        >
          Back to lodges
        </a>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl px-5 py-8">
      <Stepper current="Pay" />

      <h1 className="font-display text-3xl text-forest">
        Your <em>break</em>
      </h1>

      <div className="mt-6 rounded-2xl bg-white ring-1 ring-forest/10 shadow-sm divide-y divide-forest/10">
        <div className="p-5">
          <p className="text-xs uppercase tracking-wide text-foreground/50">Stay</p>
          <p className="mt-1 font-medium text-forest">
            {lodge?.name ?? session.lodge?.unitGroupCode}
          </p>
          <p className="text-sm text-foreground/60">
            {formatDate(session.arrival)} → {formatDate(session.departure)}
          </p>
          <p className="text-sm text-foreground/60">
            {nightsLabel(session.nights)} · {session.adults}{" "}
            {session.adults === 1 ? "guest" : "guests"} · whole lodge
          </p>
        </div>

        <div className="p-5">
          <div className="flex justify-between text-sm">
            <span>Lodge, whole break</span>
            <span className="font-medium">
              {formatKes(session.lodge?.stayGrossAmount ?? 0)}
            </span>
          </div>
          {session.extras.map((extra) => (
            <div key={extra.serviceId} className="flex justify-between text-sm mt-2">
              <span>
                {extra.name}
                {extra.count > 1 ? ` ×${extra.count}` : ""}
              </span>
              <span className="font-medium">{formatKes(extra.grossAmount)}</span>
            </div>
          ))}
          <div className="flex justify-between mt-4 pt-4 border-t border-forest/10">
            <span className="font-display text-lg text-forest">Total</span>
            <span className="font-display text-lg text-forest">
              {formatKes(session.total ?? 0)}
            </span>
          </div>
        </div>

        {session.guest && (
          <div className="p-5 text-sm text-foreground/60">
            <p className="text-xs uppercase tracking-wide text-foreground/50 mb-1">
              Lead guest
            </p>
            {session.guest.firstName} {session.guest.lastName} ·{" "}
            {session.guest.email}
            {session.guest.vehiclePlate && (
              <> · plate {session.guest.vehiclePlate.toUpperCase()}</>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="mt-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <button
        onClick={buyNow}
        disabled={busy}
        className="mt-6 w-full rounded-lg bg-forest text-white px-6 py-3.5 text-base font-semibold hover:bg-forest-light disabled:opacity-60"
      >
        {busy ? "Confirming your booking…" : `Buy now — ${formatKes(session.total ?? 0)}`}
      </button>
      <p className="mt-3 text-center text-xs text-foreground/50">
        Demo environment: your booking is real in our reservation system, but
        no money moves.
      </p>
    </div>
  );
}
