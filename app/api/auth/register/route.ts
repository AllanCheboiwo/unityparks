import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { handleRoute, jsonError, PublicError } from "@/server/api-helpers";
import { hashPassword } from "@/server/auth/password";
import { normalizeEmail } from "@/server/auth/normalize";
import { createAuthSession } from "@/server/auth/session";
import { claimByEmail } from "@/server/auth/claim";
import { sendWelcomeEmail } from "@/server/email/welcome";
import { adultAtArrival } from "@/lib/guestRules";

const RegisterBody = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().trim().email(),
  password: z.string().min(8),
  phone: z.string().min(7).optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // "Keep me signed in": absent means unticked, consent never defaults on.
  remember: z.boolean().optional(),
});

/** Creates the account, adopts any past guest bookings with this email,
 * and signs the new user in - one submit, no separate login step. */
export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const parsed = RegisterBody.safeParse(await req.json());
    if (!parsed.success) return jsonError(400, "Please check the registration form.");
    // Same rule as the checkout, anchored on today: an account holder must
    // be an adult now, whatever break they go on to book.
    const todayIso = new Date().toISOString().slice(0, 10);
    if (!adultAtArrival(parsed.data.dateOfBirth, todayIso)) {
      throw new PublicError(400, "You must be 18 or over to create an account.");
    }
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
          dateOfBirth: parsed.data.dateOfBirth,
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
    await createAuthSession(user.id, parsed.data.remember ?? false);
    // Fire-and-forget: the account exists whether or not the mail lands.
    void sendWelcomeEmail({ to: user.email, firstName: user.firstName }).catch(
      (err) => console.error(`[email] welcome to ${email} failed:`, err),
    );
    return NextResponse.json({ ok: true, firstName: user.firstName, email: user.email });
  });
}
