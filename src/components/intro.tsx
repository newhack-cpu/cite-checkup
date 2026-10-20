"use client";

import { useEffect, useRef } from "react";
import { INTRO_DONE } from "@/lib/onboarding";
import { SealLogo } from "./seal";

/**
 * 开场动画：纸上落下一方印，题名像毛笔写出，再像翻页一样把这张纸掀开，露出工作台。
 * 是否播放由 layout 里的脚本在首次绘制前决定（只在第一次来访时播放）；动画全靠 CSS，
 * 慢网络下脚本还没到也照常播完、不会挡住页面。React 接管后只负责：点一下或按任意键跳过，播完时通知新手引导。
 */
export function Intro() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    const root = document.documentElement;
    if (!el || root.dataset.intro !== "play") return;
    const finish = () => {
      cleanup();
      root.dataset.intro = "done";
      window.dispatchEvent(new Event(INTRO_DONE));
    };
    const skip = () => el.classList.add("intro-skip");
    const onEnd = (event: AnimationEvent) => {
      if (event.target === el && (event.animationName === "intro-out" || event.animationName === "intro-skip")) finish();
    };
    const cleanup = () => {
      el.removeEventListener("animationend", onEnd);
      el.removeEventListener("pointerdown", skip);
      window.removeEventListener("keydown", skip);
    };
    // 脚本到得晚、动画已经播完：直接收尾
    if (getComputedStyle(el).visibility === "hidden") {
      finish();
      return;
    }
    el.addEventListener("animationend", onEnd);
    el.addEventListener("pointerdown", skip);
    window.addEventListener("keydown", skip);
    return cleanup;
  }, []);

  return (
    <div ref={ref} aria-hidden className="intro">
      <div className="intro-stage">
        <span className="intro-bloom" />
        <SealLogo className="intro-seal" />
        <div>
          <p className="intro-title">引用体检</p>
          <p className="intro-sub">让每一条引用有据可查</p>
        </div>
      </div>
      <p className="intro-hint">点一下即可跳过</p>
    </div>
  );
}
