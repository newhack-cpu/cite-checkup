"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { INTRO_DONE, RUN_STARTED, TOUR_FLAG, TOUR_OPEN, TOUR_START, TRY_SAMPLE, readFlag, writeFlag } from "@/lib/onboarding";
import { loopPath, placeCard, type Rect, type Side } from "@/lib/tour-layout";
import { SealLogo } from "./seal";

interface Step {
  /** 依次尝试的目标；第一个在页面上可见的就是这一步要圈的地方 */
  targets: string[];
  title: string;
  body: string;
  /** 只在桌面显示的补充（比如键盘快捷键，手机上没有） */
  desktopNote?: string;
  /** 桌面端批注卡优先放在哪一侧；手机只放上下 */
  prefer: Side[];
  final?: boolean;
}

const STEPS: Step[] = [
  {
    targets: ['[data-tour="tabs"]'],
    title: "两件事，分开查",
    body: "左边查参考文献：这篇文献是不是真的存在、信息写得对不对、有没有被撤稿。右边查正文里的一句话：原文到底支不支持。",
    prefer: ["bottom", "top"],
  },
  {
    targets: ['[data-tour="input"]'],
    title: "把参考文献贴进来",
    body: "从论文末尾整段复制参考文献列表。GB/T 7714、APA、IEEE 都可以，每条一行，或者带 [1]、1. 这样的序号。",
    prefer: ["bottom", "top"],
  },
  {
    targets: ['[data-tour="import"]'],
    title: "也可以直接导入",
    body: "PDF、Word、TXT 会自动找出参考文献那一节；手机拍照、截图也能识别。先预览，确认后才填进来。",
    prefer: ["bottom", "top"],
  },
  {
    targets: ['[data-tour="start"]'],
    title: "点这里开始体检",
    body: "逐条查 DOI、比对题名作者年份期刊、看有没有撤稿，结果一条一条出来。",
    desktopNote: "在输入框里按 Ctrl + Enter（Mac 上是 ⌘ + Enter）也能开始。",
    prefer: ["bottom", "top", "left"],
  },
  {
    targets: ['[data-tour="legend"]', '[data-tour="summary"]'],
    title: "看结论印章",
    body: "体检后每条会盖一个章：已核实、有误、相近候选、查无此文、已撤稿、待人工。点“详情”能看核查过程和规范写法；数据库查不到的，可以点“AI 继续查”。",
    prefer: ["bottom", "top"],
  },
  {
    targets: ['[data-tour="sample"]'],
    title: "先拿示例试一试",
    body: "示例里的 11 条参考文献有真有假，还有一篇已经撤稿。点下面的按钮，自动载入并开始体检。",
    prefer: ["bottom", "top"],
    final: true,
  },
];

const NUMERALS = ["壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌"];
/** 高亮框比目标大一圈，朱笔圈再往外一点，批注卡不压住圈 */
const SPOT_PAD = 6;
const LOOP_PAD = 11;
const LOOP_INSET = 8;

function findTarget(step: Step): HTMLElement | null {
  for (const selector of step.targets) {
    const el = document.querySelector<HTMLElement>(selector);
    if (el && el.getClientRects().length > 0) return el;
  }
  return null;
}

const grow = (r: Rect, d: number): Rect => ({ left: r.left - d, top: r.top - d, width: r.width + 2 * d, height: r.height + 2 * d });

/**
 * 新手引导：第一次来访时，开场动画结束后右下角出现一张邀请便签；点“带我看看”或页眉的“怎么用”开始。
 * 每一步把页面其余部分压暗，用朱笔圈出要讲的地方，旁边一张批注卡。Esc 退出，← → 翻页，焦点留在批注卡里。
 */
export function Tour() {
  const [mode, setMode] = useState<"idle" | "invite" | "tour">("idle");
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [viewport, setViewport] = useState({ width: 1280, height: 800 });
  const [cardSize, setCardSize] = useState({ width: 340, height: 240 });
  const cardRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const opener = useRef<Element | null>(null);
  const modeRef = useRef(mode);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  // 从 from 开始按方向找下一个目标在页面上的步骤；找不到返回 false
  const go = (from: number, dir: 1 | -1) => {
    for (let i = from; i >= 0 && i < STEPS.length; i += dir) {
      if (findTarget(STEPS[i])) {
        setStep(i);
        return true;
      }
    }
    return false;
  };

  const finish = () => {
    writeFlag(TOUR_FLAG, "done");
    setMode("idle");
    setRect(null);
    const back = opener.current;
    if (back instanceof HTMLElement && back.isConnected) back.focus({ preventScroll: true });
  };

  const start = () => {
    opener.current = document.activeElement;
    // 引导的目标都在“参考文献体检”页：先切过去，等这次渲染完成再找第一步
    window.dispatchEvent(new Event(TOUR_OPEN));
    setRect(null);
    setMode("tour");
    requestAnimationFrame(() => {
      if (!go(0, 1)) finish();
    });
  };

  const dismissInvite = () => {
    writeFlag(TOUR_FLAG, "dismissed");
    setMode("idle");
  };

  // 事件：页眉“怎么用”、开始体检（收起邀请）、开场动画结束（第一次来访时邀请）
  useEffect(() => {
    const onStart = () => start();
    const onRun = () => {
      if (modeRef.current !== "invite") return;
      writeFlag(TOUR_FLAG, "dismissed");
      setMode("idle");
    };
    let timer: number | undefined;
    const invite = () => {
      timer = window.setTimeout(() => {
        if (modeRef.current === "idle" && !readFlag(TOUR_FLAG)) setMode("invite");
      }, 600);
    };
    window.addEventListener(TOUR_START, onStart);
    window.addEventListener(RUN_STARTED, onRun);
    if (!readFlag(TOUR_FLAG)) {
      if (document.documentElement.dataset.intro === "play") window.addEventListener(INTRO_DONE, invite, { once: true });
      else invite();
    }
    return () => {
      window.removeEventListener(TOUR_START, onStart);
      window.removeEventListener(RUN_STARTED, onRun);
      window.removeEventListener(INTRO_DONE, invite);
      window.clearTimeout(timer);
    };
    // start 只用到 setState 和 ref，挂载一次即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 当前步骤：把目标滚进视野，跟着滚动和尺寸变化重新量位置
  useEffect(() => {
    if (mode !== "tour") return;
    const target = findTarget(STEPS[step]);
    if (!target) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tall = target.getBoundingClientRect().height > window.innerHeight * 0.55;
    target.scrollIntoView({ block: tall ? "start" : "center", behavior: reduce ? "auto" : "smooth" });
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = target.getBoundingClientRect();
        setRect({ left: r.left, top: r.top, width: r.width, height: r.height });
        setViewport({ width: window.innerWidth, height: window.innerHeight });
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(target);
    window.addEventListener("scroll", update, { passive: true, capture: true });
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", update, { capture: true });
      window.removeEventListener("resize", update);
    };
  }, [mode, step]);

  // 批注卡的实际尺寸（文字长短不同），用来决定放在哪一侧；每一步的卡片是新挂载的，要重新观察
  useEffect(() => {
    const card = cardRef.current;
    if (mode !== "tour" || !card) return;
    const observer = new ResizeObserver(() => setCardSize({ width: card.offsetWidth, height: card.offsetHeight }));
    observer.observe(card);
    return () => observer.disconnect();
  }, [mode, step]);

  // 换步骤、或第一次量到位置时，把焦点放到主按钮上；滚动带来的位置变化不抢焦点
  const ready = rect !== null;
  useEffect(() => {
    if (mode === "tour" && ready) primaryRef.current?.focus({ preventScroll: true });
  }, [mode, step, ready]);

  if (mode === "idle" || typeof document === "undefined") return null;

  if (mode === "invite") {
    return createPortal(
      <aside aria-labelledby="tour-invite-title" className="tour-invite fixed bottom-4 right-4 z-[85] w-[min(21.5rem,calc(100vw-2rem))] rounded-2xl border border-rule bg-card p-4 pl-5 max-sm:left-4 max-sm:w-auto">
        <div className="flex items-start gap-3">
          <SealLogo className="mt-0.5 size-9 shrink-0 -rotate-6" />
          <div>
            <p id="tour-invite-title" className="font-kai text-[18px] text-seal">第一次来？</p>
            <p className="mt-0.5 text-[14px] leading-6 text-ink-soft">花 30 秒，我带你看一遍怎么用。</p>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-end gap-2">
          <button type="button" onClick={dismissInvite} className="rounded-sm px-3 py-1.5 text-[13.5px] text-ink-soft underline decoration-dotted underline-offset-4 hover:text-seal focus-visible:outline-2 focus-visible:outline-seal">
            先不用
          </button>
          <button type="button" onClick={start} className="rounded-full bg-seal px-4 py-1.5 text-[14px] font-semibold tracking-[0.08em] text-card shadow-[0_2px_0_var(--color-seal-deep)] hover:bg-seal-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal">
            带我看看
          </button>
        </div>
      </aside>,
      document.body,
    );
  }

  const current = STEPS[step];
  const total = STEPS.length;
  const mobile = viewport.width < 640;
  const loopBox = rect ? grow(rect, LOOP_PAD) : null;
  const cardWidth = mobile ? viewport.width - 24 : Math.min(344, viewport.width - 24);
  const placed = loopBox ? placeCard(loopBox, { width: cardWidth, height: cardSize.height }, viewport, mobile ? ["bottom", "top"] : current.prefer) : null;
  const hasText = !!document.querySelector<HTMLTextAreaElement>("#refs")?.value.trim();
  const trySample = current.final && !hasText;

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      finish();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      if (!go(step + 1, 1)) finish();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      go(step - 1, -1);
    } else if (event.key === "Tab" && cardRef.current) {
      const items = [...cardRef.current.querySelectorAll<HTMLElement>("button")];
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  return createPortal(
    <div className="tour">
      {/* 挡住页面点击：引导期间只能操作批注卡 */}
      <div className="fixed inset-0 z-[88]" aria-hidden />
      {rect && (
        <>
          <div aria-hidden className="tour-spot" style={{ left: rect.left - SPOT_PAD, top: rect.top - SPOT_PAD, width: rect.width + 2 * SPOT_PAD, height: rect.height + 2 * SPOT_PAD }} />
          {loopBox && (
            <svg
              key={step}
              aria-hidden
              className="tour-loop"
              style={{ left: loopBox.left - LOOP_INSET, top: loopBox.top - LOOP_INSET }}
              width={loopBox.width + 2 * LOOP_INSET}
              height={loopBox.height + 2 * LOOP_INSET}
            >
              <defs>
                <filter id="tour-brush" x="-5%" y="-5%" width="110%" height="110%">
                  <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="5" />
                  <feDisplacementMap in="SourceGraphic" scale="2.6" xChannelSelector="R" yChannelSelector="G" />
                </filter>
              </defs>
              <path d={loopPath(loopBox.width, loopBox.height, LOOP_INSET)} pathLength={1} filter="url(#tour-brush)" />
            </svg>
          )}
        </>
      )}
      <div
        ref={cardRef}
        key={`card-${step}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        onKeyDown={onKeyDown}
        className="tour-card fixed z-[92] rounded-2xl border border-rule bg-card py-4 pl-7 pr-5"
        style={{ left: placed?.left ?? 12, top: placed?.top ?? 12, width: cardWidth, visibility: placed ? "visible" : "hidden" }}
      >
        <div className="flex items-center gap-2.5">
          <span aria-hidden className="flex size-8 items-center justify-center rounded-full border-2 border-seal font-serif text-[14px] font-black text-seal">{NUMERALS[step]}</span>
          <span className="text-[12px] tracking-[0.2em] text-ink-faint">
            第 {step + 1} 步 · 共 {total} 步
          </span>
          <button type="button" onClick={finish} className="ml-auto rounded-sm px-1.5 py-1 text-[12.5px] text-ink-faint underline decoration-dotted underline-offset-4 hover:text-seal focus-visible:outline-2 focus-visible:outline-seal">
            跳过引导
          </button>
        </div>
        <h2 id="tour-title" className="mt-3 font-serif text-[18px] font-bold leading-snug">{current.title}</h2>
        <p id="tour-body" className="mt-1.5 font-kai text-[15.5px] leading-7 text-ink-soft">
          {current.final && hasText ? "你已经填好了内容，点左边的“开始体检”就行；想先看效果，也可以点“载入示例”。" : current.body}
          {!mobile && current.desktopNote}
          {current.final && <span className="mt-1 block text-[13.5px] text-ink-faint">以后想再看这份引导，点页面右上角的“怎么用”。</span>}
        </p>
        <div className="mt-4 flex items-center gap-2">
          <span aria-hidden className="mr-auto flex gap-1.5">
            {!current.final && STEPS.map((_, i) => (
              <span key={i} className={`size-1.5 rotate-45 ${i === step ? "bg-seal" : i < step ? "bg-seal/40" : "bg-rule"}`} />
            ))}
          </span>
          {step > 0 && (
            <button type="button" onClick={() => go(step - 1, -1)} className="whitespace-nowrap rounded-sm px-3 py-1.5 text-[13.5px] text-ink-soft hover:text-seal focus-visible:outline-2 focus-visible:outline-seal">
              上一步
            </button>
          )}
          {trySample ? (
            <button
              ref={primaryRef}
              type="button"
              onClick={() => {
                finish();
                window.dispatchEvent(new Event(TRY_SAMPLE));
              }}
              className="whitespace-nowrap rounded-full bg-seal px-4 py-1.5 text-[14px] font-semibold tracking-[0.04em] text-card shadow-[0_2px_0_var(--color-seal-deep)] hover:bg-seal-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal"
            >
              载入示例并开始体检
            </button>
          ) : (
            <button
              ref={primaryRef}
              type="button"
              onClick={() => {
                if (current.final || !go(step + 1, 1)) finish();
              }}
              className="whitespace-nowrap rounded-full bg-seal px-4 py-1.5 text-[14px] font-semibold tracking-[0.08em] text-card shadow-[0_2px_0_var(--color-seal-deep)] hover:bg-seal-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal"
            >
              {current.final ? "完成" : "下一步"}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** 页眉“怎么用”：随时重看新手引导 */
export function TourButton({ className = "" }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(TOUR_START))}
      title="新手引导：30 秒看懂怎么用"
      className={`inline-flex min-h-9 items-center gap-2 rounded-full border border-rule bg-card/80 p-1.5 text-[13.5px] text-ink-soft transition duration-300 hover:border-seal/50 hover:text-seal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal sm:pr-3.5 ${className}`}
    >
      <span aria-hidden className="flex size-6 items-center justify-center rounded-full border border-seal/70 font-serif text-[12px] font-black text-seal">问</span>
      <span className="max-sm:sr-only">怎么用</span>
    </button>
  );
}
