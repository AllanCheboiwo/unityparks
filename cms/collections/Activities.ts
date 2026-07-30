import type { CollectionConfig } from "payload";

// The "Things to do" cards on the homepage.
export const Activities: CollectionConfig = {
  slug: "activities",
  // Site visitors read this content anonymously; only writes need an admin.
  access: {
    read: () => true,
  },
  admin: {
    useAsTitle: "title",
    defaultColumns: ["title", "displayOrder"],
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
    { name: "photo", type: "upload", relationTo: "media", required: true },
    { name: "displayOrder", type: "number", required: true, defaultValue: 0 },
  ],
};
