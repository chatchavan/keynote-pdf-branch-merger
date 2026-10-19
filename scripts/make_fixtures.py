"""Generate synthetic "(ahead)"/"(complete)" PDF pairs for the tests.

Mimics keynote-pdf-brancher: one master PDF with every slide (skipped ones
included), stamped with `KPB2|<deck>|<run>|<slide>|<total>` in invisible
text, from which each variant is cut by deleting pages. Then a student's
annotations are added to some pages of the "(ahead)" copy.

Sets:
  stamped     ahead and complete from one run
  unstamped   the same without stamps (PDFs made before the stamp existed)
  other-run   same deck, separate runs; the deck was edited in between
              (slide "defs" reworded, a slide inserted after "agenda")
  other-deck  ahead and complete stamped with different deck IDs

Run: uv run --with pymupdf scripts/make_fixtures.py
"""
from pathlib import Path

import pymupdf

OUT = Path(__file__).resolve().parent.parent / "tests" / "fixtures"
W, H = 960, 540  # 16:9 landscape, like a Keynote export
DECK = "9c1e0a7b3d42"
OTHER_DECK = "0123456789ab"
RUN_1 = "3fa9c01b2e7d"
RUN_2 = "5e5e5e5e5e5e"

# (label, title, body lines, flags). Label names a slide across edits.
# "shapes" has no text at all.
SLIDES = [
    ("welcome", "Welcome", ["Course overview", "See https://example.org"], ""),
    ("agenda", "Agenda", ["Part A", "Part B"], ""),
    ("hidden", "Skipped in Keynote", ["never exported to students"], "skipped"),
    ("defs", "Definitions", ["A term", "Another term"], ""),
    ("ex1", "Answer to exercise 1", ["x = 42"], "pre"),
    ("ex2", "Answer to exercise 2", ["y = 7"], "pre"),
    ("shapes", None, [], ""),
    ("instr", "Instructor only", ["%% EXCLUDE %%"], "exclude"),
    ("build1", "Build step", ["First bullet"], ""),
    ("build2", "Build step", ["First bullet", "Second bullet"], ""),
]


def edited_slides():
    out = []
    for s in SLIDES:
        if s[0] == "defs":
            s = ("defs", "Definitions", ["A term", "A revised term"], "")
        out.append(s)
        if s[0] == "agenda":
            out.append(("new", "Inserted later", ["Fresh material"], ""))
    return out


def make_master(path: Path, slides, deck, run):
    doc = pymupdf.open()
    for n, (label, title, lines, _) in enumerate(slides, start=1):
        page = doc.new_page(width=W, height=H)
        page.draw_rect(page.rect, color=None, fill=(0.97, 0.97, 0.95))
        if title:
            page.insert_text((60, 110), title, fontsize=44, fontname="helv")
            for i, line in enumerate(lines):
                page.insert_text((80, 200 + 50 * i), "• " + line, fontsize=26, fontname="helv")
        else:
            page.draw_circle((480, 270), 150, fill=(0.2, 0.4, 0.8))
            page.draw_rect(pymupdf.Rect(100, 100, 300, 440), fill=(0.9, 0.5, 0.1))
        # Slide number baked in, as the Keynote theme would.
        page.insert_text((W - 60, H - 30), str(n), fontsize=14, fontname="helv")
        if label == "welcome":
            page.insert_link({"kind": pymupdf.LINK_URI, "from": pymupdf.Rect(80, 230, 400, 260),
                              "uri": "https://example.org"})
        if deck:
            page.insert_text((4, H - 4), f"KPB2|{deck}|{run}|{n}|{len(slides)}",
                             fontsize=1, fontname="cour", render_mode=3)
    doc.save(path)
    doc.close()


def kept(slides, variant):
    drop = {"skipped", "exclude"} | ({"pre"} if variant == "ahead" else set())
    return [s[0] for s in slides if s[3] not in drop]


def cut(master: Path, slides, variant, out: Path):
    labels = [s[0] for s in slides]
    keep = set(kept(slides, variant))
    doc = pymupdf.open(master)
    doc.select([i for i, lab in enumerate(labels) if lab in keep])
    doc.save(out, garbage=4, deflate=True)
    doc.close()


def annotate(path: Path, labels, edits):
    doc = pymupdf.open(path)
    for label, fn in edits:
        fn(doc[labels.index(label)])
    doc.saveIncr()
    doc.close()


AHEAD_ANNOTS = [
    ("defs", lambda p: p.add_ink_annot([[(100, 300), (200, 340), (300, 300), (400, 360)]])),
    ("build1", lambda p: (p.add_highlight_annot(pymupdf.Rect(78, 175, 330, 210)),
                          p.add_text_annot((600, 200), "Ask about this in class"))),
    ("build2", lambda p: p.add_freetext_annot(pymupdf.Rect(500, 300, 900, 360), "my own note", fontsize=18)),
]
COMPLETE_ANNOTS = [("build1", lambda p: p.add_ink_annot([[(700, 400), (800, 450)]]))]


def build_set(name, ahead_slides, ahead_stamp, complete_slides, complete_stamp):
    d = OUT / name
    d.mkdir(parents=True, exist_ok=True)
    master = d / "master.pdf"
    make_master(master, ahead_slides, *ahead_stamp)
    cut(master, ahead_slides, "ahead", d / "Demo (ahead).pdf")
    make_master(master, complete_slides, *complete_stamp)
    cut(master, complete_slides, "complete", d / "Demo (complete).pdf")
    master.unlink()
    annotate(d / "Demo (ahead).pdf", kept(ahead_slides, "ahead"), AHEAD_ANNOTS)
    annotate(d / "Demo (complete).pdf", kept(complete_slides, "complete"), COMPLETE_ANNOTS)


if __name__ == "__main__":
    for old in ("mismatched-deck",):
        for f in (OUT / old).glob("*.pdf"):
            f.unlink()
        if (OUT / old).exists():
            (OUT / old).rmdir()
    build_set("stamped", SLIDES, (DECK, RUN_1), SLIDES, (DECK, RUN_1))
    build_set("unstamped", SLIDES, (None, None), SLIDES, (None, None))
    build_set("other-run", SLIDES, (DECK, RUN_1), edited_slides(), (DECK, RUN_2))
    build_set("other-deck", SLIDES, (DECK, RUN_1), SLIDES, (OTHER_DECK, RUN_2))
    print("fixtures written to", OUT)
