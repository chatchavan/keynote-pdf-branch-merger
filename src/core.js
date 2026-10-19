/*
 * Keynote PDF Branch Merger: DOM-free core logic.
 *
 * Loaded by the page with a plain <script> (sets window.KPM) and by the Node
 * tests with require() (module.exports). Everything that touches pdf.js or
 * pdf-lib takes the library object as an argument, so the same code runs
 * against the vendored copies in both places.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KPM = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Invisible per-page stamp written by keynote-pdf-brancher
  // (export_keynote.stamp_slide_ids): KPB2|<deck>|<run>|<slide>|<total>.
  // deck: hash of the .key file name (same across runs); run: random per
  // export, so slide numbers are only comparable within one run. The
  // earlier KPB1|<run>|<slide>|<total> carried no deck.
  const STAMP_RE = /KPB2\|([0-9a-f]{12})\|([0-9a-f]{12})\|(\d+)\|(\d+)|KPB1\|([0-9a-f]{12})\|(\d+)\|(\d+)/;
  const STAMP_RE_ALL = new RegExp(STAMP_RE.source, 'g');

  // Annotation subtypes that are not a student's markup: hyperlinks Keynote
  // exports itself, form fields, and popups (counted through their parent).
  const IGNORED_SUBTYPES = new Set(['Link', 'Widget', 'Popup']);

  // Below this similarity a content-matched pair is flagged as uncertain
  // (only used when no exact-text information is available).
  const UNCERTAIN_BELOW = 0.5;

  // Weight of a pair of pages with identical text in the alignment: above
  // any fuzzy score (at most 1), so exact matches anchor the alignment.
  const ANCHOR_BONUS = 2;

  // A bare number, such as the slide number a theme bakes in.
  const NUMBER = /^\d+$/;

  // Text-less pages count as an exact match from this thumbnail similarity up.
  const SAME_PICTURE = 0.97;

  function parseStamp(text) {
    const m = STAMP_RE.exec(text || '');
    if (!m) return null;
    if (m[1]) return { deck: m[1], run: m[2], slide: Number(m[3]), total: Number(m[4]) };
    return { deck: null, run: m[5], slide: Number(m[6]), total: Number(m[7]) };
  }

  function isStudentAnnotation(annot) {
    return !!annot && !IGNORED_SUBTYPES.has(annot.subtype);
  }

  function tokenize(text) {
    return (text || '')
      .replace(STAMP_RE_ALL, ' ')
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean);
  }

  /* Per-page facts read with pdf.js: stamp, words, student annotations. */
  async function readPageInfo(pdfDoc, index) {
    const page = await pdfDoc.getPage(index + 1);
    const content = await page.getTextContent();
    const text = content.items.map((it) => it.str).join(' ');
    // A stamp may be split across text items; also try without separators.
    const stamp = parseStamp(text) || parseStamp(content.items.map((it) => it.str).join(''));
    const annots = (await page.getAnnotations({ intent: 'display' })).filter(isStudentAnnotation);
    return {
      index,
      stamp,
      words: tokenize(text),
      annotCount: annots.length,
      annotTypes: [...new Set(annots.map((a) => a.subtype))],
    };
  }

  async function readAllPageInfo(pdfDoc, onProgress) {
    const infos = [];
    for (let i = 0; i < pdfDoc.numPages; i++) {
      infos.push(await readPageInfo(pdfDoc, i));
      if (onProgress) onProgress(i + 1, pdfDoc.numPages);
    }
    return infos;
  }

  /*
   * Map by stamps. Returns {mapping: aheadIdx -> completeIdx (array)} or
   * {mapping: null, reason} when stamps are missing, from different exports,
   * or inconsistent; the caller then falls back to similarity matching.
   */
  /*
   * The slide's words with bare numbers left out, so the slide number the
   * theme bakes in (which shifts when slides are added or removed between
   * exports) does not stop two otherwise identical slides from matching.
   */
  function textKey(words) {
    return words.filter((w) => !NUMBER.test(w)).join(' ');
  }

  function alignByStamps(ahead, complete) {
    const all = ahead.concat(complete);
    if (all.some((p) => !p.stamp)) {
      const full = (side) => side.every((p) => p.stamp);
      const none = (side) => !side.some((p) => p.stamp);
      if (none(ahead) && none(complete)) return { mapping: null, reason: 'missing' };
      // Typically an (ahead) handed out before the stamp existed, paired
      // with a (complete) exported later, possibly from an edited deck.
      if ((full(ahead) && none(complete)) || (none(ahead) && full(complete))) {
        return { mapping: null, reason: 'one-side' };
      }
      return { mapping: null, reason: 'partial' };
    }
    const runs = new Set(all.map((p) => p.stamp.run));
    if (runs.size > 1) {
      const decksOf = (side) => new Set(side.map((p) => p.stamp.deck));
      const da = decksOf(ahead);
      const dc = decksOf(complete);
      const known = da.size === 1 && dc.size === 1 && !da.has(null) && !dc.has(null);
      if (known && [...da][0] !== [...dc][0]) return { mapping: null, reason: 'different-deck' };
      return { mapping: null, reason: 'different-export' };
    }
    const bySlide = new Map(complete.map((p) => [p.stamp.slide, p.index]));
    const mapping = ahead.map((p) => bySlide.get(p.stamp.slide));
    if (mapping.some((j) => j === undefined)) return { mapping: null, reason: 'not-subset' };
    for (let k = 1; k < mapping.length; k++) {
      if (mapping[k] <= mapping[k - 1]) return { mapping: null, reason: 'not-subset' };
    }
    return { mapping, reason: null };
  }

  function textSimilarity(a, b) {
    if (!a.length && !b.length) return null;
    const ca = new Map();
    for (const w of a) ca.set(w, (ca.get(w) || 0) + 1);
    let inter = 0;
    const cb = new Map();
    for (const w of b) cb.set(w, (cb.get(w) || 0) + 1);
    for (const [w, n] of ca) inter += Math.min(n, cb.get(w) || 0);
    return inter / (a.length + b.length - inter);
  }

  /* Grayscale thumbnail vectors (values 0..255, same length). */
  function imageSimilarity(va, vb) {
    if (!va || !vb || va.length !== vb.length || !va.length) return null;
    let diff = 0;
    for (let i = 0; i < va.length; i++) diff += Math.abs(va[i] - vb[i]);
    return 1 - diff / (255 * va.length);
  }

  function pageSimilarity(a, b) {
    // Bare numbers are left out, like in textKey(): the baked-in slide
    // number shifts between exports of an edited deck.
    const t = textSimilarity(a.words.filter((w) => !NUMBER.test(w)), b.words.filter((w) => !NUMBER.test(w)));
    const v = imageSimilarity(a.thumbVec, b.thumbVec);
    if (t === null && v === null) return 0;
    if (t === null) return v;
    if (v === null) return t;
    // Text is the stronger signal (annotations don't change it), the picture
    // separates text-less slides and build steps with identical words.
    return 0.75 * t + 0.25 * v;
  }

  /* Same slide content: identical text, or for text-less slides the same picture. */
  function samePage(a, b) {
    const ka = textKey(a.words);
    const kb = textKey(b.words);
    if (ka || kb) return ka === kb;
    const v = imageSimilarity(a.thumbVec, b.thumbVec);
    return v !== null && v >= SAME_PICTURE;
  }

  /*
   * Order-preserving alignment of every ahead page onto a distinct complete
   * page ((ahead) is an in-order subset of (complete)). Pages with the same
   * content anchor it; the rest are placed by similarity. Returns
   * {mapping, scores, exact}: exact[i] is false where the paired pages
   * differ, i.e. the slide was edited between exports, or the match is a guess.
   */
  function alignBySimilarity(ahead, complete) {
    const n = ahead.length;
    const m = complete.length;
    if (n > m) throw new Error('ahead-longer');
    const sim = ahead.map((a) => complete.map((c) => pageSimilarity(a, c)));
    const same = ahead.map((a) => complete.map((c) => samePage(a, c)));
    const weight = (i, j) => sim[i][j] + (same[i][j] ? ANCHOR_BONUS : 0);
    const NEG = -Infinity;
    // dp[i][j]: best score placing the first i ahead pages within the first j complete pages.
    const dp = Array.from({ length: n + 1 }, () => new Float64Array(m + 1).fill(NEG));
    for (let j = 0; j <= m; j++) dp[0][j] = 0;
    for (let i = 1; i <= n; i++) {
      for (let j = i; j <= m; j++) {
        dp[i][j] = Math.max(dp[i][j - 1], dp[i - 1][j - 1] + weight(i - 1, j - 1));
      }
    }
    const mapping = new Array(n);
    let j = m;
    for (let i = n; i >= 1; i--) {
      while (j > i && dp[i][j] === dp[i][j - 1]) j--;
      mapping[i - 1] = j - 1;
      j--;
    }
    return {
      mapping,
      scores: mapping.map((cj, i) => sim[i][cj]),
      exact: mapping.map((cj, i) => same[i][cj]),
    };
  }

  /*
   * One row per (complete) page, in order. ahead: page index or null.
   * match: null (mapped by stamp) or alignBySimilarity's {scores, exact}.
   * uncertain: a content-matched pair whose pages differ.
   */
  function buildRows(ahead, complete, mapping, match) {
    const aheadFor = new Map(mapping.map((cj, ai) => [cj, ai]));
    return complete.map((c, cj) => {
      const ai = aheadFor.has(cj) ? aheadFor.get(cj) : null;
      const a = ai === null ? null : ahead[ai];
      let uncertain = false;
      if (match && ai !== null) {
        uncertain = match.exact ? !match.exact[ai] : match.scores[ai] < UNCERTAIN_BELOW;
      }
      return {
        completeIdx: cj,
        aheadIdx: ai,
        aheadAnnotated: !!(a && a.annotCount),
        completeAnnotated: c.annotCount > 0,
        uncertain,
        slide: c.stamp ? c.stamp.slide : null,
        // 'replace' | 'insert' | 'keep': what happens with the ahead page.
        action: a && a.annotCount ? 'replace' : 'keep',
      };
    });
  }

  /*
   * Split rows into what the UI shows: rows whose ahead page has annotations,
   * plus the row before and after each, stay expanded; every other run of
   * rows becomes one collapsed group. Returns [{type:'row', row} | {type:'run', rows}].
   */
  function groupRows(rows) {
    const keep = rows.map(() => false);
    rows.forEach((r, i) => {
      if (!r.aheadAnnotated) return;
      for (const k of [i - 1, i, i + 1]) if (k >= 0 && k < rows.length) keep[k] = true;
    });
    const out = [];
    let run = [];
    rows.forEach((r, i) => {
      if (keep[i]) {
        if (run.length) out.push({ type: 'run', rows: run });
        run = [];
        out.push({ type: 'row', row: r });
      } else {
        run.push(r);
      }
    });
    if (run.length) out.push({ type: 'run', rows: run });
    return out;
  }

  /*
   * Bring pages of (ahead) into (complete).
   * ops: [{aheadIdx, completeIdx, mode}], mode 'replace' (default: the ahead
   * page takes the complete page's place) or 'insert' (the ahead page goes
   * right after the complete page, which stays). Returns Uint8Array.
   */
  async function mergePdf(PDFLib, aheadBytes, completeBytes, ops) {
    const { PDFDocument, PDFName } = PDFLib;
    const out = await PDFDocument.load(completeBytes, { ignoreEncryption: true, updateMetadata: false });
    if (!ops.length) return out.save();
    const src = await PDFDocument.load(aheadBytes, { ignoreEncryption: true, updateMetadata: false });
    // An annotation's optional /P points back at its page; copying it would
    // drag the source page (and through /Parent, the whole source document)
    // into the output as unused objects. Drop it on the pages we copy.
    for (const op of ops) {
      const annots = src.getPage(op.aheadIdx).node.Annots();
      if (!annots) continue;
      for (let k = 0; k < annots.size(); k++) {
        const dict = annots.lookup(k);
        if (dict && dict.delete) dict.delete(PDFName.of('P'));
      }
    }
    const copied = await out.copyPages(src, ops.map((op) => op.aheadIdx));
    // Last page first, so earlier complete indices stay valid.
    const order = ops.map((op, k) => k).sort((x, y) => ops[y].completeIdx - ops[x].completeIdx);
    for (const k of order) {
      const { completeIdx, mode } = ops[k];
      if (mode === 'insert') {
        out.insertPage(completeIdx + 1, copied[k]);
      } else {
        out.removePage(completeIdx);
        out.insertPage(completeIdx, copied[k]);
      }
    }
    return out.save();
  }

  /* "Lecture 3 (complete).pdf" -> "Lecture 3 (complete + merged).pdf" */
  function defaultOutputName(completeName) {
    const base = (completeName || 'slides.pdf').replace(/\.pdf$/i, '');
    const m = /^(.*)\(complete\)\s*$/i.exec(base);
    const stem = m ? m[1].replace(/\s+$/, '') : base;
    return `${stem} (complete + merged).pdf`;
  }

  /* Which role a dropped file probably is, from its name. */
  function guessRole(name) {
    if (/\(ahead\)/i.test(name)) return 'ahead';
    if (/\(complete\)/i.test(name)) return 'complete';
    return null;
  }

  return {
    STAMP_RE,
    UNCERTAIN_BELOW,
    textKey,
    samePage,
    parseStamp,
    isStudentAnnotation,
    tokenize,
    readPageInfo,
    readAllPageInfo,
    alignByStamps,
    textSimilarity,
    imageSimilarity,
    pageSimilarity,
    alignBySimilarity,
    buildRows,
    groupRows,
    mergePdf,
    defaultOutputName,
    guessRole,
  };
});
