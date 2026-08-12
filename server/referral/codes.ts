import "server-only";
import { randomInt } from "node:crypto";
import type { ReferralParticipant, User } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { CODE_ALPHABET, GENERATED_CODE_LENGTH } from "@/lib/referral";

/** A fresh code from the unambiguous alphabet (no 0/O or 1/I). */
export function generateCode(): string {
  let code = "";
  for (let i = 0; i < GENERATED_CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * The client-track on-ramp: a signed-in guest claims their permanent code.
 * Idempotent (an existing participant is simply returned), and collision
 * on the random code retries with a fresh one. Codes are permanent and
 * identify the person, nothing else; explicit claim keeps reads write-free
 * and means every participant consented to the programme.
 */
export async function claimClientCode(user: User): Promise<ReferralParticipant> {
  const existing = await prisma.referralParticipant.findUnique({
    where: { userId: user.id },
  });
  if (existing) return existing;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await prisma.referralParticipant.create({
        data: {
          kind: "client",
          name: `${user.firstName} ${user.lastName}`.trim(),
          email: user.email,
          phone: user.phone,
          code: generateCode(),
          userId: user.id,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        // Either the code collided (retry with a fresh one) or a racing
        // claim won on userId (return it).
        const raced = await prisma.referralParticipant.findUnique({
          where: { userId: user.id },
        });
        if (raced) return raced;
        continue;
      }
      throw err;
    }
  }
  throw new Error("Could not generate a unique referral code");
}
