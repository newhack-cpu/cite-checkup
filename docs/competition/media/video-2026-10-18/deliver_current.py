"""Publish verified local MP4s, preserving the previous video and audit records."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import shutil
import subprocess

HERE = Path(__file__).resolve().parent
COMPETITION = HERE.parent.parent
OUTPUT = COMPETITION / "output" / "video"
BACKUP = OUTPUT / "history-2026-10-14"


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def write(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def digest(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def main():
    qa = read(HERE / "final-video-QA.json")
    visual = read(HERE / "visual-QA.json")
    if not qa.get("machinePassed") or not visual.get("passed"):
        raise RuntimeError("Complete machine and actual visual review before publishing")
    for name in ["引用体检-完整演示-1080p.mp4", "video-verification.json", "recording-timing.json"]:
        if not (BACKUP / name).is_file():
            raise RuntimeError("Missing historical backup: " + name)
    delivered = []
    timing = {"createdAt": datetime.now(timezone.utc).isoformat(), "date": "2026-10-18",
              "actualNetworkRecording": True, "mockedResponses": False,
              "voice": "zh-CN-YunxiNeural", "syntheticVoice": True,
              "loopedVideo": False, "freezeFramePadding": False, "videos": []}
    for kind, name, verification in [
        ("competition", "引用体检-完整演示-1080p.mp4", "video-verification.json"),
        ("tutorial", "引用体检-老师操作教程-1080p.mp4", "tutorial-video-verification.json")
    ]:
        edit = read(HERE / "edit" / kind / "edit-manifest.json")
        machine = next(v for v in qa["videos"] if v["kind"] == kind)
        source, target = Path(edit["joinedFile"]), OUTPUT / name
        probe = json.loads(subprocess.check_output([
            "ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(source)
        ], encoding="utf-8"))
        expected = digest(source)
        # The audit's hash must refer to the exact bytes being published.
        audited = machine["inputs"]["final"]["sha256"]
        if audited.lower() != expected.lower():
            raise RuntimeError("Final video changed after QA")
        shutil.copy2(source, target)
        if digest(target) != expected:
            raise RuntimeError("Delivery checksum mismatch")
        subtitle = OUTPUT / (target.stem + ".srt")
        shutil.copy2(HERE / "edit" / kind / "subtitles.srt", subtitle)
        chapters = [{k: c[k] for k in ["id", "title", "start", "duration", "end", "narrationSeconds",
                    "sourceFile", "sourceIntervals", "removedWaits", "removedReadingTailSeconds", "reuseSource"]}
                    for c in edit["chapters"]]
        for chapter, original in zip(chapters, edit["chapters"]):
            chapter["frameEndTrimSeconds"] = original.get("frameEndTrimSeconds", 0)
        record = {"verified": True, "verifiedAt": datetime.now(timezone.utc).isoformat(),
                  "kind": kind, "file": str(target), "sha256": expected, "subtitles": str(subtitle),
                  "baselineCommit": "474c66a", "productSourceChangedDuringVideoWork": False,
                  "ordinaryMandarin": "zh-CN-YunxiNeural neural synthetic voice, rate -5%",
                  "humanRecording": False, "humanListeningPerformed": False,
                  "audioReview": str(HERE / "audio-QA.json"), "visualReview": visual,
                  "actualNetworkRecording": True, "mockedResponses": False,
                  "loopedVideo": False, "freezeFramePadding": False,
                  "editingNote": "Actual production recordings; waits shortened only where listed and marked on-screen. Synthetic demonstration inputs are labelled. Neural narration and burned captions are added; application results are unchanged.",
                  "probe": probe, "machineAudit": machine, "chapters": chapters,
                  "captureManifest": str(HERE / ("capture-manifest.json" if kind == "competition" else "tutorial-capture-manifest.json")),
                  "productionNotes": str(HERE.parent / "README.md"),
                  "historicalBackupDirectory": str(BACKUP)}
        write(OUTPUT / verification, record)
        timing["videos"].append({"kind": kind, "file": str(target), "sha256": expected,
                                 "totalSeconds": float(probe["format"]["duration"]), "chapters": chapters})
        delivered.append({"kind": kind, "file": str(target), "sha256": expected,
                          "seconds": float(probe["format"]["duration"]), "bytes": target.stat().st_size,
                          "verification": str(OUTPUT / verification)})
    write(HERE.parent / "recording-timing.json", timing)
    write(HERE / "delivery-manifest.json", {"deliveredAt": datetime.now(timezone.utc).isoformat(), "videos": delivered})
    print(json.dumps(delivered, ensure_ascii=True, indent=2))


if __name__ == "__main__":
    main()
