/* Minimal ZIP reader/writer for Office files. Uses native Compression Streams (no library). */
(function (root) {
  'use strict';
  const T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = T[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  async function pipe(b, S) { return new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new S('deflate-raw'))).arrayBuffer()); }
  const inflate = b => pipe(b, DecompressionStream), deflate = b => pipe(b, CompressionStream);

  function read(buf) {
    try {
      const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
      const min = Math.max(0, buf.length - 65557);
      let e = buf.length - 22;
      while (e >= min && v.getUint32(e, true) !== 0x06054b50) e--;
      if (e < min) throw new Error('This isn’t a valid Office/ZIP file.');
      const n = v.getUint16(e + 10, true), cdOff = v.getUint32(e + 16, true);
      if (n === 0xFFFF || cdOff === 0xFFFFFFFF) throw new Error('ZIP64 files aren’t supported.');
      const dec = new TextDecoder(), out = [];
      let p = cdOff;
      for (let i = 0; i < n; i++) {
        if (v.getUint32(p, true) !== 0x02014b50) throw new Error('This file looks damaged.');
        const fl = v.getUint16(p + 8, true), nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true);
        const lo = v.getUint32(p + 42, true), csize = v.getUint32(p + 20, true);
        if (fl & 1) throw new Error('This file is password-protected.');
        const s = lo + 30 + v.getUint16(lo + 26, true) + v.getUint16(lo + 28, true);
        const nameBytes = buf.subarray(p + 46, p + 46 + nl);
        out.push({ nameBytes, name: dec.decode(nameBytes), flags: fl, method: v.getUint16(p + 10, true), time: v.getUint16(p + 12, true), date: v.getUint16(p + 14, true), crc: v.getUint32(p + 16, true), csize, usize: v.getUint32(p + 24, true), made: v.getUint16(p + 4, true), ver: v.getUint16(p + 6, true), xattr: v.getUint32(p + 38, true), raw: buf.subarray(s, s + csize) });
        p += 46 + nl + xl + cl;
      }
      return out;
    } catch (err) {
      if (err instanceof RangeError) throw new Error('This file looks damaged.');
      throw err;
    }
  }

  async function data(e) {
    if (e.method === 0) return e.raw;
    if (e.method === 8) return inflate(e.raw);
    throw new Error('Unsupported ZIP compression method.');
  }

  async function replace(e, bytes) {
    const c = await deflate(bytes), st = c.length >= bytes.length;
    return Object.assign({}, e, { method: st ? 0 : 8, crc: crc32(bytes), csize: st ? bytes.length : c.length, usize: bytes.length, raw: st ? bytes : c });
  }

  function write(es) {
    const parts = [], cd = [];
    let off = 0;
    for (const e of es) {
      const nm = e.nameBytes, fl = e.flags & ~8; // sizes are written up front, so drop the data-descriptor flag
      const lh = new Uint8Array(30 + nm.length), v = new DataView(lh.buffer);
      v.setUint32(0, 0x04034b50, true); v.setUint16(4, e.ver, true); v.setUint16(6, fl, true); v.setUint16(8, e.method, true);
      v.setUint16(10, e.time, true); v.setUint16(12, e.date, true); v.setUint32(14, e.crc, true); v.setUint32(18, e.csize, true); v.setUint32(22, e.usize, true);
      v.setUint16(26, nm.length, true); lh.set(nm, 30);
      const ch = new Uint8Array(46 + nm.length), c = new DataView(ch.buffer);
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, e.made, true); c.setUint16(6, e.ver, true); c.setUint16(8, fl, true); c.setUint16(10, e.method, true);
      c.setUint16(12, e.time, true); c.setUint16(14, e.date, true); c.setUint32(16, e.crc, true); c.setUint32(20, e.csize, true); c.setUint32(24, e.usize, true);
      c.setUint16(28, nm.length, true); c.setUint32(38, e.xattr, true); c.setUint32(42, off, true); ch.set(nm, 46);
      parts.push(lh, e.raw); cd.push(ch); off += lh.length + e.raw.length;
    }
    const cdSize = cd.reduce((a, b) => a + b.length, 0), end = new Uint8Array(22), d = new DataView(end.buffer);
    d.setUint32(0, 0x06054b50, true); d.setUint16(8, es.length, true); d.setUint16(10, es.length, true); d.setUint32(12, cdSize, true); d.setUint32(16, off, true);
    const out = new Uint8Array(off + cdSize + 22);
    let p = 0;
    for (const a of parts.concat(cd, [end])) { out.set(a, p); p += a.length; }
    return out;
  }

  root.Zip = { read, write, data, replace, crc32 };
  if (typeof module !== 'undefined') module.exports = root.Zip;
})(globalThis);
