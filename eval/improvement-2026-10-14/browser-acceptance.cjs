/* eslint-disable -- Standalone local acceptance driver, outside application runtime. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/Darks/AppData/Roaming/npm/node_modules/playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const out = __dirname;
const base = 'http://localhost:3210';
const checks = { ranAt: new Date().toISOString(), realDatabase: true, faultsUseRecordedResponses: true };

(async () => {
  const recorded = JSON.parse(await fs.readFile(path.join(out, '../results/ai-smoke-2026-10-14T01-28-04-619Z.json'), 'utf8'));
  const events = recorded.events.filter(e => !['phase', 'notice'].includes(e.type));
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  let activePage;
  async function newPage(width = 1440, fixture) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage();
    activePage = page;
    page.setDefaultTimeout(5000);
    page.on('pageerror', e => errors.push(e.message));
    if (fixture) await page.route('**/api/check', async route => {
      if (route.request().method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ available: false, provider: 'DeepSeek', model: 'deepseek-flash' }) });
      await route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: fixture.map(e => JSON.stringify(e)).join('\n') + '\n' });
    });
    await page.goto(base, { waitUntil: 'networkidle' });
    return { page, context };
  }
  async function submit(page, input = recorded.input) {
    await page.getByRole('textbox', { name: '参考文献列表' }).fill(input);
    await page.getByRole('button', { name: '开始体检', exact: true }).click();
  }
  try {
    const desktop = await newPage();
    assert(await desktop.page.getByRole('button', { name: '开始体检', exact: true }).isDisabled());
    await desktop.page.getByRole('radio', { name: 'AI 辅助解析', exact: true }).check();
    assert(await desktop.page.getByText('AI 辅助模式会将参考文献条目发送给 DeepSeek 解析', { exact: false }).isVisible());
    await desktop.page.getByRole('radio', { name: '标准核验', exact: true }).check();
    await desktop.page.getByRole('button', { name: '载入示例', exact: true }).click();
    const responsePromise = desktop.page.waitForResponse(r => r.url().endsWith('/api/check') && r.request().method() === 'POST');
    await desktop.page.getByRole('button', { name: '开始体检', exact: true }).click();
    const response = await responsePromise;
    assert.equal(response.status(), 200);
    await desktop.page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === '复制修正版清单' && !b.disabled), null, { timeout: 180000 });
    assert.equal(await desktop.page.locator('article').count(), 11);
    await fs.writeFile(path.join(out, 'browser-live-page.txt'), await desktop.page.locator('main').innerText());
    await desktop.page.getByRole('button', { name: '复制修正版清单' }).click();
    const copied = await desktop.page.evaluate(() => navigator.clipboard.readText());
    assert(copied.includes('[11]'));
    const downloadPromise = desktop.page.waitForEvent('download');
    await desktop.page.getByRole('button', { name: '下载核查报告' }).click();
    await (await downloadPromise).saveAs(path.join(out, 'complete-report.md'));
    assert((await fs.readFile(path.join(out, 'complete-report.md'), 'utf8')).includes('状态：核查完成'));
    await desktop.page.getByRole('tab', { name: /有误/ }).click();
    const filteredCards = await desktop.page.locator('article').count();
    assert(filteredCards > 0 && filteredCards < 11);
    await desktop.page.getByRole('tab', { name: /全部/ }).click();
    await desktop.page.getByText('体 检 报 告', { exact: true }).scrollIntoViewIfNeeded();
    await desktop.page.screenshot({ path: path.join(out, 'desktop-results-final.png'), fullPage: true });
    checks.desktop = { emptyDisabled: true, privacy: true, results: 11, copy: true, download: true, filter: true };
    console.log('PASS desktop live flow');

    const mobile = await newPage(390, events);
    await submit(mobile.page);
    await mobile.page.getByRole('button', { name: '复制修正版清单' }).waitFor();
    assert.equal(await mobile.page.evaluate(() => document.documentElement.scrollWidth), 390);
    await mobile.page.getByText('体 检 报 告', { exact: true }).scrollIntoViewIfNeeded();
    await mobile.page.screenshot({ path: path.join(out, 'mobile-results-final.png'), fullPage: true });
    checks.mobile = { width: 390, noOverflow: true, recordedResults: 2 };
    console.log('PASS mobile layout');

    const truncated = await newPage(1440, [events.find(e => e.type === 'meta'), events.find(e => e.type === 'result')]);
    await submit(truncated.page);
    await truncated.page.getByText('核查连接中断，报告不完整，请重试', { exact: false }).waitFor();
    assert(await truncated.page.getByRole('button', { name: '复制修正版清单' }).isDisabled());
    assert.equal(await truncated.page.locator('article[aria-busy=true]').count(), 0);
    assert.equal(await truncated.page.locator('.animate-scan').count(), 0);
    const partialPromise = truncated.page.waitForEvent('download');
    await truncated.page.getByRole('button', { name: '下载核查报告' }).click();
    await (await partialPromise).saveAs(path.join(out, 'partial-report.md'));
    assert((await fs.readFile(path.join(out, 'partial-report.md'), 'utf8')).includes('状态：未完成'));
    checks.truncated = { copyDisabled: true, pendingStopped: true, partialReportMarked: true };
    console.log('PASS truncated stream');

    const fallback = await newPage(1440, [{ type: 'notice', message: 'AI 服务尚未配置，本次已回退标准规则核验。' }, ...events]);
    await fallback.page.getByRole('radio', { name: 'AI 辅助解析', exact: true }).check();
    await submit(fallback.page);
    await fallback.page.getByText('AI 服务尚未配置，本次已回退标准规则核验。', { exact: true }).waitFor();
    checks.fallback = { noticeVisible: true };
    console.log('PASS explicit fallback');

    const cancelled = await newPage();
    let pending;
    let posted;
    const pendingRequest = new Promise(resolve => { posted = resolve; });
    await cancelled.page.route('**/api/check', route => { if (route.request().method() === 'POST') { pending = route; posted(); } else return route.continue(); });
    await submit(cancelled.page);
    await pendingRequest;
    await cancelled.page.getByRole('button', { name: '停止核查', exact: true }).click();
    await cancelled.page.getByText('已停止核查。尚未返回的条目没有结论，可重新开始。', { exact: false }).waitFor();
    await pending.abort().catch(() => {});
    checks.cancel = { messageVisible: true, stopHidden: await cancelled.page.getByRole('button', { name: '停止核查', exact: true }).count() === 0 };
    console.log('PASS cancellation');
    assert.equal(errors.length, 0);
    checks.pageErrors = errors;
    checks.passed = true;
  } catch (error) {
    checks.passed = false;
    checks.failure = error.message;
    if (activePage) {
      checks.failurePage = await activePage.locator('body').innerText().catch(() => 'unavailable');
      await activePage.screenshot({ path: path.join(out, 'browser-failure.png'), fullPage: true }).catch(() => {});
    }
    console.error(error);
    process.exitCode = 1;
  } finally {
    await fs.writeFile(path.join(out, 'browser-acceptance.json'), JSON.stringify(checks, null, 2));
    await browser.close();
  }
})();
