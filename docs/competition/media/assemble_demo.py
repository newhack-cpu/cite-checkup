"""Combine actual unmodified browser recording with locally synthesized narration."""
from pathlib import Path
import json, subprocess, sys

HERE = Path(__file__).resolve().parent
timing = json.loads((HERE / 'recording-timing.json').read_text(encoding='utf-8'))
assert timing.get('success'), 'Do not export an incomplete or failed recording as the final demo.'
assert timing.get('actualNetwork') and not timing.get('mockResponses'), 'Final video must use actual API responses.'
duration = timing['chapters'][-1]['end'] + 0.4
assert 300 <= duration <= 480, f'Official duration requires 300-480 seconds, got {duration}'
out = HERE.parent / 'output/video'
out.mkdir(parents=True, exist_ok=True)
parts = timing.get('videoParts', [{'file': 'actual-demo.webm'}])
command = ['ffmpeg', '-y']
for part in parts:
    command += ['-i', str(HERE / part['file'])]
filters = []
if len(parts) > 1:
    for j, part in enumerate(parts):
        if part.get('reframeFromSeconds'):
            split_at = part['reframeFromSeconds']
            filters.append(f'[{j}:v]fps=25,split=2[pre{j}][post{j}]')
            filters.append(f'[pre{j}]trim=end={split_at},setpts=PTS-STARTPTS[precut{j}]')
            filters.append(f'[post{j}]trim=start={split_at},setpts=PTS-STARTPTS,crop={part["cropWidth"]}:1080:0:0,scale=1920:-2,crop=1920:1080:0:0,setsar=1[postcut{j}]')
            chain = f'[precut{j}][postcut{j}]concat=n=2:v=1:a=0'
        else:
            chain = f'[{j}:v]fps=25,setpts=PTS-STARTPTS'
        if part.get('padToSeconds'):
            chain += f',tpad=stop_mode=clone:stop_duration=30,trim=duration={part["padToSeconds"]:.6f}'
        filters.append(chain + f'[screen{j}]')
    filters.append(''.join(f'[screen{j}]' for j in range(len(parts))) + f'concat=n={len(parts)}:v=1:a=0[screen]')
for i, chapter in enumerate(timing['chapters']):
    command += ['-i', str(HERE / 'narration' / (chapter['id'] + '.wav'))]
    filters.append(f'[{i+len(parts)}:a]adelay={round(chapter["start"]*1000)}:all=1[a{i}]')
filters.append(''.join(f'[a{i}]' for i in range(len(timing['chapters']))) + f'amix=inputs={len(timing["chapters"])}:normalize=0,alimiter=limit=0.95,apad[audio]')
target = out / '引用体检-完整演示-1080p.mp4'
command += ['-filter_complex', ';'.join(filters), '-map', '[screen]' if len(parts) > 1 else '0:v:0', '-map', '[audio]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '25', '-c:a', 'aac', '-b:a', '160k', '-t', f'{duration:.3f}', '-movflags', '+faststart', str(target)]
if '--verify-only' not in sys.argv:
    with (HERE / 'ffmpeg-export.log').open('w', encoding='utf-8') as log:
        subprocess.run(command, stdout=log, stderr=log, check=True)
probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_format', '-show_streams', '-of', 'json', str(target)], text=True, encoding='utf-8'))
video = next(s for s in probe['streams'] if s['codec_type'] == 'video')
audio = next(s for s in probe['streams'] if s['codec_type'] == 'audio')
assert video['width'] == 1920 and video['height'] == 1080
assert video['codec_name'] == 'h264' and audio['codec_name'] == 'aac'
assert 300 <= float(probe['format']['duration']) <= 480
(out / 'video-verification.json').write_text(json.dumps({'verified': True, 'ordinaryMandarin': 'Windows SAPI Microsoft Huihui Desktop synthetic voice', 'actualNetworkRecording': True, 'editingNote': timing.get('editingNote', 'One continuous actual browser recording.'), 'sourceParts': parts, 'boundaryOutcomes': [c['boundaryOutcome'] for c in timing['chapters'] if c.get('boundaryOutcome')], 'probe': probe}, ensure_ascii=False, indent=2), encoding='utf-8')
frames = HERE / 'verification-frames'
frames.mkdir(exist_ok=True)
for i, chapter in enumerate(timing['chapters']):
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-ss', str(chapter['start'] + min(25, chapter['narrationSeconds']/2)), '-i', str(target), '-frames:v', '1', str(frames / f'{i+1:02d}.jpg')], check=True)
print(json.dumps({'video': str(target), 'duration': float(probe['format']['duration']), 'resolution': '1920x1080', 'audio': audio['codec_name']}, ensure_ascii=False))
