"""Edit genuine chapter recordings, with neural narration and word-timed Chinese captions.

No loop, still-frame extension or response replacement is performed. Long recorded waits
can be shortened, with an on-screen disclosure and exact source cuts in the edit manifest.
"""
from pathlib import Path
import argparse
import hashlib
import json
import math
import subprocess

HERE = Path(__file__).resolve().parent
FPS = 25
LEAD = .6
# This source's selected interval contains 1001 actual 25-fps output frames.
# End the chapter at 40.04s, instead of leaving a 40ms audio-only tail at concat.
# The genuine source interval stays intact; no frame is repeated or generated.
FRAME_END_TRIMS = {("tutorial", "05-claims"): 1 / FPS}


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def probe(path):
    return json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_format", "-show_streams", "-of", "json", str(path)
    ], text=True, encoding="utf-8"))


def ass_time(seconds):
    centis = round(seconds * 100)
    return f"{centis // 360000:01}:{centis // 6000 % 60:02}:{centis // 100 % 60:02}.{centis % 100:02}"


def srt_time(seconds):
    ms = round(seconds * 1000)
    return f"{ms // 3600000:02}:{ms // 60000 % 60:02}:{ms // 1000 % 60:02},{ms % 1000:03}"


def plain(value):
    return str(value).replace("\\", "＼").replace("{", "（").replace("}", "）").replace("\n", " ")


def segments(chapter, desired):
    start = float(chapter.get("contentStart", 0))
    length = float(chapter["contentSeconds"])
    if length + .12 < desired:
        raise ValueError(f'{chapter["id"]}: genuine video {length:.2f}s is shorter than {desired:.2f}s; record more actual content')
    desired = min(desired, length)
    remove = max(0, length - desired)
    cuts = []
    for wait in sorted(chapter.get("waits", []), key=lambda w: w["start"]):
        a, b = max(0, float(wait["start"])), min(length, float(wait["end"]))
        keep = max(4, float(wait.get("keepSeconds", 6)))
        take = min(remove, max(0, b - a - keep))
        if take > .15:
            cuts.append((a + keep / 2, a + keep / 2 + take))
            remove -= take
    # Remaining surplus is the recorded reading tail, never added freeze frames.
    end = length - remove
    intervals, cursor = [], 0.0
    for a, b in cuts:
        if a > cursor and a < end:
            intervals.append((start + cursor, start + min(a, end)))
        cursor = min(b, end)
    if end > cursor:
        intervals.append((start + cursor, start + end))
    if not intervals:
        raise ValueError("No actual video selected")
    last_action = max((c["at"] for c in chapter.get("cues", [])), default=0)
    if remove > 1 and last_action > end:
        raise ValueError(f'{chapter["id"]}: tail trim would omit action at {last_action}s; review edit manually')
    return intervals, [{"start": a, "end": b} for a, b in cuts], remove


def make_ass(path, chapter, audio, duration, ordinal, count, kind, has_cut):
    styles = """[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Microsoft YaHei,36,&H002D2924,&H002D2924,&H00F3EEE3,&H00F3EEE3,0,0,0,0,100,100,0,0,1,0,0,2,160,160,27,1
Style: Header,Microsoft YaHei,30,&H002D2924,&H002D2924,&H00F3EEE3,&H00F3EEE3,-1,0,0,0,100,100,0,0,1,0,0,7,160,160,15,1
Style: Meta,Microsoft YaHei,19,&H007C7367,&H007C7367,&H00F3EEE3,&H00F3EEE3,0,0,0,0,100,100,0,0,1,0,0,7,160,160,15,1
Style: Badge,Microsoft YaHei,20,&H001B40AD,&H001B40AD,&H00F3EEE3,&H00F3EEE3,-1,0,0,0,100,100,0,0,3,2,0,7,160,160,15,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    lines = []
    def line(a, b, style, text, layer=0):
        lines.append(f"Dialogue: {layer},{ass_time(a)},{ass_time(b)},{style},,0,0,0,,{text}")
    line(0, duration, "Header", r"{\pos(160,15)}" + f"{ordinal:02d}  " + plain(chapter["title"]))
    label = "参赛演示" if kind == "competition" else "老师操作教程"
    line(0, duration, "Meta", r"{\an9\pos(1760,19)}" + f"引用体检  /  {label}  ·  {ordinal:02d}/{count:02d}")
    line(0, duration, "Meta", r"{\an3\pos(1890,1067)\fs16}" + "云希 · 神经合成配音")
    if has_cut:
        line(0, duration, "Badge", r"{\pos(175,87)}" + "实际操作录屏 · 等待已缩短", 1)
    elif chapter.get("reuseSource"):
        line(0, min(5, duration), "Meta", r"{\pos(175,87)}" + "同日真实操作录屏", 1)
    badge = {"02-photo": "演示输入：合成模拟照片", "03-reference": "含公开引文与虚构测试条目",
             "05-hidden": "演示输入：合成测试 PDF", "07-boundaries": "演示输入：合成研究材料"}.get(chapter["id"]) if kind == "competition" else {
                 "02-import": "演示材料：第二条期刊名为故意改错",
                 "03-results": "含公开引文与虚构测试条目"
             }.get(chapter["id"])
    if badge:
        line(0, duration, "Badge", r"{\an9\pos(1745,87)}" + badge, 1)
    if kind == "competition" and chapter["id"] == "04-agent":
        line(36, duration, "Badge", r"{\an9\pos(1745,87)}" + "历史中文评测：33/75 找到论文页，1 条自动确认", 1)
    for cue in audio["cues"]:
        a, b = LEAD + cue["start"], LEAD + cue["end"]
        if a >= duration or b > duration + .05:
            raise ValueError(f'{chapter["id"]}: caption exceeds actual clip')
        line(a, min(b, duration), "Caption", plain(cue["text"]), 2)
    path.write_text(styles + "\n".join(lines) + "\n", encoding="utf-8-sig")


def main():
    cli = argparse.ArgumentParser()
    cli.add_argument("kind", choices=["competition", "tutorial"])
    cli.add_argument("--manifest", type=Path)
    cli.add_argument("--only")
    cli.add_argument("--join", action="store_true")
    args = cli.parse_args()
    manifest_path = args.manifest or HERE / ("capture-manifest.json" if args.kind == "competition" else "tutorial-capture-manifest.json")
    capture = read(manifest_path)
    if not capture.get("actualNetwork") or capture.get("mockedResponses"):
        raise ValueError("Final edit requires actual network recordings")
    spec = read(HERE.parent.parent / "narration.json" if args.kind == "competition" else HERE / "tutorial-narration.json")
    narration = read(HERE / "audio" / args.kind / "manifest.json")
    out = HERE / "edit" / args.kind
    out.mkdir(parents=True, exist_ok=True)
    record = {"kind": args.kind, "actualNetwork": True, "voice": narration["voice"], "syntheticVoice": True,
              "loopedVideo": False, "freezeFramePadding": False, "chapters": []}
    sources = {c["id"]: c for c in capture["chapters"] if c.get("success")}
    voices = {a["id"]: a for a in narration["chapters"]}
    selected = [s for s in spec["chapters"] if not args.only or s["id"] in args.only.split(",")]
    total = 0.0
    all_cues = []
    for s in selected:
        c, a = sources[s["id"]], voices[s["id"]]
        source_info = probe(c["video"])
        source_dur = float(source_info["format"]["duration"])
        desired = max(float(s["seconds"]), a["seconds"] + LEAD + .15)
        if args.kind == "tutorial":
            desired = a["seconds"] + LEAD + 1.0
        elif c["contentSeconds"] < desired and c["contentSeconds"] >= a["seconds"] + LEAD + .15:
            # Storyboard targets are flexible; never pad a genuine recording to reach them.
            desired = c["contentSeconds"]
        desired = math.floor(desired * FPS) / FPS
        intervals, cuts, tail = segments(c, desired)
        duration = math.floor(sum(b - x for x, b in intervals) * FPS + .01) / FPS
        duration -= FRAME_END_TRIMS.get((args.kind, c["id"]), 0)
        if intervals[-1][1] > source_dur + .08:
            raise ValueError(f'{c["id"]}: source interval exceeds the real file duration')
        ordinal = spec["chapters"].index(s) + 1
        ass = out / f'{c["id"]}.ass'
        make_ass(ass, c, a, duration, ordinal, len(spec["chapters"]), args.kind, bool(cuts))
        target = out / f'{c["id"]}.mp4'
        graph = []
        if len(intervals) == 1:
            x, b = intervals[0]
            graph.append(f"[0:v]trim=start={x:.6f}:end={b:.6f},setpts=PTS-STARTPTS[screen]")
        else:
            graph.append(f"[0:v]split={len(intervals)}" + "".join(f"[s{i}]" for i in range(len(intervals))))
            for i, (x, b) in enumerate(intervals):
                graph.append(f"[s{i}]trim=start={x:.6f}:end={b:.6f},setpts=PTS-STARTPTS[v{i}]")
            graph.append("".join(f"[v{i}]" for i in range(len(intervals))) + f"concat=n={len(intervals)}:v=1:a=0[screen]")
        graph.append("[screen]fps=25,scale=1600:900:flags=lanczos,pad=1920:1080:160:76:color=0xF3EEE3,"
                     f"drawbox=x=160:y=66:w=1600:h=1:color=0xCDBEAA:t=fill,drawbox=x=160:y=979:w=1600:h=1:color=0xCDBEAA:t=fill,subtitles=filename='{ass.name}'[video]")
        graph.append(f"[1:a]loudnorm=I=-16:TP=-1.5:LRA=11,adelay={round(LEAD*1000)}:all=1,apad[audio]")
        signature = hashlib.sha256(json.dumps({"source": c["video"], "sourceSize": Path(c["video"]).stat().st_size,
                    "intervals": intervals, "audio": a["inputSha256"], "ass": ass.read_text(encoding="utf-8-sig"), "graph": graph},
                    ensure_ascii=False).encode()).hexdigest()
        signature_file = out / f'{c["id"]}.signature'
        if not target.exists() or not signature_file.exists() or signature_file.read_text() != signature:
            command = ["ffmpeg", "-y", "-i", c["video"], "-i", a["file"], "-filter_complex_threads", "2",
                       "-filter_complex", ";".join(graph), "-map", "[video]", "-map", "[audio]",
                       "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-threads", "4",
                       "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "48000", "-b:a", "160k", "-t", f"{duration:.3f}",
                       "-movflags", "+faststart", str(target)]
            with (out / f'{c["id"]}.log').open("w", encoding="utf-8") as log:
                subprocess.run(command, cwd=out, stdout=log, stderr=log, check=True)
            signature_file.write_text(signature)
        actual = probe(target)
        duration = float(actual["format"]["duration"])
        entry = {"id": c["id"], "title": c["title"], "file": str(target), "sourceFile": c["video"],
                 "sourceIntervals": intervals, "removedWaits": cuts, "removedReadingTailSeconds": tail,
                 "start": total, "duration": duration, "end": total + duration, "narrationSeconds": a["seconds"],
                 "narrationOffset": LEAD, "cues": c.get("cues", []), "responses": c.get("responses", []),
                 "frameEndTrimSeconds": FRAME_END_TRIMS.get((args.kind, c["id"]), 0),
                 "reuseSource": c.get("reuseSource"), "probe": actual}
        record["chapters"].append(entry)
        for cue in a["cues"]:
            all_cues.append({"start": total + LEAD + cue["start"], "end": total + LEAD + cue["end"], "text": cue["text"]})
        total += duration
        (out / "edit-manifest.json").write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
        print("edited", c["id"], duration, flush=True)
    record["totalSeconds"] = total
    (out / "edit-manifest.json").write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    (out / "subtitles.srt").write_text("\n\n".join(f'{i+1}\n{srt_time(c["start"])} --> {srt_time(c["end"])}\n{c["text"]}'
                                                   for i, c in enumerate(all_cues)) + "\n", encoding="utf-8-sig")
    if args.join:
        if len(record["chapters"]) != len(spec["chapters"]):
            raise ValueError("Refuse final delivery with missing chapters")
        if args.kind == "competition" and not 300 <= total <= 480:
            raise ValueError(f"Competition duration out of bounds: {total}")
        (out / "concat.txt").write_text("\n".join(f"file '{Path(c['file']).name}'" for c in record["chapters"]), encoding="utf-8")
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", "concat.txt", "-c", "copy",
                        "-movflags", "+faststart", "final.mp4"], cwd=out, check=True)
        record["joinedFile"] = str(out / "final.mp4")
        record["finalProbe"] = probe(out / "final.mp4")
        (out / "edit-manifest.json").write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps({"file": record["joinedFile"], "seconds": total}), flush=True)


if __name__ == "__main__":
    main()
