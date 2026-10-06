# BanglaSnap OCR

Local Bangla and English OCR for a selected area of the current Chrome tab.

Version 0.8 uses the scalable SVG BanglaSnap logo directly in the popup and OCR result panel. Chrome does not support SVG manifest or toolbar icons, so the build includes PNG sizes generated from the same SVG artwork for those browser surfaces. The green, red, warm off-white, charcoal, and cool-gray brand color system is applied to the popup, selection overlay, and OCR result panel.

## What works

- Click the extension and drag around text on the current webpage.
- Automatically capture, crop, and recognize the selected screen area.
- Upload an image as a secondary option.
- Recognize Bangla + English (default), Bangla only, or English only.
- See OCR progress and edit the Unicode result.
- Copy the recognized text.
- Run all OCR locally from files packaged with the extension.
- Normalize contrast and upscale small selections before recognition.
- Hide low-confidence lines and isolated false characters by default, with an option to reveal every detection.
- Extract visible normal webpage text directly, then combine it with three OCR passes for text embedded in images: scattered-text recognition on color, automatic layout on contrast, and scattered-text recognition on inverted contrast for light lettering.
- Preserve contextual digits and punctuation (such as `GTA 6 & More`), separate distant icon detections from labels, and merge results using both horizontal and vertical position.
- Cross-check uncertain image text between passes; strong phrases can survive when only one pass finds them. Recognition is still approximate, and all detections remain available for review.

## Load the extension

The required runtime files are already bundled in this project. In Chrome:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the generated `BanglaSnap OCR/dist` directory.
5. Pin **BanglaSnap OCR** and open a webpage containing visible text.
6. Click the extension, choose the language, and press **Select Area on Page**.
7. Drag around the text. OCR starts automatically in a floating panel on the same webpage.

The first recognition can take several seconds while the local engine and language data initialize.

## Development

Requires Node.js 18 or newer.

```sh
npm install
npm run build
npm run check
```

`npm run build` creates the loadable `dist/` extension package and copies pinned Tesseract.js runtime files plus LSTM-only `ben`/`eng` trained data into it. Chrome never needs to fetch OCR code or language data from a CDN.

## Architecture notes

- Manifest V3 using `activeTab`, `scripting`, and extension-local `storage`; there is no persistent access to browsing data.
- A page overlay collects the drag rectangle, while `captureVisibleTab()` captures the visible tab locally.
- The screenshot is handed to an on-page extension panel through temporary extension session storage, cropped there, and deleted as soon as it is read.
- Packaged WebAssembly enabled by the narrow extension-page CSP directive `'wasm-unsafe-eval'`.
- Direct packaged worker URL (`workerBlobURL: false`) avoids a blob-worker CSP dependency.
- The build removes two unreachable legacy `Function(...)` global-object fallbacks from the upstream browser bundles; the package check rejects dynamic code construction.
- LSTM-only core variants include baseline, SIMD, and relaxed-SIMD builds so Tesseract.js can select the best supported local runtime.
- Mixed area recognition loads both `ben` and `eng`, retains the bilingual results, and adds two Bengali-only passes to recover small Bengali labels and alphabet tiles. The results are merged spatially into one output. Mixed scans take longer; all processing remains local. Image uploads use the bilingual model directly.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for bundled software and data.
