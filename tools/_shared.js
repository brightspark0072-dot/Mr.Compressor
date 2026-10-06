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

// ===== LOAD PDF.JS =====
let _pdfjs = null;
async function getPdfJs() {
  if (_pdfjs) return _pdfjs;
  if (window.pdfjsLib) { _pdfjs = window.pdfjsLib; return _pdfjs; }
  await new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    s.onload = ok; s.onerror = fail;
    document.head.appendChild(s);
  });
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  _pdfjs = window.pdfjsLib;
  return _pdfjs;
}

// ===== LOAD PDF-LIB =====
let _pdfLib = null;
async function getPdfLib() {
  if (_pdfLib) return _pdfLib;
  if (window.PDFLib) { _pdfLib = window.PDFLib; return _pdfLib; }
  await new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js';
    s.onload = ok; s.onerror = fail;
    document.head.appendChild(s);
  });
  _pdfLib = window.PDFLib;
  return _pdfLib;
}

// ===== LOAD JSZip =====
let _jszip = null;
async function getJsZip() {
  if (_jszip) return _jszip;
  if (window.JSZip) { _jszip = window.JSZip; return _jszip; }
  await new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
    s.onload = ok; s.onerror = fail;
    document.head.appendChild(s);
  });
  _jszip = window.JSZip;
  return _jszip;
}

// ===== RENDER PDF PAGE TO CANVAS =====
async function renderPage(pdfDoc, pageNum, scale = 1.5) {
  const page = await pdfDoc.getPage(pageNum);
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = vp.width; canvas.height = vp.height;
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return canvas;
}

// ===== STEM (filename without extension) =====
function stem(filename) {
  return filename.replace(/\.[^.]+$/, '');
}
