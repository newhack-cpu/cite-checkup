"""给技术说明截界面图：在魔搭公网真实操作，按元素裁剪，2 倍像素。
先试应用自己的地址（带魔搭给的参数）能否直接打开，能打开就在那里截，没有平台水印。
用法：python ms_doc_shots.py <outdir> <repo-root>"""
import json
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

URL = "https://www.modelscope.cn/studios/kgkvybu111111/cite-checkup?mode=full"
OUT = Path(sys.argv[1]); OUT.mkdir(parents=True, exist_ok=True)
ROOT = Path(sys.argv[2])
EXTRA = "\n[12] 10.1038/nature16961\n[13] 易行健, 周利. 数字普惠金融发展是否显著影响了居民消费——来自中国家庭的微观证据[J]. 金融研究, 2018(11): 47-67."
ENGLISH = "RaïssiC BrissaudJ DrayG PonceletP RocheM TeisseireM.Web analyzing traffic challenge: description and results. In: Proceedings of the ECML/PKDD;2007:47‐52."
CLAIM = "在这项研究样本中，即使用 GPT-4，它引用的书籍章节也有七成是编造的。"
DOI = "10.1038/s41598-023-41032-5"
SEEN = "try { localStorage.setItem('cite-intro', '1'); localStorage.setItem('cite-tour', 'done'); } catch (e) {}"
log = {}


def clip_of(page, top_el, bottom_el, pad=16):
    a, b = top_el.bounding_box(), bottom_el.bounding_box()
    x = min(a["x"], b["x"]) - pad
    right = max(a["x"] + a["width"], b["x"] + b["width"]) + pad
    return {"x": x, "y": a["y"] - pad, "width": right - x, "height": b["y"] + b["height"] - a["y"] + 2 * pad}


def shot(page, name, clip=None, el=None):
    path = str(OUT / f"{name}.png")
    if el is not None:
        el.scroll_into_view_if_needed(); page.wait_for_timeout(400)
        el.screenshot(path=path)
    else:
        page.screenshot(path=path, clip=clip)
    log[name] = path


with sync_playwright() as p:
    browser = p.chromium.launch(channel="msedge", args=["--no-proxy-server"])
    ctx = browser.new_context(viewport={"width": 1280, "height": 2200}, device_scale_factor=2)
    ctx.add_init_script(SEEN)
    studio = ctx.new_page()
    studio.goto(URL, wait_until="domcontentloaded", timeout=180_000)
    frame = None
    for _ in range(360):
        frame = next((f for f in studio.frames if "ms.show" in f.url), None)
        if frame and frame.locator("#refs").count():
            break
        studio.wait_for_timeout(500)
    # 平台在应用上面盖了一层透明水印（pointer-events:none 的 PNG 背景），只在这个自动化浏览器里隐藏它
    # 直接改那个元素会被平台的监视程序恢复；加一条样式规则盖住它，元素本身不动
    studio.add_style_tag(content='div[style*="pointer-events: none"][style*="data:image/png"] { display: none !important; }')
    f, pg, page = frame, studio, studio

    # 1 体检结果：需要处理筛选 + 第 4 条字段比对
    f.get_by_role("button", name="载入示例").click()
    pg.wait_for_timeout(500)
    f.fill("#refs", f.locator("#refs").input_value() + EXTRA)
    f.get_by_role("button", name="开始体检", exact=True).click()
    f.wait_for_function("() => /已完成\\s*(\\d+)\\s*\\/\\s*\\1\\s*条/.test(document.body.innerText)", timeout=240_000)
    pg.wait_for_timeout(2500)
    f.locator('[aria-label="按结论筛选"] [role=tab]', has_text="需要处理").first.click()
    pg.wait_for_timeout(1200)
    summary = f.locator('[data-tour="summary"]').first
    lstm = f.locator("article", has_text="Long short-term memory").first
    summary.evaluate("e => e.scrollIntoView({ block: 'start' })"); pg.wait_for_timeout(800)
    shot(pg, "01-results", clip=clip_of(pg, summary, lstm))
    # 2 中文期刊：知网核实
    f.locator('[aria-label="按结论筛选"] [role=tab]', has_text="全部").first.click()
    pg.wait_for_timeout(800)
    zh = f.locator("article", has_text="易行健").first
    zh.get_by_role("button", name="详情").click()
    pg.wait_for_timeout(1200)
    shot(pg, "02-cnki", el=zh)
    # 3 规范参考文献
    f.get_by_role("button", name="规范参考文献").first.click()
    pg.wait_for_timeout(1200)
    shot(pg, "03-standard", el=f.locator("#standard-list").first)
    # 4 AI 继续查
    f.get_by_role("button", name="清空").click()
    f.fill("#refs", ENGLISH)
    f.get_by_role("button", name="开始体检", exact=True).click()
    f.wait_for_function("() => /已完成\\s*(\\d+)\\s*\\/\\s*\\1\\s*条/.test(document.body.innerText)", timeout=240_000)
    card = f.locator("article").first
    card.get_by_role("button", name="AI 继续查").click()
    f.wait_for_function("() => { const a = document.querySelector('article'); return a && /已核实|结论不变|没有找到/.test(a.querySelector('[data-summary]')?.innerText || '') && !/正在规划下一步|正在读取核查记录/.test(a.innerText); }", timeout=180_000)
    pg.wait_for_timeout(1500)
    log["agentSummary"] = card.locator("[data-summary]").first.inner_text()
    card.get_by_role("button", name="详情").click()
    pg.wait_for_timeout(1200)
    shot(pg, "04-agent", el=card)
    # 5 截图识别
    f.get_by_role("button", name="清空").click()
    f.locator('input[type="file"][multiple]').first.set_input_files(str(ROOT / "docs/competition/media/shooting-inputs/mixed-photo.jpg"))
    confirm = f.get_by_role("button", name="确认并填入参考文献").first
    confirm.wait_for(timeout=180_000)
    pg.wait_for_timeout(1000)
    head = f.get_by_text("图片识别 · ", exact=False).first
    head.evaluate("e => e.scrollIntoView({ block: 'start' })"); pg.wait_for_timeout(800)
    shot(pg, "05-vision", clip=clip_of(pg, head, confirm, pad=20))
    f.get_by_role("button", name="放弃预览").first.click()
    pg.wait_for_timeout(800)
    # 6 隐藏提示词
    f.locator('input[type="file"][accept=".pdf,.docx,.txt"]').first.set_input_files(str(ROOT / "docs/competition/media/shooting-inputs/preprint-hidden.pdf"))
    hidden = f.locator('section[aria-label="隐藏文字检测"]').first
    hidden.wait_for(timeout=90_000)
    pg.wait_for_timeout(800)
    shot(pg, "06-hidden", el=hidden)
    f.get_by_role("button", name="放弃预览").first.click()
    # 7 论断核查
    f.get_by_role("tab", name="正文论断核查").click()
    for attempt in range(3):
        f.fill("#claim-text", CLAIM)
        f.fill("#claim-doi", DOI)
        f.get_by_role("button", name="核查论断").click()
        f.wait_for_function("() => /证据来自|核查未完成/.test(document.querySelector('#panel-claims').innerText) && !document.querySelector('#panel-claims [role=status]')", timeout=180_000)
        pg.wait_for_timeout(1500)
        text = f.locator("#panel-claims").inner_text()
        log[f"claimAttempt{attempt + 1}"] = "证据支持" if "证据支持" in text else ("未完成" if "核查未完成" in text else "其他")
        if "证据支持" in text and "Europe PMC 开放全文" in text:
            break
    card = f.locator("section.card", has_text="论断核查报告").first
    quotes_end = f.get_by_role("button", name="查看片段").last
    card.evaluate("e => e.scrollIntoView({ block: 'start' })"); pg.wait_for_timeout(800)
    box, end = card.bounding_box(), quotes_end.bounding_box()
    shot(pg, "07-claim", clip={"x": box["x"] - 12, "y": box["y"] - 12, "width": box["width"] + 24, "height": end["y"] + end["height"] - box["y"] + 40})
    browser.close()

(OUT / "shots.json").write_text(json.dumps(log, ensure_ascii=False, indent=1), encoding="utf-8")
print(json.dumps(log, ensure_ascii=False))
