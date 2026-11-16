"""把同目录的幻灯片 HTML 截成 1920×1080 的 JPG（视频用）和一张 PNG（放进 Word 用）。
用法（项目根目录）：python docs/competition/media/slides/render_slide.py slide-03-ai-map"""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

here = Path(__file__).resolve().parent
name = sys.argv[1] if len(sys.argv) > 1 else "slide-03-ai-map"
src = here / f"{name}.html"
with sync_playwright() as p:
    browser = p.chromium.launch(channel="msedge")
    page = browser.new_page(viewport={"width": 1920, "height": 1080}, device_scale_factor=1)
    page.goto(src.as_uri(), wait_until="networkidle")
    page.evaluate("document.fonts.ready")
    page.wait_for_timeout(500)
    overflow = page.evaluate("() => document.documentElement.scrollHeight > 1080 || document.documentElement.scrollWidth > 1920")
    page.screenshot(path=str(here / f"{name}.jpg"), type="jpeg", quality=92)
    page.screenshot(path=str(here / f"{name}.png"))
    browser.close()
print({"overflow": overflow, "jpg": str(here / f"{name}.jpg")})
