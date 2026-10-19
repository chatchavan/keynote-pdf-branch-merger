// Run: npm test   (node --test tests/)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pdfjsLib = require('../vendor/pdf.min.js');
const PDFLib = require('../vendor/pdf-lib.min.js');
const KPM = require('../src/core.js');

pdfjsLib.GlobalWorkerOptions.workerSrc = path.join(__dirname, '..', 'vendor', 'pdf.worker.min.js');

const FIX = path.join(__dirname, 'fixtures');
const read = (set, role) => new Uint8Array(fs.readFileSync(path.join(FIX, set, `Demo (${role}).pdf`)));

async function open(bytes) {
  return pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
}

async function infos(set) {
  const a = await KPM.readAllPageInfo(await open(read(set, 'ahead')));
  const c = await KPM.readAllPageInfo(await open(read(set, 'complete')));
  return { a, c };
}

// Fixture deck (scripts/make_fixtures.py): slides 1..10, 3 skipped, 8 EXCLUDE,
// 5+6 EXCLUDE PRE-LECTURE.
const COMPLETE_SLIDES = [1, 2, 4, 5, 6, 7, 9, 10];
const AHEAD_SLIDES = [1, 2, 4, 7, 9, 10];
const EXPECTED_MAPPING = AHEAD_SLIDES.map((s) => COMPLETE_SLIDES.indexOf(s));

test('parseStamp', () => {
  assert.deepEqual(KPM.parseStamp('foo KPB2|9c1e0a7b3d42|3fa9c01b2e7d|17|42 bar'),
    { deck: '9c1e0a7b3d42', run: '3fa9c01b2e7d', slide: 17, total: 42 });
  assert.deepEqual(KPM.parseStamp('foo KPB1|3fa9c01b2e7d|17|42 bar'), { deck: null, run: '3fa9c01b2e7d', slide: 17, total: 42 });
  assert.equal(KPM.parseStamp('KPB1|XYZ|1|2'), null);
  assert.equal(KPM.parseStamp(''), null);
});

test('reads stamps and student annotations; ignores links', async () => {
  const { a, c } = await infos('stamped');
  assert.deepEqual(a.map((p) => p.stamp.slide), AHEAD_SLIDES);
  assert.deepEqual(c.map((p) => p.stamp.slide), COMPLETE_SLIDES);
  // Slide 1 has a hyperlink only.
  assert.equal(a[0].annotCount, 0);
  assert.deepEqual(a.map((p) => p.annotCount > 0), [false, false, true, false, true, true]);
  assert.deepEqual(a[4].annotTypes.sort(), ['Highlight', 'Text']);
  assert.ok(!a[0].words.some((w) => w.startsWith('kpb')), 'stamp is not part of the words');
});

test('alignByStamps maps by slide number', async () => {
  const { a, c } = await infos('stamped');
  const r = KPM.alignByStamps(a, c);
  assert.equal(r.reason, null);
  assert.deepEqual(r.mapping, EXPECTED_MAPPING);
});

test('alignByStamps refuses missing or mismatched stamps', async () => {
  let { a, c } = await infos('unstamped');
  assert.equal(KPM.alignByStamps(a, c).reason, 'missing');
  const u = await infos('stamped');
  assert.equal(KPM.alignByStamps(a, u.c).reason, 'one-side');
  assert.equal(KPM.alignByStamps([...a.slice(0, 1), ...u.a.slice(1)], u.c).reason, 'partial');
  ({ a, c } = await infos('other-run'));
  assert.equal(KPM.alignByStamps(a, c).reason, 'different-export');
  ({ a, c } = await infos('other-deck'));
  assert.equal(KPM.alignByStamps(a, c).reason, 'different-deck');
  // KPB1 stamps carry no deck: a run mismatch can only be a different export.
  const kpb1 = (p) => ({ ...p, stamp: { ...p.stamp, deck: null } });
  assert.equal(KPM.alignByStamps(a.map(kpb1), c.map(kpb1)).reason, 'different-export');
});

test('textKey ignores bare numbers (shifting slide numbers)', () => {
  assert.equal(KPM.textKey(['build', 'step', 'first', 'bullet', '9']), KPM.textKey(['build', 'step', 'first', 'bullet', '10']));
  assert.notEqual(KPM.textKey(['x', '42']), KPM.textKey(['y', '42']));
});

// other-run: the (complete) export came from an edited deck. Complete pages:
// welcome, agenda, NEW, defs (reworded), ex1, ex2, shapes, build1, build2;
// slide numbers after "agenda" are all one higher than in (ahead).
test('alignBySimilarity across runs: exact anchors, only edited pages flagged', async () => {
  const { a, c } = await infos('other-run');
  // The text-less "shapes" slide can only be told apart by its picture;
  // the page supplies thumbnails, Node does not, so stand one in.
  a[3].thumbVec = c[6].thumbVec = new Array(16).fill(50);
  const match = KPM.alignBySimilarity(a, c);
  assert.deepEqual(match.mapping, [0, 1, 3, 6, 7, 8]);
  // Only "defs" was reworded.
  assert.deepEqual(match.exact, [true, true, false, true, true, true]);
  const rows = KPM.buildRows(a, c, match.mapping, match);
  assert.deepEqual(rows.filter((r) => r.uncertain).map((r) => r.completeIdx), [3]);
  assert.deepEqual(rows.filter((r) => r.aheadIdx === null).map((r) => r.completeIdx), [2, 4, 5]);
});

test('samePage compares pictures for text-less pages', () => {
  const v = (x) => new Array(16).fill(x);
  assert.equal(KPM.samePage({ words: ['7'], thumbVec: v(100) }, { words: ['8'], thumbVec: v(101) }), true);
  assert.equal(KPM.samePage({ words: [], thumbVec: v(100) }, { words: [], thumbVec: v(160) }), false);
  assert.equal(KPM.samePage({ words: ['a'] }, { words: ['b'] }), false);
});

test('alignBySimilarity recovers the mapping from content', async () => {
  const { a, c } = await infos('unstamped');
  a[3].thumbVec = c[5].thumbVec = new Array(16).fill(50);  // text-less slide 7: see the other-run test
  const { mapping, scores, exact } = KPM.alignBySimilarity(a, c);
  assert.deepEqual(mapping, EXPECTED_MAPPING);
  assert.ok(scores.every((s) => s > 0.9), `scores ${scores}`);
  assert.ok(exact.every(Boolean), `exact ${exact}`);
});

test('alignBySimilarity uses thumbnails for text-less pages', () => {
  const v = (x) => new Array(16).fill(x);
  const ahead = [{ words: [], thumbVec: v(200) }, { words: [], thumbVec: v(20) }];
  const complete = [{ words: [], thumbVec: v(200) }, { words: [], thumbVec: v(120) }, { words: [], thumbVec: v(20) }];
  assert.deepEqual(KPM.alignBySimilarity(ahead, complete).mapping, [0, 2]);
});

test('alignBySimilarity rejects ahead longer than complete', () => {
  assert.throws(() => KPM.alignBySimilarity([{ words: ['a'] }, { words: ['b'] }], [{ words: ['a'] }]), /ahead-longer/);
});

test('buildRows and groupRows', async () => {
  const { a, c } = await infos('stamped');
  const rows = KPM.buildRows(a, c, KPM.alignByStamps(a, c).mapping, null);
  assert.equal(rows.length, c.length);
  // Slides 5 and 6 are complete-only.
  assert.deepEqual(rows.map((r) => r.aheadIdx), [0, 1, 2, null, null, 3, 4, 5]);
  assert.deepEqual(rows.map((r) => r.useAhead), [false, false, true, false, false, false, true, true]);
  assert.equal(rows[6].completeAnnotated, true);
  const groups = KPM.groupRows(rows);
  // Annotated: slides 4, 9, 10 -> keep 2,4,5 and 7,9,10; slide 1 and slide 6 collapse.
  assert.deepEqual(groups.map((g) => (g.type === 'row' ? g.row.slide : g.rows.map((r) => r.slide))),
    [[1], 2, 4, 5, [6], 7, 9, 10]);
});

test('groupRows with no annotations collapses everything into one run', () => {
  const rows = [1, 2, 3].map((s) => ({ slide: s, aheadAnnotated: false }));
  const g = KPM.groupRows(rows);
  assert.equal(g.length, 1);
  assert.equal(g[0].rows.length, 3);
});

test('mergePdf replaces chosen pages and keeps their annotations', async () => {
  const aheadBytes = read('stamped', 'ahead');
  const completeBytes = read('stamped', 'complete');
  const reps = [{ aheadIdx: 2, completeIdx: 2 }, { aheadIdx: 4, completeIdx: 6 }, { aheadIdx: 5, completeIdx: 7 }];
  const merged = await KPM.mergePdf(PDFLib, aheadBytes, completeBytes, reps);
  const m = await KPM.readAllPageInfo(await open(merged));
  assert.deepEqual(m.map((p) => p.stamp.slide), COMPLETE_SLIDES);
  assert.deepEqual(m.map((p) => p.annotCount), [0, 0, 1, 0, 0, 0, 2, 1]);
  // The complete-side ink on slide 9 was replaced by the ahead page.
  assert.deepEqual(m[6].annotTypes.sort(), ['Highlight', 'Text']);
  // No whole-document bloat from /P back-references.
  assert.ok(merged.length < (aheadBytes.length + completeBytes.length), `merged ${merged.length} bytes`);
});

test('mergePdf with no replacements returns complete unchanged in content', async () => {
  const merged = await KPM.mergePdf(PDFLib, read('stamped', 'ahead'), read('stamped', 'complete'), []);
  const m = await KPM.readAllPageInfo(await open(merged));
  assert.deepEqual(m.map((p) => p.stamp.slide), COMPLETE_SLIDES);
});

test('defaultOutputName and guessRole', () => {
  assert.equal(KPM.defaultOutputName('Lecture 3 (complete).pdf'), 'Lecture 3 (complete + merged).pdf');
  assert.equal(KPM.defaultOutputName('notes.PDF'), 'notes (complete + merged).pdf');
  assert.equal(KPM.guessRole('L3 (ahead).pdf'), 'ahead');
  assert.equal(KPM.guessRole('L3 (Complete).pdf'), 'complete');
  assert.equal(KPM.guessRole('L3 (full).pdf'), null);
});
