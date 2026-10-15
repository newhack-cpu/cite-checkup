"use client";

import { useRef, useState } from "react";
import { Checker } from "./checker";
import { ClaimChecker } from "./claim-checker";

const TABS = [
  { id: "references", label: "参考文献体检", note: "查存在 · 对信息 · 看撤稿" },
  { id: "claims", label: "正文论断核查", note: "找原文 · 对证据 · 看边界" },
] as const;

export function Workbench() {
  const [active, setActive] = useState<"references" | "claims">("references");
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <>
      <div role="tablist" aria-label="选择核查任务" className="mb-7 grid grid-cols-2 gap-3">
        {TABS.map((tab, index) => (
          <button key={tab.id} ref={el => { buttons.current[index] = el; }} type="button" role="tab"
            id={`tab-${tab.id}`} aria-controls={`panel-${tab.id}`} aria-selected={active === tab.id}
            tabIndex={active === tab.id ? 0 : -1} onClick={() => setActive(tab.id)}
            onKeyDown={event => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const next = event.key === "Home" ? 0 : event.key === "End" ? 1 : 1 - index;
              setActive(TABS[next].id);
              buttons.current[next]?.focus();
            }}
            className={`rounded-sm border px-4 py-3 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal ${active === tab.id ? "border-seal/50 bg-card text-seal shadow-sm" : "border-rule bg-paper/50 text-ink-soft hover:border-ink/30"}`}>
            <span className="block font-serif text-[16px] font-bold sm:text-[18px]">{tab.label}</span>
            <span className="mt-1 block text-[11.5px] tracking-wide text-ink-faint sm:text-[13px]">{tab.note}</span>
          </button>
        ))}
      </div>
      <div role="tabpanel" id="panel-references" aria-labelledby="tab-references" hidden={active !== "references"}>
        <Checker />
      </div>
      <div role="tabpanel" id="panel-claims" aria-labelledby="tab-claims" hidden={active !== "claims"}>
        <ClaimChecker />
      </div>
    </>
  );
}
