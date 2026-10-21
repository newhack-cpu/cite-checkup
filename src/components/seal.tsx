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

/** 结论印章：md 用在结果卡上（落下时有盖章动画），sm 用在图例和筛选上 */
export function Stamp({ verdict, size = "md", still = false }: { verdict: Verdict; size?: "sm" | "md"; still?: boolean }) {
  const meta = VERDICT_META[verdict];
  const box = size === "sm" ? "px-1.5 py-px text-[11px] border-[1.5px] rounded-[4px]" : "px-2 py-0.5 text-[13.5px] border-2 rounded-[5px]";
  return (
    <span
      role="img"
      aria-label={`结论：${meta.label}`}
      className={`relative inline-flex select-none items-center justify-center whitespace-nowrap font-serif font-bold tracking-[0.14em] ${box} ${still ? "-rotate-[3deg]" : "animate-stamp"}`}
      // 小号章不加墨迹滤镜：效果几乎看不出来，滤镜却要逐帧重绘
      style={{ color: meta.color, borderColor: meta.color, filter: size === "md" ? "url(#ink)" : undefined }}
    >
      <span className="relative pl-[0.14em]">{meta.stamp}</span>
    </span>
  );
}

/** 还在核查中的占位章 */
export function PendingStamp() {
  return (
    <span className="inline-flex -rotate-[3deg] items-center justify-center rounded-[5px] border-2 border-dashed border-ink-faint/45 px-2 py-0.5 font-serif text-[13.5px] font-bold tracking-[0.14em] text-ink-faint/70">
      <span className="pl-[0.14em]">核查中</span>
    </span>
  );
}
