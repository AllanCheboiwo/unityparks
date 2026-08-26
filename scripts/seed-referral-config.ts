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

// The programme's history, one row per change, append-only. Whole KES.
const CONFIGS = [
  {
    // Launch numbers, per the plan's placeholders (section 12).
    effectiveFrom: "2026-08-04",
    guestDiscount: 5000,
    clientCredit: 5000,
    defaultCommissionRate: 0.04, // of gross lodging net of discount
    creditExpiryDays: 365,
    vatRate: 0, // gross basis; ~4.6% ex-VAT equivalent
  },
  {
    // Decided 25 Aug 2026: commission moves to a true ex-VAT base. The 16%
    // is arithmetic in our code, never Apaleo (the DE sandbox property
    // cannot express the Kenyan rate); 5% of ex-VAT is a small raise over
    // the launch 4% of gross (~4.64% ex-VAT equivalent).
    effectiveFrom: "2026-08-25",
    guestDiscount: 5000,
    clientCredit: 5000,
    defaultCommissionRate: 0.05, // of ex-VAT lodging net of discount
    creditExpiryDays: 365,
    vatRate: 0.16,
  },
];

async function main() {
  for (const config of CONFIGS) {
    const existing = await prisma.referralConfig.findFirst({
      where: { effectiveFrom: config.effectiveFrom },
    });
    if (existing) {
      await prisma.referralConfig.update({ where: { id: existing.id }, data: config });
      console.log(`Updated referral config ${existing.id} (effective ${config.effectiveFrom})`);
    } else {
      const created = await prisma.referralConfig.create({ data: config });
      console.log(`Created referral config ${created.id} (effective ${config.effectiveFrom})`);
    }
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
