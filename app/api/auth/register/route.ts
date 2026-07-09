import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { handleRoute, jsonError, PublicError } from "@/server/api-helpers";
import { hashPassword } from "@/server/auth/password";
import { normalizeEmail } from "@/server/auth/normalize";
import { createAuthSession } from "@/server/auth/session";
import { claimByEmail } from "@/server/auth/claim";

const RegisterBody = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().trim().email(),
  password: z.string().min(8),
  phone: z.string().min(7).optional(),
});

/** Creates the account, adopts any past guest bookings with this email,
 * and signs the new user in - one submit, no separate login step. */
export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const parsed = RegisterBody.safeParse(await req.json());
    if (!parsed.success) return jsonError(400, "Please check the registration form.");
    const email = normalizeEmail(parsed.data.email);

    let user;
    try {
      user = await prisma.user.create({
        data: {
          email,
          passwordHash: await hashPassword(parsed.data.password),
          firstName: parsed.data.firstName.trim(),
          lastName: parsed.data.lastName.trim(),
          phone: parsed.data.phone ?? null,
        },
      });
    } catch (err) {
      // Unique-email race or plain duplicate: same answer either way.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new PublicError(
          409,
          "This email already has a Unity Parks account. Sign in to continue.",
        );
      }
      throw err;
    }

    await claimByEmail(user.id, email);
    await createAuthSession(user.id);
    return NextResponse.json({ ok: true, firstName: user.firstName, email: user.email });
  });
}
