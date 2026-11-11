// 下载论断检索用的向量模型（multilingual-e5-small 的 ONNX 量化版，MIT 许可，约 135 MB）到 models/ 目录。
// 用法：node scripts/fetch-embedding-model.mjs [目标目录]
// 来源是魔搭上的 Xenova/multilingual-e5-small，国内构建环境能直接访问；固定到一个提交，每个文件下载后核对字节数和 SHA-256，
// 对不上就删掉并报错。已存在且校验通过的文件不重复下载。模型不进 Git 仓库：本机开发、评测和 Docker 构建时各自运行本脚本。
// 没有模型时应用照常运行，论断检索只是少一路向量召回（见 src/lib/claims/embedding.ts）。
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const REPO = "Xenova/multilingual-e5-small";
const REVISION = "a68f91cc31363a52c34be8cd041f2cdb10c44017";
const FILES = [
  { path: "config.json", bytes: 658, sha256: "cb99455288675345e1a4f411438d5d0adbba5fbd3a67ea4fb03c015433b996c1" },
  { path: "special_tokens_map.json", bytes: 167, sha256: "d05497f1da52c5e09554c0cd874037a083e1dc1b9cfd48034d1c717f1afc07a7" },
  { path: "tokenizer_config.json", bytes: 443, sha256: "a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b" },
  { path: "tokenizer.json", bytes: 17082730, sha256: "0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39" },
  { path: "onnx/model_quantized.onnx", bytes: 118308185, sha256: "f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193" },
];

const destination = resolve(process.argv[2] ?? join("models", "multilingual-e5-small"));

async function sha256(file) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(file), hash);
  return hash.digest("hex");
}

async function verified(file, expected) {
  const info = await stat(file).catch(() => null);
  return !!info && info.size === expected.bytes && (await sha256(file)) === expected.sha256;
}

for (const file of FILES) {
  const target = join(destination, file.path);
  if (await verified(target, file)) {
    console.log(`已有 ${file.path}`);
    continue;
  }
  await mkdir(dirname(target), { recursive: true });
  const url = `https://modelscope.cn/api/v1/models/${REPO}/repo?Revision=${REVISION}&FilePath=${encodeURIComponent(file.path)}`;
  const partial = `${target}.part`;
  let done = false;
  for (let attempt = 1; attempt <= 3 && !done; attempt++) {
    try {
      const response = await fetch(url, { redirect: "follow" });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
      if (!(await verified(partial, file))) throw new Error("字节数或 SHA-256 与登记值不一致");
      await rename(partial, target);
      done = true;
    } catch (error) {
      await rm(partial, { force: true });
      if (attempt === 3) throw new Error(`下载 ${file.path} 失败：${error.message}`);
      console.warn(`${file.path} 第 ${attempt} 次下载失败（${error.message}），重试`);
    }
  }
  console.log(`已下载 ${file.path}（${file.bytes.toLocaleString()} 字节，校验通过）`);
}
console.log(`向量模型就绪：${destination}`);
