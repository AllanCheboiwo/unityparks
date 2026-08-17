import type { CollectionConfig } from "payload";

/**
 * Evergreen campaign landing pages, served at /breaks/<slug>. Per
 * docs/village-and-content-direction.md section 10.4, a campaign is an
 * evergreen page with a changing window line, never a dated page, so the
 * same document sells the same moment every year with a two-minute edit.
 * The site banner (SiteSettings) is how a campaign gets pointed at.
 */
export const Campaigns: CollectionConfig = {
  slug: "campaigns",
  // Site visitors read this content anonymously; only writes need an admin.
  access: {
    read: () => true,
  },
  admin: {
    useAsTitle: "name",
    defaultColumns: ["name", "window", "slug"],
    description: "Evergreen campaign pages at /breaks/<slug>.",
  },
  fields: [
    {
      name: "slug",
      type: "text",
      required: true,
      unique: true,
      admin: {
        description:
          "URL and seed key: the page lives at /breaks/<slug>. Do not change once set.",
      },
    },
    { name: "name", type: "text", required: true },
    {
      name: "window",
      type: "text",
      required: true,
      admin: {
        description:
          "The changing window line, e.g. June to September, at its best in the August holidays.",
      },
    },
    {
      name: "strapline",
      type: "text",
      required: true,
      admin: { description: "One italic line under the name in the hero." },
    },
    { name: "intro", type: "textarea", required: true },
    { name: "hero", type: "upload", relationTo: "media", required: true },
    {
      name: "fromPrice",
      type: "text",
      required: true,
      admin: { description: "Shown exactly as typed, e.g. from KES 96,000*" },
    },
    {
      name: "fromNote",
      type: "text",
      required: true,
      admin: { description: "The footnote that keeps the from-price honest." },
    },
    {
      name: "ctaLabel",
      type: "text",
      required: true,
      defaultValue: "Find your break",
    },
    {
      name: "highlights",
      type: "array",
      minRows: 1,
      fields: [
        { name: "title", type: "text", required: true },
        { name: "copy", type: "textarea", required: true },
        { name: "photo", type: "upload", relationTo: "media", required: true },
      ],
    },
    {
      name: "faqs",
      type: "array",
      fields: [
        { name: "question", type: "text", required: true },
        { name: "answer", type: "textarea", required: true },
      ],
    },
  ],
};
