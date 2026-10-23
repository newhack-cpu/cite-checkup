// 中文期刊联网核查的回归对比：把 eval:real --lang=zh 的结果和各集合上一次的规则结果逐条比较，
// 统计结论分布、误报（新旧两种口径，见 real-results.ts）和变化的条目，写成一个汇总文件。
// 用法：tsx scripts/compare-zh.mts <输出.json> <新结果.json>=<旧结果.json> ...
import { readFileSync, writeFileSync } from "node:fs";
import { VERDICTS, type Verdict } from "../src/lib/verify/types";
import { isFalseAlarm } from "./real-results";

interface Row { id: string; verdict: Verdict; summary: string; zhJournal?: boolean; cnSearched?: boolean; match?: { site?: string; source?: string; title?: string; url?: string } }
interface ResultFile { dataset: string; ranAt?: string; results: Row[] }

const [out, ...pairs] = process.argv.slice(2);
if (!out || !pairs.length) throw new Error("用法：tsx scripts/compare-zh.mts <输出.json> <新结果.json>=<旧结果.json> ...");

const count = (rows: Row[]) => Object.fromEntries(VERDICTS.map((v) => [v, rows.filter((r) => r.verdict === v).length]));
const alarms = (rows: Row[]) => ({
  old: rows.filter((r) => isFalseAlarm({ verdict: r.verdict }, "old")).length,
  new: rows.filter((r) => isFalseAlarm({ verdict: r.verdict }, "new")).length,
});

const sets = pairs.map((pair) => {
  const [nowFile, beforeFile] = pair.split("=");
  const now = JSON.parse(readFileSync(nowFile, "utf8")) as ResultFile;
  const before = JSON.parse(readFileSync(beforeFile, "utf8")) as ResultFile;
  const earlier = new Map(before.results.map((r) => [r.id, r]));
  const rows = now.results;
  const prior = rows.map((r) => earlier.get(r.id)).filter((r): r is Row => !!r);
  const journal = rows.filter((r) => r.zhJournal);
  const journalBefore = journal.map((r) => earlier.get(r.id)).filter((r): r is Row => !!r);
  return {
    dataset: now.dataset, now: nowFile, before: beforeFile, ranAt: now.ranAt,
    zh: { total: rows.length, before: count(prior), after: count(rows), falseAlarmsBefore: alarms(prior), falseAlarmsAfter: alarms(rows) },
    zhJournal: { total: journal.length, before: count(journalBefore), after: count(journal), falseAlarmsBefore: alarms(journalBefore), falseAlarmsAfter: alarms(journal) },
    changes: rows.filter((r) => earlier.get(r.id)?.verdict !== r.verdict).map((r) => ({
      id: r.id, before: earlier.get(r.id)?.verdict, after: r.verdict, summary: r.summary, source: r.match?.site ?? r.match?.source, url: r.match?.url,
    })),
  };
});

const sum = (pick: (s: (typeof sets)[number]) => Record<string, number>) =>
  sets.reduce<Record<string, number>>((acc, s) => {
    for (const [k, v] of Object.entries(pick(s))) acc[k] = (acc[k] ?? 0) + v;
    return acc;
  }, {});
const summary = {
  zh: { total: sets.reduce((n, s) => n + s.zh.total, 0), before: sum((s) => s.zh.before), after: sum((s) => s.zh.after), falseAlarmsBefore: sum((s) => s.zh.falseAlarmsBefore), falseAlarmsAfter: sum((s) => s.zh.falseAlarmsAfter) },
  zhJournal: { total: sets.reduce((n, s) => n + s.zhJournal.total, 0), before: sum((s) => s.zhJournal.before), after: sum((s) => s.zhJournal.after), falseAlarmsBefore: sum((s) => s.zhJournal.falseAlarmsBefore), falseAlarmsAfter: sum((s) => s.zhJournal.falseAlarmsAfter) },
};
writeFileSync(out, JSON.stringify({
  comparedAt: new Date().toISOString(),
  method: "各集合的中文条目用 eval:real --lang=zh 重跑（中文期刊联网核查开启，每条都给额度），与该集合上一次的规则结果按条目编号比较；这些集合都已看过，只能做回归、不能报效果。误报按 real-results.ts 的两种口径：旧口径含相近候选，新口径不含。",
  summary, sets,
}, null, 1));
console.log(JSON.stringify(summary, null, 1));
