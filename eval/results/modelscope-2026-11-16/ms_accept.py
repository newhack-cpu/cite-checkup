"""魔搭公网验收（2026-11-16 部署 fd3d423 之后）：本机 Edge 直连，不走代理。
第 1 轮：载入示例 + 拍摄输入① 两行，和 10-26 公网彩排的 13 条摘要逐条比。
第 2 轮：这次修复针对的情形——中文引文配只登记英文题名、只有第一作者拼音的 DOI（开发集 Q0311 原样），以及同一 DOI 配无关题名。
用法：python ms_accept.py <out.json> <shots_dir>
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
ROUND2 = ("[1] 侯尧华, 张定华, 张莹. 薄壁件加工误差补偿建模与学习控制方法[J]. 机械工程学报, 2018, 54(17): 108-115. DOI: 10.3901/JME.2018.17.108.\n"
          "[2] 侯尧华. 量子计算机如何在火星上修建机场[J]. 机械工程学报, 2018, 54(17): 108-115. DOI: 10.3901/JME.2018.17.108.")
rec = {"url": URL, "startedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z")}


def find_frame(page, timeout=180):
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
    frame.wait_for_timeout(800)
    return round(time.time() - t0, 1), frame.eval_on_selector_all("article [data-summary]", "els => els.map(e => e.textContent.trim())")


with sync_playwright() as p:
    browser = p.chromium.launch(channel="msedge", args=["--no-proxy-server"])
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()
    t0 = time.time()
    page.goto(URL, wait_until="domcontentloaded", timeout=90000)
    frame = find_frame(page)
    frame.wait_for_function("() => { const t = document.querySelector('textarea'); return t && !t.disabled; }", timeout=120000)
    rec["appReadySeconds"] = round(time.time() - t0, 1)
    # 新手引导：有就跳过
    try:
        skip = frame.get_by_role("button", name="跳过引导")
        if skip.count():
            skip.first.click()
            frame.wait_for_timeout(500)
    except Exception:
        pass
    # 论断接口的服务状态（含这次新加的向量召回状态）
    rec["claimsStatus"] = frame.evaluate("() => fetch('/api/claims').then(r => r.json()).catch(e => String(e))")

    # 第 1 轮
    frame.get_by_role("button", name="载入示例").first.click()
    frame.wait_for_timeout(600)
    ta = frame.locator("textarea").first
    ta.click()
    ta.press("Control+End")
    ta.press("Enter")
    ta.type(EXTRA, delay=2)
    seconds, summaries = run_check(frame, 13)
    rec["round1"] = {
        "seconds": seconds, "count": len(summaries), "summaries": summaries,
        "sameAsRehearsal": [s == r for s, r in zip(summaries, REHEARSAL)],
        "headline": frame.locator("text=条需要处理").first.evaluate("e => e.parentElement.parentElement.innerText").replace("\n", " ")[:120],
    }
    page.screenshot(path=str(shots / "round1.png"), full_page=False)

    # 第 2 轮
    frame.get_by_role("button", name="清空").first.click()
    frame.wait_for_timeout(500)
    ta = frame.locator("textarea").first
    ta.click()
    ta.type(ROUND2, delay=2)
    seconds, summaries = run_check(frame, 2)
    rec["round2"] = {"seconds": seconds, "summaries": summaries}
    page.screenshot(path=str(shots / "round2.png"), full_page=False)
    browser.close()

rec["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
out_path.write_text(json.dumps(rec, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(rec, ensure_ascii=False, indent=1))
