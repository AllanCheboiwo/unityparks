"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";

type Summary = { considered: number; sent: number; swept: number };

/** One click = one offer run. Safe to mash: sends are stamp-claimed and
 * the sweep is conditional. */
export function RunButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={busy}
        className="btn-primary"
        onClick={async () => {
          setBusy(true);
          setError(null);
          setResult(null);
          const res = await apiFetch<Summary>("/api/ops/repeat-offers/run", { method: "POST" });
          setBusy(false);
          if (!res.ok) return setError(res.error);
          setResult(
            `${res.data.sent} sent of ${res.data.considered} candidates, ${res.data.swept} stale claims swept.`,
          );
          router.refresh();
        }}
      >
        {busy ? "Running…" : "Send offer emails now"}
      </button>
      {result && <span className="text-sm text-olive">{result}</span>}
      {error && <span className="text-sm text-[#b3261e]">{error}</span>}
    </div>
  );
}
