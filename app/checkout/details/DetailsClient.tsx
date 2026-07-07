"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, isExpired } from "@/lib/api";
import { Stepper } from "@/components/Stepper";
import { ExpiredNotice } from "@/components/ExpiredNotice";

export function DetailsClient() {
  const router = useRouter();
  const sessionId = useSearchParams().get("session");
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    vehiclePlate: "",
  });
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!sessionId || expired) return <ExpiredNotice />;

  function update(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await apiFetch(`/api/session/${sessionId}/details`, {
      method: "POST",
      body: JSON.stringify({
        ...form,
        vehiclePlate: form.vehiclePlate.trim() || undefined,
      }),
    });
    if (isExpired(result)) return setExpired(true);
    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }
    router.push(`/checkout/pay?session=${sessionId}`);
  }

  const inputClass =
    "mt-1 w-full rounded-lg border border-forest/20 px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-forest/40";

  return (
    <div className="mx-auto max-w-xl px-5 py-8">
      <Stepper current="Details" />

      <h1 className="font-display text-3xl text-forest">
        Who&apos;s <em>coming</em>?
      </h1>
      <p className="mt-1 text-sm text-foreground/60">
        Lead guest details for the booking.
      </p>

      <form onSubmit={submit} className="mt-8 grid gap-5">
        <div className="grid grid-cols-2 gap-4">
          <label>
            <span className="text-xs font-medium text-foreground/60 uppercase tracking-wide">
              First name
            </span>
            <input required value={form.firstName} onChange={update("firstName")} className={inputClass} />
          </label>
          <label>
            <span className="text-xs font-medium text-foreground/60 uppercase tracking-wide">
              Last name
            </span>
            <input required value={form.lastName} onChange={update("lastName")} className={inputClass} />
          </label>
        </div>

        <label>
          <span className="text-xs font-medium text-foreground/60 uppercase tracking-wide">
            Email
          </span>
          <input
            type="email"
            required
            value={form.email}
            onChange={update("email")}
            className={inputClass}
            placeholder="you@example.com"
          />
        </label>

        <label>
          <span className="text-xs font-medium text-foreground/60 uppercase tracking-wide">
            Mobile phone
          </span>
          <input
            type="tel"
            required
            minLength={7}
            value={form.phone}
            onChange={update("phone")}
            className={inputClass}
            placeholder="+254 7xx xxx xxx"
          />
        </label>

        <label>
          <span className="text-xs font-medium text-foreground/60 uppercase tracking-wide">
            Vehicle number plate <span className="normal-case font-normal">(optional)</span>
          </span>
          <input
            value={form.vehiclePlate}
            onChange={update("vehiclePlate")}
            className={`${inputClass} uppercase`}
            placeholder="KDA 123A"
          />
          <span className="mt-1 block text-xs text-foreground/50">
            Register your plate and the gate opens automatically when you
            arrive — no queuing.
          </span>
        </label>

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-forest text-white px-6 py-3 text-sm font-semibold hover:bg-forest-light disabled:opacity-60"
        >
          {busy ? "Saving…" : "Continue to payment"}
        </button>
      </form>
    </div>
  );
}
