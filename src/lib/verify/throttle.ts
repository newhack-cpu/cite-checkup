// 进程内的限流闸门和小缓存，给中文期刊联网检索用：DeepSeek 搜索接口每个账户限 5 次 / 秒，
// 知网和期刊官网的页面也不能一次打太多。只在服务端使用；多实例部署时各实例各自计数。

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

/** 同时最多 concurrency 个，相邻两次开始至少间隔 minIntervalMs；排队、等待间隔时都可以取消 */
export class Gate {
  private active = 0;
  private nextStart = 0;
  private waiters: (() => void)[] = [];

  constructor(private readonly concurrency: number, private readonly minIntervalMs: number) {}

  async run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    if (this.active >= this.concurrency) await this.wait(signal);
    else this.active++;
    try {
      const now = Date.now();
      const at = Math.max(now, this.nextStart);
      this.nextStart = at + this.minIntervalMs;
      if (at > now) await sleep(at - now, signal);
      return await fn();
    } finally {
      // 有人排队就把名额直接交给他
      const next = this.waiters.shift();
      if (next) next();
      else this.active--;
    }
  }

  private wait(signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const go = () => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      };
      const onAbort = () => {
        const at = this.waiters.indexOf(go);
        if (at >= 0) this.waiters.splice(at, 1);
        reject(signal?.reason);
      };
      this.waiters.push(go);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
}

/** 带过期时间的小缓存：超过上限时丢掉最早放进去的 */
export class TtlCache<V> {
  private readonly map = new Map<string, { at: number; value: V }>();

  constructor(private readonly ttlMs: number, private readonly max: number) {}

  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.at >= this.ttlMs) {
      this.map.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: V): void {
    if (this.map.size >= this.max && !this.map.has(key)) this.map.delete(this.map.keys().next().value as string);
    this.map.set(key, { at: Date.now(), value });
  }

  clear(): void {
    this.map.clear();
  }
}
