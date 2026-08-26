"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";

/** The interactive slivers of the ops page: the influencer onboarding form
 * and the per-row action buttons. Everything they change is re-read by the
 * server component on refresh; no client-side state survives. */

export function InfluencerForm() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", phone: "", code: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await apiFetch<{ id: string; code: string }>(
      `/api/ops/referrals/participants`,
      {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          email: form.email || undefined,
          phone: form.phone || undefined,
          code: form.code,
        }),
      },
    );
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setForm({ name: "", email: "", phone: "", code: "" });
    router.refresh();
  }

  const input =
    "rounded-md border border-line bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-olive/40";

  return (
    <form onSubmit={submit} className="mt-3 grid gap-2 sm:grid-cols-2">
      <input required placeholder="Name" value={form.name} className={input}
        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
      <input required placeholder="Vanity code, e.g. AMINA" value={form.code} className={`${input} uppercase`}
        onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} />
      <input placeholder="Email (for reward notes)" value={form.email} className={input}
        onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
      <input placeholder="Phone (for payouts)" value={form.phone} className={input}
        onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
      <button type="submit" disabled={busy} className="btn-primary text-sm">
        {busy ? "Adding…" : "Add influencer"}
      </button>
      {error && <p className="sm:col-span-2 text-sm text-[#b3261e]">{error}</p>}
    </form>
  );
}

export function RevokeButton(props: { participantId: string; revoked: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function toggle() {
    setBusy(true);
    await apiFetch(`/api/ops/referrals/participants/${props.participantId}`, {
      method: "POST",
      body: JSON.stringify({ revoked: !props.revoked }),
    });
    setBusy(false);
    router.refresh();
  }
  return (
    <button onClick={toggle} disabled={busy} className="btn-outline text-xs">
      {props.revoked ? "Reinstate" : "Revoke"}
    </button>
  );
}

export function ReleaseButton(props: { entryId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function release() {
    setBusy(true);
    const result = await apiFetch(`/api/ops/referrals/release`, {
      method: "POST",
      body: JSON.stringify({ entryId: props.entryId }),
    });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    router.refresh();
  }
  return (
    <span>
      <button onClick={release} disabled={busy} className="btn-outline text-xs">
        Release credit
      </button>
      {error && <span className="ml-2 text-xs text-[#b3261e]">{error}</span>}
    </span>
  );
}

export function RunPayoutBatch({
  expected,
}: {
  /** Exactly the dues this page rendered; the server refuses to record a
   *  batch that has drifted from them. */
  expected: Array<{ participantId: string; owed: number }>;
}) {
  const router = useRouter();
  const now = new Date();
  const defaultId = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-influencers`;
  const [batchId, setBatchId] = useState(defaultId);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    if (!window.confirm(`Mark batch ${batchId} as paid? Export the CSV and move the money first.`)) {
      return;
    }
    setBusy(true);
    setMessage(null);
    const result = await apiFetch<{ count: number; total: number }>(
      `/api/ops/referrals/payouts`,
      { method: "POST", body: JSON.stringify({ batchId, expected }) },
    );
    setBusy(false);
    if (!result.ok) return setMessage(result.error);
    setMessage(`Recorded ${result.data.count} payouts totalling KSh ${result.data.total.toLocaleString()}.`);
    router.refresh();
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <input
        value={batchId}
        onChange={(e) => setBatchId(e.target.value)}
        className="rounded-md border border-line bg-white px-3 py-2 text-sm font-mono"
      />
      <button onClick={run} disabled={busy} className="btn-primary text-sm">
        {busy ? "Recording…" : "Mark batch paid"}
      </button>
      {message && <p className="w-full text-sm text-foreground">{message}</p>}
    </div>
  );
}
