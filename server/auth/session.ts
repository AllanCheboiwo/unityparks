import "server-only";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { User } from "@prisma/client";
import { prisma } from "../db";
import { PublicError } from "../api-helpers";

/**
 * Login sessions, mirroring the shape of server/booking/session.ts: a row in
 * the DB, a fixed expiry, helpers that return null rather than throw. The
 * AuthSession row id is itself the bearer token (256 random bits), carried by
 * an httpOnly cookie - nothing to sign, nothing to decode.
 */

const COOKIE_NAME = "up_session";
// No sliding refresh either way, so reads never write.
//
// "Keep me signed in" chooses the KIND of cookie, not its length. Unticked
// means a session cookie: no expiry attribute, so the browser drops it when
// it closes. Shortening a persistent cookie instead would still keep a guest
// signed in after they declined to be, which is the thing the tick asks
// about. The DB row needs a value in both cases, but for the unticked case
// it is only a server-side cap on a token the browser has already thrown
// away - garbage collection, not a promise to the guest.
const REMEMBERED_TTL_MS = 182 * 24 * 60 * 60 * 1000; // about six months
const SESSION_ONLY_TTL_MS = 24 * 60 * 60 * 1000;

/** Creates the DB session and sets the cookie. Route handlers only - Next
 * rejects cookie writes anywhere else. `remember` is the guest's answer to
 * "Keep me signed in"; see the TTL note above for why it changes the cookie's
 * kind rather than its length. */
export async function createAuthSession(
  userId: string,
  remember: boolean,
): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(
    Date.now() + (remember ? REMEMBERED_TTL_MS : SESSION_ONLY_TTL_MS),
  );
  await prisma.authSession.create({ data: { id: token, userId, expiresAt } });
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    // Omitted entirely when unticked: that is what makes it a session cookie.
    ...(remember ? { expires: expiresAt } : {}),
  });
}

/** The signed-in user, or null. Read-only, safe in any server context. */
export async function getCurrentUser(): Promise<User | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const session = await prisma.authSession.findUnique({
    where: { id: token },
    include: { user: true },
  });
  if (!session || session.expiresAt < new Date()) return null;
  return session.user;
}

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new PublicError(401, "Please sign in.");
  return user;
}

/** The /ops gate for API routes. Pages use getCurrentUser + notFound()
 * instead: a thrown PublicError only turns into a clean status inside
 * handleRoute, and a 404 keeps the admin area's existence quiet. */
export async function requireAdmin(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new PublicError(401, "Please sign in.");
  if (!user.isAdmin) throw new PublicError(403, "Not available.");
  return user;
}

/** Deletes the DB session and clears the cookie. Route handlers only. */
export async function destroyAuthSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (token) {
    await prisma.authSession.deleteMany({ where: { id: token } });
  }
  store.delete(COOKIE_NAME);
}
