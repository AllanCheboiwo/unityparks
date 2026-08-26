"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";

export function ResolveButton({ alertId }: { alertId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={busy}
        className="btn-outline text-xs"
        onClick={async () => {
          setBusy(true);
          setError(null);
          const res = await apiFetch<{ ok: boolean }>("/api/ops/alerts/resolve", {
            method: "POST",
            body: JSON.stringify({ alertId }),
          });
          setBusy(false);
          if (!res.ok) return setError(res.error);
          router.refresh();
        }}
      >
        {busy ? "Resolving…" : "Resolve"}
      </button>
      {error && <span className="text-xs text-[#b3261e]">{error}</span>}
    </span>
  );
}
