import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker builds opt in; platform adapters keep their existing output format.
  output: process.env.DEPLOY_OUTPUT === "standalone" ? "standalone" : undefined,
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
