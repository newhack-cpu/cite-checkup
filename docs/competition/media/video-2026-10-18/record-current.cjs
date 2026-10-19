/* eslint-disable @typescript-eslint/no-require-imports -- Local CommonJS capture CLI, consistent with the existing recorder. */
/* Local, real-network capture. No routes, mocks, credentials, or product-source edits. */
const { chromium } = require('C:/Users/Darks/AppData/Roaming/npm/node_modules/playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '../../../..');
const OUT = path.join(__dirname, 'capture');
const BASE = 'http://127.0.0.1:3210';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const EN = 'RaïssiC BrissaudJ DrayG PonceletP RocheM TeisseireM.Web analyzing traffic challenge: description and results. In: Proceedings of the ECML/PKDD;2007:47‐52.';
const ZH = '费孝通. 社会学调查要发展[J]. 社会, 1983(3): 10-14.';
const EXTRA = '\n[12] Anderson, P. R., & Kim, S. (2019). Measuring citation hallucination in neural text generation systems. Journal of Artificial Intelligence Research, 64, 1123–1150.\n[13] Tandey, K., Shrivas, K., Sharma, A., Kant, T., Tejwani, A., Tikeshwari, Kanti Deb, M., Pervez, S., Ghosh, K.K., 2024. Nanomaterial-enabled portable paper-based colorimetric and fluorometric devices: Progress in point-of-care diagnosis. Coord. Chem. Rev.514, 215919.';
const CLAIM = '在这项研究样本中，即使用 GPT-4，它引用的书籍章节里也有七成是编造的。';
const only = process.argv.slice(2);
let manifest;
const manifestFile=path.join(__dirname,process.env.CAPTURE_KIND==='tutorial'?'tutorial-capture-manifest.json':'capture-manifest.json');
const save = () => fs.writeFile(manifestFile, JSON.stringify(manifest, null, 2));
(async () => {
  await fs.mkdir(OUT, { recursive: true });
  const script = JSON.parse(await fs.readFile(path.join(ROOT, 'docs/competition/narration.json'), 'utf8'));
  try { manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8')); }
  catch { manifest = { date: '2026-10-18', actualNetwork: true, mockedResponses: false, viewport: { width:1920,height:1080 }, zoom:1.25, chapters:[], attempts:[] }; }
  const browser = await chromium.launch({ headless:true });
  let recordingPhase='competition';
  async function chapter(spec, fn, url=BASE) {
    if((process.env.CAPTURE_KIND==='tutorial'?'tutorial':'competition')!==recordingPhase)return;
    if (only.length && !only.includes(spec.id)) return;
    const attempt = new Date().toISOString().replace(/[:.]/g,'-');
    const dir = path.join(OUT, spec.id + '-' + attempt);
    await fs.mkdir(dir, {recursive:true});
    const context = await browser.newContext({viewport:{width:1920,height:1080}, recordVideo:{dir,size:{width:1920,height:1080}}, acceptDownloads:true});
    await context.addInitScript(()=>{window.__actualResponses=[];const originalFetch=window.fetch;window.fetch=async function(...args){const response=await originalFetch.apply(this,args);const method=String(args[1]?.method||'GET').toUpperCase();if(method==='POST'&&/\/(api|demo)\//.test(response.url)){const copy=response.clone();void copy.text().then(body=>window.__actualResponses.push({url:response.url,httpStatus:response.status,body,receivedAt:Date.now()})).catch(error=>window.__actualResponses.push({url:response.url,error:String(error)}));}return response;};});
    await context.addInitScript(()=>{window.addEventListener('DOMContentLoaded',()=>{const dot=document.createElement('div');dot.setAttribute('aria-hidden','true');dot.style.cssText='position:fixed;left:0;top:0;width:16px;height:16px;border:2px solid #b94432;background:#ffffff70;border-radius:50%;pointer-events:none;z-index:2147483647;transform:translate(-50%,-50%);display:none;box-shadow:0 1px 3px #0004';document.body.append(dot);window.addEventListener('pointermove',e=>{dot.style.display='block';dot.style.left=e.clientX+'px';dot.style.top=e.clientY+'px';});window.addEventListener('pointerdown',()=>{dot.style.background='#b9443277';dot.style.scale='1.45';});window.addEventListener('pointerup',()=>{dot.style.background='#ffffff70';dot.style.scale='1';});});});
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    const recordingStarted = Date.now();
    const entry = {id:spec.id,title:spec.title,plannedSeconds:spec.seconds,startedAt:new Date().toISOString(),directory:dir,cues:[],waits:[],responses:[],errors:[]};
    const pending=[];
    let origin=Date.now();
    const sec=()=> +( (Date.now()-origin)/1000).toFixed(3);
    const cue=(action,detail)=>{entry.cues.push({at:sec(),action,...(detail?{detail}:{})});console.log(spec.id+' '+sec()+' '+action);};
    page.on('pageerror', e=>entry.errors.push(e.message));
    const show=async loc=>{await loc.first().evaluate(el=>el.scrollIntoView({block:'center',behavior:'smooth'}));await sleep(700);};
    const top=async()=>{await page.evaluate(()=>window.scrollTo({top:0,behavior:'smooth'}));await sleep(700);};
    const at=async s=>sleep(Math.max(0,s*1000-(Date.now()-origin)));
    const wait=async (reason,fn,keep=7)=>{const start=sec();const timer=setInterval(()=>{console.log(spec.id+' waiting '+reason+' '+sec()+'s');page.screenshot({path:path.join(dir,'waiting.png')}).catch(()=>{});},45000);let timeout;try{const result=await Promise.race([fn(),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error(reason+'超过300秒，真实等待未完成')),300000);})]);entry.waits.push({start,end:sec(),reason,keepSeconds:keep});return result;}finally{clearInterval(timer);clearTimeout(timeout);}};
    const check=async()=>{
      cue('开始体检');
      await page.getByRole('button',{name:'开始体检',exact:true}).click();
      const body=await wait('数据库核验',async()=>{await page.waitForFunction(()=>window.__actualResponses.some(r=>r.url.endsWith('/api/check')&&r.body),null,{timeout:150000});await page.getByRole('button',{name:'开始体检',exact:true}).waitFor();return page.evaluate(()=>window.__actualResponses.filter(r=>r.url.endsWith('/api/check')).at(-1).body);});
      const events=body.trim().split('\n').map(t=>{try{return JSON.parse(t);}catch{return null;}}).filter(Boolean);
      entry.referenceResults=events.filter(e=>e.type==='result').map(e=>({index:e.result.index,verdict:e.result.verdict,summary:e.result.summary}));
      cue('体检实际结果',entry.referenceResults);return events;
    };
    const claim=async()=>{
      cue('核查论断');const rp=page.waitForResponse(r=>r.url().endsWith('/api/claims')&&r.request().method()==='POST',{timeout:150000});
      await page.getByRole('button',{name:'核查论断',exact:true}).click();
      const result=await wait('检索原文和论断判断',async()=>{const r=await rp;const b=await r.json();await page.getByRole('button',{name:'核查论断',exact:true}).waitFor();return b;});
      (entry.claimResults??=[]).push(result);cue('论断实际结果',{status:result.status,verdict:result.verdict,source:result.source?.label,method:result.coverage?.method});return result;
    };
    try {
      await page.goto(url,{waitUntil:'networkidle'});
      await page.evaluate(()=>document.fonts.ready);
      if(url===BASE) await page.evaluate(()=>document.documentElement.style.zoom='1.25');
      await sleep(1300);
      origin=Date.now();entry.contentStart=(origin-recordingStarted)/1000;
      cue('页面已载入');
      console.log('START '+spec.id);
      await fn({page,at,show,top,cue,wait,check,claim,entry,dir,sec});
      entry.contentSeconds=sec();entry.success=true;
      await page.screenshot({path:path.join(dir,'final.png')});
      await fs.writeFile(path.join(dir,'final-ui.txt'),await page.locator('body').innerText());
      const observed=await page.evaluate(()=>window.__actualResponses||[]);for(const [i,r] of observed.entries()){const name=String(i+1).padStart(2,'0')+'-'+new URL(r.url).pathname.replaceAll('/','-')+'.txt';await fs.writeFile(path.join(dir,name),r.body||r.error);entry.responses.push({url:r.url,httpStatus:r.httpStatus,file:path.join(dir,name),receivedAt:r.receivedAt});}
    }catch(e){entry.success=false;entry.failure=e.message;await page.screenshot({path:path.join(dir,'failure.png')}).catch(()=>{});console.error('FAIL '+spec.id+' '+e.message);}
    finally{
      entry.finishedAt=new Date().toISOString();entry.contentEnd=(Date.now()-recordingStarted)/1000;
      const video=page.video();await context.close();await video.saveAs(path.join(dir,'raw.webm'));entry.video=path.join(dir,'raw.webm');
      await Promise.allSettled(pending);await fs.writeFile(path.join(dir,'entry.json'),JSON.stringify(entry,null,2));manifest.attempts.push(entry);if(entry.success){const outputs=entry.sections?entry.sections.map(s=>({...entry,id:s.id,title:s.title,contentStart:entry.contentStart+s.start,contentSeconds:s.end-s.start,contentEnd:entry.contentStart+s.end,cues:entry.cues.filter(c=>c.at>=s.start&&c.at<=s.end).map(c=>({...c,at:c.at-s.start})),waits:entry.waits.filter(w=>w.start>=s.start&&w.end<=s.end).map(w=>({...w,start:w.start-s.start,end:w.end-s.start})),reuseSource:'同一次连续真实录制的独立时间段；未循环、未重放响应',sections:undefined})): [entry];for(const output of outputs){manifest.chapters=manifest.chapters.filter(c=>c.id!==output.id);manifest.chapters.push(output);}manifest.chapters.sort((a,b)=>a.id.localeCompare(b.id));}await save();console.log('END '+spec.id+' '+entry.success+' '+entry.contentSeconds+'s');
    }
  }
  await chapter(script.chapters[0],async({page,at,show,top,cue})=>{
    await at(6);cue('切换正文论断工作区');await page.getByRole('tab',{name:/正文论断核查/}).click();
    await at(16);await show(page.getByText('召回的片段不能替代通读全文',{exact:false}));
    await at(23);await top();await page.getByRole('tab',{name:/参考文献体检/}).click();
    await at(28);cue('阅读隐私和人工复核提示');await show(page.getByText('只把参考文献条目发送给',{exact:false}));await at(36);
  });
  await chapter(script.chapters[1],async({page,at,show,cue,wait,entry})=>{
    await at(3);await page.getByRole('button',{name:'拍照 / 截图识别',exact:true}).hover();await at(9);cue('上传6条公开参考文献的合成模拟照片');
    const rp=page.waitForResponse(r=>r.url().endsWith('/api/vision')&&r.request().method()==='POST',{timeout:150000});
    await page.getByLabel('选择参考文献图片',{exact:true}).setInputFiles(path.join(ROOT,'eval/vision/out/mixed-photo.jpg'));
    const data=await wait('视觉模型逐字转写',async()=>{const r=await rp;const d=await r.json();await page.getByRole('button',{name:'确认并填入参考文献',exact:true}).waitFor({timeout:150000});return d;},9);
    entry.vision={entries:data.entries,warnings:data.warnings,model:data.model};cue('查看原图和识别条数');
    await show(page.getByText(/图片识别 · 1 张图片/));await sleep(6e3);
    await show(page.getByLabel(/识别结果 · 请对照原图/));await sleep(11e3);
    await page.getByLabel(/识别结果 · 请对照原图/).evaluate(el=>el.scrollTo({top:el.scrollHeight,behavior:'smooth'}));cue('逐条对照识别文字');await sleep(6e3);
    await show(page.getByRole('button',{name:'确认并填入参考文献',exact:true}));await sleep(3e3);await page.getByRole('button',{name:'确认并填入参考文献',exact:true}).click();cue('确认填入');await show(page.getByLabel('参考文献列表',{exact:true}));await sleep(7e3);
  });
  await chapter(script.chapters[2],async({page,show,cue,check,entry,dir})=>{
    await page.getByRole('button',{name:'载入示例',exact:true}).click();cue('载入公开与合成示例');
    const field=page.getByLabel('参考文献列表',{exact:true});await field.fill((await field.inputValue())+EXTRA);await sleep(4e3);
    await check();await show(page.getByText('体 检 报 告',{exact:true}));await sleep(6e3);
    const cards=page.locator('#panel-references article');
    for(const verdict of ['verified','mismatch','near_match','not_found','unverifiable']){
      const item=entry.referenceResults.find(r=>r.verdict===verdict);if(!item){cue('当日未出现分类',verdict);continue;}
      const card=cards.nth(item.index-1);await show(card);cue('阅读分类与说明',item);await sleep(5e3);
      const expand=card.getByRole('button',{name:'展开详情',exact:true});if(await expand.count()){await expand.click();await sleep(700);}
      if(['mismatch','near_match'].includes(verdict)){await show(card.getByText('引用中的写法',{exact:true}).locator('..').locator('..'));await sleep(8e3);}
    }
    cue('下载Markdown核查报告');const dl=page.waitForEvent('download');await page.getByRole('button',{name:'下载核查报告',exact:true}).click();await (await dl).saveAs(path.join(dir,'reference-report.md'));await show(page.getByText('体 检 报 告',{exact:true}));await sleep(5e3);
  });
  await chapter(script.chapters[3],async({page,show,cue,check,wait,entry})=>{
    await page.getByLabel('参考文献列表',{exact:true}).fill('[1] '+EN+'\n[2] '+ZH);await sleep(3e3);await check();
    const cards=page.locator('#panel-references article');
    for(let i=0;i<2;i++){
      const card=cards.nth(i);await show(card);await sleep(3e3);cue('AI继续查',i===0?'英文会议引文':'中文期刊引文');
      const btn=card.getByRole('button',{name:'AI 继续查',exact:true});if(!await btn.count()){cue('无需或无法继续查',await card.innerText());continue;}
      const previous=await page.evaluate(()=>window.__actualResponses.filter(r=>r.url.endsWith('/api/agent')).length);await btn.click();
      const body=await wait('Agent逐步检索',async()=>{await page.waitForFunction(n=>window.__actualResponses.filter(r=>r.url.endsWith('/api/agent')&&r.body).length>n,previous,{timeout:180000});return page.evaluate(()=>window.__actualResponses.filter(r=>r.url.endsWith('/api/agent')).at(-1).body);},16);
      (entry.agentBodies??=[]).push(body);await sleep(800);await show(card);cue('实际Agent结果',await card.innerText());await sleep(9e3);
      const link=card.getByRole('link',{name:/打开.*页面/});if(await link.count()){await show(link);await link.hover();cue('公开来源链接',await link.getAttribute('href'));await sleep(6e3);}
      const details=card.getByRole('button',{name:'展开详情',exact:true});if(await details.count()){await details.click();await sleep(1e3);await show(card);await sleep(4e3);}
    }
  });
  await chapter(script.chapters[4],async({page,show,cue,wait,at})=>{
    await page.getByRole('tab',{name:/正文论断核查/}).click();await page.getByRole('radio',{name:'提供文献正文',exact:true}).check();await sleep(4e3);
    cue('导入自制合成测试PDF');await page.getByLabel('选择证据文件',{exact:true}).setInputFiles(path.join(ROOT,'src/lib/documents/__tests__/fixtures/preprint-hidden.pdf'));
    await wait('PDF文字提取与隐藏指令检测',()=>page.getByRole('button',{name:'确认并填入证据',exact:true}).waitFor({timeout:35000}),3);
    await show(page.getByRole('region',{name:'隐藏文字检测'}));cue('查看隐藏文字检测结果');await sleep(10e3);
    await show(page.getByLabel(/文字预览/).filter({visible:true}));cue('核对已去除隐藏指令的预览');await sleep(8e3);
    await page.getByLabel(/文字预览/).filter({visible:true}).evaluate(el=>el.scrollTo({top:el.scrollHeight,behavior:'smooth'}));await sleep(5e3);
    await show(page.getByRole('button',{name:'确认并填入证据',exact:true}));await sleep(3e3);await page.getByRole('button',{name:'确认并填入证据',exact:true}).click();cue('确认填入净化后的证据');await show(page.getByLabel('文献原文',{exact:true}));await sleep(6e3);await at(50);
  });
  await chapter(script.chapters[5],async({page,show,cue,claim,at})=>{
    await page.getByRole('tab',{name:/正文论断核查/}).click();await sleep(3e3);await page.getByLabel('正文中的论断',{exact:true}).fill(CLAIM);await page.getByLabel('文献 DOI',{exact:true}).fill('10.1038/s41598-023-41032-5');cue('中文论断和公开DOI');await sleep(5e3);
    const result=await claim();await show(page.getByRole('heading',{name:result.status==='complete'?({supported:'证据支持',contradicted:'与证据矛盾',insufficient_evidence:'证据不足',partially_supported:'部分支持'}[result.verdict]):'核查未完成',exact:true}));await sleep(10e3);
    await show(page.getByText('判断范围：',{exact:false}));cue('阅读实际来源范围和检索方法');await sleep(8e3);
    await show(page.getByRole('heading',{name:'判断引用的原文',exact:true}));await sleep(7e3);
    const quote=page.getByRole('button',{name:/查看片段/}).first();if(await quote.count()){await quote.click();cue('定位有效引句原片段');await sleep(10e3);}else{await page.getByRole('button',{name:/检索召回的证据片段/}).click();cue('查看实际召回片段，未完成不形成结论');await show(page.locator('#panel-claims article').first());await sleep(10e3);}await at(61);
  });
  await chapter(script.chapters[6],async({page,show,cue,claim})=>{
    await page.getByRole('tab',{name:/正文论断核查/}).click();await page.getByRole('button',{name:'试用矛盾演示材料',exact:true}).click();cue('明确标注的合成材料，400人论断');await show(page.getByLabel('来源说明',{exact:true}));await sleep(4e3);
    await claim();await show(page.getByText('论 断 核 查 报 告',{exact:true}));await sleep(7e3);
    await page.getByLabel('正文中的论断',{exact:true}).fill('该学习计划显著改善了学生睡眠。');cue('材料未涉及的论断');await sleep(3e3);await claim();await show(page.getByText('论 断 核 查 报 告',{exact:true}));await sleep(7e3);
    await page.getByLabel('正文中的论断',{exact:true}).fill('该学习计划改善了学生睡眠。');await page.getByRole('button',{name:'核查论断',exact:true}).click();await show(page.getByRole('button',{name:'停止论断核查',exact:true}));await sleep(1500);await page.getByRole('button',{name:'停止论断核查',exact:true}).click();cue('主动停止，不形成结论');await sleep(4e3);
  });
  await chapter(script.chapters[7],async({page,cue,wait,entry,show,at})=>{
    await at(4);cue('真实stdio连接并列出工具');await page.locator('#connect-button').click();await wait('MCP真实连接',()=>page.locator('#connection-status[data-connected="true"]').waitFor({timeout:30000}),3);await sleep(6e3);
    cue('真实调用verify_references');await page.locator('#verify-button').click();await wait('MCP真实核验两条文献',()=>page.locator('#result-panel[data-state="complete"]').waitFor({timeout:150000}),8);
    entry.mcp=await page.evaluate(()=>window.mcpLastResult);await show(page.locator('#result-panel'));await sleep(9e3);await show(page.locator('#results .result-card').last());await sleep(8e3);await at(40);
  },'http://127.0.0.1:3211');
  await chapter(script.chapters[8],async({page,at,cue})=>{
    cue('技术说明PDF第11页真实渲染');await at(8);await page.evaluate(()=>window.scrollTo({top:350,behavior:'smooth'}));await at(19);await page.evaluate(()=>window.scrollTo({top:650,behavior:'smooth'}));await at(30);await page.evaluate(()=>window.scrollTo({top:950,behavior:'smooth'}));await at(39);
  },'file:///'+path.join(OUT,'technical-pdf-viewer.html').replaceAll('\\','/'));
  await chapter(script.chapters[9],async({page,at,show,top,cue})=>{
    await at(6);await show(page.getByText('只把参考文献条目发送给',{exact:false}));cue('参考文献覆盖与隐私边界');await at(15);await top();await page.getByRole('tab',{name:/正文论断核查/}).click();await at(22);await show(page.getByText('召回的片段不能替代通读全文',{exact:false}));cue('人工复核边界');await at(32);await top();await page.getByRole('tab',{name:/参考文献体检/}).click();await at(40);
  });
  recordingPhase='tutorial';
  const tutorial=JSON.parse(await fs.readFile(path.join(__dirname,'tutorial-narration.json'),'utf8'));
  await chapter(tutorial.chapters[0],async({page,at,show,cue})=>{
    await at(5);await page.getByRole('button',{name:'载入示例',exact:true}).click();cue('载入示例');await show(page.getByLabel('参考文献列表',{exact:true}));await at(13);await page.getByLabel('参考文献列表',{exact:true}).evaluate(el=>el.scrollTo({top:el.scrollHeight,behavior:'smooth'}));await at(20);await show(page.getByText('只把参考文献条目发送给',{exact:false}));cue('阅读隐私说明');await at(30);
  });
  await chapter(tutorial.chapters[1],async({page,at,show,cue,wait})=>{
    await at(4);cue('导入公开演示参考文献PDF');await page.getByLabel('选择参考文献文件',{exact:true}).setInputFiles(path.join(ROOT,'eval/phase-two-2026-10-14/demo-inputs/public-references.pdf'));
    await wait('提取PDF文字',()=>page.getByRole('button',{name:'确认并填入参考文献',exact:true}).waitFor({timeout:35000}),3);
    await show(page.getByLabel(/文字预览/).filter({visible:true}));await sleep(5e3);await page.getByRole('radio',{name:'全文文字',exact:true}).check();cue('全文预览');await sleep(5e3);await page.getByRole('radio',{name:'参考文献区域',exact:true}).check();cue('选择参考文献区域');await sleep(5e3);await page.getByLabel(/文字预览/).filter({visible:true}).evaluate(el=>el.scrollTo({top:el.scrollHeight,behavior:'smooth'}));await sleep(5e3);await show(page.getByRole('button',{name:'确认并填入参考文献',exact:true}));await sleep(3e3);await page.getByRole('button',{name:'确认并填入参考文献',exact:true}).click();cue('确认替换输入框');await show(page.getByLabel('参考文献列表',{exact:true}));await sleep(6e3);await at(40);
  });
  await chapter(tutorial.chapters[2],async({page,at,show,cue,check,entry})=>{
    await page.getByRole('button',{name:'载入示例',exact:true}).click();const field=page.getByLabel('参考文献列表',{exact:true});await field.fill((await field.inputValue())+EXTRA);await sleep(3e3);await check();await show(page.getByText('体 检 报 告',{exact:true}));await sleep(2e3);
    const cards=page.locator('#panel-references article');for(const verdict of ['verified','mismatch','near_match','unverifiable','not_found']){const item=entry.referenceResults.find(r=>r.verdict===verdict);if(!item)continue;const card=cards.nth(item.index-1);await show(card);cue('查看实际分类',item);await sleep(verdict==='verified'?3e3:4e3);if(['mismatch','near_match'].includes(verdict)){const expand=card.getByRole('button',{name:'展开详情',exact:true});if(await expand.count())await expand.click();await show(card.getByText('引用中的写法',{exact:true}).locator('..').locator('..'));await sleep(5e3);}}
    await show(page.getByText('体 检 报 告',{exact:true}));cue('回顾真实结果分布');await at(47);
  });
  if(process.env.CAPTURE_KIND==='tutorial') await chapter(tutorial.chapters[3],async({page,at,show,cue,check,wait,entry,dir})=>{
    await page.getByLabel('参考文献列表',{exact:true}).fill(ZH);await sleep(3e3);await check();const card=page.locator('#panel-references article').first();await show(card);await sleep(4e3);cue('中文期刊AI继续查');await card.getByRole('button',{name:'AI 继续查',exact:true}).click();
    const body=await wait('中文期刊真实Agent检索',async()=>{await page.waitForFunction(()=>window.__actualResponses.some(r=>r.url.endsWith('/api/agent')&&r.body),null,{timeout:180000});return page.evaluate(()=>window.__actualResponses.filter(r=>r.url.endsWith('/api/agent')).at(-1).body);},10);entry.agentBodies=[body];await fs.writeFile(path.join(dir,'agent-real-response.ndjson'),body);await show(card);cue('中文期刊实际结论',await card.innerText());await sleep(10e3);
    const link=card.getByRole('link',{name:/打开.*页面/});if(await link.count()){await show(link);await sleep(4e3);entry.sourceLink=await link.getAttribute('href');cue('点击真实来源链接',entry.sourceLink);const opened=page.waitForEvent('popup');await link.click();const source=await opened;await source.waitForLoadState('domcontentloaded',{timeout:10000}).catch(()=>{});await sleep(2500);entry.externalPage={url:source.url(),title:await source.title().catch(()=>''),text:await source.locator('body').innerText().catch(()=>''),screenshot:path.join(dir,'external-source.png')};entry.externalPage.contentLoaded=entry.externalPage.text.trim().length>40;await source.screenshot({path:entry.externalPage.screenshot}).catch(()=>{});const externalVideo=source.video();await source.close();await externalVideo.saveAs(path.join(dir,'external-source.webm'));entry.externalPage.video=path.join(dir,'external-source.webm');cue('真实来源新标签加载状态',{contentLoaded:entry.externalPage.contentLoaded,title:entry.externalPage.title});await show(card.getByText(/核查过程 ·/));await sleep(8e3);}else{await card.getByRole('button',{name:'展开详情',exact:true}).click();await show(card);await sleep(8e3);}await at(42);
  });
  await chapter(tutorial.chapters[4],async({page,show,top,cue,check,claim,dir,sec,entry})=>{
    await page.getByLabel('参考文献列表',{exact:true}).fill('[1] Walters, W. H., & Wilder, E. I. (2023). Fabrication and errors in the bibliographic citations generated by ChatGPT. Scientific Reports, 13, 14045. https://doi.org/10.1038/s41598-023-41032-5\n[2] LeCun, Y., Bengio, Y., & Hinton, G. (2017). Deep learning. Nature, 521(7553), 436–444.');await check();await top();const start=sec();cue('教程论断章开始');
    await page.getByRole('tab',{name:/正文论断核查/}).click();await sleep(3e3);await page.getByLabel('正文中的论断',{exact:true}).fill('在该研究样本中，GPT-3.5生成引文的55%为虚构，GPT-4为18%。');await sleep(3e3);await page.getByRole('radio',{name:'提供文献正文',exact:true}).check();cue('展示提供文献正文入口');await show(page.getByLabel('文献原文',{exact:true}));await sleep(4e3);await page.getByRole('radio',{name:'通过 DOI 查原文',exact:true}).check();await page.getByLabel('文献 DOI',{exact:true}).fill('10.1038/s41598-023-41032-5');cue('回到真实使用的DOI来源');await sleep(3e3);await claim();await show(page.getByText('判断范围：',{exact:false}));cue('阅读真实证据范围与结论');await sleep(6e3);await show(page.getByRole('heading',{name:'判断引用的原文',exact:true}));await sleep(4e3);const quote=page.getByRole('button',{name:/查看片段/}).first();if(await quote.count()){await quote.click();cue('查看原文上下文');await sleep(7e3);}const split=sec();
    cue('教程报告章开始');await show(page.getByRole('button',{name:'下载论断报告',exact:true}));await sleep(4e3);let dl=page.waitForEvent('download');await page.getByRole('button',{name:'下载论断报告',exact:true}).click();await(await dl).saveAs(path.join(dir,'claim-report.md'));cue('论断报告已下载');await sleep(4e3);await top();await page.getByRole('tab',{name:/参考文献体检/}).click();await show(page.getByRole('button',{name:'下载核查报告',exact:true}));await sleep(4e3);dl=page.waitForEvent('download');await page.getByRole('button',{name:'下载核查报告',exact:true}).click();await(await dl).saveAs(path.join(dir,'reference-report.md'));cue('参考文献报告已下载');await sleep(4e3);await page.getByRole('button',{name:'复制修正版清单',exact:true}).hover();cue('复制前仍需核对候选');await sleep(8e3);
    entry.sections=[{id:'05-claims',title:tutorial.chapters[4].title,start,end:split},{id:'06-report',title:tutorial.chapters[5].title,start:split,end:sec()}];
  });
  await chapter(tutorial.chapters[5],async({page,show,cue,check,claim,dir,sec,entry})=>{
    await page.getByLabel('参考文献列表',{exact:true}).fill('[1] Walters, W. H., & Wilder, E. I. (2023). Fabrication and errors in the bibliographic citations generated by ChatGPT. Scientific Reports, 13, 14045. https://doi.org/10.1038/s41598-023-41032-5\n[2] LeCun, Y., Bengio, Y., & Hinton, G. (2017). Deep learning. Nature, 521(7553), 436–444.');await check();
    await page.getByRole('tab',{name:/正文论断核查/}).click();await page.getByLabel('正文中的论断',{exact:true}).fill('在该研究样本中，GPT-3.5生成引文的55%为虚构，GPT-4为18%。');await page.getByLabel('文献 DOI',{exact:true}).fill('10.1038/s41598-023-41032-5');await claim();
    entry.recommendedContentStart=entry.contentStart+sec();cue('教程报告章节开始');await show(page.getByRole('button',{name:'下载论断报告',exact:true}));await sleep(4e3);let dl=page.waitForEvent('download');await page.getByRole('button',{name:'下载论断报告',exact:true}).click();await(await dl).saveAs(path.join(dir,'claim-report.md'));cue('论断报告已下载');await sleep(4e3);
    await page.getByRole('tab',{name:/参考文献体检/}).click();await show(page.getByRole('button',{name:'下载核查报告',exact:true}));await sleep(4e3);dl=page.waitForEvent('download');await page.getByRole('button',{name:'下载核查报告',exact:true}).click();await(await dl).saveAs(path.join(dir,'reference-report.md'));cue('参考文献报告已下载');await sleep(4e3);await page.getByRole('button',{name:'复制修正版清单',exact:true}).hover();cue('复制前仍需核对候选');await sleep(8e3);
  });
  const guide=await fs.readFile(path.join(ROOT,'docs/competition/TRIAL_GUIDE.md'),'utf8');
  const excerpt=guide.split('## 四、记录表（每位老师一份）')[1].split('## 五、记录怎么用')[0];
  const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  let rows='',table=false;
  for(const line of excerpt.split('\n')){if(line.startsWith('|')){if(line.includes('---'))continue;if(!table){rows+='<table>';table=true;}rows+='<tr>'+line.split('|').slice(1,-1).map(v=>'<td>'+escape(v.trim())+'</td>').join('')+'</tr>';}else{if(table){rows+='</table>';table=false;}if(line.trim())rows+='<p>'+escape(line)+'</p>';}}
  if(table)rows+='</table>';
  await fs.writeFile(path.join(OUT,'trial-guide-viewer.html'),'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>老师试用指南 · 空白记录表</title><style>body{margin:0;background:#f1eee6;color:#2e342e;font:24px/1.8 "Microsoft YaHei",sans-serif}header{padding:24px 70px;background:#793f36;color:#fff}header small{font-size:17px;float:right}main{max-width:1300px;margin:35px auto 100px}h1{font-size:36px}table{border-collapse:collapse;width:100%;background:white;margin:28px 0}td{border:1px solid #d2cbbd;padding:16px 24px}td:first-child{width:72%}tr:first-child{background:#e6e0d5;font-weight:bold}.note{font-size:19px;color:#665f51}</style><header>引用体检 · 老师试用记录说明<small>TRIAL_GUIDE.md 第四节 · 只读视图</small></header><main><h1>记录表（每位老师一份）</h1><p class="note">空白记录表：展示实际试用说明，尚未填写任何试用结果。</p>'+rows+'</main></html>');
  await chapter(tutorial.chapters[6],async({page,at,cue})=>{await at(7);await page.evaluate(()=>window.scrollTo({top:330,behavior:'smooth'}));cue('条数与人工、工具用时分别记录');await at(16);await page.evaluate(()=>window.scrollTo({top:670,behavior:'smooth'}));cue('确实有问题、误报、拿不准');await at(24);await page.evaluate(()=>window.scrollTo({top:1100,behavior:'smooth'}));cue('空白评价与其他意见');await at(33);},'file:///'+path.join(OUT,'trial-guide-viewer.html').replaceAll('\\','/'));
  await browser.close();
})().catch(e=>{console.error(e);process.exitCode=1;});
