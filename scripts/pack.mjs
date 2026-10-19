// Inline src/index.html's stylesheet and scripts into one double-clickable
// file: dist/Keynote PDF Merger.html. The pdf.js worker goes in as a
// text/plain block that app.js turns into a Blob-URL Worker.
// Run: npm run build
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src');
const outDir = path.join(root, 'dist');
const outFile = path.join(outDir, 'Keynote PDF Merger.html');

const read = (rel) => fs.readFileSync(path.join(src, rel), 'utf8');
const safe = (code, file) => {
  if (/<\/script/i.test(code)) throw new Error(`${file} contains "</script" and cannot be inlined as is`);
  return code;
};

let html = read('index.html');
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, href) => `<style>\n${read(href)}</style>`);
html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, s) => `<script>\n${safe(read(s), s)}\n</script>`);
const worker = safe(fs.readFileSync(path.join(root, 'vendor', 'pdf.worker.min.js'), 'utf8'), 'pdf.worker.min.js');
html = html.replace('</body>', () => `<script type="text/plain" id="pdfjs-worker-src">${worker}</script>\n</body>`);
if (/<(script|link)[^>]+(src|href)=/i.test(html)) throw new Error('an external reference was left in the packed page');

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, html);
console.log(`wrote ${path.relative(root, outFile)} (${(html.length / 1e6).toFixed(2)} MB)`);
