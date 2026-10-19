# Keynote PDF Merger

Bring the notes you wrote on the **(ahead)** slides into the **(complete)** slides.

Before class you get `Lecture (ahead).pdf`. After class you get `Lecture (complete).pdf`, which has extra slides (for example, answers to exercises). If you annotated the ahead version, this page builds a copy of the complete version with your annotated pages in it: in place of the matching clean pages, or right after them.

## For students

1. Double-click **`Keynote PDF Merger.html`**. It opens in your web browser (Chrome, Edge, Safari or Firefox). No installation, no internet needed; your files never leave your computer.
2. Drop both PDFs onto the page, or choose them with the two **Choose…** buttons. Use **⇄** if they ended up the wrong way round.
3. Check the two columns: your (ahead) pages on the left, the (complete) pages on the right.
   - Click the round button between two pages to choose what happens:
     - **→** replace the (complete) page with your (ahead) page,
     - **⤷** insert your (ahead) page right after the (complete) page, keeping both,
     - (empty) use the page from the (complete) version.
   - Pages with your annotations are set to **→** automatically and marked with ✎.
   - Slides without annotations are folded into a bar such as "▸ 5 slides without annotations"; click it to open them.
   - A striped box on the left means that slide was not in the (ahead) version.
   - ⚠ means you had also annotated that page in the (complete) file. Those notes are lost if you replace it; choose **⤷** to keep both.
   - **?** means the two pages are not identical, usually because the slide was edited between the two versions; check that they show the same slide.
4. Change the file name if you like, then click **Download merged PDF**.

Only annotations your PDF app saves as annotations (most apps' default: Preview, Acrobat, PDF Expert, GoodNotes/Notability without "flatten") are detected automatically. If your app flattened your ink into the page, open the folded slides and choose pages by hand.

## For maintainers

The PDFs need to come from [keynote-pdf-brancher](../keynote-pdf-brancher). Its newer versions stamp each page with an invisible slide ID, which this page uses to pair pages exactly. Older PDFs are paired by content instead.

```bash
npm install
npm test
npm run build   # writes dist/Keynote PDF Merger.html, the file you hand out
```

See `CLAUDE.md` for the design and its decisions.
