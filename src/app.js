/* Keynote PDF Branch Merger: page wiring. Logic lives in core.js (window.KPM). */
(function () {
  'use strict';

  const THUMB_CSS_WIDTH = 480;  // render width; the cell scales it down to fit
  const VEC_W = 32;
  const VEC_H = 18;

  const $ = (sel) => document.querySelector(sel);

  // pdf.js continues long page renders in animation frames, which browsers
  // stop delivering to background tabs and hidden or covered windows, so
  // reading a deck would stall there. This page animates nothing itself, so
  // a timer-based stand-in is safe and keeps the work going.
  window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 0);
  window.cancelAnimationFrame = (id) => clearTimeout(id);
  const state = {
    files: { ahead: null, complete: null },
    run: 0,          // bumps on every new load so stale async work is dropped
    rows: [],
    pages: null,     // {ahead: {infos, canvases, bytes}, complete: {...}}
    pdfWorker: null,
    matchedByStamp: false,
  };

  // ---------- pdf.js worker ----------
  // In the packed single file the worker source sits in a text/plain script
  // tag. Try a real Worker from a Blob URL; where the browser refuses that
  // (some file:// setups), run the worker code on the main thread instead.
  // The unpacked dev page always uses the main-thread fallback.
  // One PDFWorker is shared by every document and passed in explicitly:
  // pdf.js then never tears it down when a document is destroyed.
  let workerReady = null;
  function setupWorker() {
    if (workerReady) return workerReady;
    workerReady = (async () => {
      const inline = document.getElementById('pdfjs-worker-src');
      let url = null;
      if (inline) {
        url = URL.createObjectURL(new Blob([inline.textContent], { type: 'text/javascript' }));
        const worker = await tryWorker(url);
        if (worker) {
          state.pdfWorker = new pdfjsLib.PDFWorker({ port: worker });
          return 'worker';
        }
      }
      await loadScript(url || '../vendor/pdf.worker.min.js');
      state.pdfWorker = new pdfjsLib.PDFWorker();
      return 'main-thread';
    })();
    return workerReady;
  }

  function tryWorker(url) {
    return new Promise((resolve) => {
      let w;
      try { w = new Worker(url); } catch (e) { resolve(null); return; }
      const timer = setTimeout(() => { w.terminate(); resolve(null); }, 4000);
      w.addEventListener('message', () => { clearTimeout(timer); resolve(w); }, { once: true });
      w.addEventListener('error', () => { clearTimeout(timer); w.terminate(); resolve(null); }, { once: true });
    });
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('could not load ' + src));
      document.head.appendChild(s);
    });
  }

  // ---------- file input ----------
  function assign(role, file) {
    state.files[role] = file;
    const slot = document.querySelector(`.slot[data-role="${role}"]`);
    slot.classList.toggle('filled', !!file);
    $(`[data-file="${role}"]`).textContent = file ? file.name : 'No file chosen';
    maybeProcess();
  }

  function assignDropped(files) {
    const pdfs = [...files].filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    if (!pdfs.length) return;
    // Place by "(ahead)"/"(complete)" in the name; anything else fills a slot
    // this drop left free, preferring one that is still empty.
    const placed = {};
    const unplaced = [];
    for (const f of pdfs.slice(0, 2)) {
      const role = KPM.guessRole(f.name);
      if (role && !placed[role]) placed[role] = f; else unplaced.push(f);
    }
    for (const f of unplaced) {
      const free = ['ahead', 'complete'].filter((r) => !placed[r]);
      placed[free.find((r) => !state.files[r]) || free[0]] = f;
    }
    Object.assign(state.files, placed);
    assign('ahead', state.files.ahead);
    assign('complete', state.files.complete);
  }

  function wireInputs() {
    const dz = $('#dropzone');
    ['dragenter', 'dragover'].forEach((t) => dz.addEventListener(t, (e) => {
      e.preventDefault();
      dz.classList.add('over');
    }));
    ['dragleave', 'drop'].forEach((t) => dz.addEventListener(t, () => dz.classList.remove('over')));
    dz.addEventListener('drop', (e) => {
      e.preventDefault();
      assignDropped(e.dataTransfer.files);
    });
    // A file dropped anywhere else must not make the browser navigate away.
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => e.preventDefault());

    document.querySelectorAll('input[type=file][data-input]').forEach((input) => {
      input.addEventListener('change', () => {
        if (input.files[0]) assign(input.dataset.input, input.files[0]);
        input.value = '';
      });
    });
    $('#swap').addEventListener('click', () => {
      const { ahead, complete } = state.files;
      state.files = { ahead: complete, complete: ahead };
      assign('ahead', state.files.ahead);
      assign('complete', state.files.complete);
    });
    $('#download').addEventListener('click', download);
  }

  // ---------- status ----------
  function clearMessages() { $('#messages').innerHTML = ''; }
  function message(text, kind) {
    $('#status').hidden = false;
    const li = document.createElement('li');
    if (kind) li.className = kind;
    li.textContent = text;
    $('#messages').appendChild(li);
  }
  function progress(label, done, total) {
    const p = $('#progress');
    $('#status').hidden = false;
    p.hidden = label === null;
    if (label === null) return;
    p.querySelector('.label').textContent = label;
    p.querySelector('.bar').style.width = total ? `${(100 * done) / total}%` : '0';
  }

  // ---------- processing ----------
  async function maybeProcess() {
    const run = ++state.run;
    state.rows = [];
    state.pages = null;
    $('#board').hidden = true;
    $('#actionbar').hidden = true;
    clearMessages();
    progress(null);
    const { ahead, complete } = state.files;
    if (!ahead || !complete) return;
    if (ahead === complete) {
      message('The same file is chosen twice. Choose one (ahead) and one (complete) file.', 'error');
      return;
    }
    try {
      await setupWorker();
      const a = await loadSide(ahead, 'ahead', run);
      const c = await loadSide(complete, 'complete', run);
      if (run !== state.run) return;
      progress(null);
      align(a, c);
    } catch (e) {
      if (run !== state.run) return;
      progress(null);
      console.error(e);
      message(`Could not read the PDFs: ${e.message || e}`, 'error');
    }
  }

  async function loadSide(file, role, run) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    // pdf.js takes ownership of the buffer it is given; keep our own copy for pdf-lib.
    const doc = await pdfjsLib.getDocument({ data: bytes.slice(), worker: state.pdfWorker, isEvalSupported: false, verbosity: 0 }).promise;
    const infos = [];
    const canvases = [];
    try {
      for (let i = 0; i < doc.numPages; i++) {
        if (run !== state.run) throw new Error('cancelled');
        progress(`Reading ${role} – page ${i + 1} of ${doc.numPages}`, i, doc.numPages);
        const info = await KPM.readPageInfo(doc, i);
        const canvas = await renderThumb(doc, i);
        info.thumbVec = thumbVector(canvas);
        infos.push(info);
        canvases.push(canvas);
      }
    } finally {
      await doc.destroy();
    }
    return { infos, canvases, bytes, name: file.name };
  }

  async function renderThumb(doc, index) {
    const page = await doc.getPage(index + 1);
    const base = page.getViewport({ scale: 1 });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const viewport = page.getViewport({ scale: (THUMB_CSS_WIDTH / base.width) * dpr });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    page.cleanup();
    return canvas;
  }

  function thumbVector(canvas) {
    const small = document.createElement('canvas');
    small.width = VEC_W;
    small.height = VEC_H;
    const ctx = small.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0, VEC_W, VEC_H);
    const px = ctx.getImageData(0, 0, VEC_W, VEC_H).data;
    const vec = new Array(VEC_W * VEC_H);
    for (let i = 0; i < vec.length; i++) {
      vec[i] = 0.299 * px[4 * i] + 0.587 * px[4 * i + 1] + 0.114 * px[4 * i + 2];
    }
    return vec;
  }

  function align(a, c) {
    let mapping;
    let match = null;
    const byStamp = KPM.alignByStamps(a.infos, c.infos);
    if (byStamp.mapping) {
      mapping = byStamp.mapping;
    } else {
      if (a.infos.length > c.infos.length) {
        message('Your (ahead) file has more pages than the (complete) file. Did you put them the wrong way round? Use ⇄ to swap them.', 'error');
        return;
      }
      match = KPM.alignBySimilarity(a.infos, c.infos);
      mapping = match.mapping;
      const changed = match.exact.filter((e) => !e).length;
      const check = changed === 0 ? 'Every page has an exact counterpart.'
        : `${changed} page${changed === 1 ? ' differs' : 's differ'} between the two files and ${changed === 1 ? 'is' : 'are'} marked “?”: check that each pair shows the same slide.`;
      // Separate exports of the same lecture are the normal case (the
      // (complete) is often exported after the slides were edited), so say
      // so calmly; only a likely wrong file or broken IDs get a warning.
      const notes = {
        missing: ['These files were made before slide IDs were added, so pages were paired by their content.', null],
        'one-side': ['The two files come from different exports of the slides, so pages were paired by their content.', null],
        'different-export': ['The two files come from different exports of the same slides, so pages were paired by their content.', null],
        'different-deck': ['These two files seem to come from different Keynote decks. Check that you picked the (ahead) and (complete) of the same lecture. Pages were paired by their content.', 'warn'],
        partial: ['Only some pages carry slide IDs, so pages were paired by their content.', 'warn'],
        'not-subset': ['The slide IDs of the two files do not line up, so pages were paired by their content.', 'warn'],
      }[byStamp.reason];
      message(`${notes[0]} ${check}`, notes[1]);
    }
    state.matchedByStamp = !!byStamp.mapping;
    state.pages = { ahead: a, complete: c };
    state.rows = KPM.buildRows(a.infos, c.infos, mapping, match);
    const annotated = state.rows.filter((r) => r.aheadAnnotated).length;
    if (!annotated) {
      message('No annotations were found in your (ahead) file. Ink that an app has “flattened” into the page cannot be detected: open the slides below and pick pages by hand.', 'warn');
    }
    $('#outname').value = KPM.defaultOutputName(c.name);
    renderBoard();
    $('#board').hidden = false;
    $('#actionbar').hidden = false;
    updateSummary();
  }

  // ---------- board ----------
  function label(role, info) {
    // An (ahead) slide number from another export may not be the same
    // slide's number in (complete); show its page number instead then.
    const trusted = role === 'complete' || state.matchedByStamp;
    return info.stamp && trusted ? `Slide ${info.stamp.slide}` : `${role === 'ahead' ? 'Ahead' : 'Complete'} p. ${info.index + 1}`;
  }

  function thumbCell(role, idx, row) {
    const cell = document.createElement('div');
    cell.className = 'thumb';
    // Caption above the picture, so it never covers the slide's own title.
    const caption = document.createElement('div');
    caption.className = 'caption';
    cell.appendChild(caption);
    const frame = document.createElement('div');
    frame.className = 'frame';
    cell.appendChild(frame);
    if (idx === null) {
      caption.innerHTML = '&nbsp;';
      frame.innerHTML = '<div class="placeholder"><span>Not in your (ahead) file</span></div>';
      return cell;
    }
    const side = state.pages[role];
    const info = side.infos[idx];
    frame.appendChild(side.canvases[idx]);
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = label(role, info);
    caption.appendChild(tag);
    if (info.annotCount) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = `✎ ${info.annotCount} annotation${info.annotCount === 1 ? '' : 's'}`;
      badge.title = info.annotTypes.join(', ');
      caption.appendChild(badge);
    }
    if (role === 'complete') {
      const rep = document.createElement('div');
      rep.className = 'replaced-label';
      rep.innerHTML = '<span>replaced by your (ahead) page</span>';
      frame.appendChild(rep);
    }
    return cell;
  }

  function rowElement(row) {
    const el = document.createElement('div');
    el.className = 'row';
    el.appendChild(thumbCell('ahead', row.aheadIdx, row));
    if (row.aheadIdx === null) {
      const none = document.createElement('span');
      none.className = 'no-toggle';
      none.textContent = '–';
      el.appendChild(none);
    } else {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'toggle';
      btn.setAttribute('aria-haspopup', 'menu');
      btn.addEventListener('click', () => openActionMenu(btn, row, () => {
        updateRow(el, row);
        updateSummary();
      }));
      el.appendChild(btn);
    }
    el.appendChild(thumbCell('complete', row.completeIdx, row));
    const warn = document.createElement('div');
    warn.className = 'row-warning';
    el.appendChild(warn);
    updateRow(el, row);
    return el;
  }

  function updateRow(el, row) {
    const btn = el.querySelector('.toggle');
    const completeCell = el.children[2];
    const repLabel = completeCell.querySelector('.replaced-label');
    if (btn) {
      const act = ACTIONS[row.action];
      btn.dataset.action = row.action;
      btn.innerHTML = `<span class="icon">${iconHtml(act.icon)}</span>` + (row.uncertain ? '<span class="q">?</span>' : '');
      btn.setAttribute('aria-label', `${act.label}. Click to change.`);
      btn.title = `${act.label}. Click to change.`
        + (row.uncertain ? ' These two pages differ (the slide may have been edited between the two exports): check that they show the same slide.' : '');
    }
    const replaced = row.action === 'replace';
    completeCell.classList.toggle('replaced', replaced);
    if (repLabel) repLabel.hidden = !replaced;
    const warn = el.querySelector('.row-warning');
    const inserting = row.action === 'above' || row.action === 'below';
    warn.classList.toggle('note', inserting);
    if (replaced && row.completeAnnotated) {
      warn.textContent = '⚠ This (complete) page has annotations of its own. They will be lost if you replace it; insert your (ahead) page above or below it instead to keep both.';
    } else if (inserting) {
      warn.textContent = `Your (ahead) page will be inserted right ${row.action === 'above' ? 'before' : 'after'} this (complete) page.`;
    } else {
      warn.textContent = '';
    }
    warn.hidden = !warn.textContent;
  }

  // ---------- per-row action menu ----------
  // Icons: Lucide (vendor/lucide, via src/icons.js); 'keep' shows none.
  const ACTIONS = {
    replace: { icon: 'move-right', label: 'Replace' },
    above: { icon: 'corner-up-right', label: 'Insert above' },
    below: { icon: 'corner-down-right', label: 'Insert below' },
    keep: { icon: null, label: 'Use the page from the right' },
  };
  let menu = null;

  function iconHtml(name) {
    return name ? window.KPM_ICONS[name] : '';
  }

  function closeActionMenu(refocus) {
    if (!menu) return;
    const { el, button } = menu;
    menu = null;
    el.remove();
    document.removeEventListener('pointerdown', onOutside, true);
    if (refocus) button.focus();
  }

  function onOutside(e) {
    if (menu && !menu.el.contains(e.target) && e.target !== menu.button && !menu.button.contains(e.target)) {
      closeActionMenu(false);
    }
  }

  function openActionMenu(button, row, onChange) {
    const reopen = menu && menu.button === button;
    closeActionMenu(false);
    if (reopen) return;  // a second click on the same arrow closes its menu
    const el = document.createElement('div');
    el.className = 'action-menu';
    el.setAttribute('role', 'menu');
    const items = Object.entries(ACTIONS).map(([id, act]) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'action-item';
      item.setAttribute('role', 'menuitemradio');
      item.setAttribute('aria-checked', String(row.action === id));
      item.innerHTML = '<span class="icon"></span><span class="text"></span>';
      item.querySelector('.icon').innerHTML = iconHtml(act.icon);
      item.querySelector('.text').textContent = act.label;
      item.addEventListener('click', () => {
        row.action = id;
        closeActionMenu(true);
        onChange();
      });
      el.appendChild(item);
      return item;
    });
    el.addEventListener('keydown', (e) => {
      const k = items.indexOf(document.activeElement);
      if (e.key === 'Escape') { e.preventDefault(); closeActionMenu(true); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); items[(k + 1) % items.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); items[(k - 1 + items.length) % items.length].focus(); }
      else if (e.key === 'Tab') closeActionMenu(false);
    });
    document.body.appendChild(el);
    // Place it below the arrow, kept inside the window.
    const b = button.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.max(8, Math.min(b.left + b.width / 2 - w / 2, window.innerWidth - w - 8));
    const below = b.bottom + 6;
    const top = below + h > window.innerHeight - 8 ? Math.max(8, b.top - h - 6) : below;
    el.style.left = `${left + window.scrollX}px`;
    el.style.top = `${top + window.scrollY}px`;
    menu = { el, button };
    document.addEventListener('pointerdown', onOutside, true);
    items[Object.keys(ACTIONS).indexOf(row.action)].focus();
  }

  function runLabel(rows, open) {
    const first = rows[0];
    const last = rows[rows.length - 1];
    const name = (r) => (r.slide !== null ? r.slide : `p. ${r.completeIdx + 1}`);
    const span = rows.length === 1 ? `slide ${name(first)}` : `slides ${name(first)}–${name(last)}`;
    const n = rows.length === 1 ? '1 slide' : `${rows.length} slides`;
    return `${open ? '▾' : '▸'} ${n} without annotations (${span})`;
  }

  function renderBoard() {
    closeActionMenu(false);
    const host = $('#rows');
    host.innerHTML = '';
    for (const g of KPM.groupRows(state.rows)) {
      if (g.type === 'row') {
        host.appendChild(rowElement(g.row));
        continue;
      }
      const bar = document.createElement('button');
      bar.type = 'button';
      bar.className = 'run';
      bar.textContent = runLabel(g.rows, false);
      bar.setAttribute('aria-expanded', 'false');
      bar.addEventListener('click', () => toggleRun(bar, g.rows));
      host.appendChild(bar);
    }
  }

  /*
   * Expand or collapse one run in place. The slide row the student is most
   * likely looking at (the one most fully on screen; on a tie, the one below
   * the bar) keeps its position, so rows expanded between it and the bar
   * push the bar away instead. With no slide row on screen, the bar stays put.
   */
  function toggleRun(bar, rows) {
    closeActionMenu(false);
    const anchor = nearestVisibleRow(bar) || bar;
    const before = anchor.getBoundingClientRect().top;
    const open = bar.getAttribute('aria-expanded') === 'true';
    if (open) {
      bar.nextElementSibling.remove();
    } else {
      const body = document.createElement('div');
      body.className = 'run-body';
      rows.forEach((r) => body.appendChild(rowElement(r)));
      bar.after(body);
    }
    bar.setAttribute('aria-expanded', String(!open));
    bar.textContent = runLabel(rows, !open);
    window.scrollBy(0, anchor.getBoundingClientRect().top - before);
  }

  function nearestVisibleRow(bar) {
    const top = $('.board-head').getBoundingClientRect().bottom;
    const bottom = $('#actionbar').getBoundingClientRect().top;
    const barTop = bar.getBoundingClientRect().top;
    const own = bar.nextElementSibling && bar.nextElementSibling.classList.contains('run-body')
      ? bar.nextElementSibling : null;
    let best = null;
    let bestShown = 0;
    for (const row of document.querySelectorAll('#rows .row')) {
      if (own && own.contains(row)) continue;  // these rows go away on collapse
      const r = row.getBoundingClientRect();
      const shown = Math.min(r.bottom, bottom) - Math.max(r.top, top);
      if (shown <= 0) continue;
      const below = r.top > barTop;
      if (shown > bestShown + 0.5 || (Math.abs(shown - bestShown) <= 0.5 && below)) {
        best = row;
        bestShown = shown;
      }
    }
    return best;
  }

  function chosen() {
    return state.rows.filter((r) => r.action !== 'keep' && r.aheadIdx !== null)
      .map((r) => ({ aheadIdx: r.aheadIdx, completeIdx: r.completeIdx, mode: r.action }));
  }

  function updateSummary() {
    const ops = chosen();
    const replaced = ops.filter((op) => op.mode === 'replace').length;
    const inserted = ops.length - replaced;
    const pages = (n) => `${n} page${n === 1 ? '' : 's'}`;
    const parts = [];
    if (replaced) parts.push(`${pages(replaced)} replaced`);
    if (inserted) parts.push(`${pages(inserted)} inserted`);
    $('#summary').textContent = ops.length === 0 ? 'No pages chosen from (ahead) yet.'
      : `From your (ahead) file: ${parts.join(', ')}.`;
    $('#download').disabled = ops.length === 0;
  }

  // ---------- output ----------
  async function download() {
    const btn = $('#download');
    btn.disabled = true;
    try {
      const bytes = await KPM.mergePdf(PDFLib, state.pages.ahead.bytes, state.pages.complete.bytes, chosen());
      let name = $('#outname').value.trim() || KPM.defaultOutputName(state.pages.complete.name);
      if (!/\.pdf$/i.test(name)) name += '.pdf';
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      console.error(e);
      message(`Could not build the merged PDF: ${e.message || e}`, 'error');
    } finally {
      updateSummary();
    }
  }

  // "Download offline version": saves this very page. Pointing at the page's
  // own address keeps it right however the site is served. An offline copy
  // opened from disk already is the offline version, so the link is hidden.
  function wireOfflineLink() {
    if (location.protocol === 'file:') {
      $('#offline-link').hidden = true;
      return;
    }
    $('#offline-download').href = location.href.split('#')[0];
  }

  wireInputs();
  wireOfflineLink();
  // Exposed for debugging and for automated checks of the page.
  window.KPMApp = { state, assign, setupWorker };
})();
