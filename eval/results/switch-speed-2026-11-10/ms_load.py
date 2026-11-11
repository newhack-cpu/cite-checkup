import json, time, sys
from playwright.sync_api import sync_playwright
URL = "https://www.modelscope.cn/studios/kgkvybu111111/cite-checkup?mode=full"
out = []
with sync_playwright() as p:
    b = p.chromium.launch(channel="msedge", args=["--no-proxy-server"])
    for i in range(2):
        ctx = b.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
        t0 = time.time()
        rec = {"run": i + 1}
        try:
            page.goto(URL, wait_until="domcontentloaded", timeout=60000)
            rec["platformDomMs"] = round((time.time() - t0) * 1000)
            frame = None
            deadline = time.time() + 150
            while time.time() < deadline and "painted" not in rec:
                for f in page.frames:
                    if f is page.main_frame: continue
                    try:
                        if f.locator("h1", has_text="引用体检").count():
                            rec["painted"] = round((time.time() - t0) * 1000); frame = f; rec["frameUrl"] = f.url.split("?")[0]; break
                    except Exception: pass
                page.wait_for_timeout(250)
            if frame:
                frame.wait_for_function("() => { const t = document.querySelector('textarea'); return t && !t.disabled; }", timeout=120000)
                rec["interactiveMs"] = round((time.time() - t0) * 1000)
                res = frame.evaluate("() => performance.getEntriesByType('resource').map(r => [r.name.split('/').slice(-1)[0].slice(0,40), Math.round(r.startTime), Math.round(r.duration), r.transferSize])")
                res.sort(key=lambda r: -r[2])
                rec["slowest"] = res[:6]
                rec["nav"] = frame.evaluate("() => { const n = performance.getEntriesByType('navigation')[0]; return n ? { ttfb: Math.round(n.responseStart), dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd) } : null }")
        except Exception as e:
            rec["error"] = str(e)[:200]
        out.append(rec); print(json.dumps(rec, ensure_ascii=False)); ctx.close()
    b.close()
json.dump(out, open("modelscope-load.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
