import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";
import { buildConfig } from "payload";
import { postgresAdapter } from "@payloadcms/db-postgres";
import { s3Storage } from "@payloadcms/storage-s3";

import { Admins } from "./cms/collections/Admins";
import { Media } from "./cms/collections/Media";
import { Activities } from "./cms/collections/Activities";
import { Seasons } from "./cms/collections/Seasons";
import { Faqs } from "./cms/collections/Faqs";
import { Campaigns } from "./cms/collections/Campaigns";
import { Extras } from "./cms/collections/Extras";
import { HomePage } from "./cms/globals/HomePage";
import { SiteSettings } from "./cms/globals/SiteSettings";

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

export default buildConfig({
  // Admin logins come from the Admins collection, never from guest accounts.
  admin: {
    user: "admins",
  },
  collections: [Admins, Media, Activities, Seasons, Faqs, Campaigns, Extras],
  globals: [HomePage, SiteSettings],
  db: postgresAdapter({
    pool: {
      connectionString: process.env.DATABASE_URL,
    },
    // Keeps every Payload table in its own Postgres schema, away from
    // the Prisma-managed tables in public. Experimental per Payload docs;
    // see docs/payload-cms-plan.md step 3.4 before changing.
    schemaName: "payload",
  }),
  secret: process.env.PAYLOAD_SECRET || "",
  typescript: {
    outputFile: path.resolve(dirname, "cms/payload-types.ts"),
  },
  sharp,
  plugins: [
    // Declared unconditionally so dev and prod share one schema; only the
    // storage backend differs. Dev keeps files in ./media, prod uses R2.
    s3Storage({
      enabled: process.env.NODE_ENV === "production",
      // Keep the plugin's schema fields present even when disabled in dev,
      // so dev-generated migrations match the production schema.
      alwaysInsertFields: true,
      collections: {
        media: { prefix: "media" },
      },
      bucket: process.env.R2_BUCKET || "",
      config: {
        region: "auto",
        endpoint: process.env.R2_ENDPOINT || "",
        credentials: {
          accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
        },
        forcePathStyle: true,
      },
    }),
  ],
});
