/* eslint-disable -- Preserve a real model rejection as a boundary demonstration. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/Darks/AppData/Roaming/npm/node_modules/playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  const prior = JSON.parse(await fs.readFile(path.join(__dirname, 'recording-timing.json'), 'utf8'));
  assert.equal(prior.actualNetwork, true); assert.equal(prior.success, false);
  assert.equal(prior.chapters.length, 6);
  const results = (await fs.readdir(__dirname)).filter(x => /^claim-\d+\.json$/.test(x)).sort();
  const last = JSON.parse(await fs.readFile(path.join(__dirname, results.at(-1)), 'utf8'));
  assert.equal(last.status, 'incomplete'); assert.equal(last.verdict, null);
  assert.equal(last.errorCode, 'INVALID_MODEL_RESPONSE');
  await fs.writeFile(path.join(__dirname, 'initial-recording-timing.json'), JSON.stringify(prior, null, 2));
  const sixth = prior.chapters[5];
  sixth.end = sixth.start + sixth.narrationSeconds + 2;
  sixth.boundaryOutcome = { expected: 'insufficient_evidence', actual: 'incomplete', code: last.errorCode, explanation: last.explanation, evidence: results.at(-1) };
  // Recording success means all eight chapters were captured, not that this
  // model call passed. Keep its failure and original footage plainly available.
  prior.originalRecordingFailure = prior.failure;
  delete prior.failure;
  prior.videoParts = [{ file: 'incomplete-demo.webm', padToSeconds: sixth.end }, { file: 'continuation.webm' }];
  prior.editingNote = 'The first six chapters are actual network operations. The final model response was rejected and remains visibly incomplete. Hold that last frame to finish its narration, then append actual technical-document and homepage recording. No failure is changed into a successful result.';
  const narration = JSON.parse(await fs.readFile(path.join(__dirname, '../narration.json'), 'utf8'));
  const durations = JSON.parse(await fs.readFile(path.join(__dirname, 'narration/durations.json'), 'utf8'));
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir: path.join(__dirname, 'continuation-raw'), size: { width: 1920, height: 1080 } } });
  const page = await context.newPage(); page.setDefaultTimeout(7000);
  page.on('pageerror', err => prior.errors.push(err.message));
  const origin = Date.now();
  async function chapter(index, actions) {
    const started = Date.now();
    const spec = narration.chapters[index];
    const seconds = durations.find(x => x.file === spec.id + '.wav').seconds;
    const item = { ...spec, start: sixth.end + (started - origin) / 1000, narrationSeconds: seconds };
    prior.chapters.push(item); console.log(`CHAPTER ${index + 1}: ${spec.title}`);
    const at = s => pause(Math.max(0, s * 1000 - (Date.now() - started)));
    await actions(at); await at(seconds + 2); item.end = sixth.end + (Date.now() - origin) / 1000;
  }
  try {
    await chapter(6, async at => {
      await page.goto('file:///' + path.join(__dirname, '../technical-report.html').replaceAll('\\', '/'));
      await page.locator('article').nth(2).evaluate(el => el.scrollIntoView());
      await at(18); await page.locator('article').nth(7).evaluate(el => el.scrollIntoView());
      await at(34); await page.goto('file:///' + path.join(__dirname, 'mobile-showcase.html').replaceAll('\\', '/'));
      await at(39); await page.locator('.phone').evaluate(el => el.scrollTo({ top: 920, behavior: 'smooth' }));
    });
    await chapter(7, async at => {
      await page.goto('http://localhost:3210', { waitUntil: 'networkidle' });
      await at(14); await page.getByRole('tab', { name: /正文论断核查/ }).click();
      await at(29); await page.getByText('摘要不能替代全文', { exact: false }).evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'smooth' }));
      await at(40); await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    });
    assert.deepEqual(prior.errors, []);
    prior.success = true; prior.finishedAt = new Date().toISOString();
    const video = page.video(); await context.close();
    await video.saveAs(path.join(__dirname, 'continuation.webm'));
    await fs.writeFile(path.join(__dirname, 'recording-timing.json'), JSON.stringify(prior, null, 2));
  } finally { await browser.close(); }
})().catch(err => { console.error(err); process.exitCode = 1; });
