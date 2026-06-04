#!/usr/bin/env node
/**
 * Generates PWA PNG icons from a self-contained SVG.
 *
 *  - pwa-192.png         192x192  (any)
 *  - pwa-512.png         512x512  (any)
 *  - pwa-maskable-512.png 512x512 (maskable, ~20% safe-zone padding)
 *  - apple-touch-icon.png 180x180 (iOS Home Screen)
 *
 * Run via: npm run generate-icons
 */
import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(__dirname, '..', 'public');

const BG = '#0a0a0a';
const PRIMARY = '#10b981';
const ACCENT = '#86efac';

function buildSvg(size, { maskable = false } = {}) {
  const safe = maskable ? size * 0.8 : size * 0.86;
  const offset = (size - safe) / 2;
  const r = size * 0.22;
  const fontSize = safe * 0.5;
  const y = size / 2 + fontSize * 0.34;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${PRIMARY}"/>
      <stop offset="100%" stop-color="${ACCENT}"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${size}" height="${size}" rx="${maskable ? 0 : r}" fill="${BG}"/>
  <rect x="${offset}" y="${offset}" width="${safe}" height="${safe}" rx="${r * 0.7}" fill="url(#g)"/>
  <text x="${size / 2}" y="${y}" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif" font-weight="900" font-size="${fontSize}" fill="${BG}" letter-spacing="-${size * 0.02}">PS</text>
</svg>`;
}

async function emit(name, size, opts = {}) {
  const svg = buildSvg(size, opts);
  const out = resolve(PUBLIC_DIR, name);
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(out);
  console.log(`  wrote ${name}  (${size}x${size}${opts.maskable ? ' maskable' : ''})`);
}

async function main() {
  console.log(`Generating PWA icons into ${PUBLIC_DIR}/`);
  await emit('pwa-192.png', 192);
  await emit('pwa-512.png', 512);
  await emit('pwa-maskable-512.png', 512, { maskable: true });
  await emit('apple-touch-icon.png', 180);
  await writeFile(resolve(PUBLIC_DIR, 'pwa-icon.svg'), buildSvg(512));
  console.log('  wrote pwa-icon.svg (source)');
  console.log('Done.');
}

main().catch((err) => { console.error(err); process.exit(1); });
