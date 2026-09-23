#!/usr/bin/env node
/**
 * 生成 PWA 的真实 PNG 图标（192 / 512 / maskable-512）。
 * 不依赖任何第三方图形库：直接构建 RGBA 像素并用 zlib 编码 PNG。
 * 图形：深松绿底色上的简约 IELTS 字样与低饱和金色细线。
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'apps', 'web', 'public', 'icons');

const PAPER = [0xf7, 0xf5, 0xef, 255];
const PINE = [0x18, 0x3d, 0x36, 255];
const PINE_LIGHT = [0x3c, 0x76, 0x67, 255];
const GOLD = [0xb9, 0x97, 0x59, 255];

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  let crc = -1;
  for (let i = 0; i < buf.length; i += 1) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function makeCanvas(size) {
  const buf = Buffer.alloc(size * size * 4);
  return {
    size,
    buf,
    set(x, y, color) {
      if (x < 0 || y < 0 || x >= size || y >= size) return;
      const i = (y * size + x) * 4;
      buf[i] = color[0]; buf[i + 1] = color[1]; buf[i + 2] = color[2]; buf[i + 3] = color[3] ?? 255;
    },
    fill(color) { for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) this.set(x, y, color); },
    roundRect(x0, y0, w, h, r, color) {
      for (let y = Math.round(y0); y < Math.round(y0 + h); y += 1) {
        for (let x = Math.round(x0); x < Math.round(x0 + w); x += 1) {
          const dx = Math.max(x0 + r - x, x - (x0 + w - 1 - r), 0);
          const dy = Math.max(y0 + r - y, y - (y0 + h - 1 - r), 0);
          if (dx * dx + dy * dy <= r * r) this.set(x, y, color);
        }
      }
    },
    circle(cx, cy, r, color) {
      for (let y = Math.round(cy - r); y <= Math.round(cy + r); y += 1) {
        for (let x = Math.round(cx - r); x <= Math.round(cx + r); x += 1) {
          const dx = x - cx; const dy = y - cy;
          if (dx * dx + dy * dy <= r * r) this.set(x, y, color);
        }
      }
    },
  };
}

/** Restrained IELTS wordmark: no borrowed exam-board logo or external font. */
function draw(size, { maskable = false } = {}) {
  const c = makeCanvas(size);
  const u = size / 512;
  c.fill(PINE);
  const glyphs = {
    I:['11111','00100','00100','00100','00100','00100','11111'],
    E:['11111','10000','10000','11110','10000','10000','11111'],
    L:['10000','10000','10000','10000','10000','10000','11111'],
    T:['11111','00100','00100','00100','00100','00100','00100'],
    S:['11111','10000','10000','11111','00001','00001','11111'],
  };
  const cell=(maskable?10:13)*u;
  const gap=cell;
  const width=5*5*cell+4*gap;
  const x0=(size-width)/2, y0=size/2-3.5*cell;
  for(const [i,letter] of [...'IELTS'].entries()){
    for(const [row,line] of glyphs[letter].entries())for(const [col,bit] of [...line].entries()){
      if(bit==='1')c.roundRect(x0+i*6*cell+col*cell,y0+row*cell,cell*1.08,cell*1.08,0,PAPER);
    }
  }
  c.roundRect(size*0.22,size*0.72,size*0.56,8*u,4*u,GOLD);
  return c;
}

export function generateIcons() {
  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
  const written = [];
  for (const size of [192, 512]) {
    const png = encodePng(size, size, draw(size).buf);
    const f = path.join(OUT, `icon-${size}.png`);
    writeFileSync(f, png);
    written.push({ file: f, bytes: png.length });
  }
  const mask = encodePng(512, 512, draw(512, { maskable: true }).buf);
  const mf = path.join(OUT, 'maskable-512.png');
  writeFileSync(mf, mask);
  written.push({ file: mf, bytes: mask.length });
  // apple-touch-icon 复用 192
  writeFileSync(path.join(OUT, 'apple-touch-icon.png'), encodePng(192, 192, draw(192).buf));
  return written;
}

if (process.argv[1] && process.argv[1].endsWith('gen-icons.mjs')) {
  const w = generateIcons();
  for (const x of w) console.log(`  ${path.relative(ROOT, x.file)}  ${(x.bytes / 1024).toFixed(1)} KB`);
  console.log(`生成 ${w.length} 个 PNG 图标`);
}
