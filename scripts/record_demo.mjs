// Record demo/demo.gif: drive the built page (docs/index.html, served over
// http from a throwaway local server so it looks like the online version,
// download link included) in headless Chrome with a drawn cursor,
// capture one PNG per step, and turn them into a GIF with ffmpeg.
// Needs Google Chrome and ffmpeg. Run: npm run demo
// Env: CHROME (path to Chrome), FFMPEG (path to ffmpeg), KEEP_FRAMES=1.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const OUT = path.join(root, 'demo', 'demo.gif');
const W = 1000;
const H = 700;
const FPS = 10;

const frames = fs.mkdtempSync(path.join(os.tmpdir(), 'kpm-demo-'));
let n = 0;
let last = null;

const page1 = fs.readFileSync(path.join(root, 'docs', 'index.html'));
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(page1);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, defaultViewport: { width: W, height: H } });
const page = await browser.newPage();
const cdp = await page.createCDPSession();
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: frames });
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
await page.goto(`http://127.0.0.1:${server.address().port}/`);

// Cursor, drag chip, click ripple and toast drawn over the page; none of
// them takes pointer events, so real clicks reach the page underneath.
await page.evaluate(() => {
  const css = document.createElement('style');
  css.textContent = `
    #demo-cursor { position: fixed; left: 0; top: 0; z-index: 99999; pointer-events: none; width: 26px; height: 26px; }
    #demo-chip { position: fixed; z-index: 99998; pointer-events: none; display: none; padding: 8px 12px;
      background: #fff; border: 1px solid #c8ccd4; border-radius: 8px; box-shadow: 0 6px 18px rgba(0,0,0,.18);
      font: 13px -apple-system, Helvetica, Arial, sans-serif; color: #1d1d1f; line-height: 1.5; }
    #demo-ripple { position: fixed; z-index: 99997; pointer-events: none; width: 34px; height: 34px; margin: -17px 0 0 -17px;
      border-radius: 50%; background: rgba(47,111,219,.35); display: none; }
    #demo-toast { position: fixed; z-index: 99998; pointer-events: none; left: 50%; bottom: 84px; transform: translateX(-50%);
      display: none; padding: 10px 16px; border-radius: 8px; background: #1d1d1f; color: #fff;
      font: 14px -apple-system, Helvetica, Arial, sans-serif; }`;
  document.head.appendChild(css);
  const cur = document.createElement('div');
  cur.id = 'demo-cursor';
  cur.innerHTML = '<svg viewBox="0 0 26 26" width="26" height="26"><path d="M3 2 L3 21 L8 16.5 L11.5 24 L15 22.5 L11.5 15 L18 15 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  const chip = document.createElement('div');
  chip.id = 'demo-chip';
  chip.innerHTML = '📄 Lecture (ahead).pdf<br>📄 Lecture (complete).pdf';
  const ripple = document.createElement('div');
  ripple.id = 'demo-ripple';
  const toast = document.createElement('div');
  toast.id = 'demo-toast';
  document.body.append(cur, chip, ripple, toast);
});

let cx = W - 80;
let cy = H - 60;

async function setCursor(x, y) {
  cx = x;
  cy = y;
  await page.evaluate((x, y) => {
    const c = document.getElementById('demo-cursor');
    c.style.transform = `translate(${x - 3}px, ${y - 2}px)`;
    const chip = document.getElementById('demo-chip');
    chip.style.left = `${x + 18}px`;
    chip.style.top = `${y + 14}px`;
  }, x, y);
}

async function shot() {
  const file = path.join(frames, `${String(n++).padStart(4, '0')}.png`);
  await page.screenshot({ path: file });
  last = file;
}

async function hold(count) {
  for (let i = 0; i < count; i++) {
    fs.copyFileSync(last, path.join(frames, `${String(n++).padStart(4, '0')}.png`));
  }
}

const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

async function moveTo(x, y, steps = 8) {
  const x0 = cx;
  const y0 = cy;
  for (let i = 1; i <= steps; i++) {
    const t = ease(i / steps);
    await setCursor(x0 + (x - x0) * t, y0 + (y - y0) * t);
    await shot();
  }
}

async function center(selector, index = 0) {
  return page.evaluate((sel, i) => {
    const r = document.querySelectorAll(sel)[i].getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  }, selector, index);
}

async function click(x, y) {
  await page.evaluate((x, y) => {
    const r = document.getElementById('demo-ripple');
    r.style.left = `${x}px`;
    r.style.top = `${y}px`;
    r.style.display = 'block';
  }, x, y);
  await shot();
  await page.mouse.click(x, y);
  await page.evaluate(() => { document.getElementById('demo-ripple').style.display = 'none'; });
  await shot();
}

async function scrollBy(dy, steps = 8) {
  for (let i = 0; i < steps; i++) {
    await page.evaluate((d) => window.scrollBy(0, d), dy / steps);
    await shot();
  }
}

// --- the story ---
await setCursor(cx, cy);
await shot();
await hold(6);

// 1. Drag both PDFs onto the drop zone.
await page.evaluate(() => { document.getElementById('demo-chip').style.display = 'block'; });
const [dzx, dzy] = await center('#dropzone');
await moveTo(dzx - 60, dzy + 10, 12);
await page.evaluate(() => document.getElementById('dropzone').classList.add('over'));
await shot();
await hold(3);
const pdfs = ['ahead', 'complete'].map((r) => ({
  name: `Lecture (${r}).pdf`,
  b64: fs.readFileSync(path.join(root, 'demo', `Lecture (${r}).pdf`)).toString('base64'),
}));
await page.evaluate((pdfs) => {
  document.getElementById('demo-chip').style.display = 'none';
  const dt = new DataTransfer();
  for (const p of pdfs) {
    const bytes = Uint8Array.from(atob(p.b64), (c) => c.charCodeAt(0));
    dt.items.add(new File([bytes], p.name, { type: 'application/pdf' }));
  }
  const dz = document.getElementById('dropzone');
  dz.classList.remove('over');
  dz.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
}, pdfs);
for (let i = 0; i < 40; i++) {
  await shot();
  if (await page.evaluate(() => window.KPMApp.state.rows.length > 0)) break;
  await new Promise((r) => setTimeout(r, 100));
}
await shot();
await hold(8);

// 2. Scroll to the pairs.
await moveTo(W / 2 + 60, H / 2 + 60, 6);
const boardTop = await page.evaluate(() => document.getElementById('board').getBoundingClientRect().top);
await scrollBy(boardTop - 12, 10);
await hold(10);

// 3. Slide 2: open the menu and choose "Insert below".
let [bx, by] = await center('#rows > .row .toggle', 0);
await moveTo(bx, by, 10);
await hold(3);
await click(bx, by);
await hold(8);
const [ix, iy] = await center('.action-menu .action-item', 2);
await moveTo(ix - 40, iy, 8);
await hold(4);
await click(ix - 40, iy);
await hold(12);

// 4. Open the folded slides 3-5 (slide 5 is not in the ahead version).
const barIndex = await page.evaluate(() => [...document.querySelectorAll('#rows > .run')]
  .findIndex((b) => b.textContent.includes('3–5')));
const [rx, ry] = await center('#rows > .run', barIndex);
await moveTo(rx - 200, ry, 10);
await hold(3);
await click(rx - 200, ry);
await hold(6);
await scrollBy(await page.evaluate(() => {
  const body = document.querySelector('.run-body');
  return body.getBoundingClientRect().bottom - window.innerHeight + 90;
}), 14);
await hold(14);

// 5. Download the merged PDF.
const [dx, dy] = await center('#download');
await moveTo(dx, dy, 12);
await hold(3);
await click(dx, dy);
await page.evaluate(() => {
  const t = document.getElementById('demo-toast');
  t.textContent = `✓ Downloaded “${document.getElementById('outname').value}”`;
  t.style.display = 'block';
});
await new Promise((r) => setTimeout(r, 500));
await shot();
await hold(25);

await browser.close();
server.close();

execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(frames, '%04d.png'),
  '-vf', 'scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle',
  '-loop', '0', OUT]);
const merged = fs.readdirSync(frames).filter((f) => f.endsWith('.pdf'));
console.log(`wrote ${path.relative(root, OUT)} (${n} frames, ${(fs.statSync(OUT).size / 1e6).toFixed(2)} MB); downloaded: ${merged.join(', ') || 'nothing'}`);
if (!process.env.KEEP_FRAMES) fs.rmSync(frames, { recursive: true, force: true });
else console.log('frames in', frames);
