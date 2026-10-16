"""Build the reviewed technical PDF and a self-contained editable HTML source.

Run from any directory: python docs/competition/build_technical_report.py
Content comes from technical-content.json. No network or model calls are made.
"""
from pathlib import Path
import json
import html
import re
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import Paragraph, Table, TableStyle, Spacer, Flowable, Frame
import reportlab.platypus.paragraph as rl_paragraph

# reportlab 的避头规则只收了日文标点；补上中文全角逗号、冒号、分号、问号、叹号和后引号，不让它们出现在行首
rl_paragraph.ALL_CANNOT_START += '，：；？！”’》」'

HERE = Path(__file__).resolve().parent
OUT = HERE / 'output' / 'pdf'
OUT.mkdir(parents=True, exist_ok=True)
DATA = json.loads((HERE / 'technical-content.json').read_text(encoding='utf-8-sig'))
PDF = OUT / '引用体检-技术说明.pdf'
HTML = HERE / 'technical-report.html'
W, H = 595.276, 841.89
INK = colors.HexColor('#252822')
MUTED = colors.HexColor('#66675e')
RED = colors.HexColor('#943e32')
RULE = colors.HexColor('#d8d3c4')
PAPER = colors.HexColor('#fcfbf7')
GREEN = colors.HexColor('#416451')
pdfmetrics.registerFont(TTFont('CN', r'C:\Windows\Fonts\simsun.ttc', subfontIndex=0))
pdfmetrics.registerFont(TTFont('CNHead', r'C:\Windows\Fonts\simhei.ttf'))
STYLES = {
    'body': ParagraphStyle('body', fontName='CN', fontSize=10.6, leading=17.8, textColor=INK, spaceAfter=9, wordWrap='CJK'),
    'small': ParagraphStyle('small', fontName='CN', fontSize=8.6, leading=13.8, textColor=MUTED, spaceAfter=6, wordWrap='CJK'),
    'heading': ParagraphStyle('heading', fontName='CNHead', fontSize=14.3, leading=21, textColor=RED, spaceBefore=9, spaceAfter=8, wordWrap='CJK'),
    'table': ParagraphStyle('table', fontName='CN', fontSize=9.2, leading=14.8, textColor=INK, wordWrap='CJK'),
    'tablehead': ParagraphStyle('tablehead', fontName='CNHead', fontSize=9.5, leading=15, textColor=colors.white, wordWrap='CJK'),
    'callout': ParagraphStyle('callout', fontName='CNHead', fontSize=11, leading=18, textColor=GREEN, wordWrap='CJK'),
}

CLOSING = set('，。、；：？！）》」』”’】〕…%')
OPENING = set('（《「『“‘【〔')
# 英文、数字及其间的标点和短横（"10–12"、"5.5–5.8"）作为一个断行单位
UNIT_RE = re.compile(r'[A-Za-z0-9@#&+_/.:=~*^<>|\'",;!?()\[\]±–-]+|\s|.')

def prewrap(text, style, width):
    """正文自己断行：英文单词不拆开，闭合标点挂在行尾、不出现在行首，开括号不留在行尾。"""
    font, size = STYLES[style].fontName, STYLES[style].fontSize
    hard = width + 3  # 版心实际宽度；挂在行尾的标点不能超过它，否则 reportlab 会再折一次
    lines = []
    for raw in text.split('\n'):
        units = []
        for unit in UNIT_RE.findall(raw):
            used = stringWidth(''.join(units), font, size)
            w = stringWidth(unit, font, size)
            overflow = used + w > width
            hang = unit[0] in CLOSING and used + w <= hard
            if units and overflow and not hang:
                carry = []
                # 闭合标点挂不下：把前一个字一起带到下一行；开括号、前引号不留在行尾
                if unit[0] in CLOSING and len(units) > 1:
                    carry.insert(0, units.pop())
                while units and units[-1] in OPENING:
                    carry.insert(0, units.pop())
                lines.append(''.join(units).rstrip())
                units = carry
                if unit.isspace():
                    continue
            units.append(unit)
        lines.append(''.join(units).rstrip())
    return lines

# 正文框宽 491；预断行时留 3pt 余量，避免和 reportlab 自己的测量差一点而又折出一行
BODY_WIDTH = 488

def para(text, style='body', width=None):
    if width:
        return Paragraph('<br/>'.join(html.escape(line) for line in prewrap(text, style, width)), STYLES[style])
    return Paragraph(html.escape(text).replace('\n', '<br/>'), STYLES[style])

def table(headers, rows, widths=None):
    content = [[para(v, 'tablehead') for v in headers]]
    content += [[para(str(v), 'table') for v in row] for row in rows]
    t = Table(content, colWidths=widths or [491/len(headers)]*len(headers), hAlign='LEFT')
    t.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), RED),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.HexColor('#f0eee6'), PAPER]),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('LEFTPADDING', (0,0), (-1,-1), 9), ('RIGHTPADDING', (0,0), (-1,-1), 9),
        ('TOPPADDING', (0,0), (-1,-1), 8), ('BOTTOMPADDING', (0,0), (-1,-1), 8),
        ('LINEBELOW', (0,-1), (-1,-1), 0.5, RULE),
    ]))
    return t

class Diagram(Flowable):
    def __init__(self, lanes):
        Flowable.__init__(self)
        self.lanes = lanes
        self.width = 491
        self.height = len(lanes)*86 + 9
    def draw(self):
        c = self.canv
        for row, lane in enumerate(self.lanes):
            yy = self.height - 78 - row*86
            count = len(lane)
            boxw = (491-(count-1)*17)/count
            for j, text in enumerate(lane):
                xx = j*(boxw+17)
                c.setFillColor(colors.HexColor('#eeeade') if row%2==0 else colors.HexColor('#e6eee7'))
                c.setStrokeColor(RULE)
                c.roundRect(xx, yy, boxw, 63, 5, fill=1, stroke=1)
                p = para(text, 'table')
                pw, ph = p.wrap(boxw-18, 60)
                p.drawOn(c, xx+9, yy+(63-ph)/2)
                if j<count-1:
                    x=xx+boxw+3
                    c.setStrokeColor(RED)
                    c.line(x, yy+31, x+10, yy+31)
                    c.line(x+7, yy+34, x+10, yy+31)
                    c.line(x+7, yy+28, x+10, yy+31)

def blocks(page):
    story=[]
    if page.get('lead'):
        story += [para(page['lead'], 'body', BODY_WIDTH), Spacer(1,5)]
    for block in page['blocks']:
        kind=block['type']
        if kind=='section':
            story += [para(block['title'], 'heading')]
            story += [para(x, 'body', BODY_WIDTH) for x in block['paragraphs']]
        elif kind=='table':
            story += [table(block['headers'], block['rows'], block.get('widths')), Spacer(1,11)]
        elif kind=='callout':
            t=Table([[para(block['text'], 'callout')]], colWidths=[491])
            t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),colors.HexColor('#e8efe7')),('BOX',(0,0),(-1,-1),0.5,colors.HexColor('#c8d5c5')),('LEFTPADDING',(0,0),(-1,-1),13),('RIGHTPADDING',(0,0),(-1,-1),13),('TOPPADDING',(0,0),(-1,-1),11),('BOTTOMPADDING',(0,0),(-1,-1),11)]))
            story += [t, Spacer(1,10)]
        elif kind=='diagram':
            story += [Diagram(block['lanes']), Spacer(1,5)]
        elif kind=='small':
            story += [para(block['text'], 'small', BODY_WIDTH)]
        else:
            raise ValueError(kind)
    return story

def background(c, index, total, title):
    c.setFillColor(PAPER); c.rect(0,0,W,H,fill=1,stroke=0)
    c.setFillColor(RED); c.rect(0,H-10,W,10,fill=1,stroke=0)
    c.setFont('CNHead',9.2); c.drawString(52,H-37,'引用体检  /  CITE CHECKUP')
    c.setFillColor(MUTED); c.setFont('CN',8.2); c.drawRightString(W-52,H-37,'AI WEB 网页开发挑战赛 · 技术说明')
    c.setFillColor(INK); c.setFont('CNHead',23); c.drawString(52,H-85,title)
    c.setStrokeColor(RULE); c.line(52,H-104,W-52,H-104)
    c.line(52,44,W-52,44)
    c.setFont('CN',8); c.setFillColor(MUTED)
    c.drawString(52,29,DATA['footer'])
    c.drawRightString(W-52,29,f'{index:02} / {total:02}')

c=canvas.Canvas(str(PDF), pagesize=(W,H))
c.setTitle(DATA['title']); c.setAuthor('引用体检项目 · 团队信息待补充'); c.setSubject('受约束文献核验与论断证据核查技术说明')
overflow=[]
for idx,page in enumerate(DATA['pages'],1):
    background(c,idx,len(DATA['pages']),page['title'])
    story=blocks(page)
    frame=Frame(52,61,491,H-178,leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0,showBoundary=0)
    frame.addFromList(story,c)
    if story:
        overflow.append({'page':idx,'remainingBlocks':len(story)})
    c.showPage()
c.save()
if overflow:
    raise RuntimeError(f'Page content overflow: {overflow}')

css='''*{box-sizing:border-box}body{margin:0;background:#e6e3db;color:#252822;font:16px/1.8 "Microsoft YaHei","Noto Serif SC",serif}.sheet{width:794px;min-height:1123px;margin:24px auto;background:#fcfbf7;border-top:13px solid #943e32;padding:34px 68px 45px;box-shadow:0 4px 30px #0001}.eyebrow{font:12px/1.4 monospace;color:#943e32}.sheet h1{font-size:30px;margin:32px 0 22px;border-bottom:1px solid #d8d3c4;padding-bottom:20px}.sheet h2{font-size:20px;color:#943e32;margin:18px 0 8px}.sheet p{margin:0 0 13px}.sheet table{width:100%;border-collapse:collapse;margin:12px 0 18px;font-size:14px}.sheet th{background:#943e32;color:white;text-align:left}.sheet td,.sheet th{padding:10px 12px;vertical-align:top}.sheet tr:nth-child(even){background:#f0eee6}.callout{background:#e8efe7;color:#416451;padding:14px 18px;border:1px solid #c8d5c5}.small{font-size:12px;color:#66675e}.lane{display:flex;gap:12px;margin:10px 0}.node{flex:1;background:#eeeade;border:1px solid #d8d3c4;border-radius:5px;padding:12px;font-size:14px}footer{border-top:1px solid #d8d3c4;margin-top:25px;padding-top:10px;font-size:11px;color:#66675e}@media print{body{background:white}.sheet{margin:0;width:auto;min-height:0;box-shadow:none;break-after:page}}'''
parts=['<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+html.escape(DATA['title'])+'</title><style>'+css+'</style><body>']
for idx,page in enumerate(DATA['pages'],1):
    parts+=['<article class="sheet" contenteditable="true"><div class="eyebrow">引用体检 / CITE CHECKUP · 技术说明</div><h1>'+html.escape(page['title'])+'</h1>']
    if page.get('lead'): parts+=['<p>'+html.escape(page['lead'])+'</p>']
    for block in page['blocks']:
        kind=block['type']
        if kind=='section':
            parts+=['<h2>'+html.escape(block['title'])+'</h2>']+['<p>'+html.escape(x)+'</p>' for x in block['paragraphs']]
        elif kind=='table':
            parts+=['<table><thead><tr>'+''.join('<th>'+html.escape(str(x))+'</th>' for x in block['headers'])+'</tr></thead><tbody>']
            parts+=['<tr>'+''.join('<td>'+html.escape(str(x))+'</td>' for x in row)+'</tr>' for row in block['rows']]
            parts+=['</tbody></table>']
        elif kind=='diagram':
            for lane in block['lanes']: parts+=['<div class="lane">'+''.join('<div class="node">'+html.escape(x).replace('\n','<br>')+'</div>' for x in lane)+'</div>']
        else:
            parts+=['<p class="'+('callout' if kind=='callout' else 'small')+'">'+html.escape(block['text'])+'</p>']
    parts+=['<footer>'+html.escape(DATA['footer'])+f' · {idx:02} / {len(DATA["pages"]):02}</footer></article>']
parts+=['</body></html>']
HTML.write_text('\n'.join(parts),encoding='utf-8')
print(json.dumps({'pdf':str(PDF),'html':str(HTML),'pages':len(DATA['pages']),'overflow':overflow},ensure_ascii=False))
