"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, isExpired } from "@/lib/api";
import { BAND_LABELS } from "@/lib/format";
import type { GuestRowDto, SessionSummary } from "@/lib/types";
import { Stepper } from "@/components/Stepper";
import { BookingSummary } from "@/components/BookingSummary";
import { ExpiredNotice } from "@/components/ExpiredNotice";
import { CheckoutBreadcrumb } from "../Breadcrumb";
import { AlertIcon } from "../icons";

type GuestsPayload = {
  lodges: Array<{ slot: number; bands: string[]; guests: GuestRowDto[] }>;
  lead: { firstName: string | null; lastName: string | null; email: string | null };
};

type Row = {
  slot: number;
  position: number;
  band: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  email: string;
};

const inputClass =
  "mt-1.5 w-full rounded-md border border-[#cccccc] bg-white px-3 py-2.5 text-base text-ink focus:outline-none focus:border-navy focus:ring-2 focus:ring-navy/25";
const labelClass = "text-sm font-semibold text-foreground";

/**
 * The Guests step: name everyone coming, children's
 * dates of birth, lodge by lodge. Entirely optional here - skipping goes
 * straight to payment and the same card lives on Manage my booking after.
 */
export function GuestsClient() {
  const router = useRouter();
  const sessionId = useSearchParams().get("session");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [lodgeSlots, setLodgeSlots] = useState<number[]>([]);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    (async () => {
      const [g, s] = await Promise.all([
        apiFetch<GuestsPayload>(`/api/session/${sessionId}/guests`),
        apiFetch<SessionSummary>(`/api/session/${sessionId}`),
      ]);
      if (isExpired(g) || isExpired(s)) return setExpired(true);
      if (!g.ok) return setError(g.error);
      if (s.ok) setSummary(s.data);

      setLodgeSlots(g.data.lodges.map((l) => l.slot));
      setRows(
        g.data.lodges.flatMap((lodge) => {
          const saved = new Map(lodge.guests.map((row) => [row.position, row]));
          return lodge.bands.map((band, position) => {
            const row = saved.get(position);
            const isLeadSeat = lodge.slot === 0 && position === 0;
            return {
              slot: lodge.slot,
              position,
              band,
              // The first adult of the first lodge is the lead booker,
              // prefilled from the details step.
              firstName: row?.firstName ?? (isLeadSeat ? (g.data.lead.firstName ?? "") : ""),
              lastName: row?.lastName ?? (isLeadSeat ? (g.data.lead.lastName ?? "") : ""),
              dateOfBirth: row?.dateOfBirth ?? "",
              email: row?.email ?? (isLeadSeat ? (g.data.lead.email ?? "") : ""),
            };
          });
        }),
      );
    })();
  }, [sessionId]);

  if (!sessionId || expired) return <ExpiredNotice />;
  if (error && !rows) {
    return (
      <p className="mx-auto max-w-2xl px-5 py-20 text-center text-[#b3261e]">{error}</p>
    );
  }
  if (!rows) {
    return (
      <p className="mx-auto max-w-2xl px-5 py-20 text-center text-foreground/50">
        Setting up your party…
      </p>
    );
  }

  const multi = lodgeSlots.length > 1;

  function update(
    slot: number,
    position: number,
    field: keyof Omit<Row, "slot" | "position" | "band">,
    value: string,
  ) {
    setRows((prev) =>
      prev!.map((row) =>
        row.slot === slot && row.position === position ? { ...row, [field]: value } : row,
      ),
    );
  }

  async function saveAndContinue() {
    setBusy(true);
    setError(null);
    // One save per lodge. Sequential: small DB writes, no Apaleo calls.
    for (const slot of lodgeSlots) {
      const result = await apiFetch(`/api/session/${sessionId}/guests`, {
        method: "PUT",
        body: JSON.stringify({
          slot,
          guests: rows!
            .filter((row) => row.slot === slot)
            .map((row) => ({
              position: row.position,
              firstName: row.firstName.trim() || undefined,
              lastName: row.lastName.trim() || undefined,
              dateOfBirth: row.dateOfBirth || undefined,
              email: row.email.trim() || undefined,
            })),
        }),
      });
      if (isExpired(result)) return setExpired(true);
      if (!result.ok) {
        setError(result.error);
        setBusy(false);
        return;
      }
    }
    router.push(`/checkout/pay?session=${sessionId}`);
  }

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      <CheckoutBreadcrumb />
      <h1 className="font-display text-[34px] leading-tight font-bold text-ink mb-5">
        Who&apos;s coming along?
      </h1>
      <Stepper current="Guest Details" />

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-8 lg:items-start">
        <div className="max-w-xl">
          <p className="text-sm text-foreground/70">
            Name everyone coming so their activity passes and wristbands are
            ready at the gate. You can skip this and add them any time from
            Manage my booking.
          </p>

          {lodgeSlots.map((slot) => {
            const lodgeRows = rows.filter((row) => row.slot === slot);
            return (
              <div key={slot} className="mt-8">
                {multi && (
                  <p className="font-display text-xl font-bold text-ink mb-3">
                    Lodge {slot + 1}
                  </p>
                )}
                <div className="grid gap-4">
                  {lodgeRows.map((row) => (
                    <div
                      key={row.position}
                      className="rounded-lg bg-white border border-line p-6"
                    >
                      <p className="text-xl font-bold text-ink">
                        {BAND_LABELS[row.band] ?? row.band}{" "}
                        {countWithinBand(lodgeRows, row)}
                        {row.slot === 0 && row.position === 0 && (
                          <span className="ml-2 rounded-full bg-mist px-2 py-0.5 text-xs font-semibold text-olive align-middle">
                            Lead booker
                          </span>
                        )}
                      </p>
                      <div className="mt-4 grid grid-cols-2 gap-4">
                        <label>
                          <span className={labelClass}>First name</span>
                          <input
                            value={row.firstName}
                            onChange={(e) => update(row.slot, row.position, "firstName", e.target.value)}
                            className={inputClass}
                          />
                        </label>
                        <label>
                          <span className={labelClass}>Last name</span>
                          <input
                            value={row.lastName}
                            onChange={(e) => update(row.slot, row.position, "lastName", e.target.value)}
                            className={inputClass}
                          />
                        </label>
                      </div>
                      {row.band !== "adult" && (
                        <label className="block mt-4">
                          <span className={labelClass}>Date of birth</span>
                          <input
                            type="date"
                            value={row.dateOfBirth}
                            onChange={(e) => update(row.slot, row.position, "dateOfBirth", e.target.value)}
                            className={inputClass}
                          />
                        </label>
                      )}
                      {row.band === "adult" && !(row.slot === 0 && row.position === 0) && (
                        <label className="block mt-4">
                          <span className={labelClass}>
                            Email <span className="font-normal">(optional, for inviting them later)</span>
                          </span>
                          <input
                            type="email"
                            value={row.email}
                            onChange={(e) => update(row.slot, row.position, "email", e.target.value)}
                            className={inputClass}
                            placeholder="them@example.com"
                          />
                        </label>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {error && (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-[#b3261e]/30 bg-[#b3261e]/5 px-4 py-3 text-sm text-[#b3261e]">
              <AlertIcon />
              <span>{error}</span>
            </div>
          )}

          <div className="mt-6 flex items-center gap-4">
            <button onClick={saveAndContinue} disabled={busy} className="btn-primary">
              {busy ? "Saving…" : "Save and continue"}
            </button>
            <button
              onClick={() => router.push(`/checkout/pay?session=${sessionId}`)}
              className="text-sm text-foreground/60 underline underline-offset-2"
            >
              Skip for now
            </button>
          </div>
        </div>

        {summary && (
          <aside className="mt-8 lg:mt-0 lg:sticky lg:top-6">
            <BookingSummary summary={summary} />
          </aside>
        )}
      </div>
    </div>
  );
}

/** "Adult 2 of 3" style counter within one lodge's band; blank when alone. */
function countWithinBand(lodgeRows: Row[], row: Row): string {
  const sameBand = lodgeRows.filter((r) => r.band === row.band);
  if (sameBand.length <= 1) return "";
  return `${sameBand.findIndex((r) => r.position === row.position) + 1} of ${sameBand.length}`;
}
