import { afterEach, describe, expect, it, vi } from "vitest";
import { checkClientIp, createCheckLimits } from "../check-limits";

afterEach(() => vi.useRealTimers());

describe("process-local check and AI budgets", () => {
  it("releases a request IP window after one minute", () => {
    vi.useFakeTimers();
    const limits = createCheckLimits();
    for (let i = 0; i < 6; i++) expect(limits.allowCheck("one-ip")).toBe(true);
    expect(limits.allowCheck("one-ip")).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(limits.allowCheck("one-ip")).toBe(true);
  });

  it("caps new IP identities without evicting active limits, then recovers on expiry", () => {
    vi.useFakeTimers();
    const limits = createCheckLimits();
    for (let i = 0; i < 10_000; i++) expect(limits.allowCheck(`ip-${i}`)).toBe(true);
    expect(limits.allowCheck("over-capacity")).toBe(false);
    for (let i = 0; i < 5; i++) expect(limits.allowCheck("ip-0")).toBe(true);
    expect(limits.allowCheck("ip-0")).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(limits.allowCheck("over-capacity")).toBe(true);
  });

  it("limits concurrent AI work and releases a reservation only once", () => {
    const limits = createCheckLimits();
    const first = limits.reserveAI("one-ip", 100);
    const second = limits.reserveAI("two-ip", 100);
    expect(first.release).toBeTypeOf("function");
    expect(second.release).toBeTypeOf("function");
    expect(limits.reserveAI("three-ip", 100).notice).toMatch(/并发/);
    first.release?.();
    first.release?.();
    expect(limits.reserveAI("three-ip", 100).release).toBeTypeOf("function");
    expect(limits.reserveAI("four-ip", 100).notice).toMatch(/并发/);
    second.release?.();
  });

  it("caps aggregate AI calls across IPs and restores the hour budget on expiry", () => {
    vi.useFakeTimers();
    const limits = createCheckLimits();
    for (let i = 0; i < 30; i++) {
      const slot = limits.reserveAI(`ip-${i}`, 100);
      expect(slot.release).toBeTypeOf("function");
      slot.release?.();
    }
    expect(limits.reserveAI("next-ip", 100).notice).toMatch(/每小时/);
    vi.advanceTimersByTime(3_600_000);
    expect(limits.reserveAI("next-ip", 100).release).toBeTypeOf("function");
  });

  it("bounds forwarded identities and consistently selects the first hop", () => {
    expect(checkClientIp(new Request("https://example.invalid", { headers: { "x-forwarded-for": " 192.0.2.1, 192.0.2.2 " } }))).toBe("192.0.2.1");
    expect(checkClientIp(new Request("https://example.invalid", { headers: { "x-forwarded-for": "x".repeat(1_000) } }))).toBe("local");
  });
});
