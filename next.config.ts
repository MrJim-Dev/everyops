import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  // Files over Cloud Run's 32 MiB response limit go through a route that streams them in ranges.
  async rewrites() {
    return {
      beforeFiles: [{ source: "/demo.mp4", destination: "/api/media/demo.mp4" }],
      afterFiles: [],
      fallback: [],
    };
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
