"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { formatKes } from "@/lib/format";

/**
 * The account page's referral section. Two shapes: a claim card ("Get your
 * code") for guests without one, and the code card (code, share link,
 * balances) once claimed. All numbers arrive derived from the server
 * component; this only handles the claim POST and the copy button.
 */
export function ReferralCard(props: {
  participant: {
    code: string;
    vested: number;
    pending: number;
    history: Array<{
      id: string;
      amount: number;
      state: string;
      departure: string | null;
    }>;
  } | null;
  shareBase: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function claim() {
    setBusy(true);
    setError(null);
    const result = await apiFetch<{ code: string }>(`/api/referral/my-code`, {
      method: "POST",
    });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    router.refresh();
  }

  if (!props.participant) {
    return (
      <div className="mt-8 rounded-lg border border-line bg-white p-5">
        <p className="font-display text-lg font-bold text-navy">Refer a friend</p>
        <p className="mt-1 text-sm text-foreground">
          Get your permanent referral code: friends save on their first break
          and you earn resort credit after they stay.
        </p>
        {error && <p className="mt-2 text-sm text-[#b3261e]">{error}</p>}
        <button onClick={claim} disabled={busy} className="btn-primary mt-4 text-sm">
          {busy ? "One moment…" : "Get my referral code"}
        </button>
      </div>
    );
  }

  const { code, vested, pending, history } = props.participant;
  const shareUrl = `${props.shareBase}/r/${code}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be unavailable; the link is visible to copy by hand.
    }
  }

  return (
    <div className="mt-8 rounded-lg border border-line bg-white p-5">
      <p className="font-display text-lg font-bold text-navy">Refer a friend</p>
      <p className="mt-1 text-sm text-foreground">
        Share your code and your friends save on their first break. You earn
        resort credit once their stay completes.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <span className="rounded-md bg-mist px-4 py-2 font-mono text-lg font-bold tracking-widest text-navy">
          {code}
        </span>
        <button onClick={copy} className="btn-outline text-sm">
          {copied ? "Link copied" : "Copy share link"}
        </button>
      </div>
      <p className="mt-2 text-xs text-foreground/60 break-all">{shareUrl}</p>
      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4 text-sm">
        <div>
          <p className="text-xs uppercase tracking-wide text-foreground/50">
            Credit to spend
          </p>
          <p className="font-semibold text-ink">{formatKes(vested)}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-foreground/50">
            On the way
          </p>
          <p className="font-semibold text-ink">{formatKes(pending)}</p>
        </div>
      </div>
      {vested > 0 && (
        <p className="mt-2 text-xs text-foreground/60">
          Credit is offered automatically at the payment step of your next
          booking while you are signed in.
        </p>
      )}
      {history.length > 0 && (
        <div className="mt-4 border-t border-line pt-4">
          <p className="text-xs uppercase tracking-wide text-foreground/50">
            Your rewards
          </p>
          <div className="mt-2 grid gap-1.5">
            {history.map((row) => (
              <div key={row.id} className="flex justify-between gap-3 text-sm">
                <span className="text-foreground/70">
                  {row.state === "vested" && "Earned, ready to spend"}
                  {row.state === "spent" && "Applied to your booking"}
                  {row.state === "pending" &&
                    `Ready after their stay${row.departure ? `, ${row.departure}` : ""}`}
                  {row.state === "expired" && "Expired"}
                  {row.state === "lost" && "Their booking was cancelled"}
                </span>
                <span
                  className={
                    row.state === "vested"
                      ? "font-semibold text-ink"
                      : row.state === "spent" || row.state === "pending"
                        ? "text-foreground/70"
                        : "text-foreground/50 line-through"
                  }
                >
                  {row.amount < 0 ? "-" : ""}
                  {formatKes(Math.abs(row.amount))}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
