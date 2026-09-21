#!/usr/bin/env node
/**
 * 生成 PWA 的真实 PNG 图标（192 / 512 / maskable-512）。
 * 不依赖任何第三方图形库：直接构建 RGBA 像素并用 zlib 编码 PNG。
 * 图形：暖纸白底 + 深松绿双语书页 + 低饱和金色书签。
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
          const dx = Math.min(Math.max(x0 + r - x, x - (x0 + w - 1 - r)), 0);
          const dy = Math.min(Math.max(y0 + r - y, y - (y0 + h - 1 - r)), 0);
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

/** 绘制双页书 + 金色书签 */
function draw(size, { maskable = false } = {}) {
  const c = makeCanvas(size);
  const u = size / 512;
  c.fill(maskable ? PINE : PAPER);
  const ink = maskable ? PAPER : PINE;
  const ink2 = maskable ? [0xdc, 0xe7, 0xe1, 255] : PINE_LIGHT;
  const pad = maskable ? 108 : 32;
  const pw = (size - pad * 2) / 2 - 6 * u;
  const top = pad + 22 * u;
  const bottom = size - pad - 24 * u;
  const ph = bottom - top;
  const left = pad;
  c.roundRect(left, top, pw, ph, 22 * u, ink);
  c.roundRect(size - pad - pw, top, pw, ph, 22 * u, ink2);
  c.roundRect(size / 2 - 5 * u, top - 6 * u, 10 * u, ph + 12 * u, 4 * u, maskable ? PINE : PAPER);
  // 文字线
  const lx = left + 26 * u;
  const rx = size - pad - pw + 26 * u;
  for (let i = 0; i < 3; i += 1) {
    const y = top + (44 + i * 40) * u;
    c.roundRect(lx, y, (i === 0 ? 84 : 66) * u, 11 * u, 5 * u, i === 0 ? GOLD : (maskable ? [0x8f, 0xa9, 0x9f, 255] : [0xdc, 0xe7, 0xe1, 255]));
    c.roundRect(rx, y, (i === 0 ? 84 : 66) * u, 11 * u, 5 * u, i === 0 ? GOLD : (maskable ? [0x8f, 0xa9, 0x9f, 255] : [0xdc, 0xe7, 0xe1, 255]));
  }
  c.circle(size / 2, bottom - 32 * u, 13 * u, GOLD);
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
