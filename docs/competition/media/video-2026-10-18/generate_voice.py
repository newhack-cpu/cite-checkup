"""Generate the approved Yunxi narration and word-timed subtitles; no app secrets."""
from pathlib import Path
import argparse
import asyncio
import hashlib
import json
import os
import re
import subprocess
import sys

DEPS = Path(os.environ.get("CITE_TTS_PACKAGES", r"C:\Users\Darks\AppData\Local\Temp\cite-checkup-edge-tts-7.3.1"))
if DEPS.is_dir():
    sys.path.insert(0, str(DEPS))
import edge_tts

HERE = Path(__file__).resolve().parent
VOICE = "zh-CN-YunxiNeural"


def probe(file):
    return float(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", str(file)
    ], text=True).strip())


def stamp(t):
    ms = round(t * 1000)
    return f"{ms // 3600000:02}:{ms // 60000 % 60:02}:{ms // 1000 % 60:02},{ms % 1000:03}"


def width(s):
    return sum(0.55 if ord(c) < 128 else 1 for c in s)


def captions(boundaries, text):
    # Use service word times, keeping original punctuation where it is present.
    words, cursor = [], 0
    for b in boundaries:
        token = b["text"]
        at = text.find(token, cursor)
        display = token
        if at >= 0:
            end = at + len(token)
            while end < len(text) and re.match(r"[，。！？；：、,.!?;:“”‘’（）()\s]", text[end]):
                end += 1
            display = text[at:end]
            cursor = end
        words.append({"start": b["offset"] / 10_000_000,
                      "end": (b["offset"] + b["duration"]) / 10_000_000,
                      "text": display})
    cues, group = [], []
    for w in words:
        trial = "".join(x["text"] for x in group) + w["text"]
        if group and (width(trial) > 29 or w["end"] - group[0]["start"] > 6.5):
            cues.append({"start": group[0]["start"], "end": group[-1]["end"],
                         "text": "".join(x["text"] for x in group).strip()})
            group = []
        group.append(w)
        if re.search(r"[。！？!?；;][”’）)]?\s*$", w["text"]) and width("".join(x["text"] for x in group)) > 8:
            cues.append({"start": group[0]["start"], "end": group[-1]["end"],
                         "text": "".join(x["text"] for x in group).strip()})
            group = []
    if group:
        cues.append({"start": group[0]["start"], "end": group[-1]["end"],
                     "text": "".join(x["text"] for x in group).strip()})
    for i, cue in enumerate(cues):
        next_start = cues[i + 1]["start"] if i + 1 < len(cues) else cue["end"] + .3
        cue["end"] = max(cue["end"], min(next_start - .03, cue["end"] + .22))
    return cues


async def generate(spec_path, name, rate, proxy):
    spec = json.loads(spec_path.read_text(encoding="utf-8-sig"))
    out = HERE / "audio" / name
    out.mkdir(parents=True, exist_ok=True)
    manifest = {"voice": VOICE, "synthetic": True, "provider": "Microsoft Edge online neural TTS",
                "edgeTtsVersion": edge_tts.__version__, "rate": rate, "script": str(spec_path), "chapters": []}
    for chapter in spec["chapters"]:
        text = chapter["narration"]
        identity = hashlib.sha256((VOICE + rate + text).encode("utf-8")).hexdigest()
        mp3 = out / f'{chapter["id"]}.mp3'
        wav = out / f'{chapter["id"]}.wav'
        meta = out / f'{chapter["id"]}.json'
        previous = json.loads(meta.read_text(encoding="utf-8")) if meta.exists() else {}
        if previous.get("inputSha256") == identity and wav.exists() and mp3.exists() and previous.get("cues"):
            entry = previous
            print("reuse", chapter["id"], entry["seconds"], flush=True)
        else:
            for attempt in range(3):
                try:
                    boundaries = []
                    comm = edge_tts.Communicate(text, VOICE, rate=rate, boundary="WordBoundary", proxy=proxy,
                                                connect_timeout=15, receive_timeout=60)
                    with mp3.open("wb") as audio:
                        async for event in comm.stream():
                            if event["type"] == "audio":
                                audio.write(event["data"])
                            elif event["type"] in ("WordBoundary", "SentenceBoundary"):
                                boundaries.append({k: event[k] for k in ("offset", "duration", "text")})
                    if not boundaries or mp3.stat().st_size < 1500:
                        raise RuntimeError("No usable audio/word timing returned")
                    break
                except Exception as exc:
                    print(f'{chapter["id"]}: attempt {attempt+1} {type(exc).__name__}', flush=True)
                    if attempt == 2:
                        raise RuntimeError(f'{chapter["id"]}: TTS generation failed') from None
                    await asyncio.sleep(2 + attempt * 2)
            subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(mp3), "-ar", "48000", "-ac", "1", str(wav)], check=True)
            entry = {"id": chapter["id"], "title": chapter["title"], "file": str(wav), "mp3": str(mp3),
                     "seconds": probe(wav), "plannedSeconds": chapter["seconds"], "inputSha256": identity,
                     "voice": VOICE, "rate": rate, "narration": text, "boundaries": boundaries,
                     "cues": captions(boundaries, text)}
            meta.write_text(json.dumps(entry, ensure_ascii=False, indent=2), encoding="utf-8")
            (out / f'{chapter["id"]}.srt').write_text("\n\n".join(
                f'{i+1}\n{stamp(c["start"])} --> {stamp(c["end"])}\n{c["text"]}'
                for i, c in enumerate(entry["cues"])) + "\n", encoding="utf-8-sig")
            print("generated", chapter["id"], entry["seconds"], "seconds", flush=True)
        manifest["chapters"].append(entry)
        (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    manifest["totalSpeechSeconds"] = sum(c["seconds"] for c in manifest["chapters"])
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"manifest": str(out / "manifest.json"), "speechSeconds": manifest["totalSpeechSeconds"]}), flush=True)


if __name__ == "__main__":
    args = argparse.ArgumentParser()
    args.add_argument("script", type=Path)
    args.add_argument("--name", required=True)
    args.add_argument("--rate", default="-5%")
    args.add_argument("--proxy", default="http://127.0.0.1:7890")
    opts = args.parse_args()
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(generate(opts.script.resolve(), opts.name, opts.rate, opts.proxy or None))
