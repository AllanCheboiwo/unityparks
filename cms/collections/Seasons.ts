import type { CollectionConfig } from "payload";

// The seasonal promo cards on the homepage. fromPrice is a marketing string
// maintained by editors, not a live Apaleo price; the homepage footnote
// carries the disclaimer.
export const Seasons: CollectionConfig = {
  slug: "seasons",
  // Site visitors read this content anonymously; only writes need an admin.
  access: {
    read: () => true,
  },
  admin: {
    useAsTitle: "title",
    defaultColumns: ["title", "fromPrice", "displayOrder"],
  },
  defaultSort: "displayOrder",
  fields: [
    {
      name: "slug",
      type: "text",
      required: true,
      unique: true,
      admin: {
        description: "Stable key used by the seed script. Do not change once set.",
      },
    },
    { name: "title", type: "text", required: true },
    { name: "copy", type: "textarea", required: true },
    {
      name: "fromPrice",
      type: "text",
      required: true,
      admin: {
        description: "Shown exactly as typed, e.g. from KES 38,500*",
      },
    },
    { name: "photo", type: "upload", relationTo: "media", required: true },
    { name: "displayOrder", type: "number", required: true, defaultValue: 0 },
  ],
};
