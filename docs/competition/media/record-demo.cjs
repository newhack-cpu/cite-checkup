/* eslint-disable -- Reproducible local demo recorder; never reads credentials. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/Darks/AppData/Roaming/npm/node_modules/playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '../../..');
const BASE = process.env.DEMO_BASE_URL || 'http://localhost:3210';
const REHEARSAL = process.env.DEMO_REHEARSAL === '1';
const OUT = REHEARSAL ? path.join(__dirname, 'rehearsal') : __dirname;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  await fs.mkdir(OUT, { recursive: true });
  const narration = JSON.parse(await fs.readFile(path.join(__dirname, '../narration.json'), 'utf8'));
  const durations = JSON.parse(await fs.readFile(path.join(__dirname, 'narration/durations.json'), 'utf8'));
  const timing = { startedAt: new Date().toISOString(), actualNetwork: !REHEARSAL, mockResponses: REHEARSAL, narration: 'Microsoft Huihui Desktop; synthetic Mandarin', chapters: [], errors: [] };
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir: path.join(OUT, 'raw'), size: { width: 1920, height: 1080 } }, permissions: ['clipboard-read', 'clipboard-write'] });
  if (REHEARSAL) {
    const refs = JSON.parse(await fs.readFile(path.join(ROOT, 'eval/results/ai-smoke-2026-10-14T01-36-52-721Z.json'), 'utf8'));
    const claims = JSON.parse(await fs.readFile(path.join(ROOT, 'eval/results/claims-smoke-2026-10-14T02-20-44-807Z.json'), 'utf8'));
    await context.route('**/api/check', route => route.request().method() === 'POST' ? route.fulfill({ contentType: 'application/x-ndjson', body: refs.events.map(e => JSON.stringify(e)).join('\n') + '\n' }) : route.continue());
    await context.route('**/api/claims', route => {
      if (route.request().method() !== 'POST') return route.continue();
      const input = route.request().postDataJSON();
      const id = input.doi ? 'public-abstract' : input.claim.includes('400') ? 'synthetic-contradicted' : input.claim.includes('收入') ? 'synthetic-insufficient' : 'synthetic-supported';
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(claims.results.find(x => x.id === id).response) });
    });
  }
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', err => timing.errors.push(err.message));
  const origin = Date.now();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const top = () => page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  const visible = loc => loc.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  async function chapter(index, actions) {
    const spec = narration.chapters[index];
    const start = Date.now();
    const seconds = durations.find(x => x.file === spec.id + '.wav').seconds;
    const entry = { ...spec, start: (start - origin) / 1000, narrationSeconds: seconds };
    timing.chapters.push(entry);
    console.log(`CHAPTER ${index + 1}: ${spec.title}`);
    const at = async s => REHEARSAL ? pause(100) : pause(Math.max(0, s * 1000 - (Date.now() - start)));
    await actions(at);
    await at(seconds + 2);
    entry.end = (Date.now() - origin) / 1000;
    await fs.writeFile(path.join(OUT, 'recording-timing.json'), JSON.stringify(timing, null, 2));
  }
  async function runClaim(expected) {
    const responsePromise = page.waitForResponse(r => r.url().endsWith('/api/claims') && r.request().method() === 'POST', { timeout: 85000 });
    await page.getByRole('button', { name: '核查论断', exact: true }).click();
    const response = await responsePromise;
    const result = await response.json();
    await fs.writeFile(path.join(OUT, `claim-${Date.now()}.json`), JSON.stringify(result, null, 2));
    assert.equal(result.status, 'complete', result.explanation);
    assert.equal(result.verdict, expected, result.explanation);
    await visible(page.getByRole('heading', { name: expected === 'supported' ? '证据支持' : expected === 'contradicted' ? '与证据矛盾' : '证据不足', exact: true }));
  }
  try {
    await chapter(0, async at => {
      await at(12); await page.getByRole('tab', { name: /正文论断核查/ }).click();
      await at(25); await page.getByRole('tab', { name: /参考文献体检/ }).click();
      await at(33); await visible(page.getByText('文件发送至本站服务器提取文字', { exact: false }).first());
    });
    await chapter(1, async at => {
      await top(); await at(3);
      await page.getByLabel('选择参考文献文件', { exact: true }).setInputFiles(path.join(ROOT, 'eval/phase-two-2026-10-14/demo-inputs', process.env.DEMO_DOCUMENT || 'public-references.pdf'));
      await page.getByRole('button', { name: '确认并填入参考文献', exact: true }).waitFor({ timeout: 35000 });
      await visible(page.getByRole('textbox', { name: /文字预览/ }));
      await at(13); await page.getByRole('radio', { name: '全文文字', exact: true }).check();
      await at(20); await page.getByRole('radio', { name: '参考文献区域', exact: true }).check();
      await at(30); await page.getByRole('button', { name: '确认并填入参考文献', exact: true }).click();
      await visible(page.getByRole('textbox', { name: '参考文献列表', exact: true }));
    });
    await chapter(2, async at => {
      await top(); await at(3); await page.getByRole('radio', { name: 'AI 辅助解析', exact: true }).check();
      await at(7); await page.getByRole('button', { name: '开始体检', exact: true }).click();
      await page.waitForFunction(() => [...document.querySelectorAll('button')].some(x => x.textContent === '复制修正版清单' && !x.disabled), null, { timeout: 100000 });
      assert.equal(await page.locator('#panel-references article').count(), 2);
      const text = await page.locator('#panel-references').innerText();
      assert(!text.includes('已回退'), 'AI fallback during recording');
      await fs.writeFile(path.join(OUT, 'reference-live-page.txt'), text);
      await visible(page.getByText('体 检 报 告', { exact: true }));
    });
    await chapter(3, async at => {
      await at(3); const card = page.locator('#panel-references article').nth(1);
      const expand = card.getByRole('button', { name: '展开详情', exact: true });
      if (await expand.count()) await expand.click();
      await visible(card); await at(16); await visible(card.getByText(/核查过程 ·/));
      await at(33); const download = page.waitForEvent('download');
      await page.getByRole('button', { name: '下载核查报告', exact: true }).click();
      await (await download).saveAs(path.join(OUT, 'demo-reference-report.md'));
      await visible(page.getByText('体 检 报 告', { exact: true }));
    });
    await chapter(4, async at => {
      await top(); await page.getByRole('tab', { name: /正文论断核查/ }).click();
      await at(4); await page.getByRole('button', { name: '试用公开文献摘要' }).click();
      await at(8); await runClaim('supported');
      await at(31); await visible(page.getByRole('heading', { name: '判断引用的原文' }));
      await at(41); await page.getByRole('button', { name: /查看片段/ }).first().click();
    });
    await chapter(5, async at => {
      await top(); await page.getByRole('button', { name: '试用矛盾演示材料' }).click();
      await page.getByLabel('正文中的论断', { exact: true }).fill('这项研究招募了40名大学生。');
      await at(3); await runClaim('supported');
      await at(17); await page.getByLabel('正文中的论断', { exact: true }).fill('这项研究招募了400名大学生。');
      await runClaim('contradicted');
      await at(32); await page.getByLabel('正文中的论断', { exact: true }).fill('这项研究证明，干预能让参与者一年后的收入翻倍。');
      await runClaim('insufficient_evidence');
    });
    await chapter(6, async at => {
      await page.goto('file:///' + path.join(ROOT, 'docs/competition/technical-report.html').replaceAll('\\', '/'));
      await page.locator('article').nth(2).evaluate(el => el.scrollIntoView());
      await at(18); await page.locator('article').nth(7).evaluate(el => el.scrollIntoView());
      await at(34); await page.goto('file:///' + path.join(__dirname, 'mobile-showcase.html').replaceAll('\\', '/'));
      await at(39); await page.locator('.phone').evaluate(el => el.scrollTo({ top: 920, behavior: 'smooth' }));
    });
    await chapter(7, async at => {
      await page.goto(BASE, { waitUntil: 'networkidle' });
      await at(14); await page.getByRole('tab', { name: /正文论断核查/ }).click();
      await at(29); await visible(page.getByText('摘要不能替代全文', { exact: false }));
      await at(40); await top();
    });
    assert.deepEqual(timing.errors, []);
    timing.success = true;
  } catch (err) {
    timing.success = false; timing.failure = err.message;
    await page.screenshot({ path: path.join(OUT, 'recording-failure.png'), fullPage: true });
    throw err;
  } finally {
    timing.finishedAt = new Date().toISOString();
    await fs.writeFile(path.join(OUT, 'recording-timing.json'), JSON.stringify(timing, null, 2));
    const video = page.video(); await context.close();
    await video.saveAs(path.join(OUT, timing.success ? 'actual-demo.webm' : 'incomplete-demo.webm'));
    await browser.close();
  }
})().catch(err => { console.error(err); process.exitCode = 1; });
