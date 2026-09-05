# fix_ppr.py — معالجة لاحقة لملف pptxgenjs:
# 1) إزالة <a:pPr> المكرر بعد الأول داخل كل فقرة (خلل معروف يُفسد الملف في PowerPoint)
# 2) حقن rtl="1" في أي فقرة تحوي نصاً عربياً وخلت pPr منها (تنحية اتجاه RTL عند العرض)
import re, zipfile, shutil, os

SRC = os.path.join(os.path.dirname(__file__), "Evolution-of-AI-Agents-AR.pptx")
TMP = SRC + ".tmp"
AR = re.compile(r"[\u0600-\u06FF]")

def fix_paragraph(m):
    p = m.group(0)
    parts = p.split("<a:pPr")
    if len(parts) > 2:
        out = parts[0] + "<a:pPr" + parts[1]
        for seg in parts[2:]:
            self_close = re.match(r"[^>]*?/>", seg)
            if self_close:
                out += seg[self_close.end():]
            else:
                end = seg.find("</a:pPr>")
                out += seg[end + len("</a:pPr>"):]
        p = out
    # RTL recovery: Arabic text must render right-to-left even in mixed-format runs
    if AR.search(p) and not re.search(r'<a:pPr[^>]*rtl="1"', p):
        p = p.replace("<a:pPr", '<a:pPr rtl="1"', 1)
    return p

pat = re.compile(r"<a:p>(?:(?!</a:p>).)*?</a:p>", re.S)

with zipfile.ZipFile(SRC) as zin:
    with zipfile.ZipFile(TMP, "w", zipfile.ZIP_DEFLATED) as zout:
        for name in zin.namelist():
            data = zin.read(name)
            if name.startswith("ppt/slides/slide") and name.endswith(".xml"):
                data = pat.sub(fix_paragraph, data.decode("utf-8")).encode("utf-8")
            zout.writestr(name, data)

shutil.move(TMP, SRC)
print("done postprocess ->", SRC)
