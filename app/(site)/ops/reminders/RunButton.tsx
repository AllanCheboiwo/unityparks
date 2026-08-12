"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";

type Summary = {
  considered: number;
  sent: Array<{ reference: string; stage: string }>;
};

/** One click = one reminder run. Safe to mash: every send is stamp-claimed. */
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
          const res = await apiFetch<Summary>("/api/ops/reminders/run", { method: "POST" });
          setBusy(false);
          if (!res.ok) return setError(res.error);
          setResult(
            res.data.sent.length === 0
              ? `Nothing due: ${res.data.considered} open balances, all quiet or already reminded.`
              : `Sent ${res.data.sent.length}: ${res.data.sent
                  .map((s) => `${s.reference} (${s.stage})`)
                  .join(", ")}.`,
          );
          router.refresh();
        }}
      >
        {busy ? "Running…" : "Send due reminders now"}
      </button>
      {result && <span className="text-sm text-olive">{result}</span>}
      {error && <span className="text-sm text-[#b3261e]">{error}</span>}
    </div>
  );
}
