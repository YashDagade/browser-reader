# Third-party notices

Hermes source is MIT licensed. The following bundled dependencies retain their own license and copyright notices.

## PDF.js 6.4.299

- Project: https://mozilla.github.io/pdf.js/
- Source: https://github.com/mozilla/pdf.js
- Distribution: `pdfjs-dist@6.4.299` from npm, pinned in `package-lock.json`.
- License: Apache License 2.0; bundled at [`extension/vendor/pdfjs/LICENSE.txt`](extension/vendor/pdfjs/LICENSE.txt).
- Files: unmodified `legacy/build/pdf.min.mjs`, `legacy/build/pdf.worker.min.mjs`, CMaps, standard fonts, and non-WASM JBIG2/OpenJPEG decoder fallbacks.
- Reproduce: `npm ci` followed by `npm run vendor:pdf`.

The legacy distribution also embeds compatibility code and its upstream notices. Minified production files are bundled locally, not fetched or executed from a CDN. No upstream viewer UI or OCR model is bundled. CMap, Foxit/Liberation font, and JBIG2/OpenJPEG decoder notices are preserved in the adjacent `cmaps/LICENSE`, `standard_fonts/LICENSE_*`, and `wasm/LICENSE_*` files.


## pdf-lib 1.17.1

- Project and source: https://github.com/Hopding/pdf-lib
- Distribution: `pdf-lib@1.17.1` from npm, pinned in `package-lock.json`.
- License: MIT, preserved in [`extension/vendor/pdf-lib/LICENSE.txt`](extension/vendor/pdf-lib/LICENSE.txt).
- File: unmodified `dist/pdf-lib.esm.min.js`, renamed `pdf-lib.min.mjs` for the extension module loader. Loaded only when exporting an annotated PDF copy.
- Its bundled standard-fonts, UPNG, pako, and tslib notices are preserved in adjacent `LICENSE_*.txt` files.
- Reproduce: `npm ci` followed by `npm run vendor:pdf`.
