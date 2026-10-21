"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useGlide } from "@/lib/motion";
import { TOUR_OPEN } from "@/lib/onboarding";
import { Checker } from "./checker";
import { ClaimChecker } from "./claim-checker";
import { SealLogo } from "./seal";
import { TourButton } from "./tour";

const TABS = [
  { id: "references", label: "参考文献体检" },
  { id: "claims", label: "正文论断核查" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const delay = (ms: number) => ({ "--d": `${ms}ms` }) as CSSProperties;

/** 页眉（印章、两个任务的分段切换、怎么用）和两个任务面板。页眉在宽屏吸顶，滚动后出现毛玻璃 */
export function Workbench() {
  const [active, setActive] = useState<TabId>("references");
  // 切换过任务之后，新面板淡入；首次加载交给各块自己的入场动画
  const [switched, setSwitched] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const [glideRef, pillRef] = useGlide<HTMLDivElement>();

  const select = (id: TabId) => {
    setActive(id);
    setSwitched(true);
  };

  // 新手引导讲的都是“参考文献体检”页，打开引导时切回这一页
  useEffect(() => {
    const show = () => setActive("references");
    window.addEventListener(TOUR_OPEN, show);
    return () => window.removeEventListener(TOUR_OPEN, show);
  }, []);

  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setScrolled(window.scrollY > 8));
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <>
      <header className="app-header" data-scrolled={scrolled}>
        <div className="mx-auto grid max-w-5xl grid-cols-[1fr_auto] items-center gap-x-4 gap-y-3 px-5 py-3 sm:px-8 md:h-16 md:grid-cols-[1fr_auto_1fr] md:py-0">
          <div className="reveal flex min-w-0 items-center gap-3" style={delay(0)}>
            <SealLogo className="size-9 shrink-0" />
            <div className="min-w-0 leading-tight">
              <h1 className="font-serif text-[19px] font-bold tracking-[0.06em]">引用体检</h1>
              <p className="hidden text-[12px] text-ink-faint lg:block">让每一条引用有据可查</p>
            </div>
          </div>
          <div
            ref={glideRef}
            role="tablist"
            aria-label="选择核查任务"
            data-tour="tabs"
            className="reveal relative col-span-2 row-start-2 grid grid-cols-2 rounded-full border border-rule bg-paper-deep/70 p-1 md:col-span-1 md:col-start-2 md:row-start-1"
            style={delay(80)}
          >
            <span ref={pillRef} aria-hidden className="glide bg-card shadow-[0_1px_2px_rgb(40_28_14/0.12),0_8px_18px_-12px_rgb(40_28_14/0.45)]" />
            {TABS.map((tab, index) => (
              <button
                key={tab.id}
                ref={(el) => {
                  buttons.current[index] = el;
                }}
                type="button"
                role="tab"
                id={`tab-${tab.id}`}
                aria-controls={`panel-${tab.id}`}
                aria-selected={active === tab.id}
                data-glide-active={active === tab.id}
                tabIndex={active === tab.id ? 0 : -1}
                onClick={() => select(tab.id)}
                onKeyDown={(event) => {
                  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                  event.preventDefault();
                  const next = event.key === "Home" ? 0 : event.key === "End" ? 1 : 1 - index;
                  select(TABS[next].id);
                  buttons.current[next]?.focus();
                }}
                className={`relative z-[1] whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal sm:px-5 ${active === tab.id ? "font-semibold text-ink" : "text-ink-soft hover:text-ink"}`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="reveal justify-self-end md:col-start-3" style={delay(140)}>
            <TourButton />
          </div>
        </div>
      </header>

      <main data-switched={switched ? "" : undefined} className="mx-auto max-w-5xl px-5 pb-20 pt-8 sm:px-8 md:pt-12">
        <div role="tabpanel" id="panel-references" aria-labelledby="tab-references" hidden={active !== "references"}>
          <Checker />
        </div>
        <div role="tabpanel" id="panel-claims" aria-labelledby="tab-claims" hidden={active !== "claims"}>
          <ClaimChecker />
        </div>
      </main>
    </>
  );
}
