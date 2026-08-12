// Seeds the initial referral program config. Idempotent: keyed by
// effectiveFrom, re-running updates the same row. To CHANGE the program
// later, do not edit a used row here; insert a new row with a later
// effectiveFrom (the config table is append-only by design,
// docs/referral-system-plan.md section 4).
//
// Run from the repo root:
//   npm run seed:referral
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Launch numbers, per the plan's placeholders (section 12). Whole KES.
const LAUNCH_CONFIG = {
  effectiveFrom: "2026-08-04",
  guestDiscount: 5000,
  clientCredit: 5000,
  defaultCommissionRate: 0.04, // of gross lodging net of discount, ~4.6% ex-VAT
  creditExpiryDays: 365,
};

async function main() {
  const existing = await prisma.referralConfig.findFirst({
    where: { effectiveFrom: LAUNCH_CONFIG.effectiveFrom },
  });
  if (existing) {
    await prisma.referralConfig.update({ where: { id: existing.id }, data: LAUNCH_CONFIG });
    console.log(`Updated referral config ${existing.id} (effective ${LAUNCH_CONFIG.effectiveFrom})`);
  } else {
    const created = await prisma.referralConfig.create({ data: LAUNCH_CONFIG });
    console.log(`Created referral config ${created.id} (effective ${LAUNCH_CONFIG.effectiveFrom})`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
