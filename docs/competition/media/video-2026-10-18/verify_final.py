"""Independent, local-only verification of the two final demonstration videos.

No network, model calls, audio generation, or video modification. Source provenance
is checked against the recording/edit manifests, not inferred from static pictures.
Extracted frames require a separate actual visual review; no listening is claimed.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
from fractions import Fraction
import hashlib
import json
import math
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time


HERE = Path(__file__).resolve().parent
KINDS = ("competition", "tutorial")
FRAME_TOLERANCE = 0.085


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def path_key(path) -> str:
    return str(Path(path).resolve()).casefold()


def number(value, default=None):
    try:
        result = float(value)
        return result if math.isfinite(result) else default
    except (TypeError, ValueError):
        return default


def rate(value) -> float:
    try:
        return float(Fraction(value))
    except (ValueError, ZeroDivisionError, TypeError):
        return 0.0


def normalized_text(value: str) -> str:
    return "".join(char.lower() for char in value if char.isalnum())


def media_probe(path: Path) -> dict:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_format", "-show_streams", "-of", "json", str(path)],
        capture_output=True, text=True, encoding="utf-8", errors="replace", check=True,
    )
    return json.loads(result.stdout)


def stream_summary(probe: dict) -> list[dict]:
    fields = ("index", "codec_type", "codec_name", "width", "height", "pix_fmt", "r_frame_rate",
              "avg_frame_rate", "sample_rate", "channels", "start_time", "duration", "nb_frames")
    return [{key: stream[key] for key in fields if key in stream} for stream in probe.get("streams", [])]


def packet_extents(path: Path) -> dict:
    # Packet PTS plus packet duration accounts for AAC encoder priming and mux offsets.
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_packets", "-show_entries",
         "packet=stream_index,pts_time,duration_time", "-of", "compact=p=0:nk=0", str(path)],
        capture_output=True, text=True, encoding="utf-8", errors="replace", check=True,
    )
    streams = {}
    for line in result.stdout.splitlines():
        values = dict(part.split("=", 1) for part in line.split("|") if "=" in part)
        index, pts = values.get("stream_index"), number(values.get("pts_time"))
        if index is None or pts is None:
            continue
        duration = number(values.get("duration_time"), 0.0)
        row = streams.setdefault(index, {"packetCount": 0, "firstPts": pts, "lastEnd": pts + duration})
        row["packetCount"] += 1
        row["firstPts"] = min(row["firstPts"], pts)
        row["lastEnd"] = max(row["lastEnd"], pts + duration)
    return streams


def parse_time(value: str) -> float:
    parts = value.strip().replace(",", ".").split(":")
    if len(parts) != 3:
        raise ValueError(f"Invalid subtitle timestamp: {value!r}")
    return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])


def read_ass(path: Path) -> list[dict]:
    rows = []
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        if not line.startswith("Dialogue:"):
            continue
        parts = line.split(":", 1)[1].strip().split(",", 9)
        if len(parts) != 10:
            raise ValueError(f"Malformed ASS dialogue in {path.name}")
        rows.append({"start": parse_time(parts[1]), "end": parse_time(parts[2]),
                     "style": parts[3], "text": parts[9]})
    return rows


def read_srt(path: Path) -> list[dict]:
    text = path.read_text(encoding="utf-8-sig").strip()
    rows = []
    for block in re.split(r"\r?\n\s*\r?\n", text):
        lines = block.splitlines()
        if len(lines) < 3 or " --> " not in lines[1]:
            raise ValueError(f"Malformed SRT block in {path.name}")
        start, end = lines[1].split(" --> ", 1)
        rows.append({"index": int(lines[0]), "start": parse_time(start), "end": parse_time(end),
                     "text": "\n".join(lines[2:])})
    return rows


def source_to_output(source_time: float, intervals: list) -> float | None:
    cursor = 0.0
    for start, end in intervals:
        if start <= source_time < end:
            return cursor + source_time - start
        cursor += end - start
    return None


class Audit:
    def __init__(self, kind: str):
        self.data = {"kind": kind, "checks": [], "chapters": [], "frames": [],
                     "visualReview": "pending_actual_frame_inspection", "humanListeningPerformed": False}

    def check(self, name: str, passed: bool, details=None, severity="error"):
        row = {"name": name, "passed": bool(passed), "severity": severity}
        if details is not None:
            row["details"] = details
        self.data["checks"].append(row)
        return passed

    def finish(self):
        failures = [row for row in self.data["checks"] if not row["passed"] and row["severity"] == "error"]
        self.data["machinePassed"] = not failures
        self.data["failureCount"] = len(failures)
        self.data["failedChecks"] = [row["name"] for row in failures]
        return self.data


def make_contact_sheet(frames: list[dict], destination: Path):
    # Pillow is optional; the full-size frames are always the verification artifacts.
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        return None
    columns, width, height, label = 3, 640, 360, 32
    rows = math.ceil(len(frames) / columns)
    canvas = Image.new("RGB", (columns * width, rows * (height + label)), "#f3eee3")
    draw = ImageDraw.Draw(canvas)
    try:
        font = ImageFont.truetype("C:/Windows/Fonts/consola.ttf", 18)
    except OSError:
        font = ImageFont.load_default()
    for index, frame in enumerate(frames):
        x, y = index % columns * width, index // columns * (height + label)
        with Image.open(frame["file"]) as image:
            image.thumbnail((width, height))
            canvas.paste(image.convert("RGB"), (x, y + label))
        draw.text((x + 10, y + 6), f"{frame['chapter']} / {frame['label']} / {frame['seconds']:.2f}s", fill="#26221d", font=font)
    canvas.save(destination, quality=92)
    return str(destination)


def extract_frames(final: Path, entries: list[dict], voices: dict, destination: Path) -> list[dict]:
    destination.mkdir(parents=True, exist_ok=True)
    frames = []
    for chapter in entries:
        voice = voices[chapter["id"]]
        cues = voice["cues"]
        offset, start, duration = chapter["narrationOffset"], chapter["start"], chapter["duration"]
        selected = [("early", cues[0]), ("middle", cues[len(cues) // 2]), ("late", cues[-1])]
        for label, cue in selected:
            local_time = min(duration - 0.08, max(0.04, offset + (cue["start"] + cue["end"]) / 2))
            seconds = start + local_time
            target = destination / f"{chapter['id']}-{label}-{round(seconds * 1000):07d}.png"
            subprocess.run(
                ["ffmpeg", "-y", "-nostdin", "-v", "error", "-threads", "2", "-ss", f"{seconds:.6f}",
                 "-i", str(final), "-map", "0:v:0", "-frames:v", "1", "-update", "1", str(target)],
                capture_output=True, text=True, encoding="utf-8", errors="replace", check=True,
            )
            frames.append({"chapter": chapter["id"], "label": label, "seconds": round(seconds, 6),
                           "expectedCaption": cue["text"], "file": str(target), "sha256": sha256(target)})
    return frames


def verify_kind(kind: str, extract=True) -> dict:
    audit = Audit(kind)
    out = HERE / "edit" / kind
    final = out / "final.mp4"
    paths = {
        "final": final, "editManifest": out / "edit-manifest.json",
        "captureManifest": HERE / ("capture-manifest.json" if kind == "competition" else "tutorial-capture-manifest.json"),
        "audioManifest": HERE / "audio" / kind / "manifest.json",
        "script": HERE.parent.parent / "narration.json" if kind == "competition" else HERE / "tutorial-narration.json",
        "subtitles": out / "subtitles.srt", "assembler": HERE / "assemble_current.py",
    }
    if not all(audit.check(f"input_exists:{name}", path.is_file(), str(path)) for name, path in paths.items()):
        return audit.finish()
    audit.data["inputs"] = {name: {"file": str(path), "bytes": path.stat().st_size, "sha256": sha256(path)} for name, path in paths.items()}
    edit, capture, audio, script = (read_json(paths[key]) for key in ("editManifest", "captureManifest", "audioManifest", "script"))
    entries = edit["chapters"]
    expected_ids = [row["id"] for row in script["chapters"]]
    voice_ids = [row["id"] for row in audio["chapters"]]
    actual_ids = [row["id"] for row in entries]
    voices = {row["id"]: row for row in audio["chapters"]}
    script_chapters = {row["id"]: row for row in script["chapters"]}
    sources = {row["id"]: row for row in capture["chapters"] if row.get("success") is True}
    audit.check("chapter_order_and_completeness", actual_ids == expected_ids, {"expected": expected_ids, "actual": actual_ids})
    audit.check("chapter_ids_unique", len(set(actual_ids)) == len(actual_ids))
    audit.check("audio_chapters_match_script", voice_ids == expected_ids)
    audit.check("audio_text_matches_current_script", all(key in script_chapters and normalized_text(voice["narration"]) == normalized_text(script_chapters[key]["narration"]) for key, voice in voices.items()))
    audit.check("audio_manifest_speech_total_consistent", abs(sum(float(voice["seconds"]) for voice in voices.values()) - float(audio.get("totalSpeechSeconds", -1))) < 0.005)
    audit.check("capture_successful_chapters_present", all(key in sources for key in actual_ids))
    declarations = {"captureActualNetwork": capture.get("actualNetwork"), "captureMockedResponses": capture.get("mockedResponses"),
                    "editActualNetwork": edit.get("actualNetwork"), "editLoopedVideo": edit.get("loopedVideo"),
                    "editFreezeFramePadding": edit.get("freezeFramePadding")}
    audit.data["provenanceDeclarations"] = declarations
    audit.check("manifest_declares_real_network_no_mock", capture.get("actualNetwork") is True and capture.get("mockedResponses") is False and edit.get("actualNetwork") is True, declarations)
    audit.check("manifest_declares_no_loop_or_freeze_padding", edit.get("loopedVideo") is False and edit.get("freezeFramePadding") is False, declarations)
    audit.check("approved_synthetic_voice", audio.get("voice") == edit.get("voice") == "zh-CN-YunxiNeural" and audio.get("synthetic") is True and edit.get("syntheticVoice") is True)

    probe = media_probe(final)
    audit.data["finalProbe"] = {"format": probe["format"], "streams": stream_summary(probe)}
    video = [stream for stream in probe["streams"] if stream.get("codec_type") == "video"]
    sound = [stream for stream in probe["streams"] if stream.get("codec_type") == "audio"]
    audit.check("single_video_and_audio_stream", len(video) == 1 and len(sound) == 1)
    if not video or not sound:
        return audit.finish()
    video, sound = video[0], sound[0]
    duration = float(probe["format"]["duration"])
    audit.check("mp4_container", "mp4" in probe["format"].get("format_name", "").split(","))
    audit.check("1920x1080_h264_yuv420p", video.get("codec_name") == "h264" and video.get("width") == 1920 and video.get("height") == 1080 and video.get("pix_fmt") == "yuv420p")
    audit.check("25fps", abs(rate(video.get("avg_frame_rate")) - 25) < 0.001 and abs(rate(video.get("r_frame_rate")) - 25) < 0.001, {"average": video.get("avg_frame_rate"), "nominal": video.get("r_frame_rate")})
    audit.check("aac_48000hz", sound.get("codec_name") == "aac" and int(sound.get("sample_rate", 0)) == 48000)
    if kind == "competition":
        audit.check("competition_300_to_480_seconds", 300 <= duration <= 480, duration)
    else:
        audit.data["tutorialDurationSeconds"] = duration  # Tutorial duration is advisory, not a hard competition rule.
    extents = packet_extents(final)
    audit.data["packetExtents"] = extents
    ve, ae = extents.get(str(video["index"])), extents.get(str(sound["index"]))
    difference = abs(ve["lastEnd"] - ae["lastEnd"]) if ve and ae else None
    audit.check("audio_video_end_difference_under_0_2_seconds", difference is not None and difference < 0.2, {"differenceSeconds": difference, "video": ve, "audio": ae})
    print(f"[{kind}] Full audio/video decode started", flush=True)
    started = time.monotonic()
    decode = subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "error", "-xerror", "-err_detect", "explode", "-threads", "2", "-i", str(final),
         "-map", "0:v:0", "-map", "0:a:0", "-f", "null", "-"],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    audit.check("full_video_and_audio_decode", decode.returncode == 0 and not decode.stderr.strip(),
                {"exitCode": decode.returncode, "seconds": round(time.monotonic() - started, 2), "stderr": decode.stderr[-6000:]})

    accumulated, expected_srt, used_intervals = 0.0, [], {}
    source_probes = {}
    for chapter in entries:
        key = chapter["id"]
        prefix = f"chapter:{key}:"
        if key not in voices or key not in sources:
            audit.check(prefix + "source_and_audio_available", False)
            continue
        voice, source = voices[key], sources[key]
        chapter_file, source_file, audio_file = Path(chapter["file"]), Path(chapter["sourceFile"]), Path(voice["file"])
        required = [chapter_file, source_file, audio_file, out / f"{key}.ass"]
        if not audit.check(prefix + "files_exist", all(path.is_file() for path in required), [str(path) for path in required]):
            continue
        audit.check(prefix + "matches_successful_capture", path_key(source_file) == path_key(source["video"]) and source.get("success") is True)
        audit.check(prefix + "no_conflicting_mock_loop_or_freeze_flags", all(record.get("actualNetwork") is not False and record.get("mockedResponses") is not True and record.get("loopedVideo") is not True and record.get("freezeFramePadding") is not True for record in (source, chapter)))
        audit.check(prefix + "source_has_no_recorded_errors", not source.get("errors"), source.get("errors", []))
        source_key = path_key(source_file)
        if source_key not in source_probes:
            source_probes[source_key] = media_probe(source_file)
        source_duration = float(source_probes[source_key]["format"]["duration"])
        chapter_probe, audio_probe = media_probe(chapter_file), media_probe(audio_file)
        actual_chapter_duration = float(chapter_probe["format"]["duration"])
        actual_audio_duration = float(audio_probe["format"]["duration"])
        current_duration, start, end = (float(chapter[field]) for field in ("duration", "start", "end"))
        offset = float(chapter["narrationOffset"])
        audit.check(prefix + "timeline_contiguous", abs(start - accumulated) < 0.005 and abs(end - start - current_duration) < 0.005,
                    {"start": start, "previousEnd": accumulated, "duration": current_duration, "end": end})
        audit.check(prefix + "duration_matches_media", abs(current_duration - actual_chapter_duration) <= FRAME_TOLERANCE)
        audit.check(prefix + "narration_duration_matches", abs(float(voice["seconds"]) - actual_audio_duration) < 0.025 and abs(float(chapter["narrationSeconds"]) - actual_audio_duration) < 0.025)
        audit.check(prefix + "narration_fits_chapter", offset >= 0 and offset + actual_audio_duration <= current_duration + 0.025,
                    {"offset": offset, "voiceSeconds": actual_audio_duration, "chapterSeconds": current_duration})
        intervals = chapter["sourceIntervals"]
        selected_seconds = sum(float(b) - float(a) for a, b in intervals)
        valid = bool(intervals) and all(0 <= a < b <= source_duration + FRAME_TOLERANCE for a, b in intervals)
        ordered = all(intervals[i - 1][1] <= intervals[i][0] + 0.001 for i in range(1, len(intervals)))
        audit.check(prefix + "source_intervals_valid_and_monotonic", valid and ordered,
                    {"sourceDuration": source_duration, "intervals": intervals})
        audit.check(prefix + "source_duration_covers_output_without_video_padding", abs(selected_seconds - current_duration) <= FRAME_TOLERANCE,
                    {"selectedSourceSeconds": selected_seconds, "outputSeconds": current_duration})
        content_start = float(source.get("contentStart", 0))
        content_end = content_start + float(source["contentSeconds"])
        audit.check(prefix + "intervals_inside_capture_content", all(a >= content_start - 0.005 and b <= content_end + FRAME_TOLERANCE for a, b in intervals))
        used = used_intervals.setdefault(source_key, [])
        overlaps = [{"previousChapter": old_key, "seconds": min(b, old_b) - max(a, old_a)}
                    for a, b in intervals for old_a, old_b, old_key in used if min(b, old_b) - max(a, old_a) > FRAME_TOLERANCE]
        audit.check(prefix + "no_repeated_source_intervals_in_this_final", not overlaps, overlaps)
        used.extend((a, b, key) for a, b in intervals)
        removed = chapter.get("removedWaits", [])
        audit.check(prefix + "cuts_only_in_declared_waits", all(any(float(wait["start"]) - 0.01 <= cut["start"] < cut["end"] <= float(wait["end"]) + 0.01 for wait in source.get("waits", [])) for cut in removed), removed)

        ass_rows = read_ass(out / f"{key}.ass")
        captions = [row for row in ass_rows if row["style"] == "Caption"]
        audio_cues = voice["cues"]
        audit.check(prefix + "ass_all_events_within_chapter", all(0 <= row["start"] < row["end"] <= current_duration + 0.015 for row in ass_rows))
        audit.check(prefix + "synthetic_voice_disclosed", any("神经合成配音" in row["text"] and row["start"] == 0 and abs(row["end"] - current_duration) < 0.015 for row in ass_rows))
        audit.check(prefix + "shortened_wait_disclosed", not removed or any("等待已缩短" in row["text"] for row in ass_rows))
        audit.check(prefix + "caption_count_matches_voice", len(captions) == len(audio_cues), {"ass": len(captions), "voice": len(audio_cues)})
        audit.check(prefix + "voice_cues_complete_and_bounded", bool(audio_cues) and all(0 <= cue["start"] < cue["end"] <= actual_audio_duration + 0.025 for cue in audio_cues)
                    and normalized_text("".join(cue["text"] for cue in audio_cues)) == normalized_text(voice["narration"]))
        audit.check(prefix + "ass_captions_match_voice_times_and_text", len(captions) == len(audio_cues) and all(
            abs(caption["start"] - offset - cue["start"]) <= 0.011 and abs(caption["end"] - offset - cue["end"]) <= 0.011
            and normalized_text(caption["text"]) == normalized_text(cue["text"])
            for caption, cue in zip(captions, audio_cues)))
        boundaries = voice.get("boundaries", [])
        boundary_end = max(((word["offset"] + word["duration"]) / 10_000_000 for word in boundaries), default=math.inf)
        audit.check(prefix + "last_spoken_word_not_trimmed", boundary_end <= actual_audio_duration and offset + boundary_end < current_duration)
        for cue in audio_cues:
            expected_srt.append({"start": start + offset + cue["start"], "end": start + offset + cue["end"], "text": cue["text"]})
        audit.data["chapters"].append({"id": key, "start": start, "end": end, "duration": current_duration,
            "sourceFile": str(source_file), "sourceBytes": source_file.stat().st_size, "sourceDuration": source_duration,
            "sourceIntervals": intervals, "narrationSeconds": actual_audio_duration, "narrationOffset": offset,
            "lastTtsBoundaryEnd": boundary_end, "captionCount": len(captions), "removedWaits": removed,
            "reuseSource": chapter.get("reuseSource"), "assSha256": sha256(out / f"{key}.ass")})
        accumulated = end

    audit.check("chapter_total_matches_final", abs(accumulated - duration) < 0.2,
                {"chapterTotal": accumulated, "finalDuration": duration, "manifestTotal": edit.get("totalSeconds")})
    audit.check("edit_manifest_total_consistent", abs(float(edit.get("totalSeconds", -1)) - accumulated) < 0.005)
    srt = read_srt(paths["subtitles"])
    audit.check("srt_caption_count_and_indices", len(srt) == len(expected_srt) and [cue["index"] for cue in srt] == list(range(1, len(srt) + 1)), {"actual": len(srt), "expected": len(expected_srt)})
    audit.check("srt_matches_all_chapter_voice_cues", len(srt) == len(expected_srt) and all(
        abs(actual["start"] - expected["start"]) <= 0.002 and abs(actual["end"] - expected["end"]) <= 0.002
        and normalized_text(actual["text"]) == normalized_text(expected["text"])
        for actual, expected in zip(srt, expected_srt)))
    audit.check("srt_boundaries_and_no_overlap", all(0 <= cue["start"] < cue["end"] <= duration for cue in srt)
                and all(srt[i - 1]["end"] <= srt[i]["start"] + 0.002 for i in range(1, len(srt))))
    if extract and actual_ids == expected_ids and all(key in voices for key in actual_ids):
        print(f"[{kind}] Extracting {len(entries) * 3} full-size frames", flush=True)
        destination = HERE / "verification-frames" / kind
        frames = extract_frames(final, entries, voices, destination)
        audit.data["frames"] = frames
        audit.data["contactSheet"] = make_contact_sheet(frames, destination / "contact-sheet.jpg")
        (destination / "index.json").write_text(json.dumps({"kind": kind, "finalSha256": audit.data["inputs"]["final"]["sha256"],
            "frames": frames, "visualReview": "pending_actual_frame_inspection"}, ensure_ascii=False, indent=2), encoding="utf-8")
        audit.check("verification_frames_extracted", len(frames) == len(entries) * 3)
    elif not extract:
        audit.data["visualReview"] = "not_requested_no_frames_extracted"
    return audit.finish()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--kind", choices=[*KINDS, "both"], default="both")
    parser.add_argument("--no-frames", action="store_true", help="Run machine checks without frame extraction.")
    parser.add_argument("--output", type=Path, default=HERE / "final-video-QA.json")
    parser.add_argument("--preflight", action="store_true", help="Check tools/input schemas only; do not require or decode unfinished final videos.")
    args = parser.parse_args()
    for tool in ("ffmpeg", "ffprobe"):
        if not shutil.which(tool):
            parser.error(f"Required local tool not found: {tool}")
    kinds = KINDS if args.kind == "both" else (args.kind,)
    if args.preflight:
        for kind in kinds:
            audio = read_json(HERE / "audio" / kind / "manifest.json")
            capture = read_json(HERE / ("capture-manifest.json" if kind == "competition" else "tutorial-capture-manifest.json"))
            assert isinstance(audio["chapters"], list) and isinstance(capture["chapters"], list)
            assert all(row.get("file") and row.get("cues") and row.get("boundaries") for row in audio["chapters"])
            print(f"[{kind}] preflight passed; {len(audio['chapters'])} narration chapters; final verification not run")
        assert abs(parse_time("0:01:02.34") - 62.34) < 1e-9
        assert abs(parse_time("00:01:02,340") - 62.34) < 1e-9
        assert source_to_output(5, [[1, 3], [4, 7]]) == 3
        assert source_to_output(3.5, [[1, 3], [4, 7]]) is None
        return 0
    report = {"checkedAt": datetime.now(timezone.utc).isoformat(), "tool": str(Path(__file__).resolve()),
              "toolSha256": sha256(Path(__file__).resolve()), "localOnly": True, "networkAccess": False,
              "modelCalls": False, "humanListeningPerformed": False, "videos": [],
              "limitations": ["Network authenticity is checked through capture/edit declarations and source-file correspondence, not inferred from screenshots.",
                              "No-loop and no-freeze padding checks validate declarations, monotonic source intervals, non-reuse, and source/output durations.",
                              "Static application reading states are legitimate recordings; static-looking frames are not evidence of padding.",
                              "Extracted images require actual visual inspection. No human listening or phonetic accuracy judgment is performed by this tool."]}
    for kind in kinds:
        try:
            result = verify_kind(kind, extract=not args.no_frames)
        except Exception as error:
            result = {"kind": kind, "machinePassed": False, "errorType": type(error).__name__, "error": str(error),
                      "visualReview": "not_completed", "humanListeningPerformed": False}
        report["videos"].append(result)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps({"kind": kind, "machinePassed": result["machinePassed"], "failedChecks": result.get("failedChecks", []), "error": result.get("error")}, ensure_ascii=False), flush=True)
    report["completedAt"] = datetime.now(timezone.utc).isoformat()
    report["machinePassed"] = all(video["machinePassed"] for video in report["videos"])
    report["visualReview"] = "pending_actual_frame_inspection"
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Machine verification report: {args.output}")
    return 0 if report["machinePassed"] else 1


if __name__ == "__main__":
    sys.exit(main())
