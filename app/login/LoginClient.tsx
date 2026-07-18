"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api";

export function LoginClient() {
  const router = useRouter();
  const params = useSearchParams();
  // Only ever redirect within the site - a full URL in ?next= is ignored.
  const rawNext = params.get("next");
  const next = rawNext?.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/account";
  const [form, setForm] = useState({ email: params.get("email") ?? "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await apiFetch(`/api/auth/login`, {
      method: "POST",
      body: JSON.stringify(form),
    });
    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }
    router.push(next);
    // Re-render the server-side header so the account chip appears.
    router.refresh();
  }

  const inputClass =
    "mt-1 w-full rounded-md border border-[#cccccc] bg-white px-3 py-2.5 text-base text-ink focus:outline-none focus:ring-2 focus:ring-navy";

  return (
    <div className="mx-auto max-w-md px-5 py-12">
      <div className="rounded-lg border border-line bg-white p-6">
        <h1 className="font-display text-3xl font-bold text-ink">
          Welcome <em>back</em>
        </h1>
        <p className="mt-2 text-sm text-foreground">
          Sign in to see and manage your breaks at Unity Parks Naivasha.
        </p>

        <form onSubmit={submit} className="mt-6 grid gap-5">
          <label>
            <span className="text-sm font-semibold text-foreground">Email</span>
            <input
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              className={inputClass}
              placeholder="you@example.com"
            />
          </label>

          <label>
            <span className="text-sm font-semibold text-foreground">Password</span>
            <input
              type="password"
              required
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              className={inputClass}
            />
          </label>

          {error && (
            <div className="rounded-md border border-[#b3261e]/30 bg-red-50 px-4 py-3 text-sm text-[#b3261e]">
              {error}
            </div>
          )}

          <button type="submit" disabled={busy} className="btn-primary w-full">
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>

      <p className="mt-6 text-sm text-foreground">
        New to Unity Parks?{" "}
        <Link href="/register" className="font-semibold text-navy underline underline-offset-2">
          Create an account
        </Link>
      </p>
      <p className="mt-2 text-sm text-foreground">
        No account?{" "}
        <Link href="/manage" className="font-semibold text-navy underline underline-offset-2">
          Find your booking
        </Link>{" "}
        with its reference and email instead.
      </p>
      <p className="mt-2 text-xs text-foreground/60">
        Forgotten your password? Password reset is not part of this demo.
      </p>
    </div>
  );
}
