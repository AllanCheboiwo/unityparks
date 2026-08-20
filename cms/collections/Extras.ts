import type { CollectionConfig } from "payload";

// Marketing content for the extras cards, keyed by Apaleo service code.
// Apaleo owns the name, price and short offer description; this owns the
// card photo, the unit noun and the "More information" copy.
export const Extras: CollectionConfig = {
  slug: "extras",
  // Site visitors read this content anonymously; only writes need an admin.
  access: {
    read: () => true,
  },
  admin: {
    useAsTitle: "serviceCode",
    defaultColumns: ["serviceCode", "displayOrder"],
  },
  defaultSort: "displayOrder",
  fields: [
    {
      name: "serviceCode",
      type: "text",
      required: true,
      unique: true,
      admin: {
        description:
          "Apaleo service code this content belongs to, e.g. CYCLE. Do not change once set.",
      },
    },
    {
      name: "photo",
      type: "upload",
      relationTo: "media",
      admin: {
        description: "Card photo. Leave empty to fall back to a plain icon tile.",
      },
    },
    {
      name: "noun",
      type: "text",
      admin: {
        description:
          "Singular unit noun for quantity items, e.g. bike. Leave empty for one-off packs.",
      },
    },
    {
      name: "more",
      type: "array",
      fields: [
        { name: "heading", type: "text", required: true },
        { name: "body", type: "textarea", required: true },
      ],
    },
    { name: "displayOrder", type: "number", required: true, defaultValue: 0 },
  ],
};
