import type { NextConfig } from "next";

// 向量模型的运行时（onnxruntime-node）按平台动态加载原生库，构建时的文件追踪找不到，要点名带上；只带当前平台的
const ONNX_RUNTIME = `./node_modules/.pnpm/onnxruntime-node@*/node_modules/onnxruntime-node/bin/napi-v6/${process.platform}/${process.arch}/**/*`;

const nextConfig: NextConfig = {
  // Docker builds opt in; platform adapters keep their existing output format.
  output: process.env.DEPLOY_OUTPUT === "standalone" ? "standalone" : undefined,
  cacheComponents: true,
  partialPrefetching: true,
  serverExternalPackages: ["pdfjs-dist", "@napi-rs/canvas", "yauzl", "saxes", "@huggingface/transformers", "onnxruntime-node", "sharp"],
  outputFileTracingIncludes: {
    "/api/import": ["./node_modules/pdfjs-dist/**/*", "./node_modules/@napi-rs/**/*"],
    "/api/claims": [ONNX_RUNTIME],
  },
  // 模型文件（约 135 MB）由 Dockerfile 单独复制到运行镜像，不随路由打包再带一份
  outputFileTracingExcludes: { "*": ["./models/**/*"] },
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
