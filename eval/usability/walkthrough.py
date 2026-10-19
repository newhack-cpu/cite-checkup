"""可用性走查：在生产版预览（http://localhost:3210）上模拟第一次来访的用户完成常见任务，
记录每项任务的操作步数、等待时间、首屏可见性、键盘可达性、触控目标尺寸和 axe-core 无障碍检查结果。
这是自动化的专家走查，不是真人可用性测试；真人测试见 docs/competition/TRIAL_GUIDE.md 的任务和 SUS 问卷。

用法：python -I eval/usability/walkthrough.py eval/results/usability-2026-10-18
结果写到 <outdir>/walkthrough.json，截图写到同目录（截图不进 git）。
"""
import json
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
BASE = "http://localhost:3210/"
OUT = Path(sys.argv[1])
OUT.mkdir(parents=True, exist_ok=True)
AXE = (ROOT / "node_modules/.pnpm/axe-core@4.14.0/node_modules/axe-core/axe.min.js").read_text(encoding="utf-8")
PDF = ROOT / "src/lib/documents/__tests__/fixtures/paper.pdf"
CLAIM = "即使用 GPT-4，它引用的书籍章节里也有七成是编造的。"
CLAIM_DOI = "10.1038/s41598-023-41032-5"
NOT_REFERENCES = "本研究采用问卷调查法，对 300 名大学生的学习动机进行了测量。结果表明，内在动机与学业成绩显著正相关。"
VERDICT_WORDS = ["证据支持", "部分支持", "与证据矛盾", "证据不足", "未完成"]

report = {"base": BASE, "startedAt": time.strftime("%Y-%m-%dT%H:%M:%S"), "tasks": [], "axe": [], "keyboard": [], "targets": [], "notes": []}


def task(name, **fields):
    entry = {"task": name, **fields}
    report["tasks"].append(entry)
    print(json.dumps(entry, ensure_ascii=False))
    return entry


def axe(page, state):
    page.add_script_tag(content=AXE)
    violations = page.evaluate(
        """async () => {
          const r = await axe.run(document, { resultTypes: ['violations'] });
          return r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length,
            sample: v.nodes.slice(0, 3).map(n => n.target.join(' ') + ' :: ' + (n.failureSummary || '').split('\\n').slice(0, 2).join(' ')) }));
        }"""
    )
    report["axe"].append({"state": state, "violations": violations})
    print("axe", state, [(v["id"], v["impact"], v["nodes"]) for v in violations])


def vitals(page):
    return page.evaluate(
        """() => new Promise(resolve => {
          const nav = performance.getEntriesByType('navigation')[0];
          const fcp = performance.getEntriesByName('first-contentful-paint')[0];
          let lcp = 0;
          new PerformanceObserver(list => { for (const e of list.getEntries()) lcp = Math.max(lcp, e.startTime); })
            .observe({ type: 'largest-contentful-paint', buffered: true });
          setTimeout(() => resolve({
            domContentLoadedMs: Math.round(nav ? nav.domContentLoadedEventEnd : 0),
            loadMs: Math.round(nav ? nav.loadEventEnd : 0),
            fcpMs: Math.round(fcp ? fcp.startTime : 0),
            lcpMs: Math.round(lcp),
            transferredKB: Math.round(performance.getEntriesByType('resource').reduce((a, r) => a + (r.transferSize || 0), 0) / 1024),
          }), 800);
        })"""
    )


def visible_in_first_screen(page, locator):
    if locator.count() == 0:
        return False
    box = locator.first.bounding_box()
    vp = page.viewport_size
    return bool(box) and box["y"] >= 0 and box["y"] + min(box["height"], 40) <= vp["height"]


def first_screen(page, label):
    page.goto(BASE, wait_until="networkidle")
    v = vitals(page)
    seen = {
        "参考文献输入框": visible_in_first_screen(page, page.locator("#refs")),
        "开始体检按钮": visible_in_first_screen(page, page.get_by_role("button", name="开始体检")),
        "载入示例": visible_in_first_screen(page, page.get_by_role("button", name="载入示例")),
        "两个任务标签": visible_in_first_screen(page, page.get_by_role("tab", name="正文论断核查")),
        "导入文件按钮": visible_in_first_screen(page, page.get_by_role("button", name="导入 PDF / Word / TXT")),
    }
    page.screenshot(path=str(OUT / f"{label}-01-first-screen.png"))
    page.screenshot(path=str(OUT / f"{label}-01-full-page.png"), full_page=True)
    height = page.evaluate("document.documentElement.scrollHeight")
    return task(f"{label}：打开首页", vitals=v, firstScreen=seen, pageHeight=height)


def run_check(page, label):
    page.get_by_role("button", name="载入示例").click()
    detected = page.get_by_text("识别到").first.inner_text()
    t0 = time.time()
    page.get_by_role("button", name="开始体检").click()
    page.locator("article[aria-busy=false]").first.wait_for(timeout=60_000)
    first = time.time() - t0
    page.get_by_text("已完成").first.wait_for(timeout=120_000)
    page.wait_for_function("() => /已完成\\s*(\\d+)\\s*\\/\\s*\\1\\s*条/.test(document.body.innerText)", timeout=180_000)
    done = time.time() - t0
    chips = [c.inner_text().replace("\n", " ") for c in page.get_by_role("tablist", name="按结论筛选").get_by_role("tab").all()]
    page.screenshot(path=str(OUT / f"{label}-02-results.png"))
    return task(f"{label}：载入示例并体检", steps=2, detected=detected.replace("\n", " "), firstResultSeconds=round(first, 1), allDoneSeconds=round(done, 1), filterChips=chips)


def overflow(page):
    return page.evaluate("[document.documentElement.clientWidth, document.documentElement.scrollWidth]")


def tap_targets(page, label):
    small = page.evaluate(
        """() => [...document.querySelectorAll('button, a[href], input, textarea, select, [role=tab]')]
          .filter(el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden'; })
          .map(el => { const r = el.getBoundingClientRect(); return { text: (el.innerText || el.getAttribute('aria-label') || el.id || el.tagName).trim().slice(0, 24), w: Math.round(r.width), h: Math.round(r.height) }; })
          .filter(t => Math.min(t.w, t.h) < 44)"""
    )
    report["targets"].append({"state": label, "under44px": small, "under24px": [t for t in small if min(t["w"], t["h"]) < 24]})
    return small


with sync_playwright() as p:
    browser = p.chromium.launch()

    # ---------- 桌面 ----------
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, accept_downloads=True)
    ctx.grant_permissions(["clipboard-read", "clipboard-write"], origin=BASE.rstrip("/"))
    page = ctx.new_page()
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

    first_screen(page, "desktop")
    axe(page, "桌面首页")

    # 键盘：从页面顶部开始按 Tab，看能否到达输入框和开始体检，焦点是否看得见
    page.goto(BASE, wait_until="networkidle")
    seen = []
    for i in range(30):
        page.keyboard.press("Tab")
        info = page.evaluate(
            """() => { const el = document.activeElement; if (!el) return null; const s = getComputedStyle(el);
              const ring = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || (s.boxShadow && s.boxShadow !== 'none');
              return { tag: el.tagName.toLowerCase(), id: el.id || null, text: (el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim().slice(0, 30), focusVisible: !!ring }; }"""
        )
        seen.append(info)
    reach = {
        "输入框": next((i + 1 for i, s in enumerate(seen) if s and s["id"] == "refs"), None),
        "开始体检": next((i + 1 for i, s in enumerate(seen) if s and "开始体检" in s["text"]), None),
    }
    report["keyboard"].append({"state": "桌面首页", "tabPresses": len(seen), "reachedAt": reach, "withoutVisibleFocus": [s for s in seen if s and not s["focusVisible"]], "sequence": seen})
    print("keyboard", reach, "without focus ring:", len([s for s in seen if s and not s["focusVisible"]]))

    # 空输入、非参考文献文字、超长输入
    page.goto(BASE, wait_until="networkidle")
    start = page.get_by_role("button", name="开始体检")
    task("桌面：空输入", startDisabled=start.is_disabled())
    page.fill("#refs", NOT_REFERENCES)
    detected = page.get_by_text("识别到").first.inner_text().replace("\n", " ")
    start.click()
    page.wait_for_function("() => /已完成\\s*(\\d+)\\s*\\/\\s*\\1\\s*条/.test(document.body.innerText)", timeout=120_000)
    verdicts = [a.locator("p.font-serif.font-bold").first.inner_text() for a in page.locator("article").all()]
    page.screenshot(path=str(OUT / "desktop-03-not-references.png"))
    task("桌面：粘贴的是正文段落而不是参考文献", detected=detected, results=verdicts)
    page.goto(BASE, wait_until="networkidle")
    page.fill("#refs", "[1] " + "很长的一段文字。" * 9000)
    long_text = page.locator("body").inner_text()
    task("桌面：超长输入（7.2 万字符）", startDisabled=page.get_by_role("button", name="开始体检").is_disabled(),
         hint=[line for line in long_text.split("\n") if "字符" in line or "条" in line][:4])

    # 主流程：载入示例 → 体检 → 只看有问题的 → 复制修正版 → 下载报告
    page.goto(BASE, wait_until="networkidle")
    run_check(page, "desktop")
    axe(page, "桌面结果页")
    tablist = page.get_by_role("tablist", name="按结论筛选")
    mismatch_chip = tablist.get_by_role("tab").filter(has_text="有误")
    shown = None
    if mismatch_chip.count():
        mismatch_chip.first.click()
        shown = page.locator("article").count()
        page.screenshot(path=str(OUT / "desktop-04-filter-mismatch.png"))
        tablist.get_by_role("tab").first.click()
    page.get_by_role("button", name="复制修正版清单").click()
    page.wait_for_timeout(500)
    clip = page.evaluate("navigator.clipboard.readText()")
    task("桌面：筛出“有误”并复制修正版清单", steps=2, mismatchCardsShown=shown, clipboardLines=len([l for l in clip.split("\n") if l.strip()]), clipboardHead=clip[:300])
    with page.expect_download() as dl:
        page.get_by_role("button", name="下载核查报告").click()
    path = OUT / "desktop-report.md"
    dl.value.save_as(str(path))
    task("桌面：下载核查报告", steps=1, fileName=dl.value.suggested_filename, sizeKB=round(path.stat().st_size / 1024, 1))

    # AI 继续查
    button = page.get_by_role("button", name="AI 继续查")
    if button.count():
        t0 = time.time()
        button.first.click()
        page.wait_for_timeout(500)
        page.wait_for_function("() => !document.body.innerText.includes('正在规划下一步') && !document.body.innerText.includes('正在读取核查记录')", timeout=180_000)
        card = page.locator("article").filter(has=page.get_by_text("AI 检索")).first
        page.screenshot(path=str(OUT / "desktop-05-agent.png"))
        task("桌面：对一条待人工的条目点“AI 继续查”", steps=1, seconds=round(time.time() - t0, 1), aiButtons=button.count(),
             outcome=page.locator("article").filter(has=page.get_by_text("AI 检索")).first.locator("p.font-serif.font-bold").first.inner_text() if card.count() else None)

    # 导入 PDF
    page.goto(BASE, wait_until="networkidle")
    t0 = time.time()
    page.locator("input[type=file][accept='.pdf,.docx,.txt']").first.set_input_files(str(PDF))
    page.get_by_role("button", name="确认并填入参考文献").wait_for(timeout=60_000)
    preview = time.time() - t0
    region = page.get_by_label("参考文献区域", exact=False)
    region_enabled = region.count() > 0 and region.first.is_enabled()
    page.screenshot(path=str(OUT / "desktop-06-import-preview.png"))
    page.get_by_role("button", name="确认并填入参考文献").click()
    detected = page.get_by_text("识别到").first.inner_text().replace("\n", " ")
    task("桌面：导入 PDF 的参考文献", steps=3, previewSeconds=round(preview, 1), referenceRegionDetected=region_enabled, detected=detected)

    # 论断核查
    page.goto(BASE, wait_until="networkidle")
    page.get_by_role("tab", name="正文论断核查").click()
    page.fill("#claim-text", CLAIM)
    page.fill("#claim-doi", CLAIM_DOI)
    t0 = time.time()
    page.get_by_role("button", name="核查论断").click()
    page.wait_for_function("words => words.some(w => document.body.innerText.includes(w))", arg=VERDICT_WORDS, timeout=240_000)
    page.wait_for_function("() => !document.body.innerText.includes('正在检索证据')", timeout=240_000)
    page.wait_for_timeout(1500)
    body = page.locator("body").inner_text()
    page.screenshot(path=str(OUT / "desktop-07-claim.png"))
    task("桌面：核查一句论断（DOI）", steps=4, seconds=round(time.time() - t0, 1), verdict=next((w for w in VERDICT_WORDS if w in body), None), quoteLinks=page.get_by_text("查看片段").count())
    axe(page, "桌面论断结果")
    report["notes"].append({"desktopConsoleErrors": errors})
    ctx.close()

    # ---------- 手机 ----------
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    page = ctx.new_page()
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    first_screen(page, "mobile")
    axe(page, "手机首页")
    tap_targets(page, "手机首页")
    run_check(page, "mobile")
    task("手机：结果页横向溢出", clientVsScroll=overflow(page))
    page.screenshot(path=str(OUT / "mobile-03-results-full.png"), full_page=True)
    axe(page, "手机结果页")
    tap_targets(page, "手机结果页")
    report["notes"].append({"mobileConsoleErrors": errors})
    ctx.close()
    browser.close()

report["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S")
(OUT / "walkthrough.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
print("done")
