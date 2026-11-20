import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { deflateSync } from 'zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'resources');

const TOP_LEFT = [0x6d, 0x4a, 0xff];
const BOTTOM_RIGHT = [0xe2, 0x49, 0x9b];
const WHITE = [0xff, 0xff, 0xff];
const RED = [0xe8, 0x2e, 0x5c];

const BACKGROUND = { inset: 0.03, radius: 0.24 };
const BUBBLE = { x0: 0.17, y0: 0.2, x1: 0.83, y1: 0.68, radius: 0.13 };
const TAIL = [
  [0.27, 0.6],
  [0.2, 0.84],
  [0.47, 0.66]
];
const ENVELOPE = { x0: 0.3, y0: 0.3, x1: 0.7, y1: 0.58, stroke: 0.035 };

function insideRoundedRect(x, y, x0, y0, x1, y1, radius) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + radius), x1 - radius);
  const cy = Math.min(Math.max(y, y0 + radius), y1 - radius);
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

function edgeSign([ax, ay], [bx, by], x, y) {
  return (x - bx) * (ay - by) - (ax - bx) * (y - by);
}

function insideTriangle(x, y, [a, b, c]) {
  const d1 = edgeSign(a, b, x, y);
  const d2 = edgeSign(b, c, x, y);
  const d3 = edgeSign(c, a, x, y);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

function nearSegment(x, y, [ax, ay], [bx, by], half) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2 <= half * half;
}

function onEnvelope(x, y) {
  const { x0, y0, x1, y1, stroke } = ENVELOPE;
  const half = stroke / 2;
  const outer = insideRoundedRect(x, y, x0 - half, y0 - half, x1 + half, y1 + half, 0.04);
  const inner = insideRoundedRect(x, y, x0 + half, y0 + half, x1 - half, y1 - half, 0.02);
  if (outer && !inner) return true;
  const mid = [(x0 + x1) / 2, y0 + (y1 - y0) * 0.55];
  return nearSegment(x, y, [x0 + half, y0 + half], mid, half) || nearSegment(x, y, [x1 - half, y0 + half], mid, half);
}

function mix(from, to, amount) {
  return from.map((channel, index) => channel + (to[index] - channel) * amount);
}

function gradient(x, y) {
  return mix(TOP_LEFT, BOTTOM_RIGHT, Math.min(1, Math.max(0, (x + y) / 2)));
}

function sampleIcon(x, y) {
  const { inset, radius } = BACKGROUND;
  if (!insideRoundedRect(x, y, inset, inset, 1 - inset, 1 - inset, radius)) return null;
  const inBubble = insideRoundedRect(x, y, BUBBLE.x0, BUBBLE.y0, BUBBLE.x1, BUBBLE.y1, BUBBLE.radius) || insideTriangle(x, y, TAIL);
  if (inBubble && onEnvelope(x, y)) return gradient(x, y);
  if (inBubble) return WHITE;
  return gradient(x, y);
}

function sampleBadge(x, y) {
  const d = (x - 0.5) ** 2 + (y - 0.5) ** 2;
  if (d > 0.25) return null;
  if (d > 0.16) return WHITE;
  return RED;
}

function render(size, sample) {
  const samples = size <= 48 ? 8 : 4;
  const pixels = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const total = [0, 0, 0];
      let covered = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const color = sample((px + (sx + 0.5) / samples) / size, (py + (sy + 0.5) / samples) / size);
          if (!color) continue;
          covered++;
          color.forEach((channel, index) => (total[index] += channel));
        }
      }
      const value = covered === 0 ? [0, 0, 0, 0] : [...total.map((c) => Math.round(c / covered)), Math.round((covered / (samples * samples)) * 255)];
      pixels.set(value, (py * size + px) * 4);
    }
  }
  return pixels;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, pixels) {
  const stride = size * 4;
  const scanlines = Buffer.alloc((stride + 1) * size);
  for (let row = 0; row < size; row++) {
    pixels.copy(scanlines, row * (stride + 1) + 1, row * stride, (row + 1) * stride);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

function encodeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length + images.length * 16;
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map(({ png }) => png)]);
}

function writeResource(name, data) {
  writeFileSync(resolve(outDir, name), data);
  console.log(`Wrote resources/${name} (${data.length} bytes)`);
}

mkdirSync(outDir, { recursive: true });
const icoImages = [16, 24, 32, 48, 64, 256].map((size) => ({ size, png: encodePng(size, render(size, sampleIcon)) }));
writeResource('icon.png', icoImages.find(({ size }) => size === 256).png);
writeResource('tray.png', icoImages.find(({ size }) => size === 32).png);
writeResource('icon-mac.png', encodePng(1024, render(1024, sampleIcon)));
writeResource('icon.ico', encodeIco(icoImages));
writeResource('badge.png', encodePng(16, render(16, sampleBadge)));
