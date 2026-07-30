import type { CollectionConfig } from "payload";

// The "Questions, answered" list on the homepage.
export const Faqs: CollectionConfig = {
  slug: "faqs",
  admin: {
    useAsTitle: "question",
    defaultColumns: ["question", "displayOrder"],
  },
  defaultSort: "displayOrder",
  fields: [
    { name: "question", type: "text", required: true, unique: true },
    { name: "answer", type: "textarea", required: true },
    { name: "displayOrder", type: "number", required: true, defaultValue: 0 },
  ],
};
