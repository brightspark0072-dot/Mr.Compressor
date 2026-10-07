# Squeeze: offline PDF & file tools

Everything runs in your browser. Files are never uploaded. After the first visit it works offline (installable as an app).

## Tools
| Tool | What it does | Built with |
|---|---|---|
| Merge PDF | Combine PDFs, drag to reorder | pdf-lib |
| Split PDF | Ranges, extract pages, or every page (ZIP) | pdf-lib |
| Organize pages | Thumbnails; rotate, reorder, delete | pdf.js + pdf-lib |
| Compress | Images, PDFs, DOCX/XLSX/PPTX (`compress.html`) | Ghostscript-WASM, canvas |
| Images to PDF | A4 / Letter / fit-to-image, quality choice | pdf-lib |
| PDF to images | PNG or JPG, 72-300 dpi, page ranges, ZIP | pdf.js |
| Page numbers | 6 positions, formats, start number | pdf-lib |
| Watermark | Text stamp, size, opacity, angle, colour | pdf-lib |

## Layout
- `index.html` + `hub.js`: home grid, hash router (`#merge`, `#split`...), shared UI (drop zone, reorderable list, results, ZIP).
- `tools.js`: one `Hub.register({id, name, desc, icon, mount})` per tool. **To add a tool, add one block here.**
- `compress.html` + `app.js` + `gs-worker.js` + `zip.js`: the original compressor.
- `vendor/`: self-hosted pdf-lib and pdf.js (legacy build, works on older browsers and iOS). `sw.js` caches them for offline use.

## Deploy on GitHub Pages
Settings > Pages > deploy from the `main` branch, root folder. Open the https link once online, then use Install / Add to Home Screen.

## Offline PDF compression (vendor Ghostscript)
Without this, the Compress page loads Ghostscript from jsDelivr, so the first PDF compression needs internet.
1. `npm pack @jspawn/ghostscript-wasm@0.0.2` and extract it.
2. Copy `gs.mjs` and `gs.wasm` from `package/` into `vendor/` (the wasm is about 18 MB).
3. Push, then open the app once online.

## Limits
- Ghostscript is AGPL-licensed: keep this repo public with its source.
- Page numbers and watermarks use a built-in Latin font, so non-Latin text (Odia, Hindi...) isn't supported yet.
- Password-protected PDFs must be unlocked first. Signed PDFs lose their signature when changed.
- Big PDFs can run out of memory on phones (esp. iOS Safari).
- Not yet built: OCR, protect/unlock, PDF to Word/Excel.
