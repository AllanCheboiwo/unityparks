"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api";

export function ResetPasswordClient() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [form, setForm] = useState({ password: "", confirm: "" });
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (form.password !== form.confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await apiFetch(`/api/auth/reset-password`, {
      method: "POST",
      body: JSON.stringify({ token, password: form.password }),
    });
    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }
    setDone(true);
  }

  const inputClass =
    "mt-1 w-full rounded-md border border-[#cccccc] bg-white px-3 py-2.5 text-base text-ink focus:outline-none focus:ring-2 focus:ring-navy";

  return (
    <div className="mx-auto max-w-md px-5 py-12">
      <div className="rounded-lg border border-line bg-white p-6">
        <h1 className="font-display text-3xl font-bold text-ink">
          Choose a new <em>password</em>
        </h1>

        {done ? (
          <>
            <p className="mt-4 text-sm text-foreground">
              Done. Your password is changed and you&apos;ve been signed out
              everywhere. Sign in with the new one to pick up where you left
              off.
            </p>
            <Link href="/login" className="btn-primary mt-5 inline-block">
              Sign in
            </Link>
          </>
        ) : !token ? (
          <p className="mt-4 text-sm text-foreground">
            This page needs the link from your reset email. If yours has
            expired,{" "}
            <Link
              href="/forgot-password"
              className="font-semibold text-navy underline underline-offset-2"
            >
              request a new one
            </Link>
            .
          </p>
        ) : (
          <form onSubmit={submit} className="mt-6 grid gap-5">
            <label>
              <span className="text-sm font-semibold text-foreground">New password</span>
              <input
                type="password"
                required
                minLength={8}
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                className={inputClass}
              />
              <span className="mt-1 block text-xs text-foreground/60">At least 8 characters.</span>
            </label>

            <label>
              <span className="text-sm font-semibold text-foreground">Repeat it</span>
              <input
                type="password"
                required
                minLength={8}
                value={form.confirm}
                onChange={(e) => setForm((f) => ({ ...f, confirm: e.target.value }))}
                className={inputClass}
              />
            </label>

            {error && (
              <div className="rounded-md border border-[#b3261e]/30 bg-red-50 px-4 py-3 text-sm text-[#b3261e]">
                {error}
              </div>
            )}

            <button type="submit" disabled={busy} className="btn-primary w-full">
              {busy ? "Saving…" : "Save new password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
