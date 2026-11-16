"""评审期间给魔搭演示站保活：用无界面的 Edge 打开创空间页面，等应用出现，把耗时写进日志。
魔搭免费空间闲置后可能休眠，评委第一次打开要等很久；定时访问一次，让应用保持唤醒。
由 Windows 任务计划程序定时运行（见 docs/deployment/MODELSCOPE.md“评审期间保活”）。只读访问，不提交任何数据。
用法：pythonw docs/deployment/keepalive.py [日志文件，默认 output/keepalive/log.jsonl]"""
import json
import sys
import time
from pathlib import Path

URL = "https://www.modelscope.cn/studios/kgkvybu111111/cite-checkup?mode=full"
APP = "https://kgkvybu111111-cite-checkup.ms.show/api/agent"
root = Path(__file__).resolve().parents[2]
log = Path(sys.argv[1]) if len(sys.argv) > 1 else root / "output" / "keepalive" / "log.jsonl"
log.parent.mkdir(parents=True, exist_ok=True)
rec = {"at": time.strftime("%Y-%m-%dT%H:%M:%S%z")}
t0 = time.time()
try:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", args=["--no-proxy-server"])
        page = browser.new_page()
        page.goto(URL, wait_until="domcontentloaded", timeout=90000)
        ok = False
        deadline = time.time() + 240
        while time.time() < deadline and not ok:
            for f in page.frames:
                if f is page.main_frame:
                    continue
                try:
                    if f.locator("h1", has_text="引用体检").count():
                        ok = True
                        break
                except Exception:
                    pass
            page.wait_for_timeout(1000)
        rec["appVisible"] = ok
        rec["seconds"] = round(time.time() - t0, 1)
        try:
            r = page.request.get(APP, timeout=30000)
            rec["api"] = r.status
        except Exception as e:
            rec["api"] = f"error: {e}"[:120]
        browser.close()
except Exception as e:
    rec["error"] = str(e)[:300]
    rec["seconds"] = round(time.time() - t0, 1)
with log.open("a", encoding="utf-8") as f:
    f.write(json.dumps(rec, ensure_ascii=False) + "\n")
