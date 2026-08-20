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
  vehiclePlates: string[];
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

/** The shape the guests route's Zod email check accepts. Kept deliberately
 *  plain: it only has to catch the typos a guest can see and fix. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** One car on the break. dontKnow mirrors Center Parcs' "I don't know the
 *  registration" checkbox, which locks the plate box empty. */
type Car = { plate: string; dontKnow: boolean };

const inputClass =
  "mt-1.5 w-full rounded-md border border-[#cccccc] bg-white px-3 py-2.5 text-base text-ink focus:outline-none focus:border-navy focus:ring-2 focus:ring-navy/25";
const labelClass = "text-sm font-semibold text-foreground";

/** The asterisk after a required field's label, explained once above the
 * form. Decoration only: the inputs carry their own required semantics. */
function RequiredMark() {
  return (
    <span aria-hidden className="text-foreground/50">
      {" "}
      *
    </span>
  );
}

/** The message under a field that failed the save check. */
function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <span className="mt-1 flex items-start gap-1.5 text-sm text-[#b3261e]">
      <AlertIcon />
      {message}
    </span>
  );
}

/**
 * The Guests step: name everyone coming, children's dates of birth, lodge by
 * lodge. Required before paying - the checkout refuses an incomplete
 * manifest - and editable any time after from Manage my booking.
 */
export function GuestsClient() {
  const router = useRouter();
  const sessionId = useSearchParams().get("session");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [cars, setCars] = useState<Car[]>([]);
  const [lodgeSlots, setLodgeSlots] = useState<number[]>([]);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
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
      setCars(
        g.data.vehiclePlates.map((plate) => ({ plate, dontKnow: plate === "" })),
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

  function setCarCount(count: number) {
    setCars((prev) =>
      Array.from({ length: count }, (_, i) => prev[i] ?? { plate: "", dontKnow: false }),
    );
  }

  function updateCar(index: number, patch: Partial<Car>) {
    setCars((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }

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

  /** These mirror the server's rules (Zod plus the pay-step gate), so a
   * party can never pass here and be refused at payment. Cars are checked
   * here too: Center Parcs wants every car either plated or marked unknown,
   * and an unanswered car has to say so rather than deaden the button. */
  function checkRows(): Record<string, string> {
    const found: Record<string, string> = {};
    for (const row of rows!) {
      const key = `${row.slot}-${row.position}`;
      if (!row.firstName.trim()) found[`${key}-firstName`] = "Please enter a first name.";
      if (!row.lastName.trim()) found[`${key}-lastName`] = "Please enter a last name.";
      if (row.band !== "adult" && !row.dateOfBirth) {
        found[`${key}-dateOfBirth`] = "Please enter a date of birth.";
      }
      // The server takes an optional email but refuses a malformed one with
      // a generic message that names no field, so catch it while we can.
      if (row.email.trim() && !EMAIL_SHAPE.test(row.email.trim())) {
        found[`${key}-email`] = "Please enter a valid email address, or leave it empty.";
      }
    }
    cars.forEach((car, i) => {
      if (!car.dontKnow && !car.plate.trim()) {
        found[`car-${i}`] =
          "Enter the registration, or tick that you don't know it.";
      }
    });
    return found;
  }

  async function saveAndContinue() {
    // The button is never disabled for validation: it stays pressable and
    // answers with the missing fields.
    const found = checkRows();
    setFieldErrors(found);
    if (Object.keys(found).length > 0) return;
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
              firstName: row.firstName.trim(),
              lastName: row.lastName.trim(),
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
    // Cars are break-level: one set for the whole party, saved once. "Don't
    // know" cars go as "" so their slot is kept; plates are stored uppercase.
    const vehicles = await apiFetch(`/api/session/${sessionId}/vehicles`, {
      method: "PUT",
      body: JSON.stringify({
        plates: cars.map((c) => (c.dontKnow ? "" : c.plate.trim().toUpperCase())),
      }),
    });
    if (isExpired(vehicles)) return setExpired(true);
    if (!vehicles.ok) {
      setError(vehicles.error);
      setBusy(false);
      return;
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
            Tell us who&apos;s coming. We need everyone&apos;s name for
            check-in. You can update details any time from Manage my booking.
          </p>
          <p className="mt-2 text-xs text-foreground/60">Fields marked * are required.</p>

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
                          <span className={labelClass}>
                            First name
                            <RequiredMark />
                          </span>
                          <input
                            required
                            value={row.firstName}
                            onChange={(e) => update(row.slot, row.position, "firstName", e.target.value)}
                            className={inputClass}
                          />
                          <FieldError message={fieldErrors[`${row.slot}-${row.position}-firstName`]} />
                        </label>
                        <label>
                          <span className={labelClass}>
                            Last name
                            <RequiredMark />
                          </span>
                          <input
                            required
                            value={row.lastName}
                            onChange={(e) => update(row.slot, row.position, "lastName", e.target.value)}
                            className={inputClass}
                          />
                          <FieldError message={fieldErrors[`${row.slot}-${row.position}-lastName`]} />
                        </label>
                      </div>
                      {row.band !== "adult" && (
                        <label className="block mt-4">
                          <span className={labelClass}>
                            Date of birth
                            <RequiredMark />
                          </span>
                          <input
                            type="date"
                            required
                            value={row.dateOfBirth}
                            onChange={(e) => update(row.slot, row.position, "dateOfBirth", e.target.value)}
                            className={inputClass}
                          />
                          <FieldError message={fieldErrors[`${row.slot}-${row.position}-dateOfBirth`]} />
                        </label>
                      )}
                      {row.band === "adult" && !(row.slot === 0 && row.position === 0) && (
                        <label className="block mt-4">
                          <span className={labelClass}>
                            Email <span className="font-normal">(optional)</span>
                          </span>
                          <input
                            type="email"
                            value={row.email}
                            onChange={(e) => update(row.slot, row.position, "email", e.target.value)}
                            className={inputClass}
                            placeholder="them@example.com"
                          />
                          <span className="mt-1 block text-xs text-foreground/50">
                            We&apos;ll send them useful updates about the stay.
                          </span>
                          <FieldError message={fieldErrors[`${row.slot}-${row.position}-email`]} />
                        </label>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          <div className="mt-8">
            <p className="font-display text-xl font-bold text-ink mb-3">
              Vehicle details
            </p>
            <div className="rounded-lg bg-white border border-line p-6">
              <p className="text-sm text-foreground/70">
                Register a number plate and the gate reads it as you arrive, so
                you drive straight in. No queuing.
              </p>
              <label className="block mt-4 max-w-xs">
                <span className={labelClass}>How many cars are you bringing?</span>
                <select
                  value={cars.length}
                  onChange={(e) => setCarCount(Number(e.target.value))}
                  className={inputClass}
                >
                  <option value={0}>I&apos;m not bringing a car</option>
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                  <option value={3}>3</option>
                  <option value={4}>4</option>
                </select>
              </label>

              {cars.map((car, i) => (
                <div key={i} className="mt-5">
                  <label className="block max-w-xs">
                    <span className={labelClass}>
                      Car {i + 1} registration number
                    </span>
                    <input
                      value={car.plate}
                      disabled={car.dontKnow}
                      onChange={(e) => updateCar(i, { plate: e.target.value })}
                      className={`${inputClass} uppercase disabled:bg-mist disabled:text-foreground/40`}
                      placeholder="KDA 123A"
                    />
                  </label>
                  <label className="mt-2 flex items-center gap-2 text-sm text-foreground/70">
                    <input
                      type="checkbox"
                      checked={car.dontKnow}
                      onChange={(e) =>
                        updateCar(i, {
                          dontKnow: e.target.checked,
                          plate: e.target.checked ? "" : car.plate,
                        })
                      }
                      className="h-4 w-4 accent-[#536917]"
                    />
                    I don&apos;t know the registration
                  </label>
                  <FieldError message={fieldErrors[`car-${i}`]} />
                </div>
              ))}
            </div>
          </div>

          {error && (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-[#b3261e]/30 bg-[#b3261e]/5 px-4 py-3 text-sm text-[#b3261e]">
              <AlertIcon />
              <span>{error}</span>
            </div>
          )}

          <div className="mt-6">
            <button
              onClick={saveAndContinue}
              disabled={busy}
              className="btn-primary"
            >
              {busy ? "Saving…" : "Save and continue"}
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
