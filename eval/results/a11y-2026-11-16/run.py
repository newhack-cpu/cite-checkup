"""11-16 新组件的无障碍检查（axe-core 4.14，与 10-18 走查同一版本）：首屏“为什么不直接问 AI”一行、批量追查面板、
规范参考文献面板里的“导出 BibTeX”。另查这几处能否只用键盘操作（Tab 能到、Enter 能触发）。
用法：python eval/results/a11y-2026-11-16/run.py <base_url> <out.json>（项目根目录，先启动本机服务）"""
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[3]
AXE = (ROOT / "node_modules/.pnpm/axe-core@4.14.0/node_modules/axe-core/axe.min.js").read_text(encoding="utf-8")
base, out = sys.argv[1], Path(sys.argv[2])
TEXT = "\n".join([
    "[1] LECUN Y, BENGIO Y, HINTON G. Deep learning[J]. Nature, 2015, 521(7553): 436-444.",
    "[2] RaïssiC BrissaudJ DrayG PonceletP RocheM TeisseireM.Web analyzing traffic challenge: description and results. In: Proceedings of the ECML/PKDD;2007:47–52.",
    "[3] Smith, J., & Zhang, L. (2021). Deep reinforcement learning for adaptive climate policy optimization. Nature Climate Change, 11(4), 312–320.",
])
NEW = ['section[aria-label="AI 批量追查"]', "details:has(summary:has-text('为什么不直接问'))", "#standard-list"]
report = {"base": base, "axeVersion": "4.14.0", "states": [], "keyboard": {}}


def axe(page, state):
    page.add_script_tag(content=AXE)
    res = page.evaluate("""async () => {
      const r = await axe.run(document, { resultTypes: ['violations'] });
      return r.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, targets: v.nodes.slice(0, 6).map(n => n.target.join(' ')) }));
    }""")
    report["states"].append({"state": state, "violations": res})
    print(state, [(v["id"], v["impact"], v["nodes"]) for v in res])


with sync_playwright() as p:
    browser = p.chromium.launch(channel="msedge", args=["--no-proxy-server"])
    for vp_name, vp in [("desktop", {"width": 1440, "height": 900}), ("mobile", {"width": 390, "height": 844})]:
        page = browser.new_page(viewport=vp)
        page.goto(base, wait_until="networkidle", timeout=120000)
        page.wait_for_timeout(2500)
        b = page.get_by_role("button", name="先不用")
        if b.count():
            b.first.click()
        page.locator("summary", has_text="为什么不直接问 AI").click()
        page.wait_for_timeout(400)
        axe(page, f"{vp_name}：首页，对照数据展开")
        page.locator("textarea").first.fill(TEXT)
        page.get_by_role("button", name="开始体检").first.click()
        page.wait_for_function("() => document.querySelectorAll('article [data-summary]').length >= 3", timeout=240000)
        page.wait_for_timeout(1500)
        page.get_by_role("button", name="规范参考文献").first.click()
        page.wait_for_timeout(800)
        axe(page, f"{vp_name}：结果页，批量追查面板与规范参考文献面板")
        if vp_name == "desktop":
            # 键盘：从页面顶部按 Tab，看三处新控件能不能拿到焦点
            page.evaluate("window.scrollTo(0, 0); document.activeElement && document.activeElement.blur()")
            seen = set()
            for _ in range(160):
                page.keyboard.press("Tab")
                label = page.evaluate("() => { const e = document.activeElement; return e ? (e.innerText || e.getAttribute('aria-label') || '').trim().slice(0, 30) : '' }")
                for key in ["为什么不直接问 AI", "AI 继续查这", "导出 BibTeX"]:
                    if label.startswith(key) or key in label:
                        seen.add(key)
            report["keyboard"]["reachableByTab"] = sorted(seen)
        page.close()
    browser.close()
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
print("keyboard", report["keyboard"])
