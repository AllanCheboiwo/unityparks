import type { NextConfig } from "next";
import { withPayload } from "@payloadcms/next/withPayload";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  images: {
    // Once localPatterns exists, every local image must match an entry.
    // CMS media carries a query string in production (?prefix=media from the
    // R2 storage plugin), which Next blocks by default; omitting `search`
    // on the pattern allows any query.
    localPatterns: [
      { pathname: "/api/media/file/**" },
      { pathname: "/photos/**" },
      { pathname: "/village-map.svg" },
    ],
  },
};

// Source maps upload only when SENTRY_AUTH_TOKEN is set (Railway). Without
// it the build still succeeds and Sentry shows minified frames; the plugin
// says so in the build log, which is why nothing here silences it.
export default withSentryConfig(withPayload(nextConfig), {
  org: "unity-parks",
  project: "unity-parks",
});
