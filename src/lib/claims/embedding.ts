// Server only. 论断检索的向量召回：在本机用 multilingual-e5-small（ONNX 量化版，384 维）把论断和证据片段编码成向量，按余弦相似度排序。
// 作用是补词面检索的短板：论断是中文、原文是英文，或者换了说法时，BM25 一个词都对不上。
// 模型在服务器本机运行：不需要密钥，论断和原文不会为了向量化发给第三方，同样的输入得到同样的排序。
// 模型文件不在仓库里，由 scripts/fetch-embedding-model.mjs 下载到 models/（Docker 构建时也运行它）。
// 没有模型文件、依赖加载失败或超时，都只是少这一路召回：返回 null，由调用方照旧用词面检索。这一步不产生任何结论。
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { EvidenceChunk } from "./types";

export const EMBEDDING_MODEL = "multilingual-e5-small";
/** 模型最多读 512 个词元：中文约一字一词元，1200 字的片段要切成小窗分别编码，取最相近的一窗 */
const WINDOW_CHARS = 420;
const WINDOW_OVERLAP = 60;
const BATCH = 16;
const CACHE_LIMIT = 4_000;

type Extractor = (texts: string[], options: { pooling: "mean"; normalize: boolean }) => Promise<{ data: Float32Array | number[]; dims: number[] }>;

/** 模型目录：默认是工作目录下的 models/；EMBEDDING_MODEL_DIR 可改，设为 off 则关闭向量召回（单元测试用） */
function modelRoot(): string | null {
  const configured = process.env.EMBEDDING_MODEL_DIR?.trim();
  if (configured === "off") return null;
  return configured || join(process.cwd(), "models");
}

export function embeddingAvailable(): boolean {
  const root = modelRoot();
  return !!root && existsSync(join(root, EMBEDDING_MODEL, "onnx", "model_quantized.onnx"));
}

let loading: Promise<Extractor | null> | undefined;

/** 进程内只加载一次；加载失败记一次日志，之后不再重试 */
function extractor(): Promise<Extractor | null> {
  loading ??= (async () => {
    const root = modelRoot();
    if (!root || !embeddingAvailable()) return null;
    try {
      const { env, pipeline } = await import("@huggingface/transformers");
      // 只读本机文件，库自己不联网取模型
      env.allowRemoteModels = false;
      env.allowLocalModels = true;
      env.localModelPath = root;
      return (await pipeline("feature-extraction", EMBEDDING_MODEL, { dtype: "q8" })) as unknown as Extractor;
    } catch (error) {
      console.warn("[embedding] 向量模型加载失败，论断检索退回词面检索：", (error as Error).message);
      return null;
    }
  })();
  return loading;
}

const cache = new Map<string, Float32Array>();

async function embed(model: Extractor, texts: string[], signal: AbortSignal): Promise<Float32Array[]> {
  const keys = texts.map((text) => createHash("sha1").update(text).digest("base64"));
  const missing = [...new Set(keys.filter((key) => !cache.has(key)))];
  const textOf = new Map(keys.map((key, i) => [key, texts[i]]));
  for (let i = 0; i < missing.length; i += BATCH) {
    signal.throwIfAborted();
    const batch = missing.slice(i, i + BATCH);
    const output = await model(batch.map((key) => textOf.get(key)!), { pooling: "mean", normalize: true });
    const width = output.dims[1];
    batch.forEach((key, row) => cache.set(key, Float32Array.from(output.data.slice(row * width, (row + 1) * width))));
  }
  const vectors = keys.map((key) => cache.get(key)!);
  // 简单的容量上限：超出后从最早放入的开始丢
  for (const key of cache.keys()) {
    if (cache.size <= CACHE_LIMIT) break;
    cache.delete(key);
  }
  return vectors;
}

/** 片段切成不超过 WINDOW_CHARS 的小窗；英文为主的片段词元少，整段编码 */
export function embeddingWindows(text: string): string[] {
  const han = (text.match(/[\p{Script=Han}]/gu) ?? []).length;
  if (text.length <= WINDOW_CHARS || han < text.length * 0.2) return [text];
  const windows: string[] = [];
  for (let start = 0; start < text.length; start += WINDOW_CHARS - WINDOW_OVERLAP) {
    windows.push(text.slice(start, start + WINDOW_CHARS));
    if (start + WINDOW_CHARS >= text.length) break;
  }
  return windows;
}

function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

/**
 * 按向量相似度给片段排序，返回前 limit 段（score 是余弦相似度，同分按出现位置）。
 * 向量召回不可用时返回 null。e5 模型约定查询前加 "query: "、文档前加 "passage: "。
 */
export async function rankByEmbedding(claim: string, chunks: EvidenceChunk[], limit: number, signal: AbortSignal): Promise<EvidenceChunk[] | null> {
  if (!chunks.length) return [];
  const model = await extractor();
  if (!model) return null;
  signal.throwIfAborted();
  const windows = chunks.map((chunk) => embeddingWindows(chunk.text));
  const [query, ...passages] = await embed(model, [`query: ${claim}`, ...windows.flat().map((text) => `passage: ${text}`)], signal);
  let at = 0;
  return chunks.map((chunk, i) => {
    let best = -1;
    for (let w = 0; w < windows[i].length; w++) best = Math.max(best, dot(query, passages[at++]));
    return { ...chunk, score: Math.round(best * 1_000_000) / 1_000_000 };
  }).sort((a, b) => b.score - a.score || a.start - b.start).slice(0, limit);
}
