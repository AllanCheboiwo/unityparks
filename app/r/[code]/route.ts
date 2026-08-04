import { NextRequest, NextResponse } from "next/server";
import { isValidCodeFormat, normalizeReferralCode } from "@/lib/referral";

// Referral capture: unityparks.com/r/AMINA drops the code in a cookie and
// lands on the homepage. A route handler because cookie writes are only
// allowed here (same restriction createAuthSession documents). The cookie
// only bridges the gap until a BookingSession exists; the search route
// stamps the code onto the session and the funnel never reads the cookie
// again (checkout retries can arrive cookieless).
const REFERRAL_COOKIE = "up_ref";
const COOKIE_MAX_AGE_S = 30 * 24 * 60 * 60;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const normalized = normalizeReferralCode(decodeURIComponent(code));
  const res = NextResponse.redirect(new URL("/", req.url));
  // Garbage codes get no cookie but still land somewhere sensible. No DB
  // check here: validation happens at the details step and again at
  // checkout, where refusal has a face.
  if (isValidCodeFormat(normalized)) {
    res.cookies.set(REFERRAL_COOKIE, normalized, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: COOKIE_MAX_AGE_S,
    });
  }
  return res;
}
