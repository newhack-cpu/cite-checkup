import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // 单元测试不加载本机向量模型（100 多 MB、要几秒）；向量召回一路在测试里用替身
  test: { env: { EMBEDDING_MODEL_DIR: "off" } },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
});
