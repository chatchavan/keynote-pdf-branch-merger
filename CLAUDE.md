## About This Project
A single-file web page for students: it takes the "(ahead)" and "(complete)" no-notes PDFs that the sibling project `../keynote-pdf-brancher` cut from one Keynote deck, and builds a new "(complete)" PDF in which the pages the student annotated in "(ahead)" replace their counterparts.

- Only the no-notes variants are supported: `(ahead)` and `(complete)`. `(full)` and the notes variants are out of scope.
- `(ahead)` is an in-order subset of `(complete)`; complete-only slides (`%% EXCLUDE PRE-LECTURE %%`) show as an empty placeholder on the left.
- Runs entirely in the browser. Nothing is uploaded.

## Key Files
- `src/core.js`: all DOM-free logic, as a UMD-style file (`window.KPM` in the page, `module.exports` in Node). Covers stamp parsing, reading pages with pdf.js, stamp and similarity alignment, row building and grouping, merging with pdf-lib, and output naming. Library objects are passed in as arguments.
- `src/app.js`: page wiring (drop zone, pickers, thumbnails, board, toggles, download). Exposes `window.KPMApp` for debugging and automated checks.
- `src/index.html`, `src/style.css`: the dev page. It opens straight from disk and loads `../vendor/*.js` with plain `<script>` tags.
- `scripts/pack.mjs` (`npm run build`): inlines everything into `dist/Keynote PDF Merger.html`, the file handed to students. **The built file is committed**, so rebuild and commit it after any change to `src/` or `vendor/`.
- `vendor/`: byte-for-byte copies of `pdfjs-dist@3.11.174` (legacy build: `pdf.min.js`, `pdf.worker.min.js`) and `pdf-lib@1.17.1` (`pdf-lib.min.js`). Replace them wholesale from `node_modules`; never hand-edit.
- `tests/core.test.js` (`npm test`): Node tests of `core.js` against the vendored libraries.
- `scripts/make_fixtures.py` (`npm run fixtures`): regenerates `tests/fixtures/{stamped,unstamped,mismatched-deck}/Demo ({ahead,complete}).pdf`. These are synthetic, brancher-style PDFs carrying a student's annotations.

## How it works
### Page mapping
1. **Stamp (primary).** The brancher writes invisible text `KPB1|<deck-id>|<slide>|<total>` on every page (`stamp_slide_ids()` in `../keynote-pdf-brancher/export_keynote.py`). `alignByStamps()` maps by absolute slide number when every page in both files has a stamp with the same deck ID, and the result is an increasing sequence.
2. **Similarity (fallback).** Used for PDFs made before the stamp existed, files from different exports, or partly stamped files. `alignBySimilarity()` is an order-preserving DP that places every ahead page on a distinct complete page while maximising total similarity. Similarity is 0.75 × word-multiset Jaccard (pdf.js text, stamp removed) plus 0.25 × the match of 32×18 grayscale thumbnails; only the thumbnail counts when there is no text. Pairs scoring below 0.5 show a "?" on the toggle.
3. If ahead has more pages than complete (usually the files are swapped), the page says so and points to the ⇄ button.

### Annotation detection
Only real annotation objects count (`page.getAnnotations()`), not counting `Link`, `Widget` and `Popup`. Keynote exports hyperlinks as `Link`. Ink that an app has flattened into the page content cannot be detected; this was a deliberate choice. The student can expand a collapsed run and toggle any page by hand.

### Merge
`mergePdf()` loads the complete PDF with pdf-lib, `copyPages` the chosen ahead pages, and swaps each one in at its index. Before copying, it deletes each annotation's optional `/P` back-reference to its page; otherwise pdf-lib drags the whole source document in as unused objects. Replacing the page discards any annotations on the complete page, so the UI warns per row when that will happen. No merge metadata is written (decided).

### UI decisions (agreed with the user)
- A toggle defaults to on for every ahead page that has annotations.
- Rows whose ahead page is annotated, plus the row before and after each, stay expanded. Every other run collapses into one "▸ N slides without annotations" bar that expands on click.
- Output name defaults to `<stem> (complete + merged).pdf` and can be edited.
- Files can be dropped together (role guessed from `(ahead)`/`(complete)` in the name) or picked per slot.

## Environment quirks (verified)
- **The page must work from `file://`.** That rules out ES modules and `fetch`, so everything is a classic `<script>`. The pdf.js 3.x UMD build is used because 4.x and later ship only as ESM.
- **pdf.js worker.** In the packed file, the worker source sits in `<script type="text/plain" id="pdfjs-worker-src">`. `setupWorker()` makes a Blob URL and tries `new Worker(url)`, waiting for its first message. If that fails, it loads the same code as a main-thread script, where pdf.js finds `globalThis.pdfjsWorker` and runs a "fake worker". The dev page always uses the main-thread path.
- **Use one explicit `PDFWorker`** (`new pdfjsLib.PDFWorker({port})`, or `new pdfjsLib.PDFWorker()` for main-thread) and pass it as `getDocument({worker})`. With `GlobalWorkerOptions.workerPort`, `doc.destroy()` tore the shared port down and the next document failed with "PDFWorker.fromPort - the worker is being destroyed".
- **`requestAnimationFrame` is replaced with a `setTimeout` shim** at the top of `app.js`. pdf.js continues display-intent renders in animation frames, and those stop in background tabs and hidden or covered windows, so reading stalled. Rendering with `intent: 'print'` would avoid that but hides annotations that lack the print flag.
- `isEvalSupported: false` is always passed to `getDocument`. It mitigates CVE-2024-4367 (font-code injection) in pdf.js versions before 4.2, which `npm audit` flags for 3.11.174.
- pdf.js takes ownership of the buffer it is given, so pass `bytes.slice()` and keep the original for pdf-lib.
- `String.prototype.replace` with a string replacement interprets `$&`, `$'` and similar in it. `pack.mjs` therefore always uses a replacer function when inlining code.
- In Node, `require('vendor/pdf.min.js')` warns that it cannot polyfill `DOMMatrix`/`Path2D` (no `canvas` package). This is harmless for text and annotation reading, which is all the tests do.

## Testing
- `npm test`: core logic against the fixtures (mapping by stamp and by similarity, annotation counting, row grouping, merge output, naming).
- **Claude's built-in browser cannot open `file://` pages.** To check the page there, serve the repo over http (`python3 -m http.server 8765` from the repo root, via a `.claude/launch.json` in the session's primary working directory). Then load files via `fetch('/tests/fixtures/...')` → `File` → `KPMApp.assign(role, file)`, or dispatch a `drop` event with a `DataTransfer`. Intercept `HTMLAnchorElement.prototype.click` to capture the download. The `file://`-specific worker path and Safari need the user to check by double-clicking the built file.

- **Real-deck check (2026-10-19)** with a 44-slide lecture deck (16 ahead / 32 complete pages, ~27 MB each), with simulated annotations (ink, highlight + note, free text):
  - Stamped pair from one export: mapped by stamp, the right 3 rows switched on, 32-page output with the annotations on the right pages and every stamp kept.
  - Old unstamped ahead against a complete exported later from an *edited* deck (only 6 of 16 ahead pages still pixel-identical): content matching gave the same, correct mapping. Edited pages scored 0.74–0.89, so none were flagged.
  - Reading both files took ~5 s and merging ~0.5 s. The output grew by ~7% (1.9 MB for 3 replaced pages), apparently because copied pages bring their own copies of resources the complete file already has.
  - Copy test PDFs into a git-ignored `.e2e/` folder to serve them, and delete it afterwards: they are course material.
- The local static server sends no cache headers, so after `npm run build` reload with a new query string (`?v=N`), or the browser keeps the old build.

## Common Commands
```bash
npm install          # dev deps only (pdfjs-dist, pdf-lib), used to refresh vendor/ and run tests
npm test
npm run build        # -> dist/Keynote PDF Merger.html
npm run fixtures     # regenerate tests/fixtures (uv + pymupdf)
```
