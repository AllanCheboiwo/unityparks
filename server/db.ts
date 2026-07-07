import "server-only";
import { PrismaClient } from "@prisma/client";

// Next.js dev hot-reloads modules; the global stash prevents a new client
// (and connection) per reload.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
