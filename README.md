# Squeeze (web app)

Compresses images, DOCX/XLSX/PPTX and PDFs entirely in your browser. Nothing is uploaded.

## Deploy on GitHub Pages
1. Put every file in one public repo: `index.html app.js zip.js gs-worker.js sw.js manifest.webmanifest icon-192.png icon-512.png`.
2. Settings > Pages > deploy from the `main` branch, root folder. Open the https link and use Install / Add to Home Screen.

## Make PDF work offline (vendor Ghostscript)
Without this, PDFs load the engine from jsDelivr, so the first PDF needs internet.
1. `npm pack @jspawn/ghostscript-wasm@0.0.2` and extract the tarball.
2. Copy `gs.mjs` and `gs.wasm` from the extracted `package` folder into a `vendor/` folder in your repo. The wasm is about 18 MB.
3. Push, then open the app once online so the service worker caches it.

## How each type is handled
- Images: resized and re-encoded (JPEG or WebP). Transparency is flattened onto white for JPEG.
- DOCX/XLSX/PPTX: only the images in `media/` are re-encoded, in their own format and name. Text and formulas are untouched.
- PDF: Ghostscript pdfwrite with the screen/ebook/printer presets. Text and vectors are kept.
- If the result isn't smaller, the original is kept.

## Limits
- Ghostscript is AGPL-licensed: keep your repo public with its source.
- Large PDFs can run out of memory on phones (esp. iOS Safari).
- Signed PDFs lose their signature. Password-protected files must be unlocked first.
- Needs a modern browser (Compression Streams: Chrome 103+, Safari 16.4+, Firefox 113+).
