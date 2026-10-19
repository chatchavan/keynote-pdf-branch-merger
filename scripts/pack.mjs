// Inline src/index.html's stylesheet and scripts into one double-clickable
// file: docs/index.html (served by GitHub Pages, also double-clickable). The pdf.js worker goes in as a
// text/plain block that app.js turns into a Blob-URL Worker.
// Run: npm run build
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src');
const outDir = path.join(root, 'docs');
const outFile = path.join(outDir, 'index.html');

const read = (rel) => fs.readFileSync(path.join(src, rel), 'utf8');
const safe = (code, file) => {
  if (/<\/script/i.test(code)) throw new Error(`${file} contains "</script" and cannot be inlined as is`);
  return code;
};

let html = read('index.html');
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, href) => `<style>\n${read(href)}</style>`);
html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, s) => `<script>\n${safe(read(s), s)}\n</script>`);
// pdf.js is an ES module: inline it as a module script whose closing
// export list becomes the pdfjsLib global (src/pdfjs-loader.mjs does the
// same for the dev page). It must stay a module: it uses import.meta.url.
html = html.replace('<script type="module" src="pdfjs-loader.mjs"></script>', () => {
  const lib = safe(fs.readFileSync(path.join(root, 'vendor', 'pdf.min.mjs'), 'utf8'), 'pdf.min.mjs');
  const m = /export\s*\{([^}]*)\}\s*;?\s*$/.exec(lib);
  if (!m) throw new Error('pdf.min.mjs: closing export list not found');
  const props = m[1].split(',').map((part) => {
    const [local, exported] = part.trim().split(/\s+as\s+/);
    return `${JSON.stringify(exported || local)}: ${local}`;
  });
  const global = `globalThis.pdfjsLib = Object.freeze({ ${props.join(', ')} });\ndispatchEvent(new Event('pdfjs-ready'));`;
  return `<script type="module">\n${lib.slice(0, m.index)}\n${global}\n</script>`;
});
if (html.includes('pdfjs-loader.mjs')) throw new Error('pdfjs-loader.mjs tag not found or not replaced');
// The worker is a module too, but its only module features are a closing
// `export{WorkerMessageHandler}` and two `import.meta.url` base URLs for the
// wasm image decoders. Rewritten as a classic script, the page can start it
// as a classic Blob worker, which Chrome allows from file:// (a module
// Blob worker it refuses there), or run it on the main thread.
let worker = safe(fs.readFileSync(path.join(root, 'vendor', 'pdf.worker.min.mjs'), 'utf8'), 'pdf.worker.min.mjs');
const workerExport = /export\s*\{\s*WorkerMessageHandler\s*\}\s*;?\s*$/;
if (!workerExport.test(worker)) throw new Error('pdf.worker.min.mjs: closing export not found');
worker = worker.replace(workerExport, '').replace(/import\.meta\.url/g, 'self.location.href');
if (/(^|[;}])\s*(import|export)[\s{*]/.test(worker) || worker.includes('import.meta')) {
  throw new Error('pdf.worker.min.mjs: module syntax left after rewriting');
}
html = html.replace('</body>', () => `<script type="text/plain" id="pdfjs-worker-src">${worker}</script>\n</body>`);
if (/<(script|link)[^>]+(src|href)=/i.test(html)) throw new Error('an external reference was left in the packed page');

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, html);
console.log(`wrote ${path.relative(root, outFile)} (${(html.length / 1e6).toFixed(2)} MB)`);
