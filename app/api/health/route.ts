import { NextResponse } from "next/server";
import { prisma } from "@/server/db";

// Railway calls this route at the start of each deploy and only routes
// traffic to the new container once it answers 2xx. It is not polled after
// that and never triggers restarts. Only our own database is checked on
// purpose: an Apaleo or Pesapal outage must not block our deploys (LO-16).
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
