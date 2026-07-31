import type { NextConfig } from "next";
import { withPayload } from "@payloadcms/next/withPayload";

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

export default withPayload(nextConfig);
