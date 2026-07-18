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
      // Small-size take on .btn-outline: same bronze outline language, but
      // compact enough to sit beside the name chip in the header.
      className="rounded-md border border-bronze bg-white px-3 py-1 text-xs font-semibold text-bronze hover:bg-[#f7f3ec] disabled:opacity-60"
    >
      Sign out
    </button>
  );
}
