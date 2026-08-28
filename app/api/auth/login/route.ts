import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { stampSessionUser } from "@/server/booking/session";
import { handleRoute, jsonError, PublicError } from "@/server/api-helpers";
import { verifyPassword } from "@/server/auth/password";
import { normalizeEmail } from "@/server/auth/normalize";
import { createAuthSession } from "@/server/auth/session";
import { claimByEmail } from "@/server/auth/claim";

const LoginBody = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
  // Present when signing in inline at the details step: the funnel session
  // to stamp with the freshly proven identity.
  sessionId: z.string().optional(),
  // "Keep me signed in": absent means unticked, consent never defaults on.
  remember: z.boolean().optional(),
});

/** One generic 401 whether the email is unknown or the password wrong -
 * the login form must not confirm which emails have accounts. */
export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const parsed = LoginBody.safeParse(await req.json());
    if (!parsed.success) return jsonError(400, "Please enter your email and password.");
    const email = normalizeEmail(parsed.data.email);

    const user = await prisma.user.findUnique({ where: { email } });
    const ok = user !== null && (await verifyPassword(parsed.data.password, user.passwordHash));
    if (!ok || user === null) {
      throw new PublicError(401, "Email or password is incorrect.");
    }

    // Lazy cleanup: this user's expired login sessions go now; nothing else
    // ever deletes them.
    await prisma.authSession.deleteMany({
      where: { userId: user.id, expiresAt: { lt: new Date() } },
    });
    await claimByEmail(user.id, email);
    await createAuthSession(user.id, parsed.data.remember ?? false);

    if (parsed.data.sessionId) {
      await stampSessionUser(parsed.data.sessionId, user.id);
    }

    return NextResponse.json({
      ok: true,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone,
      // The rest of the profile, so an inline sign-in at the details step
      // prefills the whole form just like arriving signed in.
      title: user.title,
      dateOfBirth: user.dateOfBirth,
      addressLine1: user.addressLine1,
      addressLine2: user.addressLine2,
      townCity: user.townCity,
      county: user.county,
      postcode: user.postcode,
      country: user.country,
      marketingEmail: user.marketingEmail,
      marketingSms: user.marketingSms,
    });
  });
}
