import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agentEligible } from "../../src/lib/agent-stream";
import { VERDICTS, type Verdict } from "../../src/lib/verify/types";
import { agentEligibleRow, isFalseAlarm } from "../real-results";

describe("real-world evaluation calibers", () => {
  it("counts near matches as false alarms only under the old caliber", () => {
    expect(isFalseAlarm({ verdict: "near_match" }, "old")).toBe(true);
    expect(isFalseAlarm({ verdict: "near_match" }, "new")).toBe(false);
  });

  it("treats every other verdict the same under both calibers", () => {
    for (const caliber of ["old", "new"] as const) {
      expect(isFalseAlarm({ verdict: "mismatch" }, caliber)).toBe(true);
      expect(isFalseAlarm({ verdict: "not_found" }, caliber)).toBe(true);
      for (const v of ["verified", "retracted", "concern", "unverifiable", "error"] as const) expect(isFalseAlarm({ verdict: v }, caliber)).toBe(false);
    }
  });

  it("honours labels that accept a mismatch, but never accepts not_found", () => {
    expect(isFalseAlarm({ verdict: "mismatch", acceptMismatch: true }, "new")).toBe(false);
    expect(isFalseAlarm({ verdict: "near_match", acceptMismatch: true }, "old")).toBe(false);
    expect(isFalseAlarm({ verdict: "not_found", acceptMismatch: true }, "new")).toBe(true);
  });

  // 旧口径必须与已有结果文件里的 falseAlarms 逐个相同，历史数字才能直接比较
  it("reproduces falseAlarms of every saved result file under the old caliber", () => {
    const dir = join("eval", "results");
    const files = readdirSync(dir).filter((f) => /^real-.+-(rules|ai)\.json$/.test(f));
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      const saved = JSON.parse(readFileSync(join(dir, file), "utf8")) as {
        dataset: string; falseAlarms: number; falseAlarmsNew?: number; results: { id: string; verdict: Verdict }[];
      };
      const { cases } = JSON.parse(readFileSync(join("eval", "real-world", `${saved.dataset}.json`), "utf8")) as {
        cases: { id: string; label: { acceptMismatch?: boolean } }[];
      };
      const accept = new Map(cases.map((c) => [c.id, c.label.acceptMismatch]));
      const recount = (caliber: "old" | "new") =>
        saved.results.filter((r) => isFalseAlarm({ verdict: r.verdict, acceptMismatch: accept.get(r.id) }, caliber)).length;
      expect(recount("old"), file).toBe(saved.falseAlarms);
      if (saved.falseAlarmsNew !== undefined) expect(recount("new"), file).toBe(saved.falseAlarmsNew);
    }
  });
});

describe("agent eligibility in saved result files", () => {
  it("recognises candidates in files written before near_match existed", () => {
    expect(agentEligibleRow({ verdict: "mismatch", summary: "找到相近文献，但信息有出入，请核对是否为同一篇" })).toBe(true);
    expect(agentEligibleRow({ verdict: "mismatch", summary: "文献存在，但有 1 处信息与数据库记录不一致（来源：Crossref）" })).toBe(false);
    expect(agentEligibleRow({ verdict: "unverifiable", summary: "图书类文献不在开放学术数据库的覆盖范围内，请人工核查" })).toBe(true);
    expect(agentEligibleRow({ verdict: "not_found", summary: "开放数据库中查无此文，疑似不存在（请人工复核）" })).toBe(false);
  });

  it("agrees with the interface whenever matchStatus is recorded", () => {
    for (const verdict of VERDICTS) {
      for (const matchStatus of ["confirmed", "candidate"] as const) {
        expect(agentEligibleRow({ verdict, matchStatus, summary: "找到相近文献" }), `${verdict}/${matchStatus}`).toBe(agentEligible({ verdict, matchStatus }));
      }
    }
  });
});
