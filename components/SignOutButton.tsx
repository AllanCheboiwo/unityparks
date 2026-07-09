"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    await fetch("/api/auth/logout", { method: "POST" });
    // refresh() re-renders the server-side header so the chip disappears.
    router.push("/");
    router.refresh();
  }

  return (
    <button
      onClick={signOut}
      disabled={busy}
      className="text-xs text-foreground/60 hover:text-forest underline underline-offset-2 disabled:opacity-60"
    >
      Sign out
    </button>
  );
}
