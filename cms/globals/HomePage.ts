import type { GlobalConfig } from "payload";

// Every editor-owned string on the homepage, one field per rendered slot.
// Layout copy (banner, footer, SEO) is NOT here; it stays in code until the
// SiteSettings phase. Field names mirror app/(site)/page.tsx section order.
export const HomePage: GlobalConfig = {
  slug: "home-page",
  // Site visitors read this content anonymously; only writes need an admin.
  access: {
    read: () => true,
  },
  fields: [
    {
      name: "hero",
      type: "group",
      fields: [
        // The h1 renders as: headingBefore <em>headingEmphasis</em> headingAfter
        { name: "headingBefore", type: "text", required: true },
        { name: "headingEmphasis", type: "text", required: true },
        // Optional: the current heading ends on the emphasis.
        { name: "headingAfter", type: "text" },
        { name: "subheading", type: "text", required: true },
        { name: "intro", type: "textarea", required: true },
        {
          name: "urgency",
          type: "textarea",
          required: true,
          admin: {
            description:
              "Point this at the next school-holiday window: the April holidays, the August holidays, or the long November to January break. Update it each term, it takes two minutes.",
          },
        },
        { name: "ctaLabel", type: "text", required: true },
        { name: "video", type: "upload", relationTo: "media", required: true },
        { name: "poster", type: "upload", relationTo: "media", required: true },
        {
          name: "videoDescription",
          type: "text",
          required: true,
          admin: { description: "Read by screen readers instead of the video." },
        },
      ],
    },
    {
      name: "village",
      type: "group",
      fields: [
        { name: "heading", type: "text", required: true },
        { name: "intro", type: "textarea", required: true },
        { name: "cardName", type: "text", required: true },
        { name: "locationLine", type: "text", required: true },
        { name: "blurb", type: "textarea", required: true },
        {
          name: "mapAlt",
          type: "text",
          required: true,
          admin: { description: "Alt text for the village map illustration." },
        },
      ],
    },
    {
      name: "sections",
      type: "group",
      fields: [
        { name: "lodgesHeading", type: "text", required: true },
        { name: "lodgesIntro", type: "textarea", required: true },
        { name: "activitiesHeading", type: "text", required: true },
        { name: "activitiesIntro", type: "textarea", required: true },
        { name: "seasonsHeading", type: "text", required: true },
        {
          name: "seasonsFootnote",
          type: "text",
          required: true,
          admin: { description: "The small print under the season cards." },
        },
        { name: "discoverHeading", type: "text", required: true },
        { name: "faqsHeading", type: "text", required: true },
      ],
    },
    {
      name: "discoverCards",
      type: "array",
      minRows: 1,
      fields: [
        { name: "title", type: "text", required: true },
        { name: "copy", type: "textarea", required: true },
        { name: "photo", type: "upload", relationTo: "media", required: true },
      ],
    },
  ],
};
