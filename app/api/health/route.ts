import { NextResponse } from "next/server";
import { prisma } from "@/server/db";

// Railway polls this route and restarts the app when it stops answering
// 200. Only our own database is checked on purpose: an Apaleo or Pesapal
// outage must not turn into a restart loop on our side (LO-16).
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
