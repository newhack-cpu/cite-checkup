"""首屏性能实测（本机生产构建，Edge + Playwright）：FCP、LCP、CLS、长任务总阻塞时间、传输体积。
两种条件：桌面不限速；模拟手机（CPU 降速 4 倍，网络约 1.6 Mbps / 150 ms，与 Lighthouse 手机默认相近）。各跑 3 次取中位数。
用法：python perf.py <url> <out.json>"""
import json
import statistics
import sys
from playwright.sync_api import sync_playwright

url, out = sys.argv[1], sys.argv[2]
OBSERVE = """
window.__perf = { lcp: 0, cls: 0, tbt: 0 };
new PerformanceObserver(l => { for (const e of l.getEntries()) window.__perf.lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__perf.cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
new PerformanceObserver(l => { for (const e of l.getEntries()) window.__perf.tbt += Math.max(0, e.duration - 50); }).observe({ type: 'longtask', buffered: true });
"""


def run(p, mobile):
    browser = p.chromium.launch(channel="msedge", args=["--no-proxy-server"])
    ctx = browser.new_context(viewport={"width": 390, "height": 844} if mobile else {"width": 1440, "height": 900}, is_mobile=mobile, device_scale_factor=2 if mobile else 1)
    page = ctx.new_page()
    page.add_init_script(OBSERVE)
    cdp = ctx.new_cdp_session(page)
    cdp.send("Network.enable")
    cdp.send("Network.setCacheDisabled", {"cacheDisabled": True})
    if mobile:
        cdp.send("Emulation.setCPUThrottlingRate", {"rate": 4})
        cdp.send("Network.emulateNetworkConditions", {"offline": False, "latency": 150, "downloadThroughput": 1.6 * 1024 * 1024 / 8, "uploadThroughput": 750 * 1024 / 8})
    page.goto(url, wait_until="load", timeout=120000)
    page.wait_for_timeout(4000)
    m = page.evaluate("""() => {
      const nav = performance.getEntriesByType('navigation')[0];
      const fcp = performance.getEntriesByName('first-contentful-paint')[0];
      const res = performance.getEntriesByType('resource');
      const js = res.filter(r => r.initiatorType === 'script' || r.name.endsWith('.js')).reduce((s, r) => s + (r.transferSize || 0), 0);
      const total = res.reduce((s, r) => s + (r.transferSize || 0), 0) + (nav.transferSize || 0);
      return { ttfb: nav.responseStart, fcp: fcp ? fcp.startTime : null, domInteractive: nav.domInteractive, load: nav.loadEventEnd,
               lcp: window.__perf.lcp, cls: window.__perf.cls, tbt: window.__perf.tbt, jsKB: js / 1024, totalKB: total / 1024, requests: res.length + 1 };
    }""")
    browser.close()
    return m


rec = {"url": url, "method": "Edge + Playwright，PerformanceObserver 取 LCP/CLS/长任务，CDP 模拟手机网络与 CPU；每种条件 3 次取中位数；不是 Lighthouse 评分"}
with sync_playwright() as p:
    for name, mobile in [("desktop", False), ("mobile", True)]:
        runs = [run(p, mobile) for _ in range(3)]
        rec[name] = {k: round(statistics.median([r[k] for r in runs if r[k] is not None]), 3 if k == "cls" else 0) for k in runs[0]}
        rec[name + "Runs"] = runs
json.dump(rec, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(json.dumps({k: rec[k] for k in ["desktop", "mobile"]}, ensure_ascii=False, indent=1))
