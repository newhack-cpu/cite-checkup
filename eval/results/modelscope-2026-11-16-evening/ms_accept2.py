"""魔搭公网验收（2026-11-16 晚，部署 2be6797 之后）：本机 Edge 直连，不走代理，在平台页的 iframe 里操作。
第 1 轮：载入示例 + 拍摄输入① 两行，和 10-26 公网彩排的 13 条摘要逐条比。
第 2 轮：双语引文译名作者被换掉（应判有误）与忠实译名（应已核实）；Crossref 姓名登反那篇的规范参考文献与 BibTeX 导出。
第 3 轮：批量 AI 追查（演示视频里 AI 继续查的那篇会议论文）；首屏“为什么不直接问 AI”一行。
用法：python ms_accept2.py <out.json> <shots_dir>
"""
import json
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

URL = "https://www.modelscope.cn/studios/kgkvybu111111/cite-checkup?mode=full"
out_path, shots = Path(sys.argv[1]), Path(sys.argv[2])
shots.mkdir(parents=True, exist_ok=True)
REHEARSAL = json.load(open(r"D:\Darks\projects\cite-checkup\eval\results\modelscope-2026-10-26\shoot-check.json", encoding="utf-8"))["steps"]["seg3"]["all"]
EXTRA = ("[12] 10.1038/nature16961\n"
         "[13] 易行健, 周利. 数字普惠金融发展是否显著影响了居民消费——来自中国家庭的微观证据[J]. 金融研究, 2018(11): 47-67.")
JME = "杨敏, 赵现朝, 钟泽杉, 等. 复杂约束下的五轴数控系统自适应速度规划[J]. 机械工程学报, 2020, 56(11): 161-171. DOI: 10.3901/JME.2020.11.161."
EN = "Adaptive velocity planning under complex constraints for 5-axis CNC systems[J]. Journal of Mechanical Engineering, 2020, 56(11): 161-171."
ROUND2 = (f"[1] {JME} (Yang Min, Zhao Xianchao, Zhong Zeshan, et al. {EN})\n"
          f"[2] {JME} (Zhang Z B, Yang Y, Zhang X P, et al. {EN})")
ROUND3 = "[1] RaïssiC BrissaudJ DrayG PonceletP RocheM TeisseireM.Web analyzing traffic challenge: description and results. In: Proceedings of the ECML/PKDD;2007:47–52."
rec = {"url": URL, "startedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z")}


def find_frame(page, timeout=240):
    deadline = time.time() + timeout
    while time.time() < deadline:
        for f in page.frames:
            if f is page.main_frame:
                continue
            try:
                if f.locator("h1", has_text="引用体检").count():
                    return f
            except Exception:
                pass
        page.wait_for_timeout(500)
    raise RuntimeError("应用 iframe 没有出现")


def run_check(frame, expected):
    frame.get_by_role("button", name="开始体检").first.click()
    t0 = time.time()
    frame.wait_for_function(
        f"() => document.querySelectorAll('article [data-summary]').length >= {expected}", timeout=240000)
    frame.wait_for_timeout(1000)
    return round(time.time() - t0, 1), frame.eval_on_selector_all("article [data-summary]", "els => els.map(e => e.textContent.trim())")


def fill(frame, text):
    frame.get_by_role("button", name="清空").first.click()
    frame.wait_for_timeout(500)
    ta = frame.locator("textarea").first
    ta.click()
    ta.fill(text)


with sync_playwright() as p:
    browser = p.chromium.launch(channel="msedge", args=["--no-proxy-server"])
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, accept_downloads=True)
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    t0 = time.time()
    page.goto(URL, wait_until="domcontentloaded", timeout=90000)
    frame = find_frame(page)
    frame.wait_for_function("() => { const t = document.querySelector('textarea'); return t && !t.disabled; }", timeout=120000)
    rec["appReadySeconds"] = round(time.time() - t0, 1)
    for name in ["跳过引导", "先不用"]:
        try:
            b = frame.get_by_role("button", name=name)
            if b.count():
                b.first.click()
                frame.wait_for_timeout(400)
        except Exception:
            pass

    # 首屏对照数据那一行
    line = frame.locator("summary", has_text="为什么不直接问 AI")
    rec["compareLine"] = line.inner_text() if line.count() else None
    rec["agentStatus"] = frame.evaluate("() => fetch('/api/agent').then(r => r.json()).catch(e => String(e))")

    # 第 1 轮
    frame.get_by_role("button", name="载入示例").first.click()
    frame.wait_for_timeout(600)
    ta = frame.locator("textarea").first
    ta.click()
    ta.press("Control+End")
    ta.press("Enter")
    ta.type(EXTRA, delay=2)
    seconds, summaries = run_check(frame, 13)
    same = [s == r for s, r in zip(summaries, REHEARSAL)]
    rec["round1"] = {"seconds": seconds, "count": len(summaries), "sameAsRehearsal": sum(same), "diff": [(i + 1, s, r) for i, (s, r, ok) in enumerate(zip(summaries, REHEARSAL, same)) if not ok]}
    page.screenshot(path=str(shots / "round1.png"))

    # 第 2 轮
    fill(frame, ROUND2)
    seconds, summaries = run_check(frame, 2)
    cards = frame.locator("article")
    issue = ""
    for i in range(cards.count()):
        if "英文译名" in cards.nth(i).inner_text():
            issue = cards.nth(i).inner_text()
    frame.get_by_role("button", name="规范参考文献").first.click()
    frame.wait_for_timeout(800)
    standard = frame.locator('ol[aria-label="规范参考文献列表"]').inner_text()
    frame.locator("#standard-list").scroll_into_view_if_needed()
    page.screenshot(path=str(shots / "round2.png"))
    with page.expect_download(timeout=30000) as dl:
        frame.get_by_role("button", name="导出 BibTeX").click()
    target = shots / dl.value.suggested_filename
    dl.value.save_as(str(target))
    rec["round2"] = {"seconds": seconds, "summaries": summaries, "translationIssue": "英文译名" in issue, "standardList": standard, "bibtex": target.read_text(encoding="utf-8")}

    # 第 3 轮
    fill(frame, ROUND3)
    seconds, summaries = run_check(frame, 1)
    panel = frame.locator('section[aria-label="AI 批量追查"]')
    panel.wait_for(timeout=30000)
    before_panel = panel.inner_text()
    panel.get_by_role("button").first.click()
    t1 = time.time()
    frame.wait_for_function("() => { const s = document.querySelector('section[aria-label=\"AI 批量追查\"]'); return s && /AI 追查了/.test(s.innerText); }", timeout=300000)
    frame.wait_for_timeout(1200)
    panel.scroll_into_view_if_needed()
    page.screenshot(path=str(shots / "round3.png"))
    rec["round3"] = {"checkSeconds": seconds, "before": summaries, "panelBefore": before_panel, "batchSeconds": round(time.time() - t1, 1),
                     "panelDone": panel.inner_text(), "after": frame.eval_on_selector_all("article [data-summary]", "els => els.map(e => e.textContent.trim())")}
    rec["pageErrors"] = errors
    browser.close()

rec["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
out_path.write_text(json.dumps(rec, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(rec, ensure_ascii=False, indent=1))
