"""量页面里各种“切换”从点击到画面稳定要多久。
用法：python measure_switch.py <网址> <输出 json> [cpu 降速倍数]
稳定 = 主区域里没有还在播的有限时长动画 / 过渡；另记新面板标题不透明度到 0.99 的时间和最长一帧间隔。
"""
import json
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1]
OUT = sys.argv[2]
THROTTLE = float(sys.argv[3]) if len(sys.argv) > 3 else 1

PROBE = r"""
async ({ click, watch }) => {
  const main = document.querySelector('main');
  const target = typeof click === 'string' ? document.querySelector(click) : null;
  if (!target) return { error: 'no target ' + click };
  const finite = () => document.getAnimations().filter((a) => {
    const el = a.effect && a.effect.target;
    if (!el || !(main.contains(el) || el.closest('header'))) return false;
    const t = a.effect.getComputedTiming();
    return Number.isFinite(t.endTime) && a.playState === 'running';
  });
  const start = performance.now();
  target.click();
  let last = start, maxGap = 0, frames = 0, visibleAt = null, settledAt = null, peak = 0, names = new Set();
  await new Promise((resolve) => {
    const tick = (now) => {
      frames += 1;
      maxGap = Math.max(maxGap, now - last);
      last = now;
      const running = finite();
      peak = Math.max(peak, running.length);
      for (const a of running) names.add(a.animationName || 'transition:' + a.transitionProperty);
      if (visibleAt === null && watch) {
        const el = document.querySelector(watch);
        if (el && el.offsetParent !== null) {
          let o = 1;
          for (let n = el; n && n !== document.body; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity);
          if (o >= 0.99) visibleAt = now - start;
        }
      }
      if (running.length === 0 && frames > 2) { settledAt = now - start; resolve(); return; }
      if (now - start > 6000) { resolve(); return; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  return {
    settledMs: settledAt === null ? null : Math.round(settledAt),
    visibleMs: visibleAt === null ? null : Math.round(visibleAt),
    maxFrameGapMs: Math.round(maxGap), frames, peakAnimations: peak, animations: [...names].sort(),
  };
}
"""


def main():
    out = {"url": URL, "cpuThrottle": THROTTLE, "steps": {}}
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", args=["--no-proxy-server"])
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.add_init_script("try{localStorage.setItem('cite-intro','1');localStorage.setItem('cite-tour','done')}catch(e){}")
        page.goto(URL, wait_until="networkidle")
        page.wait_for_timeout(2500)
        if THROTTLE > 1:
            cdp = page.context.new_cdp_session(page)
            cdp.send("Emulation.setCPUThrottlingRate", {"rate": THROTTLE})

        def probe(name, click, watch=None):
            result = page.evaluate(PROBE, {"click": click, "watch": watch})
            out["steps"][name] = result
            print(name, json.dumps(result, ensure_ascii=False))
            page.wait_for_timeout(1200)

        # 空页面：两个任务来回切
        probe("empty: refs -> claims", "#tab-claims", "#panel-claims h2")
        probe("empty: claims -> refs", "#tab-references", "#panel-references h2")

        # 载入示例并体检
        page.get_by_role("button", name="载入示例").first.click()
        page.wait_for_timeout(400)
        page.get_by_role("button", name="开始体检").first.click()
        page.wait_for_function(
            "() => { const t = document.querySelector('[data-tour=summary]'); return t && /体检完成|核查完成/.test(t.textContent); }",
            timeout=180000,
        )
        page.wait_for_timeout(2500)
        out["cards"] = page.locator("#panel-references article").count()

        probe("results: refs -> claims", "#tab-claims", "#panel-claims h2")
        probe("results: claims -> refs", "#tab-references", "#panel-references article")

        # 结果筛选
        chips = page.locator('[aria-label="按结论筛选"] [role=tab]')
        labels = [chips.nth(i).inner_text().strip().replace("\n", " ") for i in range(chips.count())]
        out["filters"] = labels
        page.evaluate("() => document.querySelectorAll('[aria-label=\"按结论筛选\"] [role=tab]').forEach((el, i) => el.setAttribute('data-probe', 'chip-' + i))")
        probe("filter: all -> attention", "[data-probe=chip-1]", "#panel-references article")
        probe("filter: attention -> all", "[data-probe=chip-0]", "#panel-references article:last-of-type")
        probe("filter: all -> verified", "[data-probe=chip-2]", "#panel-references article")
        probe("filter: verified -> all", "[data-probe=chip-0]", "#panel-references article:last-of-type")

        # 详情展开
        page.evaluate("() => { const b = [...document.querySelectorAll('#panel-references article button[aria-expanded=false]')][0]; if (b) b.setAttribute('data-probe', 'detail'); }")
        probe("detail: expand", "[data-probe=detail]")

        page.screenshot(path=OUT.replace(".json", ".png"))
        browser.close()
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)


main()
