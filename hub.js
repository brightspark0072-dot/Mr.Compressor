/* Squeeze hub: tiny router + shared UI pieces for every tool. No framework, no build step. */
(() => {
'use strict';
const Hub = window.Hub = { tools: [] };

// ---------- DOM helper ----------
function h(tag, a, ...kids) {
  const e = document.createElement(tag);
  for (const k in (a || {})) {
    const v = a[k];
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k in e) e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : String(c));
  return e;
}
Hub.h = h;
Hub.fmt = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB' : (n / 1048576).toFixed(2) + ' MB';
Hub.base = name => name.replace(/\.[^.]*$/, '');
Hub.isPdf = f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
Hub.isImg = f => /^image\/(jpeg|png|webp|bmp|avif|heic|heif|gif)$/.test(f.type) || /\.(jpe?g|png|webp|bmp|avif|heic|heif|gif)$/i.test(f.name);
Hub.readBytes = async f => new Uint8Array(await f.arrayBuffer());
Hub.tick = () => new Promise(r => setTimeout(r));
Hub.icon = d => { const s = document.createElement('span'); s.className = 'ic'; s.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + d + '"/></svg>'; return s; };

// ---------- Libraries (self-hosted in /vendor so they work offline) ----------
let libP = null, jsP = null;
Hub.lib = () => libP || (libP = new Promise((ok, no) => {
  if (window.PDFLib) return ok(window.PDFLib);
  const s = h('script', { src: 'vendor/pdf-lib.min.js' });
  s.onload = () => ok(window.PDFLib);
  s.onerror = () => { libP = null; no(new Error('Couldn’t load the PDF library. Open the app once online so it can be saved for offline use.')); };
  document.head.append(s);
}));
Hub.pdfjs = () => jsP || (jsP = import('./vendor/pdf.min.mjs').then(m => {
  m.GlobalWorkerOptions.workerSrc = new URL('vendor/pdf.worker.min.mjs', location.href).href;
  return m;
}).catch(() => { jsP = null; throw new Error('Couldn’t load the PDF viewer library. Open the app once online so it can be saved for offline use.'); }));

Hub.openPdf = async bytes => {
  const { PDFDocument } = await Hub.lib();
  try { return await PDFDocument.load(bytes, { updateMetadata: false }); }
  catch (e) {
    if (/encrypt/i.test((e && e.message) || '')) throw new Error('This PDF is password-protected.');
    throw new Error('Couldn’t read this PDF. It may be damaged.');
  }
};
// Render page n (1-based) of a pdf.js document to a canvas, capped to maxPx pixels (phones limit canvas size).
Hub.renderPage = async (doc, n, scale, maxPx = 16e6) => {
  const page = await doc.getPage(n);
  let vp = page.getViewport({ scale });
  if (vp.width * vp.height > maxPx) vp = page.getViewport({ scale: scale * Math.sqrt(maxPx / (vp.width * vp.height)) });
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(vp.width)); c.height = Math.max(1, Math.ceil(vp.height));
  await page.render({ canvas: c, canvasContext: c.getContext('2d'), viewport: vp, background: 'rgb(255,255,255)' }).promise;
  page.cleanup();
  return c;
};
// "1-3, 5, 8-" -> [{label:'1-3', idx:[0,1,2]}, ...] (0-based indexes). Throws friendly errors.
Hub.parseRanges = (s, n) => {
  const parts = s.split(',').map(x => x.trim()).filter(Boolean);
  if (!parts.length) throw new Error('Enter the pages you want, like 1-3, 5, 8-');
  return parts.map(p => {
    let a, b, m;
    if ((m = /^(\d+)$/.exec(p))) a = b = +m[1];
    else if ((m = /^(\d*)\s*-\s*(\d*)$/.exec(p)) && (m[1] || m[2])) { a = m[1] ? +m[1] : 1; b = m[2] ? +m[2] : n; }
    else throw new Error('Can’t read “' + p + '”. Use numbers like 1-3, 5, 8-');
    if (a < 1 || a > n || b < 1 || b > n) throw new Error('Page ' + (a < 1 || a > n ? a : b) + ' is outside this PDF (it has ' + n + ' page' + (n > 1 ? 's' : '') + ').');
    if (a > b) throw new Error('“' + p + '” goes backwards.');
    const idx = []; for (let i = a; i <= b; i++) idx.push(i - 1);
    return { label: a === b ? String(a) : a + '-' + b, idx };
  });
};
Hub.zip = async files => {
  const enc = new TextEncoder(), es = [];
  for (const f of files) {
    const bytes = new Uint8Array(await f.blob.arrayBuffer()), nameBytes = enc.encode(f.name);
    es.push(await Zip.replace({ nameBytes, name: f.name, flags: 0x800, method: 0, time: 0, date: 0x21, crc: 0, csize: 0, usize: 0, made: 20, ver: 20, xattr: 0, raw: bytes }, bytes));
  }
  return new Blob([Zip.write(es)], { type: 'application/zip' });
};

// ---------- Shared components ----------
Hub.note = () => h('p', { class: 'note', role: 'status' });
// Runs fn(setStatus) with the button disabled; shows any error in `note`.
Hub.run = async (btn, note, fn) => {
  const old = btn.textContent;
  btn.disabled = true; btn.textContent = 'Working…'; note.textContent = ''; note.className = 'note';
  try { await fn(s => { btn.textContent = s; }); }
  catch (e) { console.error(e); note.textContent = (e && e.message) || 'Something went wrong.'; }
  finally { btn.disabled = false; btn.textContent = old; }
};

Hub.drop = ({ accept, multiple = true, text, hint, ok = () => true, onFiles }) => {
  const input = h('input', { type: 'file', accept, multiple });
  const el = h('label', { class: 'glass drop' }, input, h('b', { text: text || 'Drop files here' }), h('span', { text: hint || 'or tap to choose' }));
  const take = fs => {
    fs = [...fs]; if (!multiple) fs = fs.slice(0, 1);
    const good = fs.filter(ok);
    if (fs.length) onFiles(good, fs.length - good.length);
  };
  input.addEventListener('change', () => { const f = [...input.files]; input.value = ''; take(f); });
  ['dragenter', 'dragover'].forEach(t => el.addEventListener(t, e => { e.preventDefault(); el.classList.add('on'); }));
  ['dragleave', 'drop'].forEach(t => el.addEventListener(t, e => { e.preventDefault(); el.classList.remove('on'); if (t === 'drop' && e.dataTransfer) take(e.dataTransfer.files); }));
  return el;
};

// One PDF at a time: drop zone that turns into a "file loaded" row. onLoad({file, bytes, doc, pages}).
Hub.pdfSlot = ({ onLoad, onReset }) => {
  const note = Hub.note();
  const nm = h('b', { class: 'nm' }), mt = h('span', { class: 'mt' });
  const change = h('button', { class: 'btn', type: 'button', text: 'Change', onclick: () => reset() });
  const info = h('div', { class: 'glass row slot', hidden: true }, h('div', { class: 'tx' }, nm, mt), change);
  const drop = Hub.drop({
    accept: 'application/pdf,.pdf', multiple: false, text: 'Drop a PDF here', hint: 'or tap to choose', ok: Hub.isPdf,
    onFiles: async (good, bad) => {
      if (!good.length) { note.textContent = 'That isn’t a PDF.'; return; }
      note.textContent = '';
      try {
        const f = good[0];
        if (!f.size) throw new Error('This file is empty.');
        const bytes = await Hub.readBytes(f), doc = await Hub.openPdf(bytes), pages = doc.getPageCount();
        nm.textContent = f.name; mt.textContent = pages + ' page' + (pages > 1 ? 's' : '') + ' · ' + Hub.fmt(f.size);
        drop.hidden = true; info.hidden = false;
        await onLoad({ file: f, bytes, doc, pages });
      } catch (e) { note.textContent = (e && e.message) || 'Couldn’t open this PDF.'; }
    }
  });
  function reset() { info.hidden = true; drop.hidden = false; note.textContent = ''; onReset && onReset(); }
  return { el: h('div', { class: 'tool' }, drop, info, note), reset };
};

// Reorderable file list (drag, or up/down/remove buttons). `items` is mutated in place.
Hub.list = (items, { name, meta, thumb, onChange, onRemove }) => {
  const ul = h('ul', { class: 'files' });
  const changed = () => { render(); onChange && onChange(); };
  const move = (i, j) => { if (j < 0 || j >= items.length || i === j) return; const [x] = items.splice(i, 1); items.splice(j, 0, x); changed(); };
  function render() {
    ul.textContent = '';
    items.forEach((it, i) => {
      const th = h('div', { class: 'th' }), t = thumb && thumb(it);
      if (t) th.style.backgroundImage = 'url("' + t + '")'; else th.textContent = 'PDF';
      const li = h('li', { class: 'glass row file', draggable: true },
        th,
        h('div', { class: 'tx' }, h('b', { class: 'nm', text: name(it) }), h('span', { class: 'mt', text: meta ? meta(it) : '' })),
        h('div', { class: 'acts' },
          h('button', { class: 'ib', type: 'button', text: '↑', title: 'Move up', 'aria-label': 'Move up', disabled: i === 0, onclick: () => move(i, i - 1) }),
          h('button', { class: 'ib', type: 'button', text: '↓', title: 'Move down', 'aria-label': 'Move down', disabled: i === items.length - 1, onclick: () => move(i, i + 1) }),
          h('button', { class: 'ib', type: 'button', text: '✕', title: 'Remove', 'aria-label': 'Remove', onclick: () => { const [x] = items.splice(i, 1); onRemove && onRemove(x); changed(); } })));
      li.addEventListener('dragstart', e => { e.dataTransfer.setData('text/x-squeeze-row', String(i)); e.dataTransfer.effectAllowed = 'move'; });
      li.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('text/x-squeeze-row')) e.preventDefault(); });
      li.addEventListener('drop', e => { const f = e.dataTransfer.getData('text/x-squeeze-row'); if (f === '') return; e.preventDefault(); e.stopPropagation(); move(+f, i); });
      ul.append(li);
    });
  }
  render();
  return { el: ul, refresh: render };
};

// Result rows with Save buttons, plus an optional "Save all (ZIP)".
Hub.results = () => {
  const box = h('div', { class: 'res' }), ul = h('ul'), bar = h('div', { class: 'bar' });
  let urls = [], files = [];
  box.append(ul, bar);
  const api = {
    el: box,
    clear() { urls.forEach(u => URL.revokeObjectURL(u)); urls = []; files = []; ul.textContent = ''; bar.textContent = ''; },
    add(blob, name, note) {
      const u = URL.createObjectURL(blob); urls.push(u); files.push({ name, blob });
      const th = h('div', { class: 'th' });
      if (blob.type.startsWith('image/')) th.style.backgroundImage = 'url("' + u + '")'; else th.textContent = (name.split('.').pop() || '').slice(0, 4).toUpperCase();
      ul.append(h('li', { class: 'glass row' }, th,
        h('div', { class: 'tx' }, h('b', { class: 'nm', text: name }), h('span', { class: 'mt', text: note || Hub.fmt(blob.size) })),
        h('a', { class: 'btn', href: u, download: name, text: 'Save' })));
    },
    zipBar(zipName) {
      bar.textContent = '';
      if (files.length < 2) return;
      const b = h('button', { class: 'btn pri', type: 'button', text: 'Save all as ZIP (' + files.length + ' files)' });
      b.addEventListener('click', () => Hub.run(b, Hub.note(), async () => {
        const z = await Hub.zip(files), u = URL.createObjectURL(z);
        const a = h('a', { href: u, download: zipName }); document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(u), 10000);
      }));
      bar.append(b);
    },
    count: () => files.length
  };
  return api;
};

// ---------- Registry + router ----------
Hub.register = t => Hub.tools.push(t);
const view = document.getElementById('view'), title = document.getElementById('title'), sub = document.getElementById('sub'), main = document.querySelector('main');
const HOME_SUB = sub.textContent;
let cleanup = null;
function route() {
  if (cleanup) { try { cleanup(); } catch {} cleanup = null; }
  view.textContent = '';
  const tool = Hub.tools.find(t => t.id === location.hash.slice(1));
  scrollTo(0, 0);
  if (!tool) {
    title.textContent = 'Squeeze'; sub.textContent = HOME_SUB; document.title = 'Squeeze - offline PDF & file tools'; main.classList.add('wide');
    view.append(h('div', { class: 'grid' }, Hub.tools.map(t => h('a', { class: 'glass tile', href: t.href || '#' + t.id }, Hub.icon(t.icon), h('b', { text: t.name }), h('span', { class: 'd', text: t.desc })))));
    return;
  }
  main.classList.remove('wide');
  title.textContent = tool.name; sub.textContent = tool.desc; document.title = tool.name + ' - Squeeze';
  const root = h('div', { class: 'tool' }, h('a', { class: 'back', href: '#' , text: '← All tools' }));
  view.append(root);
  cleanup = tool.mount(root) || null;
}
Hub.start = () => { addEventListener('hashchange', route); route(); };

// ---------- Install + offline ----------
const ins = document.getElementById('ins');
let dip = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); dip = e; ins.hidden = false; });
ins.addEventListener('click', async () => { if (!dip) return; dip.prompt(); try { await dip.userChoice; } catch {} dip = null; ins.hidden = true; });
addEventListener('appinstalled', () => { ins.hidden = true; });
const ua = navigator.userAgent;
if ((/iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) && !navigator.standalone) document.getElementById('ios').hidden = false;
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
// A file dropped outside a drop zone should not make the browser open it.
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => e.preventDefault());
})();
