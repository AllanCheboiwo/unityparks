"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";

/** The footer sign-up form, wired to /api/newsletter. Keeps the footer's
 *  visual language; the thank-you replaces the form so there is nothing
 *  left to mash. */
export function NewsletterForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (done) {
    return (
      <p className="flex items-center gap-2 text-sm font-semibold text-moss">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M4 12.5 9.5 18 20 6.5" />
        </svg>
        You&apos;re on the list. Village news will find you.
      </p>
    );
  }

  return (
    <div>
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!email.trim()) return;
          setBusy(true);
          setError(null);
          const result = await apiFetch<{ ok: boolean }>("/api/newsletter", {
            method: "POST",
            body: JSON.stringify({ email }),
          });
          setBusy(false);
          if (!result.ok) return setError(result.error);
          setDone(true);
        }}
      >
        <input
          type="email"
          placeholder="Email address"
          aria-label="Email address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded-md bg-white text-ink placeholder:text-foreground/50 px-3 py-2 text-sm w-56"
        />
        <button type="submit" disabled={busy} className="btn-primary text-sm">
          {busy ? "One moment…" : "Sign up"}
        </button>
      </form>
      {error && <p className="mt-1 text-xs text-[#f2b8b5]">{error}</p>}
    </div>
  );
}
