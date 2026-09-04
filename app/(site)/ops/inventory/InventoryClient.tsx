"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import type { InventoryOverview, ResourceRow } from "@/server/inventory/ops";

/** Resources table with inline edit, the taken grid, the adjustment form,
 *  and the two buttons. Every write goes through an ops route. */
export function InventoryClient({ overview }: { overview: InventoryOverview }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function run(label: string, path: string, describe: (data: unknown) => string) {
    setBusy(label);
    setError(null);
    setMessage(null);
    const res = await apiFetch<unknown>(path, { method: "POST" });
    setBusy(null);
    if (!res.ok) return setError(res.error);
    setMessage(describe(res.data));
    router.refresh();
  }

  const th = "px-2 py-1 text-left text-xs font-semibold uppercase tracking-wide text-foreground/50";
  const td = "px-2 py-1 text-sm text-foreground";

  return (
    <div className="mt-6 grid gap-6">
      <section className="rounded-lg border border-line bg-white p-5">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="btn-primary"
            disabled={busy !== null}
            onClick={() =>
              run("sweep", "/api/ops/inventory/sweep", (d) => {
                const { released } = d as { released: number };
                return released === 0 ? "Nothing expired. Ledger already tidy." : `Released ${released} expired holds.`;
              })
            }
          >
            {busy === "sweep" ? "Sweeping…" : "Sweep expired holds"}
          </button>
          <button
            type="button"
            className="btn-outline"
            disabled={busy !== null}
            onClick={() =>
              run("reconcile", "/api/ops/inventory/reconcile", (d) => {
                const { violations, filed } = d as { violations: unknown[]; filed: number };
                return violations.length === 0
                  ? "Reconciled: counters, ledger and Apaleo all agree."
                  : `${violations.length} violation${violations.length === 1 ? "" : "s"} found, ${filed} newly filed as alerts.`;
              })
            }
          >
            {busy === "reconcile" ? "Reconciling…" : "Reconcile"}
          </button>
          {message && <span className="text-sm text-olive">{message}</span>}
          {error && <span className="text-sm text-[#b3261e]">{error}</span>}
        </div>
      </section>

      <section className="rounded-lg border border-line bg-white p-5">
        <p className="font-display text-lg font-bold text-ink">Resources</p>
        <div className="mt-3 grid gap-3">
          {overview.resources.map((resource) => (
            <ResourceForm key={resource.id} resource={resource} />
          ))}
          <ResourceForm resource={null} />
        </div>
      </section>

      <section className="rounded-lg border border-line bg-white p-5">
        <p className="font-display text-lg font-bold text-ink">Taken per day</p>
        <div className="mt-3 overflow-x-auto">
          <table className="border-collapse">
            <thead>
              <tr>
                <th className={th}>Resource</th>
                {overview.dates.map((date) => (
                  <th key={date} className={`${th} text-center`}>
                    {date.slice(8)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {overview.resources.map((resource) => (
                <tr key={resource.id} className="border-t border-line">
                  <td className={`${td} whitespace-nowrap font-semibold`}>
                    {resource.code} <span className="text-foreground/50">/ {resource.capacity}</span>
                  </td>
                  {overview.grid[resource.id].map((cell) => (
                    <td
                      key={cell.date}
                      className={`${td} text-center ${
                        cell.taken >= resource.capacity
                          ? "bg-[#b3261e]/10 font-bold text-[#b3261e]"
                          : cell.taken > 0
                            ? "bg-mist"
                            : "text-foreground/40"
                      }`}
                    >
                      {cell.taken}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <AdjustmentForm resources={overview.resources} />
    </div>
  );
}

function ResourceForm({ resource }: { resource: ResourceRow | null }) {
  const router = useRouter();
  const [form, setForm] = useState({
    code: resource?.code ?? "",
    name: resource?.name ?? "",
    kind: (resource?.kind ?? "STOCK") as "STOCK" | "SESSION",
    capacity: String(resource?.capacity ?? 0),
    sessionStart: resource?.sessionStart ?? "",
    sessionMinutes: resource?.sessionMinutes ? String(resource.sessionMinutes) : "",
    apaleoServiceCode: resource?.apaleoServiceCode ?? "",
    openDaysBefore: resource?.openDaysBefore !== null && resource?.openDaysBefore !== undefined ? String(resource.openDaysBefore) : "",
    capRule: (resource?.capRule ?? "adults") as "adults" | "children",
    sellAtCheckout: resource?.sellAtCheckout ?? false,
    active: resource?.active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const field = "rounded border border-line px-2 py-1 text-sm";
  const set = (key: keyof typeof form, value: string | boolean) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  async function save() {
    setBusy(true);
    setNote(null);
    const res = await apiFetch<ResourceRow>("/api/ops/inventory/resources", {
      method: "POST",
      body: JSON.stringify({
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        kind: form.kind,
        capacity: Number(form.capacity),
        sessionStart: form.kind === "SESSION" ? form.sessionStart || null : null,
        sessionMinutes: form.kind === "SESSION" && form.sessionMinutes ? Number(form.sessionMinutes) : null,
        apaleoServiceCode: form.apaleoServiceCode.trim().toUpperCase(),
        openDaysBefore: form.openDaysBefore === "" ? null : Number(form.openDaysBefore),
        capRule: form.capRule,
        sellAtCheckout: form.sellAtCheckout,
        active: form.active,
      }),
    });
    setBusy(false);
    if (!res.ok) return setNote(res.error);
    setNote("Saved.");
    router.refresh();
  }

  return (
    <div className={`grid gap-2 rounded-lg border p-3 ${resource ? "border-line" : "border-dashed border-line"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <input className={`${field} w-32 font-mono`} placeholder="CODE" value={form.code} disabled={resource !== null} onChange={(e) => set("code", e.target.value)} />
        <input className={`${field} w-44`} placeholder="Name" value={form.name} onChange={(e) => set("name", e.target.value)} />
        <select className={field} value={form.kind} onChange={(e) => set("kind", e.target.value)}>
          <option value="STOCK">STOCK (per night)</option>
          <option value="SESSION">SESSION (date + time)</option>
        </select>
        <label className="text-xs text-foreground/70">
          Capacity{" "}
          <input className={`${field} w-20`} type="number" min={0} value={form.capacity} onChange={(e) => set("capacity", e.target.value)} />
        </label>
        {form.kind === "SESSION" && (
          <>
            <input className={`${field} w-20`} placeholder="HH:MM" value={form.sessionStart} onChange={(e) => set("sessionStart", e.target.value)} />
            <input className={`${field} w-20`} type="number" placeholder="mins" value={form.sessionMinutes} onChange={(e) => set("sessionMinutes", e.target.value)} />
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input className={`${field} w-36 font-mono`} placeholder="APALEO-CODE" value={form.apaleoServiceCode} onChange={(e) => set("apaleoServiceCode", e.target.value)} />
        <label className="text-xs text-foreground/70">
          Opens days before{" "}
          <input className={`${field} w-16`} type="number" min={0} placeholder="any" value={form.openDaysBefore} onChange={(e) => set("openDaysBefore", e.target.value)} />
        </label>
        <select className={field} value={form.capRule} onChange={(e) => set("capRule", e.target.value)}>
          <option value="adults">cap: adults</option>
          <option value="children">cap: children 2+</option>
        </select>
        <label className="text-xs text-foreground/70">
          <input type="checkbox" checked={form.sellAtCheckout} onChange={(e) => set("sellAtCheckout", e.target.checked)} /> sell at checkout (UNP-25)
        </label>
        <label className="text-xs text-foreground/70">
          <input type="checkbox" checked={form.active} onChange={(e) => set("active", e.target.checked)} /> active
        </label>
        <button type="button" className="btn-outline text-sm" disabled={busy} onClick={save}>
          {busy ? "Saving…" : resource ? "Save" : "Add resource"}
        </button>
        {note && <span className={`text-xs ${note === "Saved." ? "text-olive" : "text-[#b3261e]"}`}>{note}</span>}
      </div>
    </div>
  );
}

function AdjustmentForm({ resources }: { resources: ResourceRow[] }) {
  const router = useRouter();
  const [form, setForm] = useState({
    resourceCode: resources[0]?.code ?? "",
    from: "",
    to: "",
    qty: "1",
    reason: "",
  });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const field = "rounded border border-line px-2 py-1 text-sm";

  async function submit() {
    setBusy(true);
    setNote(null);
    const res = await apiFetch<{ dates: number }>("/api/ops/inventory/adjustments", {
      method: "POST",
      body: JSON.stringify({ ...form, qty: Number(form.qty) }),
    });
    setBusy(false);
    if (!res.ok) return setNote(res.error);
    setNote(`Adjusted ${res.data.dates} day${res.data.dates === 1 ? "" : "s"}.`);
    setForm((prev) => ({ ...prev, reason: "" }));
    router.refresh();
  }

  return (
    <section className="rounded-lg border border-line bg-white p-5">
      <p className="font-display text-lg font-bold text-ink">Adjustment</p>
      <p className="mt-1 text-sm text-foreground">
        Take units out of sale for a date range with a reason: bikes in the
        workshop, a walk-in hire, staff use. Refused if it would exceed
        capacity; reduce capacity instead if the fleet shrank.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select className={field} value={form.resourceCode} onChange={(e) => setForm({ ...form, resourceCode: e.target.value })}>
          {resources.map((r) => (
            <option key={r.id} value={r.code}>
              {r.code}
            </option>
          ))}
        </select>
        <input className={field} type="date" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} />
        <span className="text-xs text-foreground/60">to</span>
        <input className={field} type="date" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} />
        <input className={`${field} w-16`} type="number" min={1} value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} />
        <input className={`${field} w-64`} placeholder="Reason (the audit trail)" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
        <button type="button" className="btn-primary text-sm" disabled={busy || !form.from || !form.to || !form.reason} onClick={submit}>
          {busy ? "Adjusting…" : "Adjust"}
        </button>
        {note && <span className={`text-xs ${note.startsWith("Adjusted") ? "text-olive" : "text-[#b3261e]"}`}>{note}</span>}
      </div>
    </section>
  );
}
