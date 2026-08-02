/**
 * Validate enemy animation PNGs without external image dependencies.
 *
 * Default mode validates every animation sheet that exists and reports
 * missing sheets as warnings while the art migration is in progress.
 * `--strict` requires all twenty new 2048×2560 sheets.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const root = process.cwd();
const enemyDir = path.join(root, 'public', 'assets', 'enemies');
const strict = process.argv.includes('--strict');
const expectedWidth = 2048;
const expectedHeight = 2560;
const expectedSheets = Array.from({ length: 20 }, (_, i) =>
  `enemy_anim_${String(i + 1).padStart(2, '0')}.png`);

function readPng(file) {
  const data = fs.readFileSync(file);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!data.subarray(0, 8).equals(signature)) throw new Error('not a PNG');

  let offset = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (offset < data.length) {
    const length = data.readUInt32BE(offset); offset += 4;
    const type = data.toString('ascii', offset, offset + 4); offset += 4;
    const chunk = data.subarray(offset, offset + length); offset += length + 4;
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      bitDepth = chunk[8];
      colorType = chunk[9];
    } else if (type === 'IDAT') idat.push(chunk);
    else if (type === 'IEND') break;
  }

  const result = { width, height, bitDepth, colorType, cornerAlpha: null };
  if (colorType !== 6 || bitDepth !== 8 || !idat.length) return result;

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const stride = width * bpp;
  const rows = [];
  let cursor = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[cursor++];
    const row = Buffer.from(raw.subarray(cursor, cursor + stride));
    cursor += stride;
    const prev = y ? rows[y - 1] : null;
    for (let x = 0; x < stride; x++) {
      const left = x >= bpp ? row[x - bpp] : 0;
      const up = prev ? prev[x] : 0;
      const upLeft = prev && x >= bpp ? prev[x - bpp] : 0;
      if (filter === 1) row[x] = (row[x] + left) & 255;
      else if (filter === 2) row[x] = (row[x] + up) & 255;
      else if (filter === 3) row[x] = (row[x] + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft);
        row[x] = (row[x] + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft)) & 255;
      } else if (filter !== 0) throw new Error(`unsupported PNG filter ${filter}`);
    }
    rows.push(row);
  }
  const alphaAt = (x, y) => rows[y][x * 4 + 3];
  result.cornerAlpha = [
    alphaAt(0, 0), alphaAt(width - 1, 0),
    alphaAt(0, height - 1), alphaAt(width - 1, height - 1),
  ];
  return result;
}

function validateSheet(file) {
  const info = readPng(file);
  const label = path.basename(file);
  const isNew = info.width === expectedWidth && info.height === expectedHeight;
  if (!isNew) {
    const legacy = info.width % 4 === 0 && info.height > 0;
    console.warn(`  ⚠ ${label}: legacy/nonstandard ${info.width}×${info.height}${legacy ? ' (accepted during migration)' : ''}`);
    return { ok: !strict, legacy };
  }
  if (info.colorType !== 6 || info.bitDepth !== 8) {
    console.error(`  ✘ ${label}: expected RGBA PNG-32, got colorType=${info.colorType}, bitDepth=${info.bitDepth}`);
    return { ok: false };
  }
  if (!info.cornerAlpha || info.cornerAlpha.some((a) => a !== 0)) {
    console.error(`  ✘ ${label}: corners are not transparent (${info.cornerAlpha?.join(', ')})`);
    return { ok: false };
  }
  console.log(`  ✔ ${label}: 2048×2560 RGBA, transparent corners`);
  return { ok: true };
}

function validateSourceFrames() {
  const frameRoot = path.join(enemyDir, 'frames');
  if (!fs.existsSync(frameRoot)) return 0;
  let failed = 0;
  const files = fs.readdirSync(frameRoot, { recursive: true })
    .filter((name) => String(name).toLowerCase().endsWith('.png'))
    .map((name) => path.join(frameRoot, name));
  for (const file of files) {
    try {
      const info = readPng(file);
      if (info.width !== 256 || info.height !== 256 || info.colorType !== 6 || info.bitDepth !== 8) {
        console.error(`  ✘ source ${path.relative(root, file)}: expected 256×256 RGBA PNG-32`);
        failed++;
      } else if (!info.cornerAlpha || info.cornerAlpha.some((a) => a !== 0)) {
        console.error(`  ✘ source ${path.relative(root, file)}: corners are not transparent`);
        failed++;
      }
    } catch (error) {
      console.error(`  ✘ source ${path.relative(root, file)}: ${error.message}`);
      failed++;
    }
  }
  if (files.length && !failed) console.log(`  ✔ ${files.length} retained source frames validated`);
  return failed;
}

if (!fs.existsSync(enemyDir)) throw new Error(`missing asset directory: ${enemyDir}`);
const existing = expectedSheets.filter((name) => fs.existsSync(path.join(enemyDir, name)));
let failed = 0;
for (const name of existing) {
  try {
    if (!validateSheet(path.join(enemyDir, name)).ok) failed++;
  } catch (error) {
    failed++;
    console.error(`  ✘ ${name}: ${error.message}`);
  }
}

const missing = expectedSheets.filter((name) => !existing.includes(name));
if (missing.length) {
  const message = `${missing.length} enemy animation sheet(s) missing`;
  if (strict) { console.error(`  ✘ ${message}`); failed++; }
  else console.warn(`  ℹ ${message}; procedural/static fallback remains active`);
}

if (!existing.length) console.warn('  ℹ no enemy animation sheets found');
failed += validateSourceFrames();
if (failed) process.exit(1);
