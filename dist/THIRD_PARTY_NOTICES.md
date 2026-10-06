# Third-party software

BanglaSnap OCR bundles the following software and data so OCR can run without a network request.

- **Tesseract.js 7.0.0** — Apache License 2.0 — <https://github.com/naptha/tesseract.js>
- **tesseract.js-core 7.0.0** — Apache License 2.0 — <https://github.com/naptha/tesseract.js-core>
- **@tesseract.js-data/ben 1.0.0** — MIT License — <https://github.com/naptha/tessdata>
- **@tesseract.js-data/eng 1.0.0** — MIT License — <https://github.com/naptha/tessdata>

Minified bundle notices and the tesseract.js-core license are copied into `vendor/` by `npm run build`.
The build replaces unreachable legacy global-object fallbacks in the Tesseract.js browser bundles so the MV3 package contains no `eval()` or `Function(...)` code construction.
