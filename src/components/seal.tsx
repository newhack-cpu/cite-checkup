import type { Verdict } from "@/lib/verify/types";
import { VERDICT_META } from "@/lib/verdict-meta";

/** 全页只需放一次：给印章做出边缘毛糙、局部缺墨的效果 */
export function InkFilter() {
  return (
    <svg aria-hidden width="0" height="0" className="absolute">
      <filter id="ink" x="-10%" y="-10%" width="120%" height="120%">
        <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="7" result="noise" />
        <feDisplacementMap in="SourceGraphic" in2="noise" scale="2.4" xChannelSelector="R" yChannelSelector="G" result="rough" />
        <feTurbulence type="fractalNoise" baseFrequency="1.9" numOctaves="1" seed="11" result="speck" />
        <feColorMatrix in="speck" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -3 2.6" result="mask" />
        <feComposite in="rough" in2="mask" operator="in" />
      </filter>
    </svg>
  );
}

/** 页眉的方印：白文"引用体检"，按传统从右列读起 */
export function SealLogo({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} role="img" aria-label="引用体检" style={{ filter: "url(#ink)" }}>
      <rect x="4" y="4" width="92" height="92" rx="9" fill="var(--color-seal)" />
      <rect x="11" y="11" width="78" height="78" rx="5" fill="none" stroke="var(--color-card)" strokeWidth="1.6" opacity="0.85" />
      <g fill="var(--color-card)" fontFamily="var(--font-serif)" fontWeight="900" fontSize="34" textAnchor="middle">
        <text x="69" y="45">引</text>
        <text x="69" y="81">用</text>
        <text x="31" y="45">体</text>
        <text x="31" y="81">检</text>
      </g>
    </svg>
  );
}

/** 结论印章 */
export function Stamp({ verdict, size = "md", still = false }: { verdict: Verdict; size?: "sm" | "md"; still?: boolean }) {
  const meta = VERDICT_META[verdict];
  const box = size === "sm" ? "px-1.5 py-0.5 text-[11px] border-2" : "px-3 py-1.5 text-[17px] border-[3px]";
  return (
    <span
      role="img"
      aria-label={`结论：${meta.label}`}
      className={`relative inline-flex select-none items-center justify-center whitespace-nowrap rounded-[6px] font-serif font-black tracking-[0.18em] ${box} ${still ? "-rotate-[8deg] opacity-90" : "animate-stamp"}`}
      // 小号章不加墨迹滤镜：效果几乎看不出来，滤镜却要逐帧重绘
      style={{ color: meta.color, borderColor: meta.color, filter: size === "md" ? "url(#ink)" : undefined }}
    >
      {size === "md" && <span aria-hidden className="absolute inset-[3px] rounded-[3px] border" style={{ borderColor: meta.color, opacity: 0.5 }} />}
      <span className="relative pl-[0.18em]">{meta.stamp}</span>
    </span>
  );
}

/** 还在核查中的占位章 */
export function PendingStamp() {
  return (
    <span className="inline-flex -rotate-[8deg] items-center justify-center rounded-[6px] border-[3px] border-dashed border-ink-faint/50 px-3 py-1.5 font-serif text-[17px] font-black tracking-[0.18em] text-ink-faint/60">
      <span className="pl-[0.18em]">核查中</span>
    </span>
  );
}
