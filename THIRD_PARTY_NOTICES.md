# Third-party notices

Hermes source is MIT licensed. The following bundled dependency retains its own license and copyright notices.

## PDF.js 6.4.299

- Project: https://mozilla.github.io/pdf.js/
- Source: https://github.com/mozilla/pdf.js
- Distribution: `pdfjs-dist@6.4.299` from npm, pinned in `package-lock.json`.
- License: Apache License 2.0; bundled at [`extension/vendor/pdfjs/LICENSE.txt`](extension/vendor/pdfjs/LICENSE.txt).
- Files: unmodified `legacy/build/pdf.min.mjs` and `legacy/build/pdf.worker.min.mjs`.
- Reproduce: `npm ci` followed by `npm run vendor:pdf`.

The legacy distribution also embeds compatibility code and its upstream notices. Minified production files are bundled locally, not fetched or executed from a CDN. No PDF.js UI, images, fonts, or OCR models are bundled.
