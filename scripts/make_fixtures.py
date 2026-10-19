"""Generate synthetic "(ahead)"/"(complete)" PDF pairs for the tests.

Mimics keynote-pdf-brancher: one master PDF with every slide (skipped ones
included), stamped with `KPB1|<deck-id>|<slide>|<total>` in invisible text,
from which each variant is cut by deleting pages. Then a student's
annotations are added to some pages of the "(ahead)" copy.

Run: uv run --with pymupdf scripts/make_fixtures.py
"""
from pathlib import Path

import pymupdf

OUT = Path(__file__).resolve().parent.parent / "tests" / "fixtures"
W, H = 960, 540  # 16:9 landscape, like a Keynote export
DECK_ID = "3fa9c01b2e7d"
OTHER_DECK_ID = "0123456789ab"

# Absolute slide -> (title, body lines). Slide 7 has no text at all.
SLIDES = {
    1: ("Welcome", ["Course overview", "See https://example.org"]),
    2: ("Agenda", ["Part A", "Part B"]),
    3: ("Skipped in Keynote", ["never exported to students"]),
    4: ("Definitions", ["A term", "Another term"]),
    5: ("Answer to exercise 1", ["x = 42"]),
    6: ("Answer to exercise 2", ["y = 7"]),
    7: (None, []),
    8: ("Instructor only", ["%% EXCLUDE %%"]),
    9: ("Build step", ["First bullet"]),
    10: ("Build step", ["First bullet", "Second bullet"]),
}
SKIPPED = {3}
EXCLUDE = {8}
EXCLUDE_PRE = {5, 6}


def make_master(path: Path, deck_id):
    doc = pymupdf.open()
    for n, (title, lines) in SLIDES.items():
        page = doc.new_page(width=W, height=H)
        page.draw_rect(page.rect, color=None, fill=(0.97, 0.97, 0.95))
        if title:
            page.insert_text((60, 110), title, fontsize=44, fontname="helv")
            for i, line in enumerate(lines):
                page.insert_text((80, 200 + 50 * i), "• " + line, fontsize=26, fontname="helv")
        else:
            page.draw_circle((480, 270), 150, fill=(0.2, 0.4, 0.8))
            page.draw_rect(pymupdf.Rect(100, 100, 300, 440), fill=(0.9, 0.5, 0.1))
        # Stable slide number baked in, as the Keynote theme would.
        page.insert_text((W - 60, H - 30), str(n), fontsize=14, fontname="helv")
        if n == 1:
            page.insert_link({"kind": pymupdf.LINK_URI, "from": pymupdf.Rect(80, 230, 400, 260),
                              "uri": "https://example.org"})
        if deck_id:
            page.insert_text((4, H - 4), f"KPB1|{deck_id}|{n}|{len(SLIDES)}",
                             fontsize=1, fontname="cour", render_mode=3)
    doc.save(path)
    doc.close()


def cut(master: Path, exclude: set, out: Path):
    doc = pymupdf.open(master)
    doc.select([p for p in range(doc.page_count) if (p + 1) not in exclude])
    doc.save(out, garbage=4, deflate=True)
    doc.close()


def page_of(doc, slide, excluded):
    kept = [n for n in SLIDES if n not in excluded]
    return doc[kept.index(slide)]


def annotate_ahead(path: Path):
    excluded = SKIPPED | EXCLUDE | EXCLUDE_PRE
    doc = pymupdf.open(path)
    p = page_of(doc, 4, excluded)
    p.add_ink_annot([[(100, 300), (200, 340), (300, 300), (400, 360)]])
    p = page_of(doc, 9, excluded)
    p.add_highlight_annot(pymupdf.Rect(78, 175, 330, 210))
    p.add_text_annot((600, 200), "Ask about this in class")
    p = page_of(doc, 10, excluded)
    p.add_freetext_annot(pymupdf.Rect(500, 300, 900, 360), "my own note", fontsize=18)
    doc.saveIncr()
    doc.close()


def annotate_complete(path: Path):
    excluded = SKIPPED | EXCLUDE
    doc = pymupdf.open(path)
    page_of(doc, 9, excluded).add_ink_annot([[(700, 400), (800, 450)]])
    doc.saveIncr()
    doc.close()


def build_set(name: str, deck_id, other_deck_for_ahead=False):
    d = OUT / name
    d.mkdir(parents=True, exist_ok=True)
    master = d / "master.pdf"
    make_master(master, deck_id)
    cut(master, SKIPPED | EXCLUDE, d / "Demo (complete).pdf")
    if other_deck_for_ahead:
        make_master(master, OTHER_DECK_ID)
    cut(master, SKIPPED | EXCLUDE | EXCLUDE_PRE, d / "Demo (ahead).pdf")
    master.unlink()
    annotate_ahead(d / "Demo (ahead).pdf")
    annotate_complete(d / "Demo (complete).pdf")


if __name__ == "__main__":
    build_set("stamped", DECK_ID)
    build_set("unstamped", None)
    build_set("mismatched-deck", DECK_ID, other_deck_for_ahead=True)
    print("fixtures written to", OUT)
