"""从 SHOOTING_SCRIPT.md 生成提词稿和 SRT 字幕草稿；--retime 时先把脚本里的时间改成 11-16 新时间线。
新时间线：片头后加 15 秒 AI 六项对照卡（第 0 段第二行），第 1–4 段整体顺延 15 秒；第 4 段改成批量追查后加长 10 秒，第 5 段起共顺延 25 秒。
提词稿按语速标出读不完的行（中文约每秒 4.5 字）；字幕草稿每行一条，长台词按标点切开、按字数分配时间，录完要按实际配音对一遍。
用法（项目根目录）：python docs/competition/media/build_teleprompter.py [--retime]"""
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
HERE = Path(__file__).resolve().parent
SCRIPT = HERE.parent / "SHOOTING_SCRIPT.md"
OUT_MD = HERE / "teleprompter-2026-11-16.md"
OUT_SRT = HERE / "subtitles-draft-2026-11-16.srt"
RATE = 4.0  # 每秒字数（汉字、字母数字各算 1）；非专业配音按每秒 4 字估，偏保守

TIME = re.compile(r"(\d+):(\d{2})")


def sec(m):
    return int(m.group(1)) * 60 + int(m.group(2))


def fmt(s):
    return f"{s // 60}:{s % 60:02d}"


def shift_for(segment: int, start: int) -> int:
    if segment == 0:
        return 0
    if segment <= 4:
        return 15
    return 25


lines = SCRIPT.read_text(encoding="utf-8").splitlines()
retime = "--retime" in sys.argv
segment = -1
rows = []  # (segment, title, start, end, picture, narration)
title = ""
out = []
for line in lines:
    h = re.match(r"^### 第 (\d+) 段　(.+?)（(\d+:\d{2})–(\d+:\d{2})(.*?)）$", line)
    if h:
        segment = int(h.group(1)); title = h.group(2)
        if retime:
            d = shift_for(segment, 0)
            a, b = TIME.search(h.group(3)), TIME.search(h.group(4))
            line = f"### 第 {segment} 段　{title}（{fmt(sec(a) + d)}–{fmt(sec(b) + d)}{h.group(5)}）"
        out.append(line)
        continue
    r = re.match(r"^\| (\d+:\d{2})–(\d+:\d{2}) \| (.*) \| (.*) \|$", line)
    if r and segment >= 0:
        a, b = TIME.match(r.group(1)), TIME.match(r.group(2))
        start, end = sec(a), sec(b)
        if retime:
            d = shift_for(segment, start)
            start, end = start + d, end + d
            line = f"| {fmt(start)}–{fmt(end)} | {r.group(3)} | {r.group(4)} |"
        rows.append((segment, title, start, end, r.group(3), r.group(4)))
    out.append(line)

if retime:
    text = "\n".join(out) + "\n"
    text = text.replace("片头后加 15 秒 AI 六项对照图（第 0 段第二行）；第 1 段起各段整体顺延约 15 秒，第 5 段起再顺延约 10 秒，成片约 7 分 25 秒。",
                        "片头后加 15 秒 AI 六项对照图（第 0 段第二行），下面各段时间已按新时间线改好，成片约 7 分 25 秒；提词稿和字幕草稿见 media/teleprompter-2026-11-16.md、media/subtitles-draft-2026-11-16.srt。")
    SCRIPT.write_text(text, encoding="utf-8")


def count(s):
    return len(re.findall(r"[一-鿿]|[A-Za-z0-9]+", s))


def clean(s):
    return re.sub(r"`|\*\*", "", s).strip()


md = ["# 演示视频提词稿（2026-11-16 新时间线）", "",
      f"由 `build_teleprompter.py` 从 [SHOOTING_SCRIPT.md](../SHOOTING_SCRIPT.md) 生成，台词与脚本一致。按每秒约 {RATE} 字估算，标 ⚠ 的行在给定时间里读不完：语速放快一点，或者剪辑时把画面延长几秒。", ""]
current = None
for seg, ttl, start, end, pic, nar in rows:
    if seg != current:
        md += ["", f"## 第 {seg} 段　{ttl}", ""]
        current = seg
    need = count(nar) / RATE
    dur = end - start
    flag = f" ⚠ 约需 {need:.0f} 秒，只有 {dur} 秒" if need > dur + 1 else ""
    md += [f"**{fmt(start)}–{fmt(end)}**（{dur} 秒）{flag}", "", clean(nar), ""]
OUT_MD.write_text("\n".join(md).rstrip() + "\n", encoding="utf-8")


def srt_time(t):
    ms = int(round(t * 1000))
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


blocks = []
for seg, ttl, start, end, pic, nar in rows:
    parts = [p.strip() for p in re.split(r"(?<=[。！？；])", clean(nar)) if p.strip()]
    pieces = []
    for p in parts:  # 一条字幕不超过约 24 字，再按逗号切
        if count(p) <= 24:
            pieces.append(p); continue
        buf = ""
        for q in re.split(r"(?<=[，、：])", p):
            if buf and count(buf + q) > 24:
                pieces.append(buf); buf = q
            else:
                buf += q
        if buf:
            pieces.append(buf)
    total = sum(count(p) for p in pieces) or 1
    t = float(start)
    for p in pieces:
        d = (end - start) * count(p) / total
        blocks.append((t, t + d, p.rstrip("，、")))
        t += d
srt = "\n".join(f"{i}\n{srt_time(a)} --> {srt_time(b)}\n{txt}\n" for i, (a, b, txt) in enumerate(blocks, 1))
OUT_SRT.write_text(srt, encoding="utf-8-sig")
flags = sum(1 for s in md if "⚠ 约需" in s)
print({"rows": len(rows), "subtitles": len(blocks), "tooLong": flags, "end": fmt(rows[-1][3]) if rows else None, "retimed": retime})
