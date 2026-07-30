import type { CollectionConfig } from "payload";

// Payload admin panel accounts. Completely separate from the Prisma User
// table that holds guest accounts; the two never mix.
export const Admins: CollectionConfig = {
  slug: "admins",
  auth: true,
  admin: {
    useAsTitle: "email",
  },
  fields: [],
};
