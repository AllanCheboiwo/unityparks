import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { handleRoute, jsonError, PublicError } from "@/server/api-helpers";
import { hashPassword } from "@/server/auth/password";

const ResetBody = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
});

/**
 * The emailed link's submit: swap the password, burn the token, sign the
 * account out everywhere. Consuming the token and deleting every login
 * session in one transaction means a stolen-then-raced link can never
 * leave an old session alive alongside the new password.
 */
export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const parsed = ResetBody.safeParse(await req.json());
    if (!parsed.success) {
      return jsonError(400, "Please choose a password of at least 8 characters.");
    }

    const token = await prisma.passwordResetToken.findUnique({
      where: { id: parsed.data.token },
    });
    if (!token || token.expiresAt < new Date()) {
      throw new PublicError(
        400,
        "This reset link has expired or was already used. Request a new one.",
      );
    }

    const passwordHash = await hashPassword(parsed.data.password);
    await prisma.$transaction([
      prisma.user.update({ where: { id: token.userId }, data: { passwordHash } }),
      prisma.passwordResetToken.deleteMany({ where: { userId: token.userId } }),
      prisma.authSession.deleteMany({ where: { userId: token.userId } }),
    ]);

    return NextResponse.json({ ok: true });
  });
}
