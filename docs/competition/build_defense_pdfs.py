"""把答辩准备手册和答辩问答（Markdown）排成 A4 PDF，方便直接发给队员。

用法：python docs/competition/build_defense_pdfs.py
需要 pandoc（Markdown 转网页）和 Playwright（用 Chromium 打印成 PDF）。不联网、不调用模型。
文中指向仓库文件的相对链接换成 GitHub 上的地址，PDF 里也能点开。
"""
from pathlib import Path
import html
import re
import subprocess

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
OUT = HERE / 'output' / 'pdf'
OUT.mkdir(parents=True, exist_ok=True)
REPO = 'https://github.com/newhack-cpu/cite-checkup/blob/main/'
DOCS = [
    ('DEFENSE_BRIEFING.md', '引用体检-答辩准备手册.pdf', '引用体检 · 答辩准备手册（队员版）', True),
    ('DEFENSE_QA.md', '引用体检-答辩问答.pdf', '引用体检 · 答辩问答', False),
]

CSS = '''
@page { size: A4; margin: 17mm 16mm 18mm 16mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; color: #252822; background: #fff; font: 10.4pt/1.75 "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif; }
h1 { font-size: 21pt; line-height: 1.35; margin: 0 0 10pt; padding-bottom: 9pt; border-bottom: 1.2pt solid #943e32; }
h2 { font-size: 14.5pt; color: #943e32; margin: 20pt 0 7pt; padding-bottom: 3pt; border-bottom: .6pt solid #d8d3c4; break-after: avoid; }
h3 { font-size: 11.6pt; margin: 14pt 0 5pt; break-after: avoid; }
p { margin: 0 0 7pt; }
ul, ol { margin: 0 0 7pt; padding-left: 18pt; }
li { margin: 1.5pt 0; }
li > p { margin: 0; }
a { color: #943e32; text-decoration: none; word-break: break-all; }
strong { color: #1b1d18; }
blockquote { margin: 0 0 10pt; padding: 7pt 11pt; background: #f0eee6; border-left: 3pt solid #943e32; color: #4a4b43; }
blockquote p { margin: 0 0 3pt; }
code { font: 9pt "Consolas", "Microsoft YaHei", monospace; background: #f0eee6; padding: 0 2.5pt; border-radius: 2pt; word-break: break-all; }
pre { font: 8.4pt/1.5 "Consolas", "Microsoft YaHei", monospace; background: #f3f1ea; border: .6pt solid #d8d3c4; padding: 8pt 10pt; white-space: pre-wrap; break-inside: avoid; margin: 0 0 9pt; }
pre code { background: none; padding: 0; font: inherit; word-break: normal; }
table { width: 100%; border-collapse: collapse; margin: 4pt 0 11pt; font-size: 9.3pt; line-height: 1.55; }
thead { display: table-header-group; }
th { background: #943e32; color: #fff; text-align: left; font-weight: 600; padding: 4.5pt 6pt; }
td { padding: 4.5pt 6pt; vertical-align: top; border-bottom: .5pt solid #e2ddd0; }
tr { break-inside: avoid; }
tbody tr:nth-child(even) td { background: #f5f3ec; }
hr { border: 0; border-top: .6pt solid #d8d3c4; margin: 14pt 0; }
.qa section.level3 { break-inside: avoid; }
nav.toc { margin: 0 0 14pt; padding: 8pt 12pt; border: .6pt solid #d8d3c4; background: #f8f6f0; columns: 2; column-gap: 18pt; font-size: 9.6pt; }
nav.toc div { break-inside: avoid; }
nav.toc .title { column-span: all; font-weight: 600; color: #943e32; margin-bottom: 3pt; }
'''


def absolute_links(markdown: str, source: Path) -> str:
    """相对链接（文件、目录）改成 GitHub 地址；网址和页内锚点不动"""
    def repl(m: re.Match) -> str:
        target = m.group(2)
        if re.match(r'^(?:https?:|mailto:|#)', target):
            return m.group(0)
        path = (source.parent / target).resolve().relative_to(ROOT).as_posix()
        return f'{m.group(1)}({REPO}{path})'
    return re.sub(r'(\[[^\]]*\])\(([^)\s]+)\)', repl, markdown)


def to_html(markdown: str, title: str, toc: bool) -> str:
    # pandoc 在 Windows 上输出 CRLF；<pre> 里的换行要统一成 LF，否则代码块会多出空行
    body = subprocess.run(
        ['pandoc', '-f', 'gfm', '-t', 'html5', '--section-divs'],
        input=markdown.encode('utf-8'), capture_output=True, check=True,
    ).stdout.decode('utf-8').replace('\r\n', '\n')
    if toc:
        # --section-divs 把锚点放在外层 <section> 上
        items = re.findall(r'<section id="([^"]+)" class="level2">\s*<h2>(.*?)</h2>', body)
        nav = ''.join(f'<div><a href="#{i}">{t}</a></div>' for i, t in items)
        body = body.replace('</h1>', f'</h1><nav class="toc"><div class="title">目录</div>{nav}</nav>', 1)
    # 问答一题一节，整节不拆页；手册的小节很长，允许跨页
    kind = 'brief' if toc else 'qa'
    return f'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>{html.escape(title)}</title><style>{CSS}</style></head><body class="{kind}">{body}</body></html>'


FOOTER = '''<div style="width:100%;font:7.5pt 'Microsoft YaHei',sans-serif;color:#66675e;padding:0 16mm;display:flex;justify-content:space-between">
<span>{title}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>'''

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    for name, pdf_name, title, toc in DOCS:
        source = HERE / name
        # 样式都内联在网页里，直接交给浏览器渲染，不落临时文件
        page.set_content(to_html(absolute_links(source.read_text(encoding='utf-8'), source), title, toc), wait_until='networkidle')
        page.pdf(
            path=str(OUT / pdf_name), format='A4', print_background=True, display_header_footer=True,
            header_template='<div></div>', footer_template=FOOTER.format(title=html.escape(title)),
            margin={'top': '17mm', 'bottom': '18mm', 'left': '16mm', 'right': '16mm'},
        )
        print(OUT / pdf_name)
    browser.close()
