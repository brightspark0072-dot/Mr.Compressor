(() => {
'use strict';
const $ = s => document.querySelector(s);
const list = $('#list'), sumEl = $('#sum'), stEl = $('#st'), note = $('#note'), fileIn = $('#file'), drop = $('#drop');
const q = $('#q'), qv = $('#qv'), m = $('#m'), pSel = $('#p'), ins = $('#ins');
const items = [];
let running = false, timer = 0, dip = null;
const fmt = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB' : (n / 1048576).toFixed(2) + ' MB';
const fmtKind = () => $('input[name=f]:checked').value;
const kindOf = f =>
  /^image\/(jpeg|png|webp|bmp|avif|heic|heif)$/.test(f.type) || /\.(jpe?g|png|webp|bmp|avif|heic|heif)$/i.test(f.name) ? 'img'
  : /\.pdf$/i.test(f.name) || f.type === 'application/pdf' ? 'pdf'
  : /\.(docx|xlsx|pptx)$/i.test(f.name) ? 'office' : null;
const canWebp = (() => { try { const c = document.createElement('canvas'); c.width = c.height = 1; return c.toDataURL('image/webp').startsWith('data:image/webp'); } catch { return false; } })();
if (!canWebp) { const r = $('input[value="image/webp"]'); r.disabled = true; r.parentNode.title = 'This browser cannot save WebP'; }

// ---------- UI ----------
const mk = () => { const li = document.createElement('li'); li.className = 'glass row'; li.innerHTML = '<div class="th"></div><div class="tx"><b class="nm"></b><span class="mt"></span></div><a class="btn" hidden>Save</a>'; return li; };

function paint(it) {
  const e = it.el, a = e.querySelector('a'), mt = e.querySelector('.mt'), th = e.querySelector('.th');
  e.dataset.s = it.st;
  e.querySelector('.nm').textContent = it.file.name;
  a.hidden = it.st !== 'done';
  if (it.st === 'done') {
    const pct = Math.max(0, Math.round(100 - 100 * it.blob.size / it.file.size));
    mt.textContent = it.kept ? fmt(it.file.size) + ', already small. Original kept.' : fmt(it.file.size) + ' → ' + fmt(it.blob.size) + ' (−' + pct + '%)';
    a.href = it.url; a.download = it.out;
  } else mt.textContent = it.st === 'err' ? it.msg : 'Compressing…';
  if (it.kind === 'img') { if (it.url) th.style.backgroundImage = 'url("' + it.url + '")'; }
  else th.textContent = it.file.name.split('.').pop().slice(0, 4).toUpperCase();
}

function sum() {
  const left = items.filter(i => i.stale).length, done = items.filter(i => i.st === 'done');
  let a = 0, b = 0; for (const i of done) { a += i.file.size; b += i.blob.size; }
  stEl.textContent = left ? 'Compressing ' + (items.length - left) + ' of ' + items.length + '…'
    : done.length ? done.length + (done.length > 1 ? ' files: ' : ' file: ') + fmt(a) + ' → ' + fmt(b) + ', saved ' + Math.max(0, Math.round(100 - 100 * b / a)) + '%'
    : 'Nothing compressed';
}

// ---------- Images ----------
async function decode(blob) {
  try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); }
  catch { return await new Promise((ok, no) => { const u = URL.createObjectURL(blob), i = new Image(); i.onload = () => { URL.revokeObjectURL(u); ok(i); }; i.onerror = () => { URL.revokeObjectURL(u); no(new Error('Can’t read this image. Try JPG, PNG or WebP.')); }; i.src = u; }); }
}
async function encode(blob, type, quality, max) {
  const bmp = await decode(blob), free = () => { if (bmp.close) bmp.close(); };
  const w0 = bmp.naturalWidth || bmp.width, h0 = bmp.naturalHeight || bmp.height;
  if (!w0 || !h0) { free(); throw new Error('Can’t read this image. Try JPG, PNG or WebP.'); }
  const k = Math.min(1, max / Math.max(w0, h0)), w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  if (!x) { free(); throw new Error('This browser can’t process images. Try another browser.'); }
  if (type === 'image/jpeg') { x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); }
  x.imageSmoothingQuality = 'high'; x.drawImage(bmp, 0, 0, w, h); free();
  const out = await new Promise(r => c.toBlob(r, type, quality));
  c.width = c.height = 0;
  if (!out || out.type !== type) throw new Error('This browser can’t save that format. Choose JPEG.');
  return { blob: out, k };
}
async function doImage(it) {
  const t = fmtKind(), r = await encode(it.file, t, q.value / 100, +m.value);
  return { blob: r.blob, ext: t === 'image/webp' ? 'webp' : 'jpg' };
}

// ---------- Office (DOCX/XLSX/PPTX): re-encode media images in place, same names and formats ----------
async function doOffice(it, alive) {
  const es = Zip.read(new Uint8Array(await it.file.arrayBuffer()));
  const quality = q.value / 100, max = +m.value;
  let changed = false;
  for (let i = 0; i < es.length; i++) {
    if (!alive()) return null;
    const mm = /(^|\/)media\/[^/]+\.(jpe?g|png)$/i.exec(es[i].name);
    if (!mm) continue;
    const type = /png$/i.test(mm[2]) ? 'image/png' : 'image/jpeg';
    try {
      const raw = await Zip.data(es[i]);
      const r = await encode(new Blob([raw], { type }), type, quality, max);
      if (r.blob.size < raw.length) { es[i] = await Zip.replace(es[i], new Uint8Array(await r.blob.arrayBuffer())); changed = true; }
    } catch { /* leave this one image as it is */ }
  }
  if (!changed) return null;
  return { blob: new Blob([Zip.write(es)], { type: it.file.type || 'application/octet-stream' }), ext: it.file.name.split('.').pop().toLowerCase() };
}

// ---------- PDF: Ghostscript-WASM in a worker (terminated after each job to free memory) ----------
function gsRun(it, bytes, level) {
  return new Promise((ok, no) => {
    let w;
    try { w = new Worker('gs-worker.js', { type: 'module' }); }
    catch { return no(new Error('PDF compression needs the hosted (https) version of this app.')); }
    const end = () => { w.terminate(); it.kill = null; };
    it.kill = () => { end(); no(new Error('cancelled')); };
    w.onmessage = e => { end(); e.data.error ? no(new Error(e.data.error)) : ok(e.data.bytes); };
    w.onerror = () => { end(); no(new Error('The PDF engine failed to load. Use the hosted https version and check the vendor folder.')); };
    w.postMessage({ bytes, level }, [bytes.buffer]);
  });
}
async function doPdf(it) {
  const out = await gsRun(it, new Uint8Array(await it.file.arrayBuffer()), pSel.value);
  return { blob: new Blob([out], { type: 'application/pdf' }), ext: 'pdf' };
}

// ---------- Queue ----------
async function work(it, v) {
  if (!it.file.size) throw new Error('This file is empty.');
  const alive = () => it.v === v;
  const r = it.kind === 'img' ? await doImage(it) : it.kind === 'pdf' ? await doPdf(it) : await doOffice(it, alive);
  if (!alive()) return;
  const keep = !r || r.blob.size >= it.file.size, res = keep ? it.file : r.blob, u = URL.createObjectURL(res);
  if (it.url) URL.revokeObjectURL(it.url);
  Object.assign(it, { blob: res, url: u, kept: keep, st: 'done', stale: false, out: keep ? it.file.name : it.file.name.replace(/\.[^.]*$/, '') + '-min.' + r.ext });
  paint(it);
}

// One loop works through stale items. A setting change bumps an item's version,
// which abandons its in-flight job; the loop then picks it up again with new settings.
async function run() {
  if (running) return;
  running = true;
  try {
    let it;
    while ((it = items.find(i => i.stale))) {
      const v = it.v;
      it.st = 'busy'; paint(it); sum();
      try { await work(it, v); }
      catch (e) { if (it.v === v) { it.st = 'err'; it.msg = (e && e.message) || 'Could not compress this file.'; it.stale = false; paint(it); } }
      if (it.v === v && it.stale) it.stale = false;
    }
  } finally { running = false; }
  sum();
}

function add(files) {
  let skip = 0, added = 0;
  for (const f of files) {
    const kind = kindOf(f);
    if (!kind) { skip++; continue; }
    const it = { file: f, kind, v: 0, kill: null, stale: true, st: 'wait', msg: '', url: null, blob: null, kept: false, out: '', el: mk() };
    items.push(it); list.appendChild(it.el); paint(it); added++;
  }
  note.textContent = skip ? 'Skipped ' + skip + (skip > 1 ? ' files' : ' file') + ' that aren’t images, PDF, DOCX, XLSX or PPTX.' : '';
  if (added) { sumEl.hidden = false; run(); }
}

function restale(pred) {
  const hit = items.filter(pred);
  for (const i of hit) { i.v++; if (i.kill) i.kill(); i.stale = true; }
  if (hit.length) run();
}
const notPdf = i => i.kind !== 'pdf';
q.addEventListener('input', () => { qv.textContent = q.value; clearTimeout(timer); timer = setTimeout(() => restale(notPdf), 300); });
m.addEventListener('change', () => restale(notPdf));
document.querySelectorAll('input[name=f]').forEach(r => r.addEventListener('change', () => restale(i => i.kind === 'img')));
pSel.addEventListener('change', () => restale(i => i.kind === 'pdf'));

$('#clr').addEventListener('click', () => {
  clearTimeout(timer);
  for (const i of items) { i.v++; if (i.kill) i.kill(); if (i.url) URL.revokeObjectURL(i.url); }
  items.length = 0; list.textContent = ''; sumEl.hidden = true; note.textContent = '';
});

// ---------- Input, install, offline ----------
fileIn.addEventListener('change', () => { const f = [...fileIn.files]; fileIn.value = ''; add(f); });
['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('on'); }));
['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('on'); if (t === 'drop' && e.dataTransfer) add([...e.dataTransfer.files]); }));
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => e.preventDefault());
addEventListener('paste', e => { const f = e.clipboardData ? [...e.clipboardData.files] : []; if (f.length) add(f); });
addEventListener('beforeinstallprompt', e => { e.preventDefault(); dip = e; ins.hidden = false; });
ins.addEventListener('click', async () => { if (!dip) return; dip.prompt(); try { await dip.userChoice; } catch {} dip = null; ins.hidden = true; });
addEventListener('appinstalled', () => { ins.hidden = true; });
const ua = navigator.userAgent;
if ((/iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) && !navigator.standalone) $('#ios').hidden = false;
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
})();
