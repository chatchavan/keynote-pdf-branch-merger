# Keynote PDF Merger

Bring the notes you wrote on the **(ahead)** slides into the **(complete)** slides.

Before class you get `Lecture (ahead).pdf`. After class you get `Lecture (complete).pdf`, which has extra slides (for example, answers to exercises). If you annotated the ahead version, this page builds a copy of the complete version in which your annotated pages replace the matching clean ones.

## For students

1. Double-click **`Keynote PDF Merger.html`**. It opens in your web browser (Chrome, Edge, Safari or Firefox). No installation, no internet needed; your files never leave your computer.
2. Drop both PDFs onto the page, or choose them with the two **Choose…** buttons. Use **⇄** if they ended up the wrong way round.
3. Check the two columns: your (ahead) pages on the left, the (complete) pages on the right.
   - A filled **→** means "use my (ahead) page here". Click it to switch it on or off.
   - Pages with your annotations are switched on automatically and marked with ✎.
   - Slides without annotations are folded into a bar such as "▸ 5 slides without annotations"; click it to open them.
   - A striped box on the left means that slide was not in the (ahead) version.
   - ⚠ means you had also annotated that page in the (complete) file. Those notes are lost if you use the (ahead) page.
   - **?** means the two pages were matched by their content rather than by slide ID; check that they really are the same slide.
4. Change the file name if you like, then click **Download merged PDF**.

Only annotations your PDF app saves as annotations (most apps' default: Preview, Acrobat, PDF Expert, GoodNotes/Notability without "flatten") are detected automatically. If your app flattened your ink into the page, open the folded slides and switch the pages on by hand.

## For maintainers

The PDFs need to come from [keynote-pdf-brancher](../keynote-pdf-brancher). Its newer versions stamp each page with an invisible slide ID, which this page uses to pair pages exactly. Older PDFs are paired by content instead.

```bash
npm install
npm test
npm run build   # writes dist/Keynote PDF Merger.html, the file you hand out
```

See `CLAUDE.md` for the design and its decisions.
