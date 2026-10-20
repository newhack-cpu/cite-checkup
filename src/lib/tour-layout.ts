// 新手引导的几何计算：批注卡放在哪一侧、朱笔圈怎么画。纯函数，便于测试。

export interface Rect { left: number; top: number; width: number; height: number }
export type Side = "bottom" | "top" | "right" | "left";

/**
 * 批注卡放在目标旁边：按偏好顺序找第一个放得下的一侧，并夹在视口内。
 * 都放不下（目标比屏幕还高、手机屏幕太窄）时贴在视口底部，像一张底部便签。
 */
export function placeCard(
  target: Rect,
  card: { width: number; height: number },
  viewport: { width: number; height: number },
  prefer: Side[],
  gap = 16,
  margin = 12,
): { left: number; top: number; side: Side | "sheet" } {
  const clampX = (x: number) => Math.max(margin, Math.min(x, viewport.width - card.width - margin));
  const clampY = (y: number) => Math.max(margin, Math.min(y, viewport.height - card.height - margin));
  const bottom = target.top + target.height;
  const right = target.left + target.width;
  for (const side of prefer) {
    if (side === "bottom" && bottom + gap + card.height + margin <= viewport.height && bottom + gap >= margin) {
      return { left: clampX(target.left), top: bottom + gap, side };
    }
    if (side === "top" && target.top - gap - card.height >= margin && target.top - gap <= viewport.height) {
      return { left: clampX(target.left), top: target.top - gap - card.height, side };
    }
    if (side === "right" && right + gap + card.width + margin <= viewport.width) {
      return { left: right + gap, top: clampY(target.top + target.height / 2 - card.height / 2), side };
    }
    if (side === "left" && target.left - gap - card.width >= margin) {
      return { left: target.left - gap - card.width, top: clampY(target.top + target.height / 2 - card.height / 2), side };
    }
  }
  return { left: clampX(margin), top: Math.max(margin, viewport.height - card.height - margin), side: "sheet" };
}

/**
 * 手绘的朱笔圈：沿目标外框绕一圈，四角略圆、边略歪，收笔越过起点再往上带一点，像老师批卷时随手圈出。
 * 返回的路径画在 (width + 2·inset) × (height + 2·inset) 的画布里，inset 给笔画和收笔留出余地。
 */
export function loopPath(width: number, height: number, inset = 8): string {
  const w = Math.max(width, 8);
  const h = Math.max(height, 8);
  const m = inset;
  const r = Math.min(16, h / 2, w / 2);
  const p = (x: number, y: number) => `${Math.round(x * 10) / 10} ${Math.round(y * 10) / 10}`;
  return [
    `M ${p(m + w * 0.55, m + 1)}`,
    `L ${p(m + w - r, m - 1)}`,
    `Q ${p(m + w + 1, m - 1)} ${p(m + w + 1, m + r)}`,
    `L ${p(m + w - 1, m + h - r)}`,
    `Q ${p(m + w - 1, m + h + 1)} ${p(m + w - r, m + h + 1)}`,
    `L ${p(m + r, m + h)}`,
    `Q ${p(m - 1, m + h)} ${p(m - 1, m + h - r)}`,
    `L ${p(m + 1, m + r)}`,
    `Q ${p(m + 1, m - 1)} ${p(m + r + 2, m)}`,
    `L ${p(m + w * 0.72, m - Math.min(4, m - 1))}`,
  ].join(" ");
}
