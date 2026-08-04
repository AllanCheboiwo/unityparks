import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { getSession, setGuestDetails, setReferralOnSession } from "@/server/booking/session";
import { validateReferralCode } from "@/server/referral/validate";
import { normalizeReferralCode } from "@/lib/referral";
import { getCurrentUser, createAuthSession } from "@/server/auth/session";
import { hashPassword } from "@/server/auth/password";
import { normalizeEmail } from "@/server/auth/normalize";
import { claimByEmail } from "@/server/auth/claim";
import { handleRoute, jsonError } from "@/server/api-helpers";

const DetailsBody = z.object({
  title: z.enum(["Mr", "Mrs", "Ms", "Miss", "Dr"]).optional(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().trim().email(),
  phone: z.string().min(7),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // Postal address (welcome-pack story). Stays local: session snapshot and
  // account profile, never Apaleo. Line 2, county and postcode are optional -
  // postcodes are patchy in Kenya.
  addressLine1: z.string().trim().min(1),
  addressLine2: z.string().trim().optional(),
  townCity: z.string().trim().min(1),
  county: z.string().trim().optional(),
  postcode: z.string().trim().optional(),
  country: z.string().trim().min(1),
  marketingEmail: z.boolean().optional(),
  marketingSms: z.boolean().optional(),
  // The client gates submit on the checkbox; the server enforces it too.
  termsAccepted: z.literal(true),
  // Present when the guest ticked "Create my Unity Parks account".
  password: z.string().min(8).optional(),
  // The referral code field, always sent (prefilled from the session);
  // empty string means the guest cleared it. Last code standing wins.
  referralCode: z.string().trim().max(40).optional(),
});

/** The profile columns shared by account creation and write-back. Email is
 * deliberately absent: the lead-guest email edits the booking, never the
 * account. */
function profileData(
  guest: Omit<z.infer<typeof DetailsBody>, "password" | "termsAccepted">,
) {
  return {
    firstName: guest.firstName.trim(),
    lastName: guest.lastName.trim(),
    phone: guest.phone,
    title: guest.title ?? null,
    dateOfBirth: guest.dateOfBirth,
    addressLine1: guest.addressLine1,
    addressLine2: guest.addressLine2 ?? null,
    townCity: guest.townCity,
    county: guest.county ?? null,
    postcode: guest.postcode ?? null,
    country: guest.country,
    marketingEmail: guest.marketingEmail ?? false,
    marketingSms: guest.marketingSms ?? false,
  };
}

/** True when someone born on dob is 18 or older on the arrival date. Pure
 * ISO string arithmetic - no timezones to get wrong. */
function adultAtArrival(dob: string, arrival: string): boolean {
  const cutoff = `${Number(arrival.slice(0, 4)) - 18}${arrival.slice(4)}`;
  return dob <= cutoff;
}

/**
 * Lead guest details plus, Center Parcs style, the account moment: a signed
 * in guest stamps their walk, a new password mints a complete account, and
 * plain guests stay plain guests.
 *
 * Guard order is load-bearing: the record-exists check freezes the guest
 * columns (and ownership) the moment a real Apaleo reservation exists, so a
 * checkout retry can never be hijacked into rewriting the email and adopting
 * a paid booking through the claim backfill.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleRoute(async () => {
    const { id } = await params;
    const session = await getSession(id);
    if (!session) return jsonError(410, "Session expired.");
    if (session.state === "completed") {
      return jsonError(409, "This booking is already confirmed. Start a new search to book another break.");
    }
    const existingRecord = await prisma.bookingRecord.findUnique({
      where: { sessionId: id },
      select: { id: true },
    });
    if (existingRecord) {
      return jsonError(409, "Your booking is already being confirmed. Press Buy now to finish.");
    }

    const parsed = DetailsBody.safeParse(await req.json());
    if (!parsed.success) return jsonError(400, "Please check the details form.");
    // termsAccepted is validated by Zod (must be true) and not stored.
    const { password, termsAccepted, referralCode, ...guest } = parsed.data;
    void termsAccepted;
    if (!adultAtArrival(guest.dateOfBirth, session.arrival)) {
      return jsonError(400, "The lead booker must be over 18 at the time of arrival.");
    }
    const email = normalizeEmail(guest.email);

    // Identity snapshot: whoever is signed in NOW. Null when signed out,
    // written unconditionally so a stale stamp never survives a sign-out.
    let user = await getCurrentUser();
    let accountCreated = false;

    if (!user && password) {
      try {
        user = await prisma.user.create({
          data: {
            email,
            passwordHash: await hashPassword(password),
            ...profileData(guest),
          },
        });
      } catch (err) {
        // The email-status check said "none" but an account exists now (or
        // the check was skipped). Flip the client into its sign-in card.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          return NextResponse.json(
            {
              error: "This email already has a Unity Parks account. Sign in to continue.",
              emailTaken: true,
            },
            { status: 409 },
          );
        }
        throw err;
      }
      await claimByEmail(user.id, email);
      // Signs the response: the guest reaches the pay step already signed in.
      await createAuthSession(user.id);
      accountCreated = true;
    }

    // Center Parcs semantics: for a signed-in guest this form is a view of
    // their account, and edits write back. A just-created account already
    // carries these fields; email is never touched (the lead-guest email
    // edits the booking, not the account).
    if (user && !accountCreated) {
      await prisma.user.update({ where: { id: user.id }, data: profileData(guest) });
    }

    await setGuestDetails(id, guest, user?.id ?? null);

    // Referral: last code standing at details submit wins. Valid codes stamp
    // the code plus the advisory discount snapshot; anything else clears
    // both (the inline check already told the guest why). The record-exists
    // 409 above is the freeze rule: once folio totals exist, no code change.
    let referral: { applied: boolean; discount: number | null } = {
      applied: false,
      discount: null,
    };
    const typedCode = normalizeReferralCode(referralCode ?? "");
    if (typedCode) {
      const check = await validateReferralCode({
        code: typedCode,
        guestEmail: email,
        guestPhone: guest.phone,
        sessionUserId: user?.id ?? null,
      });
      if (check.ok) {
        await setReferralOnSession(id, { code: typedCode, discount: check.discount });
        referral = { applied: true, discount: check.discount };
      } else {
        await setReferralOnSession(id, { code: null, discount: null });
      }
    } else {
      await setReferralOnSession(id, { code: null, discount: null });
    }

    return NextResponse.json({ ok: true, accountCreated, referral });
  });
}
