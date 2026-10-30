"""把 capture.py 在魔搭公网截下的界面图整理成技术说明用的 JPG：裁掉过高的部分、缩到 1600 像素宽。
AI 继续查那张只留结论和检索步骤两段，中间的字段比对略去并在图里注明（OpenAlex 登记的作者字段有误，规范写法照搬了它）。

用法：python docs/competition/media/doc-shots/prepare.py <capture.py 的输出目录>
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

SRC = Path(sys.argv[1])
OUT = Path(__file__).resolve().parent
WIDTH = 1600
FONT = ImageFont.truetype(r'C:\Windows\Fonts\simsun.ttc', 30)


def save(image, name):
    if image.width > WIDTH:
        image = image.resize((WIDTH, round(image.height * WIDTH / image.width)), Image.LANCZOS)
    image.convert('RGB').save(OUT / name, quality=88, optimize=True)
    print(name, image.size)


def joined(top, bottom, note):
    """上下两段之间留一条带说明的空白，说明略去了中间部分"""
    gap = 64
    canvas = Image.new('RGB', (top.width, top.height + gap + bottom.height), (252, 251, 247))
    canvas.paste(top, (0, 0)); canvas.paste(bottom, (0, top.height + gap))
    draw = ImageDraw.Draw(canvas)
    w = draw.textlength(note, font=FONT)
    draw.text(((top.width - w) / 2, top.height + 16), note, fill=(110, 110, 104), font=FONT)
    return canvas


shot = lambda name: Image.open(SRC / name)
results = shot('01-results.png')
save(results.crop((0, 0, results.width, min(results.height, 1800))), '01-results.jpg')
save(shot('02-cnki.png'), '02-cnki.jpg')
save(shot('03-standard.png'), '03-standard.jpg')
agent = shot('04-agent.png')
save(joined(agent.crop((0, 0, agent.width, 345)), agent.crop((0, 1085, agent.width, agent.height)), '……（中间的字段比对与规范写法略）……'), '04-agent.jpg')
save(shot('05-vision.png'), '05-vision.jpg')
save(shot('06-hidden.png'), '06-hidden.jpg')
save(shot('07-claim.png'), '07-claim.jpg')
