import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { normalizeEmail } from "@/server/auth/normalize";
import { handleRoute, jsonError } from "@/server/api-helpers";

// The RFC 5321 cap: without it an oversized address sails past validation
// and dies on Postgres' btree index limit, or stores multi-KB junk forever.
const SignupBody = z.object({ email: z.string().trim().email().max(254) });

/**
 * The footer newsletter sign-up. Stores the lowercase email and nothing
 * else; signing up twice is a cheerful no-op rather than an error, so the
 * form can always answer "you're on the list" honestly.
 */
export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const parsed = SignupBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, "That doesn't look like an email address.");

    const email = normalizeEmail(parsed.data.email);
    try {
      await prisma.newsletterSubscriber.create({ data: { email } });
    } catch (err) {
      const alreadySubscribed =
        err && typeof err === "object" && "code" in err && err.code === "P2002";
      if (!alreadySubscribed) throw err;
    }
    return NextResponse.json({ ok: true });
  });
}
