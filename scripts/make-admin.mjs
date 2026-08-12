// Flags a Unity Parks account as admin, which gates the /ops pages. There
// is deliberately no in-app path to admin; this script is the only door.
// Idempotent: re-running on an admin is a no-op. Run from the repo root:
//   node scripts/make-admin.mjs someone@example.com
//   node scripts/make-admin.mjs someone@example.com --remove
import { PrismaClient } from "@prisma/client";

const email = process.argv[2]?.trim().toLowerCase();
const remove = process.argv.includes("--remove");
if (!email || !email.includes("@")) {
  console.error("Usage: node scripts/make-admin.mjs <email> [--remove]");
  process.exit(1);
}

const prisma = new PrismaClient();
try {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No account with email ${email}. Register on the site first.`);
    process.exit(1);
  }
  await prisma.user.update({ where: { id: user.id }, data: { isAdmin: !remove } });
  console.log(`${email} is ${remove ? "no longer" : "now"} an admin.`);
} finally {
  await prisma.$disconnect();
}
