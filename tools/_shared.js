// ===== SHARED UTILITIES FOR ALL TOOL PAGES =====
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

// ===== TOAST NOTIFICATIONS =====
function toast(msg, type = 'info', duration = 3500) {
  let wrap = document.getElementById('toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'toast-wrap';
    wrap.className = 'toast-wrap';
    document.body.appendChild(wrap);
  }
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

// ===== FORMAT BYTES =====
function fmt(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
  return (n / 1048576).toFixed(2) + ' MB';
}

// ===== FORMAT SAVINGS =====
function savings(orig, compressed) {
  const pct = Math.max(0, Math.round(100 - 100 * compressed / orig));
  return fmt(orig) + ' \u2192 ' + fmt(compressed) + ' (\u2212' + pct + '%)';
}

// ===== DRAG AND DROP =====
function setupDrop(zone, onFiles, multiple = false, accept = null) {
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('dragover');
    let files = [...e.dataTransfer.files];
    if (accept) files = files.filter(f => {
      if (accept.includes('/')) return f.type.startsWith(accept.replace('*',''));
      return accept.split(',').some(ext => f.name.toLowerCase().endsWith(ext.trim()));
    });
    if (!files.length) { toast('No compatible files dropped', 'error'); return; }
    if (!multiple) files = [files[0]];
    onFiles(files);
  });
}

// ===== DOWNLOAD BLOB =====
function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ===== SELF-HOSTED LIBRARIES (in /vendor, cached by the service worker, so they work offline) =====
const VENDOR = new URL('../vendor/', document.currentScript.src).href;
function loadScript(src, ready) {
  return new Promise((ok, fail) => {
    if (ready()) return ok();
    const s = document.createElement('script');
    s.src = src; s.onload = ok;
    s.onerror = () => fail(new Error('Could not load a required library. Open this app once while online so it can be saved for offline use.'));
    document.head.appendChild(s);
  });
}

let _pdfjs = null;
async function getPdfJs() {
  if (_pdfjs) return _pdfjs;
  try {
    const m = await import(VENDOR + 'pdf.min.mjs');
    m.GlobalWorkerOptions.workerSrc = VENDOR + 'pdf.worker.min.mjs';
    _pdfjs = m;
  } catch (e) { throw new Error('Could not load the PDF viewer library. Open this app once while online so it can be saved for offline use.'); }
  return _pdfjs;
}

let _pdfLib = null;
async function getPdfLib() {
  if (_pdfLib) return _pdfLib;
  await loadScript(VENDOR + 'pdf-lib.min.js', () => window.PDFLib);
  return (_pdfLib = window.PDFLib);
}

let _jszip = null;
async function getJsZip() {
  if (_jszip) return _jszip;
  await loadScript(VENDOR + 'jszip.min.js', () => window.JSZip);
  return (_jszip = window.JSZip);
}

// ===== RENDER PDF PAGE TO CANVAS =====
async function renderPage(pdfDoc, pageNum, scale = 1.5) {
  const page = await pdfDoc.getPage(pageNum);
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = vp.width; canvas.height = vp.height;
  const ctx = canvas.getContext('2d');
  await page.render({ canvas, canvasContext: ctx, viewport: vp, background: 'rgb(255,255,255)' }).promise;
  return canvas;
}

// ===== STEM (filename without extension) =====
function stem(filename) {
  return filename.replace(/\.[^.]+$/, '');
}
