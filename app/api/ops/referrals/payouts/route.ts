import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleRoute, jsonError } from "@/server/api-helpers";
import { requireAdmin } from "@/server/auth/session";
import { payoutsDue, runPayoutBatch } from "@/server/referral/ops";

/** The payout CSV: one line per influencer owed, for the accountant and
 * the hand-run M-Pesa/bank transfers. KRA PIN stays a column for the
 * accountant to fill until onboarding collects it. */
export async function GET() {
  return handleRoute(async () => {
    await requireAdmin();
    const dues = await payoutsDue();
    const escape = (v: string | null) => `"${(v ?? "").replace(/"/g, '""')}"`;
    const lines = [
      "name,code,phone,email,kra_pin,amount_kes",
      ...dues.map((d) =>
        [escape(d.name), d.code, escape(d.phone), escape(d.email), "", d.owed].join(","),
      ),
    ];
    return new NextResponse(lines.join("\n") + "\n", {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="referral-payouts-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  });
}

const RunBody = z.object({ batchId: z.string().min(4).max(40) });

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    await requireAdmin();
    const parsed = RunBody.safeParse(await req.json());
    if (!parsed.success) return jsonError(400, "Give the batch a short slug id.");
    const result = await runPayoutBatch(parsed.data.batchId);
    return NextResponse.json(result);
  });
}
