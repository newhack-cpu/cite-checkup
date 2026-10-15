# 演示视频源文件

正式视频位于 `../output/video/引用体检-完整演示-1080p.mp4`；时长、编码和分辨率以同目录 `video-verification.json` 为准。

- `incomplete-demo.webm`：前六章1920×1080实际操作原始录屏。公开摘要支持、合成支持/矛盾成功；最后一次新措辞论断的模型输出被拒绝，页面真实显示未完成。
- `continuation.webm`：第七/八章技术说明、手机验收截图和首页的实际录制。成片在第六章最后一帧短暂停留以完成失败处理旁白，然后拼接这两章；未把失败改成成功。
- `recording-timing.json`：实际章节起止、网络模式、异常与成功标记。
- `claim-*.json`、`reference-live-page.txt`、`demo-reference-report.md`：正式录制过程的真实响应和下载产物。
- `narration/*.wav`：Windows Microsoft Huihui Desktop 通用普通话合成声音，非真人声纹克隆；稿件为上一级 `narration.json`。
- `verification-frames/`：由最终MP4逐章抽取的验收帧。
- `rehearsal/`：快进彩排，文献和论断使用预先保存的响应回放；只用于验证脚本定位，**不作为正式视频或真实模型验收证据**。

正式录制不拦截模型/数据库响应；公开文献与标明虚构的合成研究各自按来源展示。`assemble_demo.py` 会拒绝未成功录制、回放模式或不满足5–8分钟的视频。导出为H264/AAC MP4，保留原录屏和独立旁白便于重新剪辑。

本次`recording-timing.json`的`success`只表示8章录制完整，**不表示所有模型调用成功**；第6章`boundaryOutcome`保留真实`INVALID_MODEL_RESPONSE`。原停止时的元数据在`initial-recording-timing.json`，续录由`record-ending.cjs`验证这个已知失败后执行；独立联网四例冒烟的成功结果与这次演示失败分开保留。

在项目根目录运行（本机需 Playwright Chromium、ffmpeg/ffprobe，Python需reportlab/python-docx）：

```powershell
# 如修改了旁白，先本地重新合成
& ./docs/competition/media/generate-narration.ps1
python docs/competition/media/prepare_media.py
# 先启动已构建、已配置的本地生产服务3210；以下会发生真实模型/数据库调用
node docs/competition/media/record-demo.cjs
python docs/competition/media/assemble_demo.py
```

录制前确认技术HTML与手机生产截图已验收。脚本默认使用本机Playwright安装位置，可用`PLAYWRIGHT_MODULE`修改；服务地址可用`DEMO_BASE_URL`修改。`DEMO_REHEARSAL=1`只生成隔离彩排文件，不得用于正式导出。再次录制前自行备份需要保留的旧成片。
