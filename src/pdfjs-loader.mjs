// Dev page only (served over http): load the ES-module build of pdf.js and
// expose it as the global the classic scripts use. The packed single file
// (scripts/pack.mjs) inlines the library instead, which also works from
// file://, where a module script cannot load another file.
import * as pdfjsLib from '../vendor/pdf.min.mjs';

globalThis.pdfjsLib = pdfjsLib;
dispatchEvent(new Event('pdfjs-ready'));
