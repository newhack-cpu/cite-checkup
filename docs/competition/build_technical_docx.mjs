/**
 * 技术说明的 Word 版（正式文档版式）：内容来自 technical-content.json（与 build_technical_report.py 的 PDF 同源），
 * 按官方要求的章节重新编排，给参赛者填好团队信息后用 Word 另存为 PDF 提交。
 *
 * 用法：node docs/competition/build_technical_docx.mjs
 *       python docs/competition/finish_technical_docx.py   （用本机 Word 更新目录页码并清理文档属性）
 * 需要 docx（npm install -g docx），项目里没装时到 npm 全局目录找。不联网、不调用模型。
 *
 * 版式：封面、目录、正文三节；黑白，宋体正文、黑体标题，三线表，图表按章编号，页脚“第 X 页 共 Y 页”。
 * 正文沿用 JSON 原文，只改这几处：交叉引用按新章节号改写（TEXT_FIXES）；“本报告共 21 页”改为自动页数；
 * 删去面向队内的说法；团队信息、材料日期移到封面（待填写）；第 8 章补一段由项目摘要原句组成的总结。
 * 另按报名表“作品介绍文档”的 7 项要求补了：1.2–1.5 节（使用方式、亮点、AI 落地与测试、发表获奖与来源，
 * 内容取自试用指南和本文已有数字）、7 幅界面截图（media/doc-shots/，魔搭公网实际操作截取）和附录 A.2 对照表。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

// 按文件地址导入 ES 模块时不解析 package.json，要直接写到 docx 的入口文件
async function loadDocx() {
  try {
    return await import('docx');
  } catch {
    const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
    return import(pathToFileURL(path.join(root, 'docx', 'dist', 'index.mjs')).href);
  }
}
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, Header, Footer, HeadingLevel, TableOfContents, ImageRun,
  AlignmentType, BorderStyle, WidthType, VerticalAlign, PageNumber, LineRuleType, HeightRule,
} = await loadDocx();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = JSON.parse(fs.readFileSync(path.join(HERE, 'technical-content.json'), 'utf8').replace(/^﻿/, ''));
const OUT = path.join(HERE, 'output', 'docx', '引用体检-技术说明.docx');

// 单位 DXA（1pt = 20）。A4，上下 2.54 cm，左右 2.5 cm
const PAGE = { size: { width: 11906, height: 16838 }, margin: { top: 1440, bottom: 1440, left: 1418, right: 1418, header: 851, footer: 992 } };
const WIDTH = PAGE.size.width - PAGE.margin.left - PAGE.margin.right;
// hint=eastAsia：弯引号、间隔号这类中西文共用的字符按中文字体排
const SONG = { ascii: 'Times New Roman', hAnsi: 'Times New Roman', cs: 'Times New Roman', eastAsia: 'SimSun', hint: 'eastAsia' };
const HEI = { ascii: 'Times New Roman', hAnsi: 'Times New Roman', cs: 'Times New Roman', eastAsia: 'SimHei', hint: 'eastAsia' };
// 间隔号、连接号前后本来就有空格或数字，按西文字体排（半角），不然在表格里显得很宽
const LATIN = { ascii: 'Times New Roman', hAnsi: 'Times New Roman', cs: 'Times New Roman', eastAsia: 'SimSun', hint: 'default' };
const NARROW = /([·–])/;
const NONE = { style: BorderStyle.NONE, size: 0, color: 'auto' };
const rule = (size) => ({ style: BorderStyle.SINGLE, size, color: '000000' });
const exact = (pt) => ({ line: Math.round(pt * 20), lineRule: LineRuleType.EXACT });

// 正文按官方要求的章节编排；page 是 technical-content.json 里的页序号，页内小节降一级、自动编号
const OUTLINE = [
  { title: '项目概述', page: 0 },
  { title: '需求分析', page: 1 },
  { title: '系统架构设计', page: 2 },
  { title: 'AI 技术方案', children: [
    { title: 'AI 技术选型、集成方式与优化策略', page: 3 },
    { title: 'AI 检索 Agent：模型规划检索，规则下结论', page: 6 },
    { title: '中文期刊联网核查：找原文页，规则下结论', page: 5 },
    { title: '论断核查：开放全文、混合检索与带引句判断', page: 7 },
    { title: '多模态：拍照 / 截图识别参考文献', page: 9 },
  ] },
  { title: '核心功能实现', children: [
    { title: '参考文献核验：工具调用与事实核验', page: 4 },
    { title: '规范参考文献与只贴 DOI', page: 12 },
    { title: '文档导入与隐藏提示词检测', page: 10 },
    { title: 'MCP Server、可控性与隐私', page: 11 },
  ] },
  { title: '测试与部署', children: [
    { title: '验证方法与实测结果', page: 13 },
    { title: '论断检索评测', page: 8 },
    { title: '开发方场景测试：代替用户试用', pages: [14, 15] },
    { title: '和“直接问 AI”比：对照实验与消融', page: 16 },
    { title: '运行、配置、部署与复现', page: 17 },
  ] },
  { title: '创新点', page: 18 },
  { title: '总结与展望', page: 19 },
  { title: '证据索引与提交对应', page: 20, appendix: 'A' },
];

// 交叉引用按新章节号改写；页数改为域；删去面向队内的说法
const PAGES_FIELD = '\u0000页数\u0000';
const TEXT_FIXES = [
  ['（第 15 节）', '（见 6.4 节）'], ['（第 14 节）', '（见 6.3 节）'], ['（第 5 节）', '（见 4.3 节）'],
  ['第 15 节', '6.4 节'], ['第 14 节', '6.3 节'], ['第 5 节', '4.3 节'],
  ['本报告共 21 页，对应这些部分', `本说明共 ${PAGES_FIELD} 页（含封面和目录），对应这些部分`],
  ['；对外介绍和答辩都以此为准。', '。'],
  ['代码仓库已公开并保留真实历史；团队资料由参赛者补齐。', '代码仓库已公开并保留真实历史。'],
];
// {图:id}、{表:页:块} 换成生成时编好的号（正文要生成两遍，第二遍才有编号）
const REFS = {};
const fix = (text) => TEXT_FIXES.reduce((s, [a, b]) => s.split(a).join(b), String(text))
  .replace(/\{(图|表):([^}]+)\}/g, (_, kind, id) => REFS[`${kind}:${id}`] ?? `${kind} ?`);

// 表、图的标题（键为“页序号:块序号”）
const CAPTIONS = {
  '0:2': '项目基本信息', '1:0': '用户问题、产品行为与结论边界', '2:0': '系统数据流（上：参考文献核验；下：论断核查）',
  '2:1': '模块边界与实现职责', '3:0': 'AI 能力的模型接口、集成方式与优化策略', '4:1': '参考文献核验的关键保护与用户可见结果',
  '5:0': '中文期刊联网核查流程', '5:1': '中文期刊联网核查的结论条件', '6:0': 'AI 检索 Agent 流程', '6:1': 'AI 检索 Agent 的约束与做法',
  '7:0': '论断核查流程', '8:0': '不同检索方式的论断检索效果', '9:0': '图片识别流程', '9:1': '图片识别的设计要点',
  '10:1': '各格式的隐藏文字检测内容', '11:0': 'MCP Server 提供的工具', '11:1': '可控性与隐私的处理策略',
  '12:0': '规范参考文献在不同情况下的写法', '13:0': '验证层级、实测记录与解释范围', '14:1': '场景一：查证结果与两次核查对比',
  '15:0': '场景一的问题条目', '15:2': '场景二：只贴 DOI 的检查结果', '16:0': '与直接问 AI 的对照结果',
  '17:0': '运行、配置与部署步骤', '19:0': '尚缺的证据', '20:0': '证据索引',
};
// 页内需要另加小节标题的位置；第 8 章开头补总结（句子取自 1.1 项目摘要）
const HEADING_BEFORE = { '19:lead': '尚缺的证据' };
const PRELUDE = {
  19: { title: '总结', paragraphs: [
    '参考文献的书目真实性与正文论断的证据支持是两个问题。本项目把它们分为独立工作区：前者用公开学术数据库逐字段核对题名、作者、年份、期刊与 DOI；后者先检索证据片段，再由 DeepSeek 判断一条论断与材料的关系。模型和搜索只提供候选或依据，真伪结论由规则或带原文引句的判断给出。',
    '和“直接问 AI”的对照实验（130 条构造引文）中，不联网的 DeepSeek 把 23%–33% 的编造引文说成真实，本系统为 0；本系统说“已核实”的条目全部正确，改正写法全部来自数据库记录（见 6.4 节）。',
  ] },
};
// 移到封面的行
const DROP_ROWS = new Set(['材料日期', '学校、队伍与成员']);

// 报名表“作品介绍文档”要求的使用方式、亮点、AI 落地与测试、发表获奖与来源，接在 1.1 之后
const INTRO = [
  { title: '使用方式', paragraphs: [
    '引用体检是网页应用，打开即可使用，不需要注册登录。公网演示部署在魔搭创空间（https://www.modelscope.cn/studios/kgkvybu111111/cite-checkup?mode=full），首次打开需要等待加载。页面顶部有两个工作区：左边“参考文献体检”，右边“正文论断核查”。第一次打开会播放约 2 秒的开场动画，可以跟着 6 步新手引导熟悉页面，页眉的“怎么用”可随时重看。本文的界面截图均取自魔搭公网演示的实际运行结果。',
    '（1）粘贴或导入参考文献。把论文末尾的参考文献列表粘贴进输入框，一条一行或带 [1]、1. 这样的序号，GB/T 7714、APA、IEEE 等格式都可以，只贴 DOI 也行；也可以点“导入文件”从 PDF、Word、TXT 中提取参考文献，或点“截图识别”上传参考文献页的照片或截图，对照原图确认后再填入（{图:vision}）。',
    '（2）开始体检，查看结论。点“开始体检”，每条参考文献陆续盖上结论印章：已核实、有误、相近候选、查无此文、已撤稿 / 关注声明、待人工或未完成。点“需要处理”只看有问题的条目，点“详情”查看逐字段比对、按数据库记录生成的规范写法和每一步核查过程（{图:results}）。中文期刊论文会自动到知网、万方、维普和期刊官网联网核查（{图:cnki}）。',
    '（3）对查不到的条目让 AI 继续查。“待人工”或“相近候选”的条目可以点“AI 继续查”：DeepSeek 规划检索，换着方式再查几个数据库，每一步都显示出来，找到的候选仍由规则逐字段确认（{图:agent}）。',
    '（4）导出结果。查完可以“复制修正版清单”（只改写错的条目），点“规范参考文献”把整份列表统一成 GB/T 7714 或 APA（{图:standard}），或“下载核查报告”。导入的 PDF、Word 里如有读者看不见、AI 却会读到的隐藏文字，导入预览时会列出来并去掉（{图:hidden}）。',
    '正文论断核查：在“正文中的论断”里输入一句话，证据来源选“通过 DOI 查原文”并填它引用文献的 DOI，或选“提供文献正文”粘贴原文段落，然后点“核查论断”。结论分为证据支持、部分支持、与证据矛盾、证据不足四类，并列出判断所依据的原文引句，可展开查看引句在原文中的位置（{图:claim}）。',
    '所有结论都需要人工复核：查不到不等于编造，工具只帮助把可疑条目挑出来。开发者还可以在本地以 stdio 方式启动 MCP Server，让支持 MCP 的 AI 工具调用核验能力（见 5.4 节）；本地运行与部署方法见 6.5 节。',
  ] },
  { title: '项目亮点', paragraphs: [
    '（1）检索与裁决分离。大模型和搜索只负责找候选、读原文；是不是同一篇、真不真，由规则逐字段判定，每个结论都能回到数据库记录或原文片段（见第 3、4 章）。',
    '（2）比直接问 AI 可靠。在 130 条构造引文的对照实验中，不联网的 DeepSeek 把 23%–33% 的编造引文说成真实，本系统为 0；本系统说“已核实”的条目全部正确，改正写法全部来自数据库记录（见 6.4 节）。',
    '（3）中文期刊也能查。知网、万方、维普没有开放接口，标准体检用 DeepSeek 搜索接口找到原文页，再由规则逐字段比对；在规则定稿后只运行一次的 40 条中文期刊论文上，“待人工”从 95% 降到 32.5%，已核实的 15 条全部正确（见 4.3 节）。',
    '（4）正文论断有原文依据。读取开放全文，经混合检索后由模型判断论断与原文的关系，每个结论都附可在原文中逐字定位的引句（见 4.4 节）。',
    '（5）贴合论文写作的实际环节：拍照 / 截图识别参考文献、导入文档时检出隐藏提示词、一键规范为 GB/T 7714 或 APA、只贴 DOI 也能补全，并通过 MCP Server 把核验能力开放给其他 AI 工具（见 4.5、5.2–5.4 节）。',
  ] },
  { title: 'AI 技术落地与测试情况概述', paragraphs: [
    '落地情况：项目接入了六项 AI 能力，即受约束的字段解析、对查不到条目的 AI 检索 Agent、标准体检里的中文期刊联网核查、拍照 / 截图识别参考文献、读取开放全文并混合检索的论断核查，以及把核验工具开放给其他 AI 的 MCP Server。前五项在魔搭创空间公网演示中可以直接使用，MCP Server 以 stdio 方式在本地运行。大模型统一使用 DeepSeek（deepseek-flash），中文期刊检索使用 DeepSeek 搜索接口（搜索引擎，不是大模型）。模型和搜索只提供候选或依据，真伪结论由规则或带原文引句的判断给出（见 4.1 节）。',
    '测试情况：自动测试 45 个文件 728 项，用固定的上游响应覆盖边界与回归。AI 能力逐项单独评测：AI 检索 Agent 在首次盲测的 58 条上确认 7 条，没有判为疑似不存在；图片识别在合成印刷体样本上 16/16 逐字一致；论断检索前 6 段命中率由 75% 提高到 100%；隐藏提示词测试夹具全部检出，自家 PDF 无误报。各项评测的样本与适用范围见{表:13:0}。',
    '测试中也用到了 AI：开发方场景测试让 DeepSeek 按三个题目写出 36 条参考文献（其中 11 条编造）作为测试样本（见 6.3 节）；对照实验让 DeepSeek 以四种设置逐条判断同一批 130 条构造引文，与本系统比较（见 6.4 节）。',
  ] },
  { title: '发表、获奖与项目来源', paragraphs: [
    '是否发表过或获奖：待填写（没有的话写“本项目此前未公开发表，也未获奖”）。',
    '是否在其他项目基础上优化：待填写（不是的话写“本项目为本次比赛新开发，不是在其他项目基础上优化”；是的话写明原项目和本次优化的部分）。本项目的代码仓库保留完整开发历史，GitHub 上的首个提交为 2026-10-15。',
  ] },
];
// 界面截图（media/doc-shots/capture.py 在魔搭公网实际操作截取，prepare.py 裁剪），放在对应功能小节末尾；width 单位 cm
const SHOTS_DIR = path.join(HERE, 'media', 'doc-shots');
const SCREENSHOTS = {
  4: [{ id: 'results', file: '01-results.jpg', width: 13, caption: '参考文献体检结果：按“需要处理”筛选并展开字段比对' }],
  5: [{ id: 'cnki', file: '02-cnki.jpg', width: 14, caption: '中文期刊论文经知网原文页核实' }],
  6: [{ id: 'agent', file: '04-agent.jpg', width: 14, caption: 'AI 继续查：结论与检索步骤（中间的字段比对略）' }],
  7: [{ id: 'claim', file: '07-claim.jpg', width: 12, caption: '正文论断核查结果：结论、判断范围与原文引句' }],
  9: [{ id: 'vision', file: '05-vision.jpg', width: 13, caption: '截图识别：原图与可编辑的识别结果' }],
  10: [{ id: 'hidden', file: '06-hidden.jpg', width: 14, caption: '导入 PDF 时检出的隐藏提示词' }],
  12: [{ id: 'standard', file: '03-standard.jpg', width: 13, caption: '一键规范参考文献（GB/T 7714）' }],
};
// 附录 A 末尾：报名表“作品介绍文档”要求与章节对应
const APPENDIX_EXTRA = {
  title: '作品介绍文档要求对应', caption: '作品介绍文档要求与对应章节', headers: ['作品介绍文档要求', '对应章节'], widths: [230, 261],
  rows: [
    ['（1）描述项目详情及使用方式', '第 1–5 章；使用方式见 1.2 节'],
    ['（2）描述项目的亮点', '1.3 节；创新点见第 7 章'],
    ['（3）AI 测试技术落地使用情况概述', '1.4 节；AI 技术方案见第 4 章，测试见第 6 章'],
    ['（4）描述项目中涉及的关键技术', '第 3 章系统架构设计、第 4 章 AI 技术方案、第 5 章核心功能实现'],
    ['（5）项目相关的图片 / 照片', '第 4、5 章的 7 幅界面截图，第 3、4 章的流程图'],
    ['（6）项目之前是否发表过或获奖', '1.5 节'],
    ['（7）若在其他项目基础上优化，说明优化部分', '1.5 节'],
  ],
};

const styles = {
  default: { document: { run: { font: SONG, size: 21 }, paragraph: { spacing: exact(20) } } },
  paragraphStyles: [
    { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Body', quickFormat: true,
      run: { font: HEI, size: 30 }, paragraph: { spacing: { before: 300, after: 200, line: 400, lineRule: LineRuleType.AT_LEAST }, outlineLevel: 0, keepNext: true, keepLines: true } },
    { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Body', quickFormat: true,
      run: { font: HEI, size: 28 }, paragraph: { spacing: { before: 200, after: 120, line: 400, lineRule: LineRuleType.AT_LEAST }, outlineLevel: 1, keepNext: true, keepLines: true } },
    { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Body', quickFormat: true,
      run: { font: HEI, size: 24 }, paragraph: { spacing: { before: 120, after: 60, line: 400, lineRule: LineRuleType.AT_LEAST }, outlineLevel: 2, keepNext: true, keepLines: true } },
    { id: 'Body', name: 'Body', basedOn: 'Normal', next: 'Body', quickFormat: true,
      paragraph: { alignment: AlignmentType.JUSTIFIED, indent: { firstLine: 420 }, spacing: exact(20) } },
    { id: 'Note', name: 'Note', basedOn: 'Normal', next: 'Body', quickFormat: true,
      run: { size: 18 }, paragraph: { alignment: AlignmentType.LEFT, spacing: { before: 60, ...exact(14) } } },
    { id: 'TableText', name: 'Table Text', basedOn: 'Normal', quickFormat: true, run: { size: 18 }, paragraph: { spacing: exact(14) } },
    { id: 'TableHead', name: 'Table Head', basedOn: 'TableText', quickFormat: true, run: { font: HEI } },
    { id: 'Caption', name: 'caption', basedOn: 'Normal', next: 'Body', quickFormat: true,
      run: { font: HEI, size: 21 }, paragraph: { alignment: AlignmentType.CENTER, spacing: { before: 120, after: 60, ...exact(20) } } },
    { id: 'TOC1', name: 'toc 1', basedOn: 'Normal', next: 'Normal', run: { font: HEI, size: 21 }, paragraph: { spacing: { before: 40, ...exact(15.5) } } },
    { id: 'TOC2', name: 'toc 2', basedOn: 'Normal', next: 'Normal', run: { size: 21 }, paragraph: { indent: { left: 420 }, spacing: exact(15.5) } },
  ],
};

/** 文本里的换行拆成多段；页数占位换成 NUMPAGES 域；间隔号、连接号单独成段按西文字体排 */
const textRuns = (text, opts = {}) => text.split(NARROW).filter(Boolean).map((part) => new TextRun({ text: part, ...opts, ...(NARROW.test(part) ? { font: LATIN } : {}) }));
function runs(text) {
  return fix(text).split(PAGES_FIELD).flatMap((part, i) => [...(i ? [new TextRun({ children: [PageNumber.TOTAL_PAGES] })] : []), ...textRuns(part)]);
}
const paras = (text, style, extra = {}) => fix(text).split('\n').map((line) => new Paragraph({ style, ...extra, children: runs(line) }));
const gap = (pt, keepNext = false) => new Paragraph({ keepNext, spacing: exact(pt), children: [] });

function cell(lines, width, { style = 'TableText', borders = {}, align, margins = { top: 30, bottom: 30, left: 100, right: 100 }, keepNext = false } = {}) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA }, borders, margins, verticalAlign: VerticalAlign.CENTER,
    children: lines.flatMap((line) => paras(line, style, { keepNext, ...(align ? { alignment: align } : {}) })),
  });
}

/** 三线表：表头上下各一条线，表尾一条线，不用竖线和底色 */
function dataTable(block) {
  const scale = WIDTH / (block.widths ?? []).reduce((a, b) => a + b, 0);
  const widths = block.widths ? block.widths.map((w) => Math.floor(w * scale)) : block.headers.map(() => Math.floor(WIDTH / block.headers.length));
  widths[widths.length - 1] += WIDTH - widths.reduce((a, b) => a + b, 0);
  const rows = block.rows.filter((row) => !DROP_ROWS.has(row[0]));
  return new Table({
    width: { size: WIDTH, type: WidthType.DXA }, columnWidths: widths,
    borders: { top: rule(12), bottom: rule(12), left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE },
    rows: [
      new TableRow({ tableHeader: true, cantSplit: true, children: block.headers.map((h, j) => cell([h], widths[j], { style: 'TableHead', borders: { bottom: rule(6) } })) }),
      ...rows.map((row) => new TableRow({ cantSplit: true, children: row.map((v, j) => cell([String(v)], widths[j])) })),
    ],
  });
}

/** 流程图：每行一排细线框，框间加箭头 */
function figure(block) {
  const out = [];
  block.lanes.forEach((lane, row) => {
    const arrow = 400;
    const box = Math.floor((WIDTH - arrow * (lane.length - 1)) / lane.length);
    const widths = lane.flatMap((_, j) => (j < lane.length - 1 ? [box, arrow] : [WIDTH - (box + arrow) * (lane.length - 1)]));
    const frame = { top: rule(6), bottom: rule(6), left: rule(6), right: rule(6) };
    const cells = lane.flatMap((text, j) => {
      const node = cell(text.split('\n'), widths[j * 2], { borders: frame, align: AlignmentType.CENTER, margins: { top: 60, bottom: 60, left: 100, right: 100 }, keepNext: true });
      if (j === lane.length - 1) return [node];
      return [node, cell(['→'], arrow, { borders: { top: NONE, bottom: NONE, left: NONE, right: NONE }, align: AlignmentType.CENTER, margins: { top: 0, bottom: 0, left: 0, right: 0 }, keepNext: true })];
    });
    out.push(new Table({
      width: { size: WIDTH, type: WidthType.DXA }, columnWidths: widths, borders: { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE },
      rows: [new TableRow({ cantSplit: true, height: { value: 860, rule: HeightRule.ATLEAST }, children: cells })],
    }));
    out.push(gap(row < block.lanes.length - 1 ? 8 : 4, true));
  });
  return out;
}

/** JPEG 的宽、高（读 SOF 段） */
function jpegSize(buf) {
  for (let i = 2; i < buf.length;) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker >= 0xc0 && marker <= 0xc3) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
    i += 2 + buf.readUInt16BE(i + 2);
  }
  throw new Error('不是 JPEG');
}

/** 界面截图居中，图题在下；图片段落用自动行距，固定行距会把图片裁掉 */
function screenshot(shot, captionText) {
  const data = fs.readFileSync(path.join(SHOTS_DIR, shot.file));
  const [w, h] = jpegSize(data);
  const width = Math.round((shot.width / 2.54) * 96);
  return [
    new Paragraph({ alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: 120, line: 240, lineRule: LineRuleType.AUTO },
      children: [new ImageRun({ type: 'jpg', data, transformation: { width, height: Math.round((width * h) / w) }, altText: { title: shot.caption, description: shot.caption, name: shot.id } })] }),
    ...paras(captionText, 'Caption', { spacing: { before: 60, after: 120, ...exact(20) } }),
  ];
}

// ---------- 正文 ----------
const body = [];
const counters = { table: 0, figure: 0 };
function heading(level, text) {
  const map = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3 };
  body.push(new Paragraph({ heading: map[level], children: [new TextRun(text)] }));
}

/** 一页内容放进当前章节；sub 生成下一级小节号 */
function emit(pageIndex, chapter, sub, level) {
  const page = DATA.pages[pageIndex];
  const caption = (kind, key, title = CAPTIONS[key]) => {
    const label = `${kind === 'table' ? '表' : '图'} ${chapter}-${++counters[kind]}`;
    REFS[`${label[0]}:${key}`] = label;
    return `${label}　${title}`;
  };
  const prelude = PRELUDE[pageIndex];
  if (prelude) {
    heading(level, `${sub()}　${prelude.title}`);
    for (const text of prelude.paragraphs) body.push(...paras(text, 'Body'));
  }
  if (HEADING_BEFORE[`${pageIndex}:lead`]) heading(level, `${sub()}　${HEADING_BEFORE[`${pageIndex}:lead`]}`);
  if (page.lead) body.push(...paras(page.lead, 'Body'));
  page.blocks.forEach((block, j) => {
    const key = `${pageIndex}:${j}`;
    if (HEADING_BEFORE[key]) heading(level, `${sub()}　${HEADING_BEFORE[key]}`);
    if (block.type === 'section') {
      heading(level, `${sub()}　${block.title}`);
      for (const text of block.paragraphs) body.push(...paras(text, 'Body'));
    } else if (block.type === 'table') {
      body.push(...paras(caption('table', key), 'Caption', { keepNext: true }), dataTable(block), gap(6));
    } else if (block.type === 'diagram') {
      body.push(gap(4, true), ...figure(block), ...paras(caption('figure', key), 'Caption', { spacing: { before: 60, after: 120, ...exact(20) } }));
    } else if (block.type === 'callout') {
      body.push(...paras(block.text, 'Body'));
    } else if (block.type === 'small') {
      body.push(...paras(block.text, 'Note'));
    } else {
      throw new Error(`未知的内容块：${block.type}`);
    }
  });
  for (const shot of SCREENSHOTS[pageIndex] ?? []) body.push(...screenshot(shot, caption('figure', shot.id, shot.caption)));
  if (pageIndex === 0) {
    for (const section of INTRO) {
      heading(level, `${sub()}　${section.title}`);
      for (const text of section.paragraphs) body.push(...paras(text, 'Body'));
    }
  }
  if (pageIndex === 20) {
    heading(level, `${sub()}　${APPENDIX_EXTRA.title}`);
    body.push(...paras(caption('table', 'A2', APPENDIX_EXTRA.caption), 'Caption', { keepNext: true }), dataTable(APPENDIX_EXTRA), gap(6));
  }
}

function buildBody() {
  body.length = 0;
  let chapterNo = 0;
  for (const chapter of OUTLINE) {
    const label = chapter.appendix ?? String(++chapterNo);
    counters.table = 0; counters.figure = 0;
    heading(1, chapter.appendix ? `附录 ${label}　${chapter.title}` : `${label}　${chapter.title}`);
    if (chapter.page !== undefined) {
      let n = 0;
      emit(chapter.page, label, () => `${label}.${++n}`, 2);
    } else {
      chapter.children.forEach((child, i) => {
        const num = `${label}.${i + 1}`;
        heading(2, `${num}　${child.title}`);
        let n = 0;
        for (const page of child.pages ?? [child.page]) emit(page, label, () => `${num}.${++n}`, 3);
      });
    }
  }
}
// 第一遍得到图表编号，第二遍把正文里的 {图:…}、{表:…} 换成编号
buildBody();
buildBody();

// ---------- 封面、目录 ----------
const center = (text, font, size, before = 0, after = 0) =>
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before, after, line: Math.round(size * 15), lineRule: LineRuleType.AT_LEAST }, children: [new TextRun({ text, font, size })] });
const FIELDS = [['作品名称', '引用体检'], ['参赛赛道', 'AI WEB 网页开发挑战赛'], ['学　　校', '待填写'], ['队伍名称', '待填写'], ['队　　员', '待填写'], ['指导老师', '待填写'], ['完成日期', '待填写']];
const infoWidths = [1700, 4300];
const cover = [
  center('第九届传智杯全国大学生数智创新与AI应用大赛', HEI, 32, 1200, 160),
  center('AI WEB 网页开发挑战赛', HEI, 32, 0, 0),
  center('引用体检', HEI, 72, 2000, 240),
  center('受约束文献核验与论断证据核查', HEI, 36, 0, 480),
  center('技术说明', HEI, 52, 0, 1800),
  new Table({
    width: { size: infoWidths[0] + infoWidths[1], type: WidthType.DXA }, columnWidths: infoWidths, alignment: AlignmentType.CENTER,
    borders: { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE },
    rows: FIELDS.map(([label, value]) => new TableRow({ height: { value: 640, rule: HeightRule.ATLEAST }, children: [
      new TableCell({ width: { size: infoWidths[0], type: WidthType.DXA }, verticalAlign: VerticalAlign.BOTTOM, children: [new Paragraph({ children: [new TextRun({ text: `${label}：`, font: HEI, size: 28 })] })] }),
      new TableCell({ width: { size: infoWidths[1], type: WidthType.DXA }, verticalAlign: VerticalAlign.BOTTOM, borders: { bottom: rule(6) },
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: value, size: 28 })] })] }),
    ] })),
  }),
];
const toc = [
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240, line: 480, lineRule: LineRuleType.AT_LEAST }, children: [new TextRun({ text: '目　录', font: HEI, size: 32 })] }),
  new TableOfContents('目录', { hyperlink: true, headingStyleRange: '1-2' }),
];

const blank = () => ({ default: new Header({ children: [new Paragraph({ children: [] })] }) });
const blankFooter = () => ({ default: new Footer({ children: [new Paragraph({ children: [] })] }) });
const header = new Header({
  children: [new Paragraph({ alignment: AlignmentType.CENTER, border: { bottom: { ...rule(6), space: 2 } }, spacing: exact(14),
    children: textRuns('引用体检：受约束文献核验与论断证据核查 · 技术说明', { size: 18 }) })],
});
const footer = new Footer({
  children: [new Paragraph({ alignment: AlignmentType.CENTER, spacing: exact(14),
    children: [new TextRun({ children: ['第 ', PageNumber.CURRENT, ' 页 共 ', PageNumber.TOTAL_PAGES_IN_SECTION, ' 页'], size: 18 })] })],
});

const doc = new Document({
  creator: '引用体检项目组', lastModifiedBy: '引用体检项目组', title: DATA.title,
  subject: '受约束文献核验与论断证据核查技术说明', description: '第九届传智杯 AI WEB 网页开发挑战赛 · 技术说明',
  styles,
  sections: [
    { properties: { page: PAGE }, headers: blank(), footers: blankFooter(), children: cover },
    { properties: { page: PAGE }, headers: blank(), footers: blankFooter(), children: toc },
    { properties: { page: { ...PAGE, pageNumbers: { start: 1 } } }, headers: { default: header }, footers: { default: footer }, children: body },
  ],
});

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, await Packer.toBuffer(doc));
console.log(JSON.stringify({ docx: OUT, tables: Object.keys(CAPTIONS).length }));
