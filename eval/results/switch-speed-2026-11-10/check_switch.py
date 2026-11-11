"""切换改动的外观与行为检查：首访开场、切换后印章仍倾斜、切换后再体检新卡片照常入场、引导能切回第一页。"""
import json
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1]
OUT = sys.argv[2]
out = {}

STATE = r"""
() => {
  const q = (s) => [...document.querySelectorAll(s)];
  const stamps = q('#panel-references article [role=img]');
  const cards = q('#panel-references article');
  const st = stamps.map((el) => { const c = getComputedStyle(el); return { anim: c.animationName, transform: c.transform, rotate: c.rotate, played: el.dataset.played !== undefined }; });
  return {
    cards: cards.length,
    cardsPlayed: cards.filter((el) => el.dataset.played !== undefined).length,
    cardAnim: [...new Set(cards.map((el) => getComputedStyle(el).animationName))],
    cardOpacity: [...new Set(cards.map((el) => getComputedStyle(el).opacity))],
    stampKinds: [...new Set(st.map((s) => JSON.stringify(s)))].map((s) => JSON.parse(s)),
    revealPlayed: q('main .reveal').filter((el) => el.dataset.played !== undefined).length + '/' + q('main .reveal').length,
    headerRevealPlayed: q('header .reveal').filter((el) => el.dataset.played !== undefined).length,
  };
}
"""

with sync_playwright() as p:
    browser = p.chromium.launch(channel="msedge", args=["--no-proxy-server"])

    # 1. 第一次来访：开场动画播完后页面露出、入场结束
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_timeout(900)
    page.screenshot(path=OUT + "-1-intro.png")
    page.wait_for_function("() => document.documentElement.dataset.intro === 'done'", timeout=8000)
    out["introDoneMs"] = page.evaluate("() => Math.round(performance.now())")
    page.wait_for_timeout(1200)
    out["firstLoadRunning"] = page.evaluate("() => document.getAnimations().filter(a => a.playState === 'running' && Number.isFinite(a.effect.getComputedTiming().endTime)).length")
    page.screenshot(path=OUT + "-2-loaded.png")
    # 引导邀请若出现先关掉
    page.evaluate("() => { try { localStorage.setItem('cite-tour', 'done') } catch (e) {} }")
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(1500)

    # 2. 体检示例 → 切到论断 → 切回
    page.get_by_role("button", name="载入示例").first.click()
    page.wait_for_timeout(300)
    page.get_by_role("button", name="开始体检").first.click()
    page.wait_for_function("() => { const t = document.querySelector('[data-tour=summary]'); return t && /体检完成|核查完成/.test(t.textContent); }", timeout=180000)
    page.wait_for_timeout(1500)
    out["afterRun"] = page.evaluate(STATE)
    page.click("#tab-claims")
    page.wait_for_timeout(600)
    page.screenshot(path=OUT + "-3-claims.png")
    page.click("#tab-references")
    page.wait_for_timeout(120)
    page.screenshot(path=OUT + "-4-back-120ms.png")
    page.wait_for_timeout(600)
    out["afterSwitchBack"] = page.evaluate(STATE)
    page.locator("#panel-references article").first.scroll_into_view_if_needed()
    page.wait_for_timeout(500)
    page.screenshot(path=OUT + "-5-back-results.png")

    # 3. 换筛选再回“全部”：重新出现的卡片用快速入场、印章不再落
    page.locator('[aria-label="按结论筛选"] [role=tab]').nth(1).click()
    page.wait_for_timeout(500)
    page.locator('[aria-label="按结论筛选"] [role=tab]').nth(0).click()
    page.wait_for_timeout(60)
    out["filterBack60ms"] = page.evaluate("() => [...document.querySelectorAll('#panel-references article')].map(el => (el.classList.contains('enter-quick') ? 'quick' : el.dataset.played !== undefined ? 'played' : 'fresh')).join(',')")
    page.wait_for_timeout(600)
    out["afterFilter"] = page.evaluate(STATE)

    # 4. 切换之后重新体检：新结果卡和印章照常入场
    page.evaluate("() => window.scrollTo(0, 0)")
    page.get_by_role("button", name="开始体检").first.click()
    page.wait_for_function("() => document.querySelectorAll('#panel-references article').length > 0", timeout=30000)
    out["rerunFirstCards"] = page.evaluate("() => { const c = [...document.querySelectorAll('#panel-references article')]; return { n: c.length, played: c.filter(el => el.dataset.played !== undefined).length, quick: c.filter(el => el.classList.contains('enter-quick')).length, anim: [...new Set(c.map(el => getComputedStyle(el).animationName))] }; }")
    page.wait_for_function("() => { const t = document.querySelector('[data-tour=summary]'); return t && /体检完成|核查完成/.test(t.textContent); }", timeout=180000)
    out["rerunStamps"] = page.evaluate("() => [...new Set([...document.querySelectorAll('#panel-references article [role=img]')].map(el => getComputedStyle(el).animationName + '|' + (el.dataset.played !== undefined)))]")
    page.wait_for_timeout(1200)

    # 5. 在论断页点“怎么用”：引导打开并切回参考文献页
    page.click("#tab-claims")
    page.wait_for_timeout(400)
    page.get_by_role("button", name="怎么用").first.click()
    page.wait_for_timeout(900)
    out["tourSwitchedBack"] = page.evaluate("() => ({ refsHidden: document.getElementById('panel-references').hidden, selected: document.getElementById('tab-references').getAttribute('aria-selected') })")
    page.screenshot(path=OUT + "-6-tour.png")
    out["errors"] = errors
    page.close()

    # 6. 手机宽度切换
    phone = browser.new_page(viewport={"width": 390, "height": 844})
    phone.add_init_script("try{localStorage.setItem('cite-intro','1');localStorage.setItem('cite-tour','done')}catch(e){}")
    phone.goto(URL, wait_until="networkidle")
    phone.wait_for_timeout(1200)
    phone.click("#tab-claims")
    phone.wait_for_timeout(500)
    phone.screenshot(path=OUT + "-7-phone-claims.png")
    out["phoneOverflow"] = phone.evaluate("() => document.documentElement.scrollWidth > innerWidth")
    browser.close()

print(json.dumps(out, ensure_ascii=False, indent=2))
with open(OUT + ".json", "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=2)
