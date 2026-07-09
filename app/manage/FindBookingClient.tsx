"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";

/**
 * The airline-style way back in: booking reference plus the lead guest's
 * email. Verifies against the booking API (which answers with the same
 * generic error whether the reference or the email is wrong), then opens
 * the manage page with the email proof in the URL.
 */
export function FindBookingClient() {
  const router = useRouter();
  const [form, setForm] = useState({ reference: "", email: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const reference = form.reference.trim().toUpperCase();
    const email = form.email.trim();
    const result = await apiFetch(
      `/api/booking/${encodeURIComponent(reference)}?email=${encodeURIComponent(email)}`,
    );
    if (!result.ok) {
      setError(
        result.status === 404
          ? "We couldn't find a booking with that reference and email."
          : result.error,
      );
      setBusy(false);
      return;
    }
    router.push(`/manage/${reference}?email=${encodeURIComponent(email)}`);
  }

  const inputClass =
    "mt-1 w-full rounded-lg border border-forest/20 px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-forest/40";

  return (
    <div className="mx-auto max-w-md px-5 py-12">
      <h1 className="font-display text-3xl text-forest">
        Find your <em>booking</em>
      </h1>
      <p className="mt-1 text-sm text-foreground/60">
        Enter your booking reference and the lead guest&apos;s email, both on
        your confirmation.
      </p>

      <form onSubmit={submit} className="mt-8 grid gap-5">
        <label>
          <span className="text-xs font-medium text-foreground/60 uppercase tracking-wide">
            Booking reference
          </span>
          <input
            required
            value={form.reference}
            onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
            className={`${inputClass} uppercase font-mono tracking-widest`}
            placeholder="ABCDEFGH"
          />
        </label>

        <label>
          <span className="text-xs font-medium text-foreground/60 uppercase tracking-wide">
            Lead guest email
          </span>
          <input
            type="email"
            required
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            className={inputClass}
            placeholder="you@example.com"
          />
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
          {busy ? "Looking…" : "Find my booking"}
        </button>
      </form>

      <p className="mt-6 text-sm text-foreground/60">
        Have an account?{" "}
        <Link href="/login?next=/account" className="text-forest underline underline-offset-2">
          Sign in
        </Link>{" "}
        to see all your breaks instead.
      </p>
    </div>
  );
}
