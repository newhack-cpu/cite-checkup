"""用本机 Word 更新技术说明 Word 版的目录页码和域，再把文档属性里的作者改回“引用体检项目组”。

用法：python docs/competition/finish_technical_docx.py [预览 PDF 路径]
先运行 build_technical_docx.mjs。只在装了 Word 的 Windows 上用：这台电脑 PowerShell 调 Word COM 会报类型库错误，
所以用 cscript 跑 JScript 晚绑定。开着 Word 时不运行，免得动到正在编辑的文档；结束时退出它自己启动的 Word。
"""
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
DOCX = HERE / 'output' / 'docx' / '引用体检-技术说明.docx'
AUTHOR = '引用体检项目组'
JS = r'''
var a = WScript.Arguments, w = new ActiveXObject("Word.Application");
w.Visible = false; w.DisplayAlerts = 0;
try {
  var d = w.Documents.Open(a(0), false, false, false);
  for (var i = 1; i <= d.TablesOfContents.Count; i++) d.TablesOfContents(i).Update();
  d.Fields.Update();
  d.Save();
  if (a.length > 1) d.ExportAsFixedFormat(a(1), 17, false, 0, 0, 1, 1, 0, true, true, 1);
  WScript.Echo("pages=" + d.ComputeStatistics(2));
  d.Close(0);
} finally { w.Quit(0); }
'''


def word_running() -> bool:
    out = subprocess.run(['tasklist', '/FI', 'IMAGENAME eq WINWORD.EXE', '/NH'], capture_output=True, text=True).stdout
    return 'WINWORD.EXE' in out.upper()


def clean_properties(path: Path) -> None:
    """Word 保存时会把本机用户名写进“最后修改者”、把单位写进 Company；改成项目组、清空单位"""
    tmp = path.with_suffix('.tmp')
    with zipfile.ZipFile(path) as src, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as dst:
        for item in src.infolist():
            data = src.read(item.filename)
            if item.filename == 'docProps/core.xml':
                text = data.decode('utf-8')
                for tag in ('dc:creator', 'cp:lastModifiedBy'):
                    text = re.sub(rf'<{tag}>.*?</{tag}>|<{tag}/>', f'<{tag}>{AUTHOR}</{tag}>', text, flags=re.S)
                data = text.encode('utf-8')
            elif item.filename == 'docProps/app.xml':
                data = re.sub(rb'<Company>.*?</Company>', b'<Company></Company>', data, flags=re.S)
                data = re.sub(rb'<Manager>.*?</Manager>', b'<Manager></Manager>', data, flags=re.S)
            dst.writestr(item, data)
    tmp.replace(path)


if word_running():
    sys.exit('Word 正在运行：先保存并关闭 Word 再执行，免得影响正在编辑的文档。')
preview = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else None
with tempfile.TemporaryDirectory() as tmp:
    work = Path(tmp)
    (work / 'update.js').write_text(JS, encoding='ascii')
    shutil.copy(DOCX, work / 'tech.docx')
    args = ['cscript', '//nologo', str(work / 'update.js'), str(work / 'tech.docx')] + ([str(work / 'tech.pdf')] if preview else [])
    result = subprocess.run(args, capture_output=True, text=True, timeout=300)
    if result.returncode != 0:
        sys.exit(result.stdout + result.stderr)
    shutil.copy(work / 'tech.docx', DOCX)
    if preview:
        preview.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(work / 'tech.pdf', preview)
clean_properties(DOCX)
print(result.stdout.strip(), DOCX, preview or '')
