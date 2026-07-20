import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/server/db";
import { handleRoute, jsonError } from "@/server/api-helpers";
import { normalizeEmail } from "@/server/auth/normalize";
import { sendPasswordResetEmail } from "@/server/email/passwordReset";

const ForgotBody = z.object({
  email: z.string().trim().email(),
});

// One hour: long enough to walk to an inbox, short enough that a leaked
// link goes stale the same afternoon.
const RESET_TTL_MS = 60 * 60 * 1000;

/**
 * "Forgotten your password" submit. The answer is the same generic ok
 * whether the email has an account or not, so the form cannot be used to
 * probe which emails are registered (same rule the login route follows).
 */
export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const parsed = ForgotBody.safeParse(await req.json());
    if (!parsed.success) return jsonError(400, "Please enter your email address.");
    const email = normalizeEmail(parsed.data.email);

    const user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      // At most one live link per account: older tokens die when a new one
      // is issued, and expired leftovers get swept in the same breath.
      await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
      const token = randomBytes(32).toString("base64url");
      await prisma.passwordResetToken.create({
        data: {
          id: token,
          userId: user.id,
          expiresAt: new Date(Date.now() + RESET_TTL_MS),
        },
      });
      await sendPasswordResetEmail({ to: email, firstName: user.firstName, token });
    }

    return NextResponse.json({ ok: true });
  });
}
