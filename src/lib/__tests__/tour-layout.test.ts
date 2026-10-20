import { describe, expect, it } from "vitest";
import { loopPath, placeCard } from "../tour-layout";

const desktop = { width: 1440, height: 900 };
const card = { width: 340, height: 220 };

describe("引导批注卡的位置", () => {
  it("按偏好顺序放在第一个放得下的一侧", () => {
    const tabs = { left: 144, top: 200, width: 1152, height: 80 };
    expect(placeCard(tabs, card, desktop, ["bottom", "top"])).toEqual({ left: 144, top: 296, side: "bottom" });
    const input = { left: 144, top: 350, width: 400, height: 200 };
    expect(placeCard(input, card, desktop, ["right", "bottom"])).toMatchObject({ left: 560, side: "right" });
  });

  it("下面放不下就换到上面，并且不出视口", () => {
    const start = { left: 1200, top: 760, width: 200, height: 50 };
    const placed = placeCard(start, card, desktop, ["bottom", "top"]);
    expect(placed.side).toBe("top");
    expect(placed.top).toBe(760 - 16 - 220);
    expect(placed.left + card.width).toBeLessThanOrEqual(desktop.width - 12);
  });

  it("目标比屏幕还高、哪边都放不下时贴在视口底部", () => {
    const phone = { width: 390, height: 844 };
    const tall = { left: 20, top: 40, width: 350, height: 900 };
    const placed = placeCard(tall, { width: 366, height: 240 }, phone, ["bottom", "top"]);
    expect(placed).toEqual({ left: 12, top: 844 - 240 - 12, side: "sheet" });
  });
});

describe("朱笔圈", () => {
  it("是一条从上边出发、绕一圈后越过起点的路径", () => {
    const path = loopPath(300, 100);
    expect(path.startsWith("M 173 9")).toBe(true);
    expect(path.match(/Q /g)).toHaveLength(4);
    expect(path).not.toMatch(/NaN|Infinity/);
  });

  it("目标很小时圆角不会超过一半边长", () => {
    expect(loopPath(0, 0)).not.toMatch(/NaN|-\d/);
  });
});
