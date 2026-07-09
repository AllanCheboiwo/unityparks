"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";

export function RegisterClient() {
  const router = useRouter();
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    password: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function update(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await apiFetch(`/api/auth/register`, {
      method: "POST",
      body: JSON.stringify({
        ...form,
        phone: form.phone.trim() || undefined,
      }),
    });
    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }
    router.push("/account");
    // Re-render the server-side header so the account chip appears.
    router.refresh();
  }

  const inputClass =
    "mt-1 w-full rounded-lg border border-forest/20 px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-forest/40";

  return (
    <div className="mx-auto max-w-md px-5 py-12">
      <h1 className="font-display text-3xl text-forest">
        Create your <em>account</em>
      </h1>
      <p className="mt-1 text-sm text-foreground/60">
        See your breaks in one place and manage them any time. If you have
        booked with this email before, those breaks join your account
        automatically.
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
            Mobile phone <span className="normal-case font-normal">(optional)</span>
          </span>
          <input
            type="tel"
            value={form.phone}
            onChange={update("phone")}
            className={inputClass}
            placeholder="+254 7xx xxx xxx"
          />
        </label>

        <label>
          <span className="text-xs font-medium text-foreground/60 uppercase tracking-wide">
            Password
          </span>
          <input
            type="password"
            required
            minLength={8}
            value={form.password}
            onChange={update("password")}
            className={inputClass}
          />
          <span className="mt-1 block text-xs text-foreground/50">
            At least 8 characters.
          </span>
        </label>

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
            {error}{" "}
            {error.includes("already has") && (
              <Link href={`/login?email=${encodeURIComponent(form.email)}`} className="underline underline-offset-2">
                Go to sign in
              </Link>
            )}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-forest text-white px-6 py-3 text-sm font-semibold hover:bg-forest-light disabled:opacity-60"
        >
          {busy ? "Creating your account…" : "Create account"}
        </button>
      </form>

      <p className="mt-6 text-sm text-foreground/60">
        Already have an account?{" "}
        <Link href="/login" className="text-forest underline underline-offset-2">
          Sign in
        </Link>
      </p>
    </div>
  );
}
