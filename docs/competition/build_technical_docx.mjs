/**
 * 技术说明的 Word 版：内容和 build_technical_report.py 生成的 PDF 同源（technical-content.json），
 * 给参赛者自己填团队信息，再用 Word 另存为 PDF。
 *
 * 用法：node docs/competition/build_technical_docx.mjs
 * 需要 docx（npm install -g docx），项目里没装时到 npm 全局目录找。不联网、不调用模型。
 * 版心、字号、行距照 PDF 设置，每个 page 占一页（页标题用“标题 1”，小节用“标题 2”）。
 * 和 PDF 只差三处：团队那一行换成“待填写”，材料日期去掉“技术验收版”，页脚不再写“团队身份信息待补充”。
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
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, Header, Footer, HeadingLevel,
  AlignmentType, BorderStyle, WidthType, ShadingType, VerticalAlign, PageNumber, TabStopType,
  LineRuleType, HeightRule,
} = await loadDocx();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = JSON.parse(fs.readFileSync(path.join(HERE, 'technical-content.json'), 'utf8').replace(/^﻿/, ''));
const OUT = path.join(HERE, 'output', 'docx', '引用体检-技术说明.docx');

// 单位 DXA（1pt = 20）。A4，左右各 52pt，正文宽 491pt，与 PDF 相同
const PAGE = { width: 11906, height: 16838 };
const SIDE = 1040;
const WIDTH = PAGE.width - 2 * SIDE;
const INK = '252822', MUTED = '66675E', RED = '943E32', RULE = 'D8D3C4', GREEN = '416451';
// hint=eastAsia：弯引号、间隔号这类中西文共用的字符按中文字体排（全角），和 PDF 一致
const SONG = { ascii: 'Times New Roman', hAnsi: 'Times New Roman', cs: 'Times New Roman', eastAsia: 'SimSun', hint: 'eastAsia' };
const HEI = { ascii: 'Arial', hAnsi: 'Arial', cs: 'Arial', eastAsia: 'SimHei', hint: 'eastAsia' };
const NONE = { style: BorderStyle.NONE, size: 0, color: 'auto' };
const NO_BORDERS = { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE };
const exact = (pt) => ({ line: Math.round(pt * 20), lineRule: LineRuleType.EXACT });

// 团队信息由参赛者自己填，Word 里只留位置
const ROW_OVERRIDES = {
  '学校、队伍与成员': ['学校：待填写　　队伍名称：待填写', '队员与分工：待填写', '指导老师：待填写'],
  '材料日期': ['2026-10-23'],
};
const FOOTER_TEXT = '引用体检 · 技术说明 · 2026-10-23';

const styles = {
  default: {
    document: { run: { font: SONG, size: 21, color: INK }, paragraph: { spacing: exact(17.8) } },
  },
  paragraphStyles: [
    {
      id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Body', quickFormat: true,
      run: { font: HEI, size: 46, color: INK },
      paragraph: {
        spacing: { before: 0, after: 240, ...exact(30) }, outlineLevel: 0, keepNext: true, keepLines: true,
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE, space: 8 } },
      },
    },
    {
      id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Body', quickFormat: true,
      run: { font: HEI, size: 28, color: RED },
      paragraph: { spacing: { before: 180, after: 160, line: 420, lineRule: LineRuleType.AT_LEAST }, outlineLevel: 1, keepNext: true, keepLines: true },
    },
    {
      id: 'Body', name: 'Body', basedOn: 'Normal', next: 'Body', quickFormat: true,
      paragraph: { alignment: AlignmentType.JUSTIFIED, spacing: { after: 180, ...exact(17.8) } },
    },
    {
      id: 'Small', name: 'Small', basedOn: 'Normal', next: 'Body', quickFormat: true,
      run: { size: 17, color: MUTED },
      paragraph: { alignment: AlignmentType.JUSTIFIED, spacing: { after: 120, ...exact(13.8) } },
    },
    {
      id: 'TableText', name: 'Table Text', basedOn: 'Normal', quickFormat: true,
      run: { size: 18 }, paragraph: { spacing: { after: 0, ...exact(14.8) } },
    },
    {
      id: 'TableHead', name: 'Table Head', basedOn: 'TableText', quickFormat: true,
      run: { font: HEI, size: 19, color: 'FFFFFF' },
    },
    {
      id: 'Callout', name: 'Callout', basedOn: 'Normal', quickFormat: true,
      run: { font: HEI, size: 22, color: GREEN }, paragraph: { spacing: { after: 0, ...exact(18) } },
    },
  ],
};

/** 文本里的换行拆成多段 */
const paras = (text, style, extra = {}) =>
  String(text).split('\n').map((line) => new Paragraph({ style, ...extra, children: [new TextRun(line)] }));

/** 表格、图示之后的空白（PDF 里的 Spacer） */
const gap = (pt) => new Paragraph({ spacing: { after: 0, ...exact(pt) }, children: [] });

function cell(lines, width, { style = 'TableText', fill, borders, margins, align, valign = VerticalAlign.TOP } = {}) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: fill ? { fill, type: ShadingType.CLEAR, color: 'auto' } : undefined,
    borders: borders ?? { top: NONE, bottom: NONE, left: NONE, right: NONE },
    // PDF 的单元格上下各留 8pt；Word 版收到 5pt，给第 1 页填团队信息留出余量
    margins: margins ?? { top: 100, bottom: 100, left: 180, right: 180 },
    verticalAlign: valign,
    children: lines.flatMap((line) => paras(line, style, align ? { alignment: align } : {})),
  });
}

/** PDF 给的列宽单位是 pt、合计 491；换成 DXA 后把零头补到最后一列，合计等于正文宽 */
function columnWidths(block) {
  const widths = (block.widths ?? block.headers.map(() => 491 / block.headers.length)).map((w) => Math.round(w * 20));
  widths[widths.length - 1] += WIDTH - widths.reduce((a, b) => a + b, 0);
  return widths;
}

function dataTable(block, pageIndex) {
  const widths = columnWidths(block);
  const last = block.rows.length - 1;
  const head = new TableRow({
    tableHeader: true, cantSplit: true,
    children: block.headers.map((h, j) => cell([h], widths[j], { style: 'TableHead', fill: RED })),
  });
  const rows = block.rows.map((row, i) => {
    const values = pageIndex === 0 && ROW_OVERRIDES[row[0]] ? [[row[0]], ROW_OVERRIDES[row[0]]] : row.map((v) => [String(v)]);
    const bottom = i === last ? { style: BorderStyle.SINGLE, size: 4, color: RULE } : NONE;
    return new TableRow({
      cantSplit: true,
      children: values.map((lines, j) => cell(lines, widths[j], {
        fill: i % 2 === 0 ? 'F0EEE6' : 'FCFBF7', borders: { top: NONE, bottom, left: NONE, right: NONE },
      })),
    });
  });
  return [new Table({ width: { size: WIDTH, type: WidthType.DXA }, columnWidths: widths, borders: NO_BORDERS, rows: [head, ...rows] }), gap(11)];
}

function callout(block) {
  const line = { style: BorderStyle.SINGLE, size: 4, color: 'C8D5C5' };
  return [
    new Table({
      width: { size: WIDTH, type: WidthType.DXA }, columnWidths: [WIDTH], borders: NO_BORDERS,
      rows: [new TableRow({ children: [cell([block.text], WIDTH, {
        style: 'Callout', fill: 'E8EFE7', borders: { top: line, bottom: line, left: line, right: line },
        margins: { top: 170, bottom: 170, left: 260, right: 260 },
      })] })],
    }),
    gap(10),
  ];
}

/** 流程图：每一行是一排方框，框与框之间放红色箭头；和 PDF 一样框高 63pt、行距 86pt */
function diagram(block) {
  const out = [];
  block.lanes.forEach((lane, row) => {
    const arrow = 340;
    const box = Math.floor((WIDTH - arrow * (lane.length - 1)) / lane.length);
    const widths = lane.flatMap((_, j) => (j < lane.length - 1 ? [box, arrow] : [WIDTH - (box + arrow) * (lane.length - 1)]));
    const edge = { style: BorderStyle.SINGLE, size: 4, color: RULE };
    const fill = row % 2 === 0 ? 'EEEADE' : 'E6EEE7';
    const cells = lane.flatMap((text, j) => {
      const node = cell(text.split('\n'), widths[j * 2], {
        fill, borders: { top: edge, bottom: edge, left: edge, right: edge },
        margins: { top: 60, bottom: 60, left: 140, right: 140 }, align: AlignmentType.CENTER, valign: VerticalAlign.CENTER,
      });
      if (j === lane.length - 1) return [node];
      const link = new TableCell({
        width: { size: arrow, type: WidthType.DXA }, borders: { top: NONE, bottom: NONE, left: NONE, right: NONE },
        margins: { top: 0, bottom: 0, left: 0, right: 0 }, verticalAlign: VerticalAlign.CENTER,
        children: [new Paragraph({ style: 'TableText', alignment: AlignmentType.CENTER, children: [new TextRun({ text: '→', color: RED, bold: true })] })],
      });
      return [node, link];
    });
    out.push(new Table({
      width: { size: WIDTH, type: WidthType.DXA }, columnWidths: widths, borders: NO_BORDERS,
      rows: [new TableRow({ cantSplit: true, height: { value: 1260, rule: HeightRule.EXACT }, children: cells })],
    }));
    out.push(gap(row < block.lanes.length - 1 ? 23 : 14));
  });
  return out;
}

const children = [];
DATA.pages.forEach((page, index) => {
  children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: index > 0, children: [new TextRun(page.title)] }));
  if (page.lead) children.push(...paras(page.lead, 'Body', { spacing: { after: 280, ...exact(17.8) } }));
  for (const block of page.blocks) {
    if (block.type === 'section') {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(block.title)] }));
      for (const text of block.paragraphs) children.push(...paras(text, 'Body'));
    } else if (block.type === 'table') {
      children.push(...dataTable(block, index));
    } else if (block.type === 'callout') {
      children.push(...callout(block));
    } else if (block.type === 'diagram') {
      children.push(...diagram(block));
    } else if (block.type === 'small') {
      children.push(...paras(block.text, 'Small'));
    } else {
      throw new Error(`未知的内容块：${block.type}`);
    }
  }
});

const tabs = [{ type: TabStopType.RIGHT, position: WIDTH }];
const header = new Header({
  children: [new Paragraph({
    tabStops: tabs, spacing: { after: 0, ...exact(14) },
    border: { top: { style: BorderStyle.SINGLE, size: 36, color: RED, space: 6 } },
    children: [
      new TextRun({ text: '引用体检  /  CITE CHECKUP', font: HEI, size: 18, color: INK }),
      new TextRun({ text: '\tAI WEB 网页开发挑战赛 · 技术说明', size: 16, color: MUTED }),
    ],
  })],
});
const footer = new Footer({
  children: [new Paragraph({
    tabStops: tabs, spacing: { after: 0, ...exact(12) },
    border: { top: { style: BorderStyle.SINGLE, size: 4, color: RULE, space: 6 } },
    children: [
      new TextRun({ text: FOOTER_TEXT, size: 16, color: MUTED }),
      new TextRun({ text: '\t', size: 16 }),
      new TextRun({ children: [PageNumber.CURRENT, ' / ', PageNumber.TOTAL_PAGES], size: 16, color: MUTED }),
    ],
  })],
});

const doc = new Document({
  creator: '引用体检项目组',
  lastModifiedBy: '引用体检项目组',
  title: DATA.title,
  subject: '受约束文献核验与论断证据核查技术说明',
  description: '第九届传智杯 AI WEB 网页开发挑战赛 · 技术说明（Word 版）',
  styles,
  sections: [{
    properties: {
      page: {
        size: PAGE,
        margin: { top: 1240, bottom: 1220, left: SIDE, right: SIDE, header: 560, footer: 480 },
      },
    },
    headers: { default: header },
    footers: { default: footer },
    children,
  }],
});

fs.mkdirSync(path.dirname(OUT), { recursive: true });
Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync(OUT, buffer);
  console.log(JSON.stringify({ docx: OUT, pages: DATA.pages.length }));
});
