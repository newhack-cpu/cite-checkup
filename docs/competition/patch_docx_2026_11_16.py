# -*- coding: utf-8 -*-
"""11-16 晚给两份定稿 Word 补内容（作品介绍、技术说明），改完用 finish_technical_docx.py 更新目录并导出 PDF。
每一处都先核对原文完全匹配才改，有一处对不上就整体退出、不保存。
补的内容：AI 六项对照卡（图）、批量 AI 追查、BibTeX 导出、双语引文作者比对、拼音姓名颠倒纠正、本机向量召回（改掉“没有做向量检索”的旧说法）、
持续集成与测试数、首屏性能与运行成本（新 6.6 节）、推广与商业模式（新 8.5 节）。数字来源见各段括号与 eval/results/。
用法（项目根目录）：python docs/competition/patch_docx_2026_11_16.py
"""
import copy
import sys
from pathlib import Path

import docx
from docx.shared import Cm
from docx.table import Table
from docx.text.paragraph import Paragraph

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parent
DOCX = ROOT / "output" / "docx"
CARD = ROOT / "media" / "slides" / "slide-03-ai-map.png"
W_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def fail(msg):
    raise SystemExit("没有保存：" + msg)


def set_text(par, text):
    runs = par.runs
    if not runs:
        par.add_run(text)
        return
    runs[0].text = text
    for r in runs[1:]:
        r._r.getparent().remove(r._r)


def strip_bookmarks(el):
    for tag in ("bookmarkStart", "bookmarkEnd"):
        for b in el.iter(W_NS + tag):
            b.getparent().remove(b)


def clone_after(anchor_el, template_par, text):
    new = copy.deepcopy(template_par._p)
    strip_bookmarks(new)
    anchor_el.addnext(new)
    p = Paragraph(new, template_par._parent)
    set_text(p, text)
    return p


def replace_in(par, old, new):
    if par.text.count(old) != 1:
        fail(f"找不到唯一的原文「{old[:30]}」，段落为「{par.text[:40]}」")
    set_text(par, par.text.replace(old, new))


def append_to(par, tail, expect_end):
    if not par.text.endswith(expect_end):
        fail(f"段落结尾不是「{expect_end}」：「{par.text[-40:]}」")
    set_text(par, par.text + tail)


def find(doc, start, expect=None, style=None):
    for p in doc.paragraphs:
        if p.text.startswith(start) and (style is None or p.style.name == style):
            if expect and expect not in p.text:
                fail(f"段落「{start}」里没有「{expect}」")
            return p
    fail(f"找不到以「{start}」开头的段落")


def picture_after(anchor_el, template_pic_par, image, width_cm):
    new = copy.deepcopy(template_pic_par._p)
    strip_bookmarks(new)
    for r in list(new.iter(W_NS + "r")):
        r.getparent().remove(r)
    anchor_el.addnext(new)
    p = Paragraph(new, template_pic_par._parent)
    p.add_run().add_picture(str(image), width=Cm(width_cm))
    return p


def set_cell(cell, text):
    pars = cell.paragraphs
    set_text(pars[0], text)
    for extra in pars[1:]:
        extra._p.getparent().remove(extra._p)


def table_after(anchor_el, template_tbl, rows):
    """套用模板三线表：首行表头、末行带下框线，中间行按模板第 2 行复制或删减"""
    new = copy.deepcopy(template_tbl._tbl)
    anchor_el.addnext(new)
    t = Table(new, template_tbl._parent)
    if len(t.columns) != len(rows[0]):
        fail("模板表列数不对")
    while len(t.rows) < len(rows):
        t.rows[-1]._tr.addprevious(copy.deepcopy(t.rows[1]._tr))
    while len(t.rows) > len(rows):
        t._tbl.remove(t.rows[-2]._tr)
    for r, data in zip(t.rows, rows):
        for c, text in zip(r.cells, data):
            set_cell(c, text)
    return t


def pic_template(doc):
    ps = doc.paragraphs
    for i, p in enumerate(ps[:-1]):
        if "graphicData" in p._p.xml and ps[i + 1].style.name == "Caption" and ps[i + 1].text.startswith("图"):
            return p, ps[i + 1]
    fail("找不到图片段落模板")


def diagram_cell(table, old_first_run, new_first_run):
    for row in table.rows:
        for cell in row.cells:
            for p in cell.paragraphs:
                if p.runs and p.runs[0].text == old_first_run:
                    p.runs[0].text = new_first_run
                    return
    fail(f"流程图里找不到「{old_first_run}」")


# ---------- 共用文字 ----------
H6 = "查不到的一键交给 AI 批量追查：每次最多 6 条逐条排队，整批显示进度、检索次数和规则确认了几条；整理好的参考文献可导出 BibTeX，直接导入 Zotero、EndNote 或 LaTeX"
H7 = "成本低、能推广：标准体检不调用大模型，Crossref、OpenAlex 等开放数据库免费；中文期刊联网核查每条约 0.01 元，AI 继续查每条不到 0.06 元，一篇 30 条参考文献的论文做一次标准体检不超过 0.3 元（按 DeepSeek 2026-11-16 官方价格估算）"
TEST_OLD = "自动测试 45 个文件 728 项，用固定的上游响应覆盖边界与回归。"
TEST_NEW = "自动测试 49 个文件 783 项，用固定的上游响应覆盖边界与回归，每次提交由 GitHub Actions 自动运行类型检查、lint、全部测试和生产构建。"
CARD_CAPTION = "AI 技术深度六项对照：每项对应的功能、实测数字和演示视频段落"

# ---------- 作品介绍 ----------
intro_path = DOCX / "引用体检-作品介绍.docx"
d = docx.Document(intro_path)
h5 = find(d, "（5）贴合论文写作的实际环节")
p6 = clone_after(h5._p, h5, f"（6）{H6}（详见技术说明 4.2、5.2 节）。")
clone_after(p6._p, h5, f"（7）{H7}，详见技术说明 6.6、8.5 节。")
sec3 = find(d, "3　AI 测试技术落地使用情况概述", style="Heading 1")
pic_t, cap_t = pic_template(d)
pic = picture_after(sec3._p, pic_t, CARD, 15.5)
clone_after(pic._p, cap_t, f"图 3-1　{CARD_CAPTION}")
replace_in(find(d, "测试情况：自动测试"), TEST_OLD, TEST_NEW)
append_to(find(d, "（2）规则核验："), "中文条目附英文译名时比对两段作者，数据库拼音登记把姓和名弄反时，规范写法按引文的汉字作者调回。", "文献真伪结论只由规则给出。")
append_to(find(d, "（3）大模型函数调用："), "体检完成后可一键批量追查待处理条目。", "找到的候选一律交给规则逐字段复核。")
replace_in(find(d, "（5）论断检索增强生成"), "用 BM25 加模型扩展检索词做混合检索", "用 BM25、本机向量召回（multilingual-e5-small，在服务器本地运行）和模型扩展检索词做混合检索")
dep = find(d, "（9）部署：")
clone_after(dep._p, dep, "（10）工程质量：GitHub Actions 持续集成，每次提交在干净环境里自动运行类型检查、lint、783 项测试和生产构建。")
diagram_cell(d.tables[2], "BM25 + ", "BM25 + 向量 + ")
d.save(intro_path)
print("作品介绍：已改")

# ---------- 技术说明 ----------
tech_path = DOCX / "引用体检-技术说明.docx"
d = docx.Document(tech_path)
h5 = find(d, "（5）贴合论文写作的实际环节")
p6 = clone_after(h5._p, h5, f"（6）{H6}（见 4.2、5.2 节）。")
clone_after(p6._p, h5, f"（7）{H7}，见 6.6、8.5 节。")
replace_in(find(d, "测试情况：自动测试"), TEST_OLD, TEST_NEW)
ai_test = find(d, "测试中也用到了 AI：")
pic_t, cap_t = pic_template(d)
pic = picture_after(ai_test._p, pic_t, CARD, 15.5)
clone_after(pic._p, cap_t, f"图 1-1　{CARD_CAPTION}")
agent = find(d, "对“无法核验 / 只找到相近候选”的条目，用户可点“AI 继续查”。")
clone_after(agent._p, agent, "体检完成后，结果上方会列出可以交给 AI 的条目数，点一下即可批量追查：每次最多 6 条（接口限每个访客每分钟 6 次），逐条排队，各条的检索步骤显示在自己的卡片上，整批显示进度、检索次数和规则确认了几条；可随时停止，触发限流时停下并说明原因。")
append_to(find(d, "体检完成后，可以把整份参考文献统一成"), "整理好的列表可导出 BibTeX，只含数据库确认是同一篇的条目，字段取自数据库记录。Crossref 把中国作者的姓和名登记反了时（如杨敏登记为 family“Min”、given“YANG”），规范写法按引文的汉字作者调回，并加注说明。", "规范写法只用数据库记录生成，不让模型编写。")
append_to(find(d, "2. 中文证据链："), "中文条目附英文译名时还比对两段作者：译名里过半数的拼音作者在中文作者和数据库登记的作者里都找不到对应的人，就判信息有误。", "核对不上只给相近候选。")
replace_in(find(d, "3. 论断 RAG："), "BM25 与模型扩展的中英文检索词融合", "BM25、本机向量召回与模型扩展的中英文检索词融合")
hybrid = find(d, "多于 6 段时，原论断的 BM25", expect="DeepSeek 没有向量接口")
set_text(hybrid, "多于 6 段时，原论断的 BM25（英文按词、中文按相邻两字）、模型扩展检索词（中英文同义词、缩写）的 BM25，以及本机向量召回（multilingual-e5-small，ONNX 量化版，384 维，在服务器本地运行、不调用外部接口）按倒数排名融合取 20 段，再由模型按 0–3 分重排，取前 6 段交给判断。两步输出逐项校验：检索词不能含网址，重排只能用候选片段的编号；扩展或重排失败时退回“词面 + 向量”检索，并在结果中说明。")
# 表 4-1 论断 RAG 一行的优化策略
rag_row = [r for r in d.tables[6].rows if r.cells[0].text.startswith("论断 RAG")]
if len(rag_row) != 1:
    fail("表 4-1 里找不到论断 RAG 一行")
cell = rag_row[0].cells[2]
if "没有向量接口，用 BM25 与扩展检索词融合补跨语言召回" not in cell.text:
    fail("表 4-1 论断 RAG 的优化策略和预期不同")
set_cell(cell, cell.text.replace("没有向量接口，用 BM25 与扩展检索词融合补跨语言召回", "BM25、本机向量召回（multilingual-e5-small）与扩展检索词融合，补跨语言召回"))
diagram_cell(d.tables[4], "BM25 + ", "BM25 + 向量 + ")
diagram_cell(d.tables[13], "BM25 + ", "BM25 + 向量 + ")
# 表 6-2 加向量召回的几行（11-12 重跑，同一批 24 条，eval/results/retrieval-2026-11-12-vector.json）
t62 = d.tables[24]
if [c.text for c in t62.rows[-1].cells] != ["+ 模型重排（现在的默认）", "100%", "0.98", "100%"]:
    fail("表 6-2 末行和预期不同")
for data in (["词面 + 本机向量（不调用大模型）", "96%", "0.75", "92%"], ["只用本机向量（不调用大模型）", "88%", "0.66", "92%"]):
    new = copy.deepcopy(t62.rows[1]._tr)
    t62.rows[1]._tr.addnext(new)
    for c, text in zip(Table(t62._tbl, t62._parent).rows[2].cells, data):
        set_cell(c, text)
before_last = copy.deepcopy(t62.rows[1]._tr)
t62.rows[-1]._tr.addprevious(before_last)
t62 = Table(t62._tbl, t62._parent)
for c, text in zip(t62.rows[-2].cells, ["+ 模型重排（加向量之前的默认）", "100%", "0.98", "100%"]):
    set_cell(c, text)
for c, text in zip(t62.rows[-1].cells, ["+ 本机向量召回（现在的默认）", "100%", "0.98", "100%"]):
    set_cell(c, text)
append_to(find(d, "24 条的出处句子只有 2 条在摘要里"), "11-12 加入本机向量召回后用同一批 24 条重跑：不调用大模型时，词面加向量的命中率由 75% 升到 96%，中文 12 条由 50% 升到 92%，扩展或重排失败时的退路因此更稳；完整流程本来就是 100%，加向量后没有变化，不能据此说检索更准了。", "重排把出处片段排到第 1 位（23/24）。")
repro = find(d, "自动测试中的固定上游响应保证可重复性")
clone_after(repro._p, repro, "仓库配置了 GitHub Actions 持续集成：每次提交在 Ubuntu 上从干净环境安装依赖，运行类型检查、lint、全部 783 项测试和生产构建，结果显示在 README 页首的徽章上。")
# 新 6.6 节：放在第 7 章标题前
ch7 = find(d, "7　创新点", style="Heading 1")
h2_t = find(d, "6.5　运行、配置、部署与复现", style="Heading 2")
body_t = find(d, "源码可在本地运行，另在魔搭创空间部署了公网演示")
cap_t = find(d, "表 6-7　运行、配置与部署步骤", style="Caption")
anchor = ch7._p.getprevious()
h = clone_after(anchor, h2_t, "6.6　首屏性能与运行成本")
b1 = clone_after(h._p, body_t, "本机生产构建，用 Edge 和 Playwright 测首屏：PerformanceObserver 取最大内容绘制（LCP）、累计布局偏移（CLS）和长任务，DevTools 协议模拟手机网络与 CPU，每种条件测 3 次取中位数（记录在 eval/results/perf-2026-11-16/）。这不是 Lighthouse 评分。")
c1 = clone_after(b1._p, cap_t, "表 6-8　首屏性能实测")
t1 = table_after(c1._p, d.tables[24], [
    ["指标", "桌面（不限速）", "模拟手机（CPU 降速 4 倍、1.6 Mbps）", "说明"],
    ["首次内容绘制 FCP", "0.47 秒", "1.42 秒", "页面开始有内容"],
    ["最大内容绘制 LCP", "0.47 秒", "4.22 秒", "手机慢网下主要在等中文衬线字体"],
    ["累计布局偏移 CLS", "0", "0.116", "良好线为 0.1"],
    ["长任务总阻塞时间", "5 毫秒", "约 1.0 秒", "CPU 降速 4 倍后"],
    ["首屏传输", "1.29 MB", "1.29 MB", "脚本 178 KB，字体约 0.98 MB，31 个请求"],
])
b2 = clone_after(t1._tbl, body_t, "桌面端各项都在 Web Vitals 的“良好”范围内；模拟手机慢网时 LCP 和总阻塞时间偏高，主要是首屏要下载约 0.98 MB 的中文衬线字体分片，脚本本身只有 178 KB。下一步按页面实际用到的字减少字体分片，或首屏标题改用系统字体。")
c2 = clone_after(b2._p, cap_t, "表 6-9　单条引文的运行成本（估算）")
t2 = table_after(c2._p, d.tables[26], [
    ["环节", "调用", "每条成本"],
    ["标准体检（规则核验）", "Crossref、OpenAlex、doi.org 等开放数据库，不调用大模型", "0"],
    ["中文期刊联网核查", "平均约 2 次 DeepSeek 搜索（每千次 5 元），页面由服务器直接读取", "约 0.01 元"],
    ["AI 继续查", "平均约 5.8 千 token（deepseek-flash 高峰时段输入每百万 2 元、输出 8 元），另有约 1.2 次中文检索", "不到 0.06 元（token 全按输出价计的上限）"],
    ["部署", "魔搭创空间免费 2 核 8 GB Docker 资源", "0"],
])
clone_after(t2._tbl, body_t, "价格取自 DeepSeek 官方价格页（2026-11-16 查看，空闲时段减半）；token 数取自 10-17 的中文 Agent 评测（README“AI 检索 Agent 评测”）。按此估算，一篇 30 条参考文献的论文做一次标准体检不超过 0.3 元，即使全部交给 AI 追查也不到 2 元。")
# 新 8.5 节：放在附录 A 标题前
appx = find(d, "附录 A　证据索引与提交对应", style="Heading 1")
h8 = find(d, "8.4　下一阶段优先级", style="Heading 2")
b8 = find(d, "前三次盲测的误报在 9%–12%")
anchor = appx._p.getprevious()
h = clone_after(anchor, h8, "8.5　推广与商业模式")
clone_after(h._p, b8, "面向的用户是写论文的学生和指导老师，以及需要批量把关参考文献的研究生院、期刊编辑部和图书馆。设想分三层：标准体检免费，不调用大模型，成本接近零；AI 继续查、论断核查这类调用大模型的功能按次或包月计费，单条成本在几分钱以内（见 6.6 节）；面向学校和期刊提供批量核查、API / MCP 接入和私有部署。推广上先在本校研究生和指导老师中试用，用试用记录表收集复核时间和误报，再决定是否接入写作工具（BibTeX 导出已经可用）。以上是设想，目前还没有真实的付费或留存数据。")
d.save(tech_path)
print("技术说明：已改")

# 补改（第一次运行后发现）：表 6-1 单元格里的测试数
d = docx.Document(tech_path)
cells = {id(par): par for t in d.tables for r in t.rows for c in r.cells for par in c.paragraphs if "45 个文件 728 项" in par.text}
if len(cells) != 1:
    fail("表 6-1 里找不到唯一的测试数")
set_text(*cells.values(), list(cells.values())[0].text.replace("45 个文件 728 项", "49 个文件 783 项（GitHub Actions 每次提交自动运行）"))
d.save(tech_path)
print("技术说明：表 6-1 测试数已改")

# 补改：表 6-9 套用的模板列宽不合适，“调用”一列太窄
d = docx.Document(tech_path)
t69 = [t for t in d.tables if [c.text for c in t.rows[0].cells] == ["环节", "调用", "每条成本"]]
if len(t69) != 1:
    fail("找不到表 6-9")
for i, w in enumerate([Cm(3.4), Cm(8.6), Cm(4.0)]):
    t69[0].columns[i].width = w
    for cell in t69[0].columns[i].cells:
        cell.width = w
d.save(tech_path)
print("技术说明：表 6-9 列宽已调")
