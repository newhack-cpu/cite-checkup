// DeepSeek 返回的函数参数有两种已知的“多写”，内容本身没问题却会被严格校验整体拒绝。这里只处理这两种，
// 处理完仍按各自规则严格校验（字段、枚举、引句逐字一致等），其他多余字段照旧拒绝。

// 一、把参数再包一层，例如 {"arguments": {...}}：对象恰好只有一个外壳键、值是对象时才拆。
const WRAPPERS = new Set(["arguments", "parameters", "args", "input"]);

export function unwrapToolArguments(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const keys = Object.keys(value);
  if (keys.length !== 1 || !WRAPPERS.has(keys[0])) return value;
  const inner = (value as Record<string, unknown>)[keys[0]];
  return inner && typeof inner === "object" && !Array.isArray(inner) ? inner : value;
}

// 二、把工具名当成一个字段写进参数，例如 {"call": "judge_claim", "verdict": ...}。
// 2026-11-12 实测：演示用的论断连续 4 次如此，判断和引句都对（引句与原文逐字一致），整条结果却因为多了这个字段作废。
// 这个字段只是把工具名重复一遍、不带任何内容：键是下面几个之一、值恰好等于本次调用的工具名时才去掉；
// 值是别的字符串或对象的，不动，留给后面的校验拒绝。
const NAME_ECHO_KEYS = ["call", "name", "function", "tool"];

export function dropToolNameEcho(value: unknown, toolName: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const source = value as Record<string, unknown>;
  if (!NAME_ECHO_KEYS.some((key) => source[key] === toolName)) return value;
  return Object.fromEntries(Object.entries(source).filter(([key, entry]) => !(NAME_ECHO_KEYS.includes(key) && entry === toolName)));
}

/** 两种都处理：工具名可能写在外壳旁边，也可能写在外壳里面 */
export function cleanToolArguments(value: unknown, toolName: string): unknown {
  return dropToolNameEcho(unwrapToolArguments(dropToolNameEcho(value, toolName)), toolName);
}
