/* Squeeze tools. Each tool = { id, name, desc, icon (SVG path), mount(root) -> optional cleanup }. */
(() => {
'use strict';
const { h, fmt, base } = Hub;
const PDF = 'application/pdf';
const pdfBlob = bytes => new Blob([bytes], { type: PDF });
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
const field = (label, input) => h('div', { class: 'f' }, h('label', null, label, input));
const opts = pairs => pairs.map(([v, t, sel]) => h('option', { value: v, text: t, selected: !!sel }));
const select = (pairs, onchange) => h('select', { onchange }, opts(pairs));

// ======================================================================
// Merge
// ======================================================================
Hub.register({
  id: 'merge', name: 'Merge PDF', desc: 'Combine several PDFs into one. Drag to reorder.',
  icon: 'M6 3v6a4 4 0 0 0 4 4h0M18 3v6a4 4 0 0 1-4 4h0M12 13v8M9 18l3 3 3-3',
  mount(root) {
    const items = [], note = Hub.note(), res = Hub.results();
    const go = h('button', { class: 'btn pri', type: 'button', text: 'Merge PDFs', disabled: true });
    const sync = () => { go.disabled = items.length < 2; };
    const list = Hub.list(items, { name: it => it.file.name, meta: it => plural(it.pages, 'page') + ' · ' + fmt(it.file.size), onChange: sync });
    const drop = Hub.drop({
      accept: 'application/pdf,.pdf', text: 'Drop PDFs here', hint: 'or tap to choose. Add two or more.', ok: Hub.isPdf,
      onFiles: async (good, bad) => {
        note.textContent = bad ? 'Skipped ' + plural(bad, 'file') + ' that aren’t PDFs.' : '';
        for (const f of good) {
          try {
            const bytes = await Hub.readBytes(f), doc = await Hub.openPdf(bytes);
            items.push({ file: f, bytes, pages: doc.getPageCount() });
          } catch (e) { note.textContent = f.name + ': ' + e.message; }
        }
        list.refresh(); sync();
      }
    });
    go.addEventListener('click', () => Hub.run(go, note, async set => {
      res.clear();
      const { PDFDocument } = await Hub.lib(), out = await PDFDocument.create();
      let i = 0;
      for (const it of items) {
        set('Merging ' + (++i) + ' of ' + items.length + '…');
        const src = await Hub.openPdf(it.bytes);
        for (const p of await out.copyPages(src, src.getPageIndices())) out.addPage(p);
        await Hub.tick();
      }
      const bytes = await out.save();
      res.add(pdfBlob(bytes), 'merged.pdf', plural(out.getPageCount(), 'page') + ' · ' + fmt(bytes.length));
    }));
    root.append(drop, list.el, note, h('div', { class: 'bar' }, go), res.el);
    return () => res.clear();
  }
});

// ======================================================================
// Split
// ======================================================================
Hub.register({
  id: 'split', name: 'Split PDF', desc: 'Pull out pages or cut a PDF into parts.',
  icon: 'M12 3v6M12 9l-6 12M12 9l6 12',
  mount(root) {
    const res = Hub.results(), note = Hub.note();
    let cur = null;
    const mode = select([['ranges', 'Each range becomes its own PDF'], ['extract', 'Extract these pages into one PDF'], ['each', 'Every page as a separate PDF']], () => sync());
    const range = h('input', { type: 'text', placeholder: 'e.g. 1-3, 5, 8-', autocomplete: 'off', spellcheck: false });
    const rf = field('Pages', range);
    const go = h('button', { class: 'btn pri', type: 'button', text: 'Split' });
    const panel = h('section', { class: 'glass ctl', hidden: true }, field('Mode', mode), rf, h('div', { class: 'bar' }, go));
    const sync = () => { rf.hidden = mode.value === 'each'; };
    const slot = Hub.pdfSlot({
      onLoad: s => { cur = s; panel.hidden = false; res.clear(); range.value = ''; sync(); },
      onReset: () => { cur = null; panel.hidden = true; res.clear(); note.textContent = ''; }
    });
    go.addEventListener('click', () => Hub.run(go, note, async set => {
      res.clear();
      const { PDFDocument } = await Hub.lib(), src = await Hub.openPdf(cur.bytes), n = cur.pages, nm = base(cur.file.name);
      let jobs;
      if (mode.value === 'each') { const w = String(n).length; jobs = src.getPageIndices().map(i => ({ idx: [i], name: nm + '-page-' + String(i + 1).padStart(w, '0') + '.pdf' })); }
      else {
        const parts = Hub.parseRanges(range.value, n);
        jobs = mode.value === 'ranges'
          ? parts.map(p => ({ idx: p.idx, name: nm + '-pages-' + p.label + '.pdf' }))
          : [{ idx: parts.flatMap(p => p.idx), name: nm + '-extract.pdf' }];
      }
      let k = 0;
      for (const j of jobs) {
        set('Creating ' + (++k) + ' of ' + jobs.length + '…');
        const out = await PDFDocument.create();
        for (const p of await out.copyPages(src, j.idx)) out.addPage(p);
        const bytes = await out.save();
        res.add(pdfBlob(bytes), j.name, plural(j.idx.length, 'page') + ' · ' + fmt(bytes.length));
        if (k % 5 === 0) await Hub.tick();
      }
      res.zipBar(nm + '-split.zip');
    }));
    root.append(slot.el, panel, note, res.el);
    return () => res.clear();
  }
});

// ======================================================================
// Organize (rotate / reorder / delete pages) with thumbnails
// ======================================================================
Hub.register({
  id: 'organize', name: 'Organize pages', desc: 'Rotate, reorder or delete pages.',
  icon: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  mount(root) {
    const res = Hub.results(), note = Hub.note();
    let cur = null, pages = [], jsDoc = null, jsTask = null, alive = true, token = 0;
    const S = 112;
    const grid = h('div', { class: 'pages' });
    const go = h('button', { class: 'btn pri', type: 'button', text: 'Save PDF' });
    const rotAll = h('button', { class: 'btn', type: 'button', text: 'Rotate all ⟳', onclick: () => { pages.forEach(p => p.rot = (p.rot + 90) % 360); paintAll(); } });
    const bar = h('div', { class: 'bar', hidden: true }, go, rotAll, h('span', { class: 'mt', id: 'cnt' }));

    function layout(p) {
      const c = p.canvas; if (!c) return;
      const odd = p.rot % 180 !== 0, a = (odd ? c.height / c.width : c.width / c.height);
      const vw = a >= 1 ? S : S * a, vh = a >= 1 ? S / a : S;
      c.style.width = (odd ? vh : vw) + 'px'; c.style.height = (odd ? vw : vh) + 'px';
      c.style.transform = 'rotate(' + p.rot + 'deg)';
    }
    function paintAll() { grid.textContent = ''; pages.forEach((p, i) => grid.append(card(p, i))); count(); }
    function count() { const k = pages.filter(p => !p.del).length; bar.querySelector('#cnt').textContent = plural(k, 'page') + ' kept'; go.disabled = k === 0; }
    function move(i, j) { if (j < 0 || j >= pages.length || i === j) return; const [x] = pages.splice(i, 1); pages.splice(j, 0, x); paintAll(); }
    function card(p, i) {
      const img = h('div', { class: 'pgimg' });
      if (p.canvas) { img.append(p.canvas); layout(p); } else img.textContent = '…';
      const el = h('div', { class: 'glass pg', draggable: true, 'data-del': String(p.del) }, img, h('span', { class: 'pgn', text: 'Page ' + (p.idx + 1) }),
        h('div', { class: 'acts' },
          h('button', { class: 'ib', type: 'button', text: '⟲', title: 'Rotate left', 'aria-label': 'Rotate left', onclick: () => { p.rot = (p.rot + 270) % 360; layout(p); } }),
          h('button', { class: 'ib', type: 'button', text: '⟳', title: 'Rotate right', 'aria-label': 'Rotate right', onclick: () => { p.rot = (p.rot + 90) % 360; layout(p); } }),
          h('button', { class: 'ib', type: 'button', text: p.del ? '↺' : '✕', title: p.del ? 'Restore' : 'Delete', 'aria-label': p.del ? 'Restore page' : 'Delete page', onclick: () => { p.del = !p.del; paintAll(); } })),
        h('div', { class: 'acts' },
          h('button', { class: 'ib', type: 'button', text: '←', title: 'Move earlier', 'aria-label': 'Move earlier', disabled: i === 0, onclick: () => move(i, i - 1) }),
          h('button', { class: 'ib', type: 'button', text: '→', title: 'Move later', 'aria-label': 'Move later', disabled: i === pages.length - 1, onclick: () => move(i, i + 1) })));
      el.addEventListener('dragstart', e => { e.dataTransfer.setData('text/x-squeeze-pg', String(i)); e.dataTransfer.effectAllowed = 'move'; });
      el.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('text/x-squeeze-pg')) e.preventDefault(); });
      el.addEventListener('drop', e => { const f = e.dataTransfer.getData('text/x-squeeze-pg'); if (f === '') return; e.preventDefault(); e.stopPropagation(); move(+f, i); });
      return el;
    }
    async function thumbs(t) {
      try {
        const lib = await Hub.pdfjs();
        jsTask = lib.getDocument({ data: cur.bytes.slice() }); jsDoc = await jsTask.promise;
        for (let n = 1; n <= cur.pages; n++) {
          if (!alive || t !== token) return;
          const p = pages.find(x => x.idx === n - 1);
          p.canvas = await Hub.renderPage(jsDoc, n, 0.4, 2e6);
          const slot = [...grid.children][pages.indexOf(p)];
          if (slot) { const box = slot.querySelector('.pgimg'); box.textContent = ''; box.append(p.canvas); layout(p); }
          if (n % 4 === 0) await Hub.tick();
        }
      } catch (e) { if (alive && t === token) note.textContent = 'Page previews unavailable: ' + e.message + ' You can still reorder and save.'; }
    }
    const slot = Hub.pdfSlot({
      onLoad: s => {
        cur = s; res.clear(); token++; pages = Array.from({ length: s.pages }, (_, i) => ({ idx: i, rot: 0, del: false, canvas: null }));
        bar.hidden = false; paintAll(); thumbs(token);
      },
      onReset: () => { token++; cur = null; pages = []; grid.textContent = ''; bar.hidden = true; res.clear(); note.textContent = ''; if (jsTask) { jsTask.destroy(); jsTask = jsDoc = null; } }
    });
    go.addEventListener('click', () => Hub.run(go, note, async () => {
      res.clear();
      const { PDFDocument, degrees } = await Hub.lib(), src = await Hub.openPdf(cur.bytes), out = await PDFDocument.create();
      const keep = pages.filter(p => !p.del), copied = await out.copyPages(src, keep.map(p => p.idx));
      copied.forEach((pg, i) => { pg.setRotation(degrees((pg.getRotation().angle + keep[i].rot) % 360)); out.addPage(pg); });
      const bytes = await out.save();
      res.add(pdfBlob(bytes), base(cur.file.name) + '-organized.pdf', plural(keep.length, 'page') + ' · ' + fmt(bytes.length));
    }));
    root.append(slot.el, bar, grid, note, res.el);
    return () => { alive = false; token++; res.clear(); if (jsTask) jsTask.destroy(); };
  }
});

// ======================================================================
// Compress (existing Squeeze page)
// ======================================================================
Hub.register({
  id: 'compress', href: 'compress.html', name: 'Compress', desc: 'Shrink images, PDFs and Office files.',
  icon: 'M4 4l6 6M10 5v5H5M20 20l-6-6M14 19v-5h5',
  mount() {}
});

// ======================================================================
// Images -> PDF
// ======================================================================
const PAGE = { a4: [595.28, 841.89], letter: [612, 792] };
async function decodeImage(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { try { return await createImageBitmap(file); } catch { throw new Error('Can’t read ' + file.name + '. Try JPG, PNG or WebP.'); } }
}
Hub.register({
  id: 'img2pdf', name: 'Images to PDF', desc: 'Turn photos and screenshots into one PDF.',
  icon: 'M6 3h8l4 4v14H6zM9 17l2.5-3 2 2.5 1.5-1.5 2 2',
  mount(root) {
    const items = [], note = Hub.note(), res = Hub.results();
    const go = h('button', { class: 'btn pri', type: 'button', text: 'Create PDF', disabled: true });
    const sync = () => { go.disabled = !items.length; };
    const list = Hub.list(items, { name: it => it.file.name, meta: it => fmt(it.file.size), thumb: it => it.url, onChange: sync, onRemove: it => URL.revokeObjectURL(it.url) });
    const size = select([['fit', 'Same size as the image', true], ['a4', 'A4'], ['letter', 'US Letter']]);
    const margin = select([['0', 'None'], ['24', 'Small', true], ['48', 'Large']]);
    const qual = select([['0.92', 'High', true], ['0.75', 'Medium (smaller file)'], ['0.5', 'Low (smallest)']]);
    const drop = Hub.drop({
      accept: 'image/*', text: 'Drop images here', hint: 'JPG, PNG, WebP and more. Order them below.', ok: Hub.isImg,
      onFiles: (good, bad) => {
        note.textContent = bad ? 'Skipped ' + plural(bad, 'file') + ' that aren’t images.' : '';
        for (const f of good) items.push({ file: f, url: URL.createObjectURL(f) });
        list.refresh(); sync();
      }
    });
    go.addEventListener('click', () => Hub.run(go, note, async set => {
      res.clear();
      const { PDFDocument } = await Hub.lib(), out = await PDFDocument.create(), q = +qual.value, m = +margin.value;
      let i = 0;
      for (const it of items) {
        set('Adding ' + (++i) + ' of ' + items.length + '…');
        const bmp = await decodeImage(it.file), png = /png$/i.test(it.file.type) || /\.png$/i.test(it.file.name);
        const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
        const x = c.getContext('2d');
        if (!png) { x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); }
        x.drawImage(bmp, 0, 0); if (bmp.close) bmp.close();
        const blob = await new Promise(r => c.toBlob(r, png ? 'image/png' : 'image/jpeg', q));
        if (!blob) throw new Error('Couldn’t process ' + it.file.name + '.');
        const bytes = new Uint8Array(await blob.arrayBuffer()), iw = c.width, ih = c.height; c.width = c.height = 0;
        const img = png ? await out.embedPng(bytes) : await out.embedJpg(bytes);
        if (size.value === 'fit') {
          const w = iw * 0.75, hh = ih * 0.75;
          out.addPage([w, hh]).drawImage(img, { x: 0, y: 0, width: w, height: hh });
        } else {
          let [pw, ph] = PAGE[size.value]; if (iw > ih) [pw, ph] = [ph, pw];
          const k = Math.min((pw - 2 * m) / iw, (ph - 2 * m) / ih), w = iw * k, hh = ih * k;
          out.addPage([pw, ph]).drawImage(img, { x: (pw - w) / 2, y: (ph - hh) / 2, width: w, height: hh });
        }
        await Hub.tick();
      }
      const bytes = await out.save();
      res.add(pdfBlob(bytes), 'images.pdf', plural(items.length, 'page') + ' · ' + fmt(bytes.length));
    }));
    root.append(drop, list.el, h('section', { class: 'glass ctl' }, h('div', { class: 'two' }, field('Page size', size), field('Margin', margin)), field('Image quality', qual)), note, h('div', { class: 'bar' }, go), res.el);
    return () => { res.clear(); items.forEach(i => URL.revokeObjectURL(i.url)); };
  }
});

// ======================================================================
// PDF -> Images
// ======================================================================
Hub.register({
  id: 'pdf2img', name: 'PDF to images', desc: 'Save PDF pages as PNG or JPG.',
  icon: 'M6 3h8l4 4v14H6zM9 17l2.5-3 2 2.5 1.5-1.5 2 2',
  mount(root) {
    const res = Hub.results(), note = Hub.note();
    let cur = null, jsDoc = null;
    const fmtSel = select([['png', 'PNG (sharp, larger)', true], ['jpg', 'JPG (smaller)']]);
    const dpi = select([['72', '72 dpi (small)'], ['144', '144 dpi (good for screens)', true], ['216', '216 dpi'], ['300', '300 dpi (print)']]);
    const range = h('input', { type: 'text', placeholder: 'All pages. Or e.g. 1-3, 5', autocomplete: 'off', spellcheck: false });
    const go = h('button', { class: 'btn pri', type: 'button', text: 'Convert' });
    const panel = h('section', { class: 'glass ctl', hidden: true }, h('div', { class: 'two' }, field('Format', fmtSel), field('Resolution', dpi)), field('Pages', range), h('div', { class: 'bar' }, go));
    const slot = Hub.pdfSlot({
      onLoad: s => { cur = s; panel.hidden = false; res.clear(); },
      onReset: () => { cur = null; panel.hidden = true; res.clear(); note.textContent = ''; }
    });
    go.addEventListener('click', () => Hub.run(go, note, async set => {
      res.clear();
      const idx = range.value.trim() ? Hub.parseRanges(range.value, cur.pages).flatMap(p => p.idx) : Array.from({ length: cur.pages }, (_, i) => i);
      const lib = await Hub.pdfjs(), task = lib.getDocument({ data: cur.bytes.slice() }), doc = await task.promise;
      try {
        const jpg = fmtSel.value === 'jpg', w = String(cur.pages).length, nm = base(cur.file.name);
        let k = 0;
        for (const i of idx) {
          set('Page ' + (++k) + ' of ' + idx.length + '…');
          const c = await Hub.renderPage(doc, i + 1, +dpi.value / 72);
          const blob = await new Promise(r => c.toBlob(r, jpg ? 'image/jpeg' : 'image/png', 0.92));
          c.width = c.height = 0;
          if (!blob) throw new Error('This browser couldn’t save page ' + (i + 1) + '. Try a lower resolution.');
          res.add(blob, nm + '-page-' + String(i + 1).padStart(w, '0') + (jpg ? '.jpg' : '.png'));
          await Hub.tick();
        }
        res.zipBar(nm + '-images.zip');
      } finally { task.destroy(); }
    }));
    root.append(slot.el, panel, note, res.el);
    return () => res.clear();
  }
});

// ======================================================================
// Shared: draw text on pages that may have their own /Rotate
// ======================================================================
// Map a point in the *displayed* page frame (origin bottom-left) to the raw page frame.
function toRaw(rot, w, hgt, dx, dy) {
  switch (rot) {
    case 90: return { x: w - dy, y: dx };
    case 180: return { x: w - dx, y: hgt - dy };
    case 270: return { x: dy, y: hgt - dx };
    default: return { x: dx, y: dy };
  }
}
function drawShown(page, font, text, size, dx, dy, angle, opt, degrees) {
  const { width: w, height: hgt } = page.getSize(), rot = ((page.getRotation().angle % 360) + 360) % 360;
  const p = toRaw(rot, w, hgt, dx, dy);
  page.drawText(text, Object.assign({ x: p.x, y: p.y, size, font, rotate: degrees(angle + rot) }, opt));
}
function shownSize(page) {
  const { width: w, height: hgt } = page.getSize(), rot = ((page.getRotation().angle % 360) + 360) % 360;
  return rot % 180 ? { W: hgt, H: w } : { W: w, H: hgt };
}
async function stdFont(out, text) {
  const { StandardFonts } = await Hub.lib(), font = await out.embedFont(StandardFonts.Helvetica);
  try { font.encodeText(text); } catch { throw new Error('That text has characters the built-in font can’t draw. Use English letters, numbers and common symbols.'); }
  return font;
}

// ======================================================================
// Page numbers
// ======================================================================
Hub.register({
  id: 'numbers', name: 'Page numbers', desc: 'Add page numbers to a PDF.',
  icon: 'M6 3h12v18H6zM10 8l2-1.5V13M9.5 17h5',
  mount(root) {
    const res = Hub.results(), note = Hub.note();
    let cur = null;
    const pos = select([['bc', 'Bottom center', true], ['br', 'Bottom right'], ['bl', 'Bottom left'], ['tc', 'Top center'], ['tr', 'Top right'], ['tl', 'Top left']]);
    const style = select([['n', '1', true], ['page', 'Page 1'], ['of', '1 / 10'], ['pageof', 'Page 1 of 10']]);
    const start = h('input', { type: 'number', value: '1', min: '0', max: '99999' });
    const sz = select([['9', '9 pt'], ['11', '11 pt', true], ['14', '14 pt'], ['18', '18 pt']]);
    const skip = h('input', { type: 'checkbox' });
    const go = h('button', { class: 'btn pri', type: 'button', text: 'Add page numbers' });
    const panel = h('section', { class: 'glass ctl', hidden: true },
      h('div', { class: 'two' }, field('Position', pos), field('Format', style)),
      h('div', { class: 'two' }, field('Start at', start), field('Size', sz)),
      h('label', { class: 'chk' }, skip, 'Leave the first page unnumbered'),
      h('div', { class: 'bar' }, go));
    const slot = Hub.pdfSlot({ onLoad: s => { cur = s; panel.hidden = false; res.clear(); }, onReset: () => { cur = null; panel.hidden = true; res.clear(); note.textContent = ''; } });
    go.addEventListener('click', () => Hub.run(go, note, async () => {
      res.clear();
      const { PDFDocument, degrees, rgb } = await Hub.lib(), doc = await Hub.openPdf(cur.bytes), font = await stdFont(doc, '0123456789 Pageof/');
      const size = +sz.value, s0 = Math.max(0, parseInt(start.value, 10) || 0), total = cur.pages + s0 - 1, margin = 28;
      doc.getPages().forEach((pg, i) => {
        if (skip.checked && i === 0) return;
        const n = s0 + i;
        const text = { n: String(n), page: 'Page ' + n, of: n + ' / ' + total, pageof: 'Page ' + n + ' of ' + total }[style.value];
        const tw = font.widthOfTextAtSize(text, size), { W, H } = shownSize(pg), v = pos.value[0], hz = pos.value[1];
        const dx = hz === 'l' ? margin : hz === 'r' ? W - margin - tw : (W - tw) / 2, dy = v === 'b' ? margin : H - margin - size;
        drawShown(pg, font, text, size, dx, dy, 0, { color: rgb(0.1, 0.1, 0.1) }, degrees);
      });
      const bytes = await doc.save();
      res.add(pdfBlob(bytes), base(cur.file.name) + '-numbered.pdf', plural(cur.pages, 'page') + ' · ' + fmt(bytes.length));
    }));
    root.append(slot.el, panel, note, res.el);
    return () => res.clear();
  }
});

// ======================================================================
// Watermark
// ======================================================================
Hub.register({
  id: 'watermark', name: 'Watermark', desc: 'Stamp text across every page.',
  icon: 'M5 19L19 5M4 8h5M15 16h5M7 4h2M15 20h2',
  mount(root) {
    const res = Hub.results(), note = Hub.note();
    let cur = null;
    const txt = h('input', { type: 'text', value: 'CONFIDENTIAL', maxLength: 60, autocomplete: 'off' });
    const sz = h('input', { type: 'range', min: '24', max: '160', value: '72' });
    const op = h('input', { type: 'range', min: '5', max: '100', value: '25' });
    const ang = select([['45', 'Diagonal', true], ['0', 'Horizontal']]);
    const col = select([['0.5,0.5,0.5', 'Gray', true], ['0.85,0.1,0.1', 'Red'], ['0.1,0.3,0.85', 'Blue'], ['0,0,0', 'Black']]);
    const go = h('button', { class: 'btn pri', type: 'button', text: 'Add watermark' });
    const panel = h('section', { class: 'glass ctl', hidden: true },
      field('Text', txt), field('Size', sz), field('Opacity', op),
      h('div', { class: 'two' }, field('Angle', ang), field('Colour', col)), h('div', { class: 'bar' }, go));
    const slot = Hub.pdfSlot({ onLoad: s => { cur = s; panel.hidden = false; res.clear(); }, onReset: () => { cur = null; panel.hidden = true; res.clear(); note.textContent = ''; } });
    go.addEventListener('click', () => Hub.run(go, note, async () => {
      res.clear();
      const text = txt.value.trim(); if (!text) throw new Error('Type the watermark text first.');
      const { degrees, rgb } = await Hub.lib(), doc = await Hub.openPdf(cur.bytes), font = await stdFont(doc, text);
      const [r, g, b] = col.value.split(',').map(Number), a = +ang.value, rad = a * Math.PI / 180;
      doc.getPages().forEach(pg => {
        const { W, H } = shownSize(pg);
        let size = +sz.value; const tw0 = font.widthOfTextAtSize(text, size), maxW = Math.hypot(W, H) * 0.9;
        const fit = a ? Math.min(1, (Math.min(W, H) * 1.15) / tw0) : Math.min(1, (W * 0.9) / tw0);
        size = Math.max(8, size * Math.min(1, fit, maxW / tw0));
        const tw = font.widthOfTextAtSize(text, size), ox = tw / 2, oy = size * 0.35;
        // anchor = page centre minus the rotated half-text offset, so the text is centred
        const dx = W / 2 - (ox * Math.cos(rad) - oy * Math.sin(rad)), dy = H / 2 - (ox * Math.sin(rad) + oy * Math.cos(rad));
        drawShown(pg, font, text, size, dx, dy, a, { color: rgb(r, g, b), opacity: op.value / 100 }, degrees);
      });
      const bytes = await doc.save();
      res.add(pdfBlob(bytes), base(cur.file.name) + '-watermarked.pdf', plural(cur.pages, 'page') + ' · ' + fmt(bytes.length));
    }));
    root.append(slot.el, panel, note, res.el);
    return () => res.clear();
  }
});

Hub.start();
})();
