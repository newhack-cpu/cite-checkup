"""Render and mechanically check the latest PDF; human image review is separate."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import subprocess
import fitz
from PIL import Image, ImageOps, ImageDraw

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
PDF = HERE / 'output' / 'pdf' / '引用体检-技术说明.pdf'
# 每次验收写进当天的目录，不覆盖旧版本的验收证据（10-14 版在 eval/phase-two-2026-10-14/competition/）
QA = ROOT / 'eval' / 'results' / f"technical-pdf-{datetime.now().strftime('%Y-%m-%d')}"
RENDER = QA / 'render'
RENDER.mkdir(parents=True, exist_ok=True)
subprocess.run(['pdftoppm','-r','110','-png',str(PDF),str(RENDER/'page')],check=True)
doc = fitz.open(PDF)
pages=[]
for i,page in enumerate(doc,1):
    text=page.get_text()
    outliers=[]
    for block in page.get_text('dict')['blocks']:
        for line in block.get('lines',[]):
            for span in line['spans']:
                x0,y0,x1,y1=span['bbox']
                if x0<0 or y0<0 or x1>page.rect.width+0.5 or y1>page.rect.height+0.5:
                    outliers.append({'text':span['text'],'bbox':span['bbox']})
    pages.append({'page':i,'textCharacters':len(text),'pageNumber':f'{i:02} / {len(doc):02}' in text,'outOfPageText':outliers,'render':str(RENDER/f'page-{i:02}.png')})
alltext='\n'.join(p.get_text() for p in doc)
(QA/'technical-report-extracted.txt').write_text(alltext,encoding='utf-8')
files=sorted(RENDER.glob('page-*.png'))
for start in range(0,len(files),4):
    group=files[start:start+4]
    sheet=Image.new('RGB',(1280,1820),'#e6e3db')
    draw=ImageDraw.Draw(sheet)
    for j,p in enumerate(group):
        im=Image.open(p).convert('RGB')
        thumb=ImageOps.contain(im,(615,860))
        x=15+(j%2)*635; y=35+(j//2)*895
        sheet.paste(thumb,(x,y))
        draw.text((x,y-23),f'Page {start+j+1}',fill='#943e32')
    sheet.save(RENDER/f'contact-{start//4+1}.png')
result={
    'checkedAt':datetime.now(timezone.utc).isoformat(),
    'file':str(PDF),'sha256':hashlib.sha256(PDF.read_bytes()).hexdigest(),
    'pages':len(doc),'maxPages':30,'textSelectable':all(x['textCharacters']>200 for x in pages),
    'pageNumbers':all(x['pageNumber'] for x in pages),
    'noOutOfPageText':all(not x['outOfPageText'] for x in pages),
    'containsPendingDraft':any(x in alltext for x in ['集成验收前草稿','待主执行者','待末轮合入','待最终集成']),
    'visualReview':'pending human image inspection',
    'pageDetails':pages,
}
assert len(doc)<=30
assert result['textSelectable'] and result['pageNumbers'] and result['noOutOfPageText']
(QA/'pdf-validation.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in result.items() if k!='pageDetails'},ensure_ascii=True))
