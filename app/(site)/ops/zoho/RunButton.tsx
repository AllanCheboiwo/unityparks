"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";

type Summary = { done: number; errored: number };

/** One click = one full drain, pending and failed alike. Safe to mash. */
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
          const res = await apiFetch<Summary>("/api/ops/zoho/run", { method: "POST" });
          setBusy(false);
          if (!res.ok) return setError(res.error);
          setResult(
            res.data.done === 0 && res.data.errored === 0
              ? "Nothing to do: no pending or failed exports."
              : `Pushed ${res.data.done}, errored ${res.data.errored}.`,
          );
          router.refresh();
        }}
      >
        {busy ? "Running…" : "Push pending and failed now"}
      </button>
      {result && <span className="text-sm text-olive">{result}</span>}
      {error && <span className="text-sm text-[#b3261e]">{error}</span>}
    </div>
  );
}
