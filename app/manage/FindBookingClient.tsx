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
    "mt-1 w-full rounded-md border border-[#cccccc] bg-white px-3 py-2.5 text-base text-ink focus:outline-none focus:ring-2 focus:ring-navy";

  return (
    <div className="mx-auto max-w-md px-5 py-12">
      <div className="rounded-lg border border-line bg-white p-6">
        <h1 className="font-display text-3xl font-bold text-ink">
          Find your <em>booking</em>
        </h1>
        <p className="mt-2 text-sm text-foreground">
          Enter your booking reference and the lead guest&apos;s email, both on
          your confirmation.
        </p>

        <form onSubmit={submit} className="mt-6 grid gap-5">
          <label>
            <span className="text-sm font-semibold text-foreground">Booking reference</span>
            <input
              required
              value={form.reference}
              onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
              className={`${inputClass} uppercase font-mono tracking-widest`}
              placeholder="ABCDEFGH"
            />
          </label>

          <label>
            <span className="text-sm font-semibold text-foreground">Lead guest email</span>
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
            <div className="rounded-md border border-[#b3261e]/30 bg-red-50 px-4 py-3 text-sm text-[#b3261e]">
              {error}
            </div>
          )}

          <button type="submit" disabled={busy} className="btn-primary w-full">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            {busy ? "Looking…" : "Find my booking"}
          </button>
        </form>
      </div>

      <p className="mt-6 text-sm text-foreground">
        Have an account?{" "}
        <Link href="/login?next=/account" className="font-semibold text-navy underline underline-offset-2">
          Sign in
        </Link>{" "}
        to see all your breaks instead.
      </p>
    </div>
  );
}
