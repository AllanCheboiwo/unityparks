import path from "path";
import { fileURLToPath } from "url";
import type { CollectionConfig } from "payload";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export const Media: CollectionConfig = {
  slug: "media",
  admin: {
    useAsTitle: "alt",
  },
  upload: {
    // Local storage in dev only; production stores in R2 (see payload.config.ts).
    staticDir: path.resolve(dirname, "../../media"),
    mimeTypes: ["image/*", "video/*"],
  },
  fields: [
    {
      name: "alt",
      type: "text",
      required: true,
      admin: {
        description: "Describes the image for screen readers.",
      },
    },
    {
      name: "creditUrl",
      type: "text",
      required: true,
      admin: {
        description:
          "Source page for this asset, e.g. the Pexels photo URL. Every file must have one; never upload Center Parcs media. See public/photos/CREDITS.md for the rules.",
      },
    },
    {
      name: "license",
      type: "text",
      required: true,
      defaultValue: "Pexels License",
    },
  ],
};
