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
    "mt-1 w-full rounded-lg border border-forest/20 px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-forest/40";

  return (
    <div className="mx-auto max-w-md px-5 py-12">
      <h1 className="font-display text-3xl text-forest">
        Welcome <em>back</em>
      </h1>
      <p className="mt-1 text-sm text-foreground/60">
        Sign in to see and manage your breaks.
      </p>

      <form onSubmit={submit} className="mt-8 grid gap-5">
        <label>
          <span className="text-xs font-medium text-foreground/60 uppercase tracking-wide">
            Email
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

        <label>
          <span className="text-xs font-medium text-foreground/60 uppercase tracking-wide">
            Password
          </span>
          <input
            type="password"
            required
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            className={inputClass}
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
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="mt-6 text-sm text-foreground/60">
        New to Unity Parks?{" "}
        <Link href="/register" className="text-forest underline underline-offset-2">
          Create an account
        </Link>
      </p>
      <p className="mt-2 text-sm text-foreground/60">
        No account?{" "}
        <Link href="/manage" className="text-forest underline underline-offset-2">
          Find your booking
        </Link>{" "}
        with its reference and email instead.
      </p>
      <p className="mt-2 text-xs text-foreground/50">
        Forgotten your password? Password reset is not part of this demo.
      </p>
    </div>
  );
}
