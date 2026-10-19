"""Mock-up slides for the README demo (demo/*.pdf), cut like the brancher does.

Eight slides, each one big number; slide 5 is missing from "(ahead)" and says
so. The "(ahead)" copy gets a student's annotations on slides 2 and 6.

Run: uv run --with pymupdf scripts/make_demo_slides.py
"""
from pathlib import Path

import pymupdf

OUT = Path(__file__).resolve().parent.parent / "demo"
W, H = 960, 540
N = 8
EXCLUDED = {5}
DECK, RUN = "dec0dec0de11", "0f1e2d3c4b5a"
INK = (0.85, 0.12, 0.12)


def master():
    doc = pymupdf.open()
    for n in range(1, N + 1):
        page = doc.new_page(width=W, height=H)
        page.draw_rect(page.rect, color=None, fill=(0.96, 0.97, 0.99))
        text = str(n)
        size = 220
        width = pymupdf.get_text_length(text, fontname="helv", fontsize=size)
        page.insert_text(((W - width) / 2, H / 2 + 70), text, fontsize=size, fontname="helv",
                         color=(0.18, 0.33, 0.6))
        if n in EXCLUDED:
            label = '(excluded from "ahead" version)'
            lw = pymupdf.get_text_length(label, fontname="helv", fontsize=30)
            page.insert_text(((W - lw) / 2, H / 2 + 150), label, fontsize=30, fontname="helv",
                             color=(0.45, 0.45, 0.5))
        page.insert_text((W - 50, H - 24), text, fontsize=14, fontname="helv", color=(0.5, 0.5, 0.5))
        page.insert_text((4, H - 4), f"KPB2|{DECK}|{RUN}|{n}|{N}", fontsize=1, fontname="cour", render_mode=3)
    return doc


def save_cut(exclude, path):
    doc = master()
    doc.select([i for i in range(N) if (i + 1) not in exclude])
    doc.save(path, garbage=4, deflate=True)
    doc.close()


def annotate(path):
    doc = pymupdf.open(path)
    kept = [n for n in range(1, N + 1) if n not in EXCLUDED]
    # Slide 2: circle the number and write a note.
    p = doc[kept.index(2)]
    pts = [(480 + 190 * __import__("math").cos(t / 20 * 6.4), 250 + 150 * __import__("math").sin(t / 20 * 6.4))
           for t in range(21)]
    a = p.add_ink_annot([pts])
    a.set_colors(stroke=INK)
    a.set_border(width=5)
    a.update()
    a = p.add_freetext_annot(pymupdf.Rect(640, 60, 930, 120), "key idea!", fontsize=34, text_color=INK)
    a.update()
    # Slide 6: underline and a check mark.
    p = doc[kept.index(6)]
    a = p.add_ink_annot([[(330, 430), (630, 425)], [(700, 250), (740, 300), (840, 160)]])
    a.set_colors(stroke=INK)
    a.set_border(width=6)
    a.update()
    doc.saveIncr()
    doc.close()


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    save_cut(set(), OUT / "Lecture (complete).pdf")
    save_cut(EXCLUDED, OUT / "Lecture (ahead).pdf")
    annotate(OUT / "Lecture (ahead).pdf")
    print("wrote", *sorted(p.name for p in OUT.glob("*.pdf")))
