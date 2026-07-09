import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { handleRoute, jsonError } from "@/server/api-helpers";
import { normalizeEmail } from "@/server/auth/normalize";

const Body = z.object({ email: z.string().trim().email() });

/**
 * The Center Parcs "have an account with us?" check at the details step.
 * Deliberately an existence oracle - the product tells guests whether an
 * email has an account, so no point pretending otherwise elsewhere. The
 * response echoes the checked email so the client can discard answers for
 * a value the guest has since edited.
 */
export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return jsonError(400, "Please enter a valid email address.");
    const email = normalizeEmail(parsed.data.email);
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    return NextResponse.json({ email, status: user ? "active" : "none" });
  });
}
