import { Workbench } from "@/components/workbench";
import { InkFilter, SealLogo } from "@/components/seal";

export default function Home() {
  return (
    <>
      <InkFilter />
      <header className="mx-auto max-w-6xl animate-rise px-5 pt-10 sm:px-8 sm:pt-14">
        <div className="flex items-center gap-4 sm:gap-6">
          <SealLogo className="size-14 shrink-0 sm:size-[4.5rem]" />
          <div>
            <h1 className="font-serif text-[32px] font-black leading-tight tracking-[0.08em] sm:text-[42px]">引用体检</h1>
            <p className="mt-1 text-[14px] text-ink-soft sm:text-[15.5px]">
              让每一条引用有据可查：文献真实性 · 信息准确性 · 论断与证据
            </p>
          </div>
        </div>
        <div aria-hidden className="mt-7 space-y-[3px]">
          <div className="h-[2px] bg-ink/80" />
          <div className="h-px bg-ink/30" />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-10">
        <Workbench />
      </main>

      <footer className="mx-auto max-w-6xl px-5 pb-12 text-[12.5px] leading-6 text-ink-faint sm:px-8">
        <div aria-hidden className="mb-4 h-px bg-ink/20" />
        数据来源：Crossref（含 Retraction Watch 撤稿数据）· OpenAlex · doi.org，或你提供的文献原文。规范引文依据数据库生成；论断判断附带证据范围，供人工复核。
      </footer>
    </>
  );
}
