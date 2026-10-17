import { describe, expect, it } from "vitest";
import { healthScore, VERDICT_META, VERDICT_ORDER } from "../verdict-meta";
import { VERDICTS } from "../verify/types";

describe("verdict metadata", () => {
  it("shows every verdict exactly once", () => {
    expect([...VERDICT_ORDER].sort()).toEqual([...VERDICTS].sort());
    for (const v of VERDICTS) expect(VERDICT_META[v].label).toBeTruthy();
  });

  it("labels near matches apart from wrong information", () => {
    expect(VERDICT_META.near_match.label).toBe("相近候选");
    expect(VERDICT_META.near_match.hint).toContain("不算信息有误");
    expect(VERDICT_META.near_match.color).not.toBe(VERDICT_META.mismatch.color);
    expect(VERDICT_META.near_match.stamp).not.toBe(VERDICT_META.unverifiable.stamp);
  });

  it("keeps near matches out of the health score, like unverifiable items", () => {
    expect(healthScore({ verified: 1, mismatch: 1 })).toBe(75);
    expect(healthScore({ verified: 1, mismatch: 1, near_match: 3 })).toBe(75);
    expect(healthScore({ near_match: 2, unverifiable: 1 })).toBeUndefined();
  });
});
