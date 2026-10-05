// Module worker: runs Ghostscript (WebAssembly) off the UI thread.
// Looks for ./vendor/gs.mjs + gs.wasm first (offline), then falls back to the jsDelivr CDN.
const CDN = 'https://cdn.jsdelivr.net/npm/@jspawn/ghostscript-wasm@0.0.2/';

async function load() {
  for (const base of ['./vendor/', CDN]) {
    try {
      const mod = await import(base + 'gs.mjs');
      return await mod.default({ locateFile: f => base + f });
    } catch { /* try the next source */ }
  }
  throw new Error('Couldn’t load the PDF engine. Add gs.mjs and gs.wasm to the vendor folder, or go online once.');
}

self.onmessage = async ({ data }) => {
  try {
    const gs = await load();
    gs.FS.writeFile('in.pdf', data.bytes);
    try {
      gs.callMain(['-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.4', '-dPDFSETTINGS=/' + data.level, '-dNOPAUSE', '-dQUIET', '-dBATCH', '-sOutputFile=out.pdf', 'in.pdf']);
    } catch { /* Emscripten may throw on exit; the output file decides success */ }
    let out;
    try { out = gs.FS.readFile('out.pdf'); } catch { out = null; }
    if (!out || !out.length) throw new Error('Ghostscript couldn’t process this PDF. It may be password-protected or damaged.');
    self.postMessage({ bytes: out });
  } catch (e) {
    self.postMessage({ error: (e && e.message) || String(e) });
  }
};
