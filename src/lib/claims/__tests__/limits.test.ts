import { afterEach, describe, expect, it, vi } from "vitest";
import { createClaimLimits } from "../limits";

afterEach(() => vi.useRealTimers());

describe("claim request and model budgets", () => {
  it("caps each identity and recovers after the one-minute window", () => {
    vi.useFakeTimers();
    const limits = createClaimLimits();
    for (let i = 0; i < 6; i++) expect(limits.allowRequest("client")).toBe(true);
    expect(limits.allowRequest("client")).toBe(false);
    vi.advanceTimersByTime(60_001);
    expect(limits.allowRequest("client")).toBe(true);
  });

  it("releases concurrency exactly once without refunding completed requests", () => {
    const limits = createClaimLimits();
    const first = limits.reserve(100);
    limits.reserve(100);
    expect(limits.reserve(100).error).toMatch(/任务/);
    first.release?.();
    first.release?.();
    expect(limits.reserve(100).error).toBeUndefined();
    expect(limits.reserve(100).error).toMatch(/任务/);
  });

  it("caps paid requests across identities and recovers after one hour", () => {
    vi.useFakeTimers();
    const limits = createClaimLimits();
    for (let i = 0; i < 30; i++) {
      const slot = limits.reserve(100);
      expect(slot.error).toBeUndefined();
      slot.release?.();
    }
    expect(limits.reserve(100).error).toMatch(/30/);
    vi.advanceTimersByTime(3_600_001);
    expect(limits.reserve(100).error).toBeUndefined();
  });

  it("caps cumulative model input characters, not uploaded document size", () => {
    const limits = createClaimLimits();
    for (let i = 0; i < 26; i++) limits.reserve(9_200).release?.();
    expect(limits.reserve(9_200).error).toMatch(/字符预算/);
    expect(limits.reserve(160_000).error).toMatch(/单次预算/);
  });
});
