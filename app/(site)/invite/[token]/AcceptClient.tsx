"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";

export function AcceptClient({ token }: { token: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setBusy(true);
    setError(null);
    const result = await apiFetch<{ ok: boolean; bookingId: string }>(
      `/api/invite/${token}/accept`,
      { method: "POST" },
    );
    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }
    router.push(`/manage/${result.data.bookingId}`);
    router.refresh();
  }

  return (
    <div className="mt-6">
      <button
        onClick={accept}
        disabled={busy}
        className="w-full rounded-md bg-navy px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
      >
        {busy ? "Accepting..." : "Accept the invitation"}
      </button>
      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
    </div>
  );
}
