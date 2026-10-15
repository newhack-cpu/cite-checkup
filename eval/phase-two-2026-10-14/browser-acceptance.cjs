/* eslint-disable -- Standalone browser acceptance; never imported by the application. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/Darks/AppData/Roaming/npm/node_modules/playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '../..');
const base = process.env.QA_BASE_URL || 'http://localhost:3211';
const label = (process.env.QA_RUN_LABEL || 'dev').replace(/[^a-zA-Z0-9_-]/g, '_');
const only = process.env.QA_ONLY || 'all';
const fixtureRoot = path.join(root, 'src/lib/documents/__tests__/fixtures');
const successPath = path.join(root, 'eval/results/claims-smoke-2026-10-14T02-20-44-807Z.json');
const failurePath = path.join(root, 'eval/results/claims-smoke-2026-10-14T02-12-14-972Z.json');
const checks = {
  ranAt: new Date().toISOString(), base, runLabel: label, only, locatorTimeoutMs: 5000,
  documents: { mode: 'Real browser uploads to local /api/import; real fixture PDF/DOCX parsing', fixtureRoot },
  claims: { mode: 'Recorded real API responses replayed by Playwright route; no new model/database calls', successPath, failurePath },
  viewports: [], pageErrors: [], passed: false,
};

const artifact = (width, name, ext = 'png') => path.join(__dirname, `qa-${label}-${width}-${name}.${ext}`);

(async () => {
  const success = JSON.parse(await fs.readFile(successPath, 'utf8'));
  const failed = JSON.parse(await fs.readFile(failurePath, 'utf8'));
  assert.equal(success.passed, true, 'Use a verified real-response fixture');
  const recorded = Object.fromEntries(success.results.map(entry => [entry.id, entry]));
  recorded['incomplete'] = failed.results.find(entry => entry.id === 'public-abstract');
  assert.equal(recorded.incomplete.response.status, 'incomplete');

  const browser = await chromium.launch({ headless: true });
  let activePage;
  let activeWidth;
  let current;
  try {
    for (const width of [1440, 390]) {
      activeWidth = width;
      current = { width, height: width === 390 ? 844 : 1000, uploads: [], claims: [], layout: [], tabState: {}, screenshots: [] };
      checks.viewports.push(current);
      const context = await browser.newContext({ viewport: { width, height: current.height }, deviceScaleFactor: 1, acceptDownloads: true });
      const page = await context.newPage();
      activePage = page;
      page.setDefaultTimeout(5000);
      page.setDefaultNavigationTimeout(30000);
      page.on('pageerror', error => checks.pageErrors.push({ width, message: error.message }));
      let selectedFixture = recorded['public-abstract'];
      let holdClaims = false;
      let pendingClaimRoute;
      let onPendingClaim;
      let pendingClaim = new Promise(resolve => { onPendingClaim = resolve; });
      let replayedPosts = 0;
      await page.route('**/api/claims', async route => {
        if (route.request().method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ available: true, provider: 'DeepSeek', model: 'deepseek-flash', limits: { claimChars: 2000, evidenceChars: 160000, retrievedChunks: 6 } }) });
        const input = route.request().postDataJSON();
        replayedPosts++;
        if (holdClaims) { pendingClaimRoute = route; onPendingClaim(); return; }
        assert.equal(input.claim, selectedFixture.input.claim, 'Replay must match the actual submitted claim');
        if (selectedFixture.input.doi) assert.equal(input.doi, selectedFixture.input.doi);
        else assert.equal(input.evidenceText, selectedFixture.input.evidenceText);
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(selectedFixture.response) });
      });
      await page.route('**/api/check', async route => {
        if (route.request().method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ available: true, provider: 'DeepSeek', model: 'deepseek-flash' }) });
        throw new Error('This acceptance script must not invoke bibliography/model verification');
      });
      // Compile/initialize the route without uploading or consuming its per-IP admission window.
      await context.request.get(`${base}/api/import`);
      await page.goto(base, { waitUntil: 'networkidle' });
      await page.locator('#panel-references').waitFor({ state: 'visible' });
      await fs.writeFile(artifact(width, 'initial-dom', 'txt'), await page.locator('main').innerText());
      const references = page.getByRole('textbox', { name: '参考文献列表', exact: true });
      const refsTab = page.getByRole('tab', { name: /参考文献体检/ });
      const claimsTab = page.getByRole('tab', { name: /正文论断核查/ });
      const preview = () => page.getByRole('textbox', { name: '文字预览 · 可编辑或删除不需要的部分' });
      const sentinel = `原输入保留测试-${width}：[1] Original reference must remain until confirmation.`;
      await references.fill(sentinel);

      async function noOverflow(step) {
        const dimensions = await page.evaluate(() => ({ viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth }));
        current.layout.push({ step, ...dimensions });
        assert(dimensions.scrollWidth <= dimensions.viewport + 1, `${step}: horizontal overflow ${JSON.stringify(dimensions)}`);
      }
      async function screenshot(name, override) {
        const file = override || artifact(width, name);
        await page.screenshot({ path: file, fullPage: true, animations: 'disabled' });
        current.screenshots.push(file);
      }
      async function upload(name, purpose = 'references', expectedStatus = 200) {
        const responseTask = page.waitForResponse(response => response.url().endsWith('/api/import') && response.request().method() === 'POST');
        await page.getByLabel(purpose === 'references' ? '选择参考文献文件' : '选择证据文件', { exact: true }).setInputFiles(path.join(fixtureRoot, name));
        const response = await responseTask;
        const body = await response.json();
        current.uploads.push({ name, purpose, httpStatus: response.status(), code: body.code, characters: body.metadata?.characterCount, format: body.metadata?.format, realParsing: true });
        assert.equal(response.status(), expectedStatus, `${name}: ${JSON.stringify(body)}`);
        return body;
      }

      if (only !== 'claims') {
        const pdf = await upload('paper.pdf');
        await preview().waitFor();
        assert.equal(await references.inputValue(), sentinel, 'PDF preview must not replace original input');
        assert((await preview().inputValue()).includes('Miller'));
        assert(await page.getByRole('radio', { name: '参考文献区域', exact: true }).isChecked());
        await page.getByRole('radio', { name: '全文文字', exact: true }).check();
        assert.equal(await preview().inputValue(), pdf.text);
        assert((await preview().inputValue()).includes('controlled trial'));
        await page.getByRole('radio', { name: '参考文献区域', exact: true }).check();
        assert.equal(await preview().inputValue(), pdf.references.text);
        assert.equal(await references.inputValue(), sentinel);
        await noOverflow('PDF preview and source range');
        await screenshot('pdf-preview');
        await page.getByRole('button', { name: '放弃预览', exact: true }).click();
        assert.equal(await preview().count(), 0);
        assert.equal(await references.inputValue(), sentinel, 'Abandoning preview preserves original');

        const docx = await upload('paper.docx');
        await preview().waitFor();
        assert.equal(await references.inputValue(), sentinel);
        assert.equal(await preview().inputValue(), docx.references.text);
        await page.getByRole('button', { name: '确认并填入参考文献', exact: true }).click();
        assert.equal(await references.inputValue(), docx.references.text.trim());
        assert.equal(await preview().count(), 0);

        const chinese = await upload('chinese.pdf');
        await preview().waitFor();
        assert((await preview().inputValue()).includes('张三'));
        assert.equal(await references.inputValue(), docx.references.text.trim());
        await page.getByRole('radio', { name: '全文文字', exact: true }).check();
        assert((await preview().inputValue()).includes('中文研究正文'));
        const edited = `${chinese.text}\n已人工确认的中文内容。`;
        await preview().fill(edited);
        assert.equal(await references.inputValue(), docx.references.text.trim());
        await page.getByRole('button', { name: '确认并填入参考文献', exact: true }).click();
        assert.equal(await references.inputValue(), edited.trim());

        const preserved = await references.inputValue();
        const noText = await upload('no-text.pdf', 'references', 422);
        assert.equal(noText.code, 'NO_TEXT');
        await page.getByRole('alert').filter({ hasText: noText.error }).waitFor();
        assert.equal(await references.inputValue(), preserved, 'No-text PDF leaves existing input untouched');
        assert.equal(await preview().count(), 0);
        await noOverflow('no-text PDF error');
        await screenshot('no-text-pdf');
        current.importAssertions = { previewBeforeReplacement: true, fullAndReferencesSelection: true, abandonPreservesInput: true, confirmedDocxReplacement: true, chinesePdfAndEditablePreview: true, noTextPdfPreservesInput: true };
      }

      const savedReferences = await references.inputValue();
      await refsTab.focus();
      await refsTab.press('ArrowRight');
      assert.equal(await claimsTab.getAttribute('aria-selected'), 'true');
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'tab-claims');
      await page.getByRole('button', { name: '试用公开文献摘要', exact: true }).click();
      const claim = page.getByRole('textbox', { name: '正文中的论断', exact: true });
      const doi = page.getByRole('textbox', { name: '文献 DOI', exact: true });
      assert.equal(await claim.inputValue(), recorded['public-abstract'].input.claim);
      assert.equal(await doi.inputValue(), recorded['public-abstract'].input.doi);
      current.tabState.keyboardRight = true;

      async function submitFixture(id, heading) {
        selectedFixture = recorded[id];
        const input = selectedFixture.input;
        await claim.fill(input.claim);
        if (input.doi) {
          await page.getByRole('radio', { name: '通过 DOI 查摘要', exact: true }).check();
          await doi.fill(input.doi);
        } else {
          await page.getByRole('radio', { name: '提供文献正文', exact: true }).check();
          await page.getByRole('textbox', { name: '文献原文', exact: true }).fill(input.evidenceText);
          await page.getByRole('textbox', { name: '来源说明', exact: true }).fill(input.evidenceLabel);
        }
        await page.getByRole('button', { name: '核查论断', exact: true }).click();
        await page.getByRole('heading', { name: heading, exact: true }).waitFor();
        assert.equal(await page.locator('#panel-claims blockquote').count(), selectedFixture.response.citations.length);
        current.claims.push({ id, status: selectedFixture.response.status, verdict: selectedFixture.response.verdict, citationCount: selectedFixture.response.citations.length, transport: 'recorded response fixture replay' });
        await noOverflow(`claims ${id}`);
      }
      async function reportDownload(name, completed) {
        const downloadTask = page.waitForEvent('download');
        await page.getByRole('button', { name: '下载论断报告', exact: true }).click();
        const download = await downloadTask;
        assert(download.suggestedFilename().startsWith('论断核查报告-'));
        const file = artifact(width, name, 'md');
        await download.saveAs(file);
        const text = await fs.readFile(file, 'utf8');
        assert(text.includes(`核查状态：${completed ? '已完成' : '未完成'}`));
        if (completed) assert(text.includes('数据库摘要，未核查全文'));
        else assert(text.includes('判断：本次未形成判断'));
        return { file, text };
      }

      if (only !== 'uploads') {
        await submitFixture('public-abstract', '证据支持');
        assert((await page.locator('#panel-claims').innerText()).includes('仅数据库摘要，未核查全文'));
        const citation = selectedFixture.response.citations[0];
        assert.equal(await page.locator('#panel-claims blockquote').first().innerText(), citation.quote);
        const disclosure = page.getByRole('button', { name: /检索召回的证据片段/ });
        assert.equal(await disclosure.getAttribute('aria-expanded'), 'true');
        await disclosure.click();
        assert.equal(await disclosure.getAttribute('aria-expanded'), 'false');
        assert.equal(await page.locator('#evidence-source-1-c1').count(), 0);
        await page.getByRole('button', { name: new RegExp(`查看片段 ${citation.chunkId}`) }).click();
        assert.equal(await disclosure.getAttribute('aria-expanded'), 'true');
        const evidence = page.locator(`#evidence-${citation.chunkId}`);
        await evidence.waitFor({ state: 'visible' });
        assert((await evidence.innerText()).includes(citation.quote));
        assert((await evidence.innerText()).includes('文本位置 1–1031'));
        const downloaded = await reportDownload('supported-report', true);
        assert(downloaded.text.includes(citation.quote));
        current.quoteNavigation = { collapse: true, citationExpandsChunk: true, exactQuote: true, positionsVisible: true, report: downloaded.file };
        await screenshot('claims-supported');
        if (width === 390) await screenshot('mobile-claims-final', path.join(__dirname, 'mobile-claims-final.png'));
        await fs.writeFile(artifact(width, 'supported-dom', 'txt'), await page.locator('#panel-claims').innerText());

        const savedClaim = await claim.inputValue();
        await claimsTab.focus();
        await claimsTab.press('ArrowLeft');
        assert.equal(await refsTab.getAttribute('aria-selected'), 'true');
        assert.equal(await page.evaluate(() => document.activeElement?.id), 'tab-references');
        assert.equal(await references.inputValue(), savedReferences);
        await refsTab.press('ArrowRight');
        assert.equal(await claim.inputValue(), savedClaim);
        await page.getByRole('heading', { name: '证据支持', exact: true }).waitFor();
        current.tabState = { ...current.tabState, keyboardLeft: true, originalInputRetained: true, claimAndResultRetained: true };
      }

      if (only !== 'claims') {
        await page.getByRole('radio', { name: '提供文献正文', exact: true }).check();
        const evidenceInput = page.getByRole('textbox', { name: '文献原文', exact: true });
        await evidenceInput.fill('旧证据正文：确认前不可被替换。');
        const docx = await upload('paper.docx', 'evidence');
        await preview().waitFor();
        assert(await page.getByRole('radio', { name: '全文文字', exact: true }).isChecked());
        assert.equal(await preview().inputValue(), docx.text);
        assert.equal(await evidenceInput.inputValue(), '旧证据正文：确认前不可被替换。');
        await page.getByRole('button', { name: '确认并填入证据', exact: true }).click();
        assert.equal(await evidenceInput.inputValue(), docx.text.trim());
        assert((await page.locator('#panel-claims').innerText()).includes('来源为用户提供'));
        current.evidenceImport = { defaultFullText: true, previewBeforeReplacement: true, sourceMarkedUserProvided: true };
      }

      if (only !== 'uploads') {
        await submitFixture('synthetic-contradicted', '与证据矛盾');
        assert((await page.locator('#panel-claims').innerText()).includes('来源未经独立认证'));
        await screenshot('claims-contradicted');
        await submitFixture('synthetic-insufficient', '证据不足');
        await screenshot('claims-insufficient');
        await submitFixture('incomplete', '核查未完成');
        assert.equal(await page.getByRole('heading', { name: '证据支持', exact: true }).count(), 0);
        const incompleteReport = await reportDownload('incomplete-report', false);
        current.incompleteReport = incompleteReport.file;
        await screenshot('claims-incomplete');

        holdClaims = true;
        pendingClaim = new Promise(resolve => { onPendingClaim = resolve; });
        await page.getByRole('button', { name: '试用公开文献摘要', exact: true }).click();
        await page.getByRole('button', { name: '核查论断', exact: true }).click();
        await Promise.race([pendingClaim, new Promise((_, reject) => setTimeout(() => reject(new Error('Expected held claim request')), 5000))]);
        await page.getByRole('button', { name: '停止论断核查', exact: true }).click();
        await page.getByRole('alert').filter({ hasText: '已停止论断核查，本次没有形成判断。' }).waitFor();
        assert.equal(await page.getByRole('button', { name: '停止论断核查', exact: true }).count(), 0);
        assert.equal(await page.getByRole('button', { name: '核查论断', exact: true }).isDisabled(), false);
        assert.equal(await page.getByRole('button', { name: '下载论断报告', exact: true }).count(), 0);
        await pendingClaimRoute.abort().catch(() => {});
        current.cancel = { pendingRouteFixture: true, noVerdictAfterCancellation: true, controlsRecovered: true };
        await noOverflow('cancelled claims');
        await screenshot('claims-cancelled');
      }
      current.claimsReplayedPosts = replayedPosts;
      current.passed = true;
      console.log(`PASS ${width}px real document import + recorded claim UI flows`);
      await context.close();
      activePage = undefined;
    }
    assert.equal(checks.pageErrors.length, 0, 'No pageerror events');
    checks.passed = true;
  } catch (error) {
    checks.failure = { width: activeWidth, message: error.message, stack: error.stack };
    if (current) current.passed = false;
    if (activePage) {
      checks.failure.body = await activePage.locator('body').innerText().catch(() => 'Unavailable');
      await activePage.screenshot({ path: artifact(activeWidth, 'failure'), fullPage: true }).catch(() => {});
    }
    console.error(error);
    process.exitCode = 1;
  } finally {
    await fs.writeFile(path.join(__dirname, `qa-${label}-browser-acceptance.json`), JSON.stringify(checks, null, 2));
    await browser.close();
  }
})();
