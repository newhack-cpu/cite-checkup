// 外部请求的统一出口：超时、按主机限流、429/5xx 退避重试、内存缓存。
// 只在服务端使用。

const USER_AGENT = "cite-checkup/0.1 (+https://github.com/; student competition project)";

interface HostPolicy {
  concurrency: number;
  minIntervalMs: number;
}

// Crossref 公共池限流较严，带 mailto 进入 polite pool 后可以放宽
function policyFor(host: string): HostPolicy {
  if (host === "api.crossref.org") {
    return process.env.CROSSREF_MAILTO ? { concurrency: 3, minIntervalMs: 120 } : { concurrency: 2, minIntervalMs: 300 };
  }
  if (host === "api.openalex.org") return { concurrency: 3, minIntervalMs: 120 };
  return { concurrency: 4, minIntervalMs: 50 };
}

class HostLimiter {
  private active = 0;
  private lastStart = 0;
  private queue: (() => void)[] = [];
  constructor(private policy: HostPolicy) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      // 有人排队就把名额直接交给他，避免释放和抢占之间的竞态
      const next = this.queue.shift();
      if (next) next();
      else this.active--;
    }
  }

  private async acquire() {
    if (this.active >= this.policy.concurrency) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    } else {
      this.active++;
    }
    // 相邻两次请求的发起时间至少间隔 minIntervalMs
    const now = Date.now();
    const startAt = Math.max(now, this.lastStart + this.policy.minIntervalMs);
    this.lastStart = startAt;
    if (startAt > now) await sleep(startAt - now);
  }
}

const limiters = new Map<string, HostLimiter>();
function limiterFor(host: string): HostLimiter {
  let l = limiters.get(host);
  if (!l) {
    l = new HostLimiter(policyFor(host));
    limiters.set(host, l);
  }
  return l;
}

// 简单的进程内缓存：演示时同一批文献反复核查不会重复打外部接口
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX = 2000;
const cache = new Map<string, { at: number; value: FetchResult }>();

export interface FetchResult {
  status: number;
  /** 解析后的 JSON；非 JSON 或请求失败时为 undefined */
  json?: unknown;
  ms: number;
}

export class UpstreamError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * GET 一个 JSON 接口。404 视为正常结果（status=404）返回；
 * 429 / 5xx / 网络错误会退避重试，重试用尽后抛 UpstreamError。
 */
export async function getJson(
  url: string,
  opts: {
    headers?: Record<string, string>;
    timeoutMs?: number;
    retries?: number;
    signal?: AbortSignal;
    /** 单条记录的 404 表示未收录；检索端点的 404 表示接口不可用。 */
    allowNotFound?: boolean;
    /** 成功响应必须符合数据源的结构，避免把错误页 / 错误 JSON 缓存成无结果。 */
    validate?: (json: unknown) => boolean;
  } = {},
): Promise<FetchResult> {
  opts.signal?.throwIfAborted();
  const cacheKey = url + "|" + JSON.stringify(opts.headers ?? {});
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { ...hit.value, ms: 0 };

  const host = new URL(url).host;
  const retries = opts.retries ?? 3;
  const started = Date.now();
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await limiterFor(host).run(() => {
        opts.signal?.throwIfAborted();
        const timeout = AbortSignal.timeout(opts.timeoutMs ?? 15000);
        return fetch(url, {
          headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...opts.headers },
          signal: opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout,
          redirect: "follow",
        });
      });
      opts.signal?.throwIfAborted();

      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get("retry-after"));
        lastErr = new UpstreamError(`${host} 返回 ${res.status}`, res.status);
        if (attempt < retries) {
          await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 800 * 2 ** attempt, opts.signal);
          continue;
        }
        throw lastErr;
      }

      if (res.status !== 200 && (res.status !== 404 || opts.allowNotFound === false)) {
        throw new UpstreamError(`${host} 返回 ${res.status}，无法完成查询`, res.status);
      }

      let json: unknown;
      const text = await res.text();
      try {
        json = text ? JSON.parse(text) : undefined;
      } catch {
        json = undefined;
      }
      opts.signal?.throwIfAborted();
      if (res.status === 200 && (json === undefined || (opts.validate && !opts.validate(json)))) {
        throw new UpstreamError(`${host} 返回了无法识别的数据，无法完成查询`, res.status);
      }
      const value: FetchResult = { status: res.status, json, ms: Date.now() - started };
      if (res.status === 200 || res.status === 404) {
        if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
        cache.set(cacheKey, { at: Date.now(), value });
      }
      return value;
    } catch (err) {
      opts.signal?.throwIfAborted();
      if (err instanceof UpstreamError) throw err;
      lastErr = err;
      if (attempt < retries) {
        await sleep(800 * 2 ** attempt, opts.signal);
        continue;
      }
    }
  }
  throw new UpstreamError(`${host} 请求失败：${(lastErr as Error)?.message ?? lastErr}`);
}
