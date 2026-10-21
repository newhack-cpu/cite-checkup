import type { CSSProperties } from "react";
import { Workbench } from "@/components/workbench";
import { Tour } from "@/components/tour";

export default function Home() {
  return (
    <>
      <Workbench />
      <footer className="reveal mx-auto max-w-5xl px-5 pb-12 text-[12.5px] leading-6 text-ink-faint sm:px-8" style={{ "--d": "480ms" } as CSSProperties}>
        <div aria-hidden className="mb-4 h-px bg-rule" />
        数据来源：Crossref（含 Retraction Watch 撤稿数据）· OpenAlex · doi.org，或你提供的文献原文。规范引文依据数据库生成；论断判断附带证据范围，供人工复核。
      </footer>
      <Tour />
    </>
  );
}
