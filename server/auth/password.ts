import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

/**
 * Password hashing with Node's built-in scrypt - no external dependency,
 * every line explainable. Stored as "saltHex:hashHex" in User.passwordHash.
 * Needs the Node runtime; auth routes must never opt into the edge runtime.
 */

const scrypt = promisify(scryptCallback);

const SALT_BYTES = 16;
const KEY_BYTES = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = (await scrypt(password, salt, KEY_BYTES)) as Buffer;
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  if (expected.length !== KEY_BYTES) return false;
  const actual = (await scrypt(password, Buffer.from(saltHex, "hex"), KEY_BYTES)) as Buffer;
  return timingSafeEqual(actual, expected);
}
