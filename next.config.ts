import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  serverExternalPackages: ["pdfjs-dist", "@napi-rs/canvas", "yauzl", "saxes"],
  outputFileTracingIncludes: {
    "/api/import": ["./node_modules/pdfjs-dist/**/*", "./node_modules/@napi-rs/**/*"],
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
