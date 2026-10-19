// 把本项目生成的报告 Markdown 转成可以直接双击打开、打印成 PDF 的网页（可用性走查：老师多半不会打开 .md）。
// 只处理报告里用到的写法：#/##/### 标题、"- " 列表和普通段落；特殊字符在生成 Markdown 时已用反斜杠转义。

const unescapeMarkdown = (s: string) => s.replace(/\\([\\`*_{}[\]<>#|])/g, "$1");
const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** 行内文字：先还原 Markdown 转义，再做 HTML 转义，最后把网址做成链接 */
function inline(text: string): string {
  return escapeHtml(unescapeMarkdown(text)).replace(/https?:\/\/[^\s<>"'，；。、）)]+/g, (url) => `<a href="${url}">${url}</a>`);
}

const STYLE = `
:root { color-scheme: light; }
body { margin: 0; background: #f2ecdf; color: #252822; font: 15px/1.75 "Songti SC", "Noto Serif SC", "Source Han Serif SC", SimSun, serif; }
main { max-width: 820px; margin: 24px auto; background: #fbf8f1; padding: 36px 48px; box-shadow: 0 2px 16px rgba(0,0,0,.06); }
h1 { font-size: 26px; margin: 0 0 12px; color: #943e32; }
h2 { font-size: 18px; margin: 28px 0 8px; padding-top: 14px; border-top: 1px dashed #d8d3c4; }
h3 { font-size: 15px; margin: 18px 0 6px; }
p { margin: 6px 0; }
ul { margin: 6px 0; padding-left: 1.4em; }
li { margin: 3px 0; }
a { color: #943e32; word-break: break-all; }
.tip { font-size: 13px; color: #6d6458; margin-bottom: 18px; }
@media print {
  body { background: #fff; }
  main { margin: 0; max-width: none; box-shadow: none; padding: 0; }
  .tip { display: none; }
  h2, h3 { break-after: avoid; }
}
@page { margin: 16mm; }
`;

export function reportHtml(markdown: string, title: string): string {
  const out: string[] = [];
  let inList = false;
  const closeList = () => {
    if (inList) out.push("</ul>");
    inList = false;
  };
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.trim()) {
      closeList();
      continue;
    }
    const heading = line.match(/^(#{1,3}) (.*)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
    } else if (line.startsWith("- ")) {
      if (!inList) out.push("<ul>");
      inList = true;
      out.push(`<li>${inline(line.slice(2))}</li>`);
    } else {
      closeList();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  return [
    "<!doctype html>",
    '<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body><main>`,
    '<p class="tip">用浏览器打开即可阅读；需要纸质版或 PDF 时，按 Ctrl+P（Mac 为 ⌘+P）打印或另存为 PDF。</p>',
    ...out,
    "</main></body></html>",
  ].join("\n");
}

/** 本地时间“2026-10-19 20:55（UTC+8）”，用于报告里的生成时间；ISO 的 UTC 时间老师看不懂 */
export function localTime(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const offset = -d.getTimezoneOffset();
  const zone = `UTC${offset >= 0 ? "+" : "-"}${Math.floor(Math.abs(offset) / 60)}${Math.abs(offset) % 60 ? `:${pad(Math.abs(offset) % 60)}` : ""}`;
  return `${localDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}（${zone}）`;
}

/** 本地日期 YYYY-MM-DD，用于文件名；toISOString 是 UTC，北京时间 0–8 点会差一天 */
export function localDate(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 在浏览器里把文本存成文件 */
export function saveFile(content: string, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
