import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { getSession, setGuestDetails, setReferralOnSession } from "@/server/booking/session";
import { validateReferralCode } from "@/server/referral/validate";
import { findClaim, isLiveClaim, releaseClaim } from "@/server/referral/claim";
import { pendingRedemptionForSession } from "@/server/repeatOffer/derive";
import { normalizeReferralCode } from "@/lib/referral";
import { adultAtArrival } from "@/lib/guestRules";
import { getCurrentUser, createAuthSession } from "@/server/auth/session";
import { hashPassword } from "@/server/auth/password";
import { normalizeEmail } from "@/server/auth/normalize";
import { claimByEmail } from "@/server/auth/claim";
import { sendWelcomeEmail } from "@/server/email/welcome";
import { handleRoute, jsonError } from "@/server/api-helpers";

const DetailsBody = z.object({
  title: z.enum(["Mr", "Mrs", "Ms", "Miss", "Dr"]).optional(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().trim().email(),
  phone: z.string().min(7),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // Postal address (welcome-pack story). Stays local: session snapshot and
  // account profile, never Apaleo. The form no longer asks for any of it,
  // so every field is optional; the columns stay for the data already in
  // them.
  addressLine1: z.string().trim().min(1).optional(),
  addressLine2: z.string().trim().optional(),
  townCity: z.string().trim().min(1).optional(),
  county: z.string().trim().optional(),
  postcode: z.string().trim().optional(),
  country: z.string().trim().min(1).optional(),
  marketingEmail: z.boolean().optional(),
  marketingSms: z.boolean().optional(),
  // The client gates submit on the checkbox; the server enforces it too.
  termsAccepted: z.literal(true),
  // Mandatory for a signed-out guest, forbidden for a signed-in one. The
  // rule is conditional on identity, so it cannot live in the shape: it is
  // enforced below, after getCurrentUser, where the refusal can say which
  // of the two mistakes was made.
  password: z.string().min(8).optional(),
  // "Keep me signed in" from the create-account card. Same wire name as the
  // login and register routes: one vocabulary for one flag, so a change to
  // remember semantics cannot miss this door. Absent means unticked -
  // consent never defaults on.
  remember: z.boolean().optional(),
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
    addressLine1: guest.addressLine1 ?? null,
    addressLine2: guest.addressLine2 ?? null,
    townCity: guest.townCity ?? null,
    county: guest.county ?? null,
    postcode: guest.postcode ?? null,
    country: guest.country ?? null,
    marketingEmail: guest.marketingEmail ?? false,
    marketingSms: guest.marketingSms ?? false,
  };
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
    const { password, remember, termsAccepted, referralCode, ...guest } = parsed.data;
    void termsAccepted;
    if (!adultAtArrival(guest.dateOfBirth, session.arrival)) {
      return jsonError(400, "The lead booker must be over 18 at the time of arrival.");
    }
    const email = normalizeEmail(guest.email);

    // Identity snapshot: whoever is signed in NOW. Null when signed out,
    // written unconditionally so a stale stamp never survives a sign-out.
    let user = await getCurrentUser();
    let accountCreated = false;

    // Mandatory accounts (UNP-19): a booking cannot leave this step without
    // an owner. One if/else on identity, so the invariant lives in exactly
    // one place: signed out, the password mints the owner; signed in, the
    // form is a view of the account and a riding password is refused rather
    // than ignored (it is either a stale form or a bid for a second
    // account). Each refusal names the mistake and carries a machine flag,
    // because the client's rendered state can lag the cookie's truth and
    // the flag is how it resyncs.
    if (!user) {
      if (!password) {
        // signedOut: a client that believed it was signed in (dead cookie,
        // sign-out in another tab) resyncs instead of hunting for a
        // password field it never rendered.
        return NextResponse.json(
          {
            error:
              "Please choose a password to create your account. Every booking needs one.",
            signedOut: true,
          },
          { status: 400 },
        );
      }
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
      await createAuthSession(user.id, remember ?? false);
      // Fire-and-forget: the account exists whether or not the mail lands.
      void sendWelcomeEmail({ to: user.email, firstName: user.firstName }).catch(
        (err) => console.error(`[email] welcome to ${email} failed:`, err),
      );
      accountCreated = true;
    } else {
      if (password) {
        // alreadySignedIn: the create-account card was rendered, then a
        // sign-in landed from another tab or an earlier submit's cookie
        // survived a lost response. The client reloads into the signed-in
        // view, which prefills from the account.
        return NextResponse.json(
          {
            error: "You are already signed in, so there is no password to set here.",
            alreadySignedIn: true,
          },
          { status: 400 },
        );
      }
      // Center Parcs semantics: for a signed-in guest this form is a view of
      // their account, and edits write back. Email is never touched (the
      // lead-guest email edits the booking, not the account).
      await prisma.user.update({ where: { id: user.id }, data: profileData(guest) });
    }

    // Applied credit belongs to the signed-in identity that applied it. If
    // the identity changed since (sign-out on a shared machine, a different
    // user signing in mid-funnel), the stale application would either be
    // silently skipped at checkout (display disagreeing with the charge) or
    // spend the previous user's credit. Give any committed claim back to
    // its owner and clear the flags; the guest re-applies at the pay step.
    if (session.userId !== user.id) {
      const claim = await findClaim(id);
      if (isLiveClaim(claim)) {
        const released = await releaseClaim(claim);
        if (!released) {
          // The claim is already on this booking's folio, so the credit
          // cannot go home and a different account must not inherit the
          // discount it paid for. This walk belongs to whoever applied it.
          return jsonError(
            409,
            "This booking already has referral credit applied by another account. Please start a new search.",
          );
        }
      }
      // The repeat-guest offer is account state too: it must not outlive
      // the account that earned it. A PENDING redemption is the same wall
      // as a committed claim: its allowance may already be on the folios.
      // Only a walk that had a signed-in owner can carry one, so a fresh
      // guest walk (userId null) skips the read.
      if (session.userId != null) {
        const pendingOffer = await pendingRedemptionForSession(id);
        if (pendingOffer && pendingOffer.claimantUserId !== user.id) {
          return jsonError(
            409,
            "This booking already has a repeat-guest offer applied by another account. Please start a new search.",
          );
        }
      }
      await prisma.bookingSession.updateMany({
        where: { id, booking: null },
        data: {
          applyCredit: false,
          creditAmount: null,
          repeatOfferRecordId: null,
          repeatOfferDiscount: null,
        },
      });
    }

    await setGuestDetails(id, guest, user.id);

    // Referral: last code standing at details submit wins. Valid codes stamp
    // the code plus the advisory discount snapshot; anything else clears
    // both (the inline check already told the guest why). The record-exists
    // 409 above is the freeze rule: once folio totals exist, no code change.
    // Field semantics: empty string = the guest cleared it; ABSENT = keep
    // and revalidate whatever is stamped (a /r/ link stamps the code with
    // no snapshot, and a client that never renders the field must not wipe
    // it).
    let referral: { applied: boolean; discount: number | null } = {
      applied: false,
      discount: null,
    };
    const typedCode =
      referralCode === undefined
        ? normalizeReferralCode(session.referralCode ?? "")
        : normalizeReferralCode(referralCode);
    if (typedCode) {
      // One discount instrument per booking (UNP-7 decision 7): a session
      // already carrying the repeat-guest offer (a live snapshot, or an
      // in-flight claim from a crashed checkout) refuses a referral code
      // here at the stamp, not at the money click. Skipped when the
      // identity just changed, because that block cleared the snapshot.
      const offerRiding =
        session.userId === user.id &&
        (session.repeatOfferRecordId != null ||
          (await pendingRedemptionForSession(id)) != null);
      if (offerRiding) {
        return jsonError(
          409,
          "This booking carries your repeat-guest offer, which cannot be combined with a referral code. Remove the offer at the pay step first.",
        );
      }
      const check = await validateReferralCode({
        code: typedCode,
        guestEmail: email,
        guestPhone: guest.phone,
        sessionUserId: user.id,
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
