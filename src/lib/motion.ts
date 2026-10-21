// 界面动效的小工具：按下时的朱砂涟漪、数字缓动、滑动高亮底。都尊重系统的“减少动画”设置。
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from "react";

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** 在 .ink 按钮里、指尖按下的位置放一滴“朱砂”，晕开后自己移除 */
export function inkDrop(event: PointerEvent<HTMLElement>, color?: string) {
  if (reducedMotion()) return;
  const host = event.currentTarget;
  const rect = host.getBoundingClientRect();
  const drop = document.createElement("span");
  drop.className = "ink-drop";
  drop.style.left = `${event.clientX - rect.left}px`;
  drop.style.top = `${event.clientY - rect.top}px`;
  if (color) drop.style.setProperty("--ink-color", color);
  drop.addEventListener("animationend", () => drop.remove(), { once: true });
  host.appendChild(drop);
}

/** 数字从当前显示值缓动到新值（指数缓出）；减少动画时直接跳到新值 */
export function useCountUp(value: number, duration = 650): number {
  const [shown, setShown] = useState(value);
  const current = useRef(value);
  useEffect(() => {
    const from = current.current;
    if (from === value) return;
    const instant = reducedMotion();
    const start = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const t = instant ? 1 : Math.min(1, (now - start) / duration);
      const eased = t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
      current.current = Math.round(from + (value - from) * eased);
      setShown(current.current);
      if (t < 1) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);
  return shown;
}

/**
 * 滑动高亮底：在容器里找 data-glide-active="true" 的那一项，把高亮块挪到它下面。
 * 每次渲染提交后、绘制前同步量一次（不等下一帧：后台标签页里 requestAnimationFrame 会暂停），
 * 容器或某一项改尺寸、换行时再量。第一次出现直接就位，之后切换都带弹簧过渡。容器要是 position: relative。
 * 返回 [容器 ref, 高亮块 ref]；高亮块的位置和尺寸由这里直接写样式，不经过 React 状态。
 */
export function useGlide<T extends HTMLElement, P extends HTMLElement = HTMLSpanElement>() {
  const hostRef = useRef<T>(null);
  const pillRef = useRef<P>(null);
  useLayoutEffect(() => {
    const host = hostRef.current;
    const pill = pillRef.current;
    if (!host || !pill) return;
    const place = () => {
      const el = host.querySelector<HTMLElement>('[data-glide-active="true"]');
      if (!el) {
        pill.style.opacity = "0";
        return;
      }
      const first = pill.dataset.placed !== "true";
      if (first) pill.style.transition = "none";
      pill.style.transform = `translate(${el.offsetLeft}px, ${el.offsetTop}px)`;
      pill.style.width = `${el.offsetWidth}px`;
      pill.style.height = `${el.offsetHeight}px`;
      pill.style.opacity = "1";
      if (first) {
        pill.dataset.placed = "true";
        void pill.offsetWidth; // 先按无过渡落位，再恢复过渡
        pill.style.transition = "";
      }
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(host);
    for (const child of host.children) if (child !== pill) observer.observe(child);
    return () => observer.disconnect();
  });
  return [hostRef, pillRef] as const;
}
