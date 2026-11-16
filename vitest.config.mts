import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 单元测试不加载本机向量模型（100 多 MB、要几秒）；向量召回一路在测试里用替身
    env: { EMBEDDING_MODEL_DIR: "off" },
    // output/ 和 tmp/ 是本机生成的材料（软著快照里有整份源码和测试的拷贝），不进 Git，也不算项目测试
    exclude: [...configDefaults.exclude, "output/**", "tmp/**"],
  },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
});
