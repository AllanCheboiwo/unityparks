import { NextResponse } from "next/server";
import { handleRoute } from "@/server/api-helpers";
import { destroyAuthSession } from "@/server/auth/session";

export async function POST() {
  return handleRoute(async () => {
    await destroyAuthSession();
    return NextResponse.json({ ok: true });
  });
}
