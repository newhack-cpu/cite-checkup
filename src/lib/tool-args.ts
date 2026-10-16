// DeepSeek 偶尔会把函数参数再包一层，例如 {"arguments": {...}}。
// 只拆这一种已知外壳：对象恰好只有一个外壳键、值是对象时才拆；拆开后仍按各自规则严格校验，
// 外壳和真实字段并列（如 {"call": "judge_claim", "verdict": ...}）照旧拒绝。
const WRAPPERS = new Set(["arguments", "parameters", "args", "input"]);

export function unwrapToolArguments(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const keys = Object.keys(value);
  if (keys.length !== 1 || !WRAPPERS.has(keys[0])) return value;
  const inner = (value as Record<string, unknown>)[keys[0]];
  return inner && typeof inner === "object" && !Array.isArray(inner) ? inner : value;
}
