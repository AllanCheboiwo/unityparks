import type { GlobalConfig } from "payload";

/**
 * Site-wide chrome an editor owns. Deliberately small: the teal banner under
 * the header is the campaign slot (docs/content-strategy.md), rotated a
 * handful of times a year alongside the homepage hero's urgency line. Point
 * it at whatever the village is selling next: a campaign page under
 * /breaks/<slug>, or /#search when nothing is running.
 */
export const SiteSettings: GlobalConfig = {
  slug: "site-settings",
  // Site visitors read this content anonymously; only writes need an admin.
  access: {
    read: () => true,
  },
  fields: [
    {
      name: "banner",
      type: "group",
      fields: [
        {
          name: "text",
          type: "text",
          required: true,
          admin: {
            description:
              "One sentence, shown site-wide on the teal stripe under the header.",
          },
        },
        { name: "linkLabel", type: "text", required: true },
        {
          name: "linkHref",
          type: "text",
          required: true,
          admin: {
            description:
              "Internal path, e.g. /breaks/august-by-the-fire or /#search.",
          },
        },
      ],
    },
  ],
};
