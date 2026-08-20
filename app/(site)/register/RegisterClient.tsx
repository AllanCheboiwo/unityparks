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
    dateOfBirth: "",
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
    "mt-1 w-full rounded-md border border-[#cccccc] bg-white px-3 py-2.5 text-base text-ink focus:outline-none focus:ring-2 focus:ring-navy";

  return (
    <div className="mx-auto max-w-md px-5 py-12">
      <div className="rounded-lg border border-line bg-white p-6">
        <h1 className="font-display text-3xl font-bold text-ink">
          Create your <em>account</em>
        </h1>
        <p className="mt-2 text-sm text-foreground">
          See your breaks in one place and manage them any time. If you have
          booked with this email before, those breaks join your account
          automatically.
        </p>

        <form onSubmit={submit} className="mt-6 grid gap-5">
          <div className="grid grid-cols-2 gap-4">
            <label>
              <span className="text-sm font-semibold text-foreground">First name</span>
              <input required value={form.firstName} onChange={update("firstName")} className={inputClass} />
            </label>
            <label>
              <span className="text-sm font-semibold text-foreground">Last name</span>
              <input required value={form.lastName} onChange={update("lastName")} className={inputClass} />
            </label>
          </div>

          <label>
            <span className="text-sm font-semibold text-foreground">Email</span>
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
            <span className="text-sm font-semibold text-foreground">
              Mobile phone <span className="font-normal text-foreground/70">(optional)</span>
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
            <span className="text-sm font-semibold text-foreground">Date of birth</span>
            <input
              type="date"
              required
              value={form.dateOfBirth}
              onChange={update("dateOfBirth")}
              className={inputClass}
            />
            <span className="mt-1 block text-xs text-foreground/60">
              You must be 18 or over to hold a Unity Parks account.
            </span>
          </label>

          <label>
            <span className="text-sm font-semibold text-foreground">Password</span>
            <input
              type="password"
              required
              minLength={8}
              value={form.password}
              onChange={update("password")}
              className={inputClass}
            />
            <span className="mt-1 block text-xs text-foreground/60">
              At least 8 characters.
            </span>
          </label>

          {error && (
            <div className="rounded-md border border-[#b3261e]/30 bg-red-50 px-4 py-3 text-sm text-[#b3261e]">
              {error}{" "}
              {error.includes("already has") && (
                <Link href={`/login?email=${encodeURIComponent(form.email)}`} className="font-semibold underline underline-offset-2">
                  Go to sign in
                </Link>
              )}
            </div>
          )}

          <button type="submit" disabled={busy} className="btn-primary w-full">
            {busy ? "Creating your account…" : "Create account"}
          </button>
        </form>
      </div>

      <p className="mt-6 text-sm text-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-navy underline underline-offset-2">
          Sign in
        </Link>
      </p>
    </div>
  );
}
