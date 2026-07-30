"use client";

import { useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";

export function ForgotPasswordClient() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await apiFetch(`/api/auth/forgot-password`, {
      method: "POST",
      body: JSON.stringify({ email }),
    });
    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }
    setSent(true);
  }

  const inputClass =
    "mt-1 w-full rounded-md border border-[#cccccc] bg-white px-3 py-2.5 text-base text-ink focus:outline-none focus:ring-2 focus:ring-navy";

  return (
    <div className="mx-auto max-w-md px-5 py-12">
      <div className="rounded-lg border border-line bg-white p-6">
        <h1 className="font-display text-3xl font-bold text-ink">
          Forgotten your <em>password?</em>
        </h1>

        {sent ? (
          <p className="mt-4 text-sm text-foreground">
            If that email has a Unity Parks account, a reset link is on its
            way. It works once and expires in an hour. Check your spam folder
            if it doesn&apos;t arrive.
          </p>
        ) : (
          <>
            <p className="mt-2 text-sm text-foreground">
              Enter your email and we&apos;ll send you a link to choose a new
              one.
            </p>
            <form onSubmit={submit} className="mt-6 grid gap-5">
              <label>
                <span className="text-sm font-semibold text-foreground">Email</span>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
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
                {busy ? "Sending…" : "Email me a reset link"}
              </button>
            </form>
          </>
        )}
      </div>

      <p className="mt-6 text-sm text-foreground">
        Remembered it after all?{" "}
        <Link href="/login" className="font-semibold text-navy underline underline-offset-2">
          Sign in
        </Link>
      </p>
    </div>
  );
}
