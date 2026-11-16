"""本地界面截图：粘贴一条真实双语引文和它的 C1 改动版（英文译名作者换成别人），体检后展开改判的那条看问题怎么显示。
用法：python shot.py <base_url> <out_dir>"""
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

base, out = sys.argv[1], Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
TEXT = (
    "[1] 杨敏, 赵现朝, 钟泽杉, 等. 复杂约束下的五轴数控系统自适应速度规划[J]. 机械工程学报, 2020, 56(11): 161-171. DOI: 10.3901/JME.2020.11.161. "
    "(Yang Min, Zhao Xianchao, Zhong Zeshan, et al. Adaptive velocity planning under complex constraints for 5-axis CNC systems[J]. Journal of Mechanical Engineering, 2020, 56(11): 161-171.)\n"
    "[2] 杨敏, 赵现朝, 钟泽杉, 等. 复杂约束下的五轴数控系统自适应速度规划[J]. 机械工程学报, 2020, 56(11): 161-171. DOI: 10.3901/JME.2020.11.161. "
    "(Zhang Z B, Yang Y, Zhang X P, et al. Adaptive velocity planning under complex constraints for 5-axis CNC systems[J]. Journal of Mechanical Engineering, 2020, 56(11): 161-171.)"
)
with sync_playwright() as p:
    browser = p.chromium.launch(channel="msedge", args=["--no-proxy-server"])
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(base, wait_until="networkidle", timeout=120000)
    try:
        skip = page.get_by_role("button", name="跳过引导")
        if skip.count():
            skip.first.click()
            page.wait_for_timeout(500)
    except Exception:
        pass
    ta = page.locator("textarea").first
    ta.fill(TEXT)
    page.get_by_role("button", name="开始体检").first.click()
    page.wait_for_function("() => document.querySelectorAll('article [data-summary]').length >= 2", timeout=180000)
    page.wait_for_timeout(1000)
    summaries = page.eval_on_selector_all("article [data-summary]", "els => els.map(e => e.textContent.trim())")
    cards = page.locator("article")
    target = None
    for i in range(cards.count()):
        if "英文译名" in cards.nth(i).inner_text():
            target = cards.nth(i)
            break
    if target is None:
        target = cards.nth(1)
    detail = target.get_by_role("button", name="详情")
    if detail.count():
        detail.first.click()
        page.wait_for_timeout(800)
    target.scroll_into_view_if_needed()
    page.screenshot(path=str(out / "c1-desktop.png"), full_page=False)
    target.screenshot(path=str(out / "c1-card.png"))
    card_text = target.inner_text()
    page.set_viewport_size({"width": 390, "height": 844})
    page.wait_for_timeout(600)
    target.scroll_into_view_if_needed()
    page.screenshot(path=str(out / "c1-mobile.png"), full_page=False)
    overflow = page.evaluate("() => document.documentElement.scrollWidth > window.innerWidth")
    browser.close()
print(json.dumps({"summaries": summaries, "card": card_text[:1200], "mobileOverflow": overflow, "pageErrors": errors}, ensure_ascii=False, indent=1))
