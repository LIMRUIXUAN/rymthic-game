import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import puppeteer from 'puppeteer';

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const file = path.join('dist', url === '/' ? 'index.html' : url);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});
await new Promise((r) => server.listen(8916, r));

function decodePNG(buf) {
  let pos = 8;
  const readChunk = () => {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    return { type, data };
  };
  let width, height, colorType;
  const idat = [];
  let c = readChunk();
  width = c.data.readUInt32BE(0); height = c.data.readUInt32BE(4);
  colorType = c.data[9];
  const ch = colorType === 6 ? 4 : 3;
  while (true) { c = readChunk(); if (c.type === 'IDAT') idat.push(c.data); else if (c.type === 'IEND') break; }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const out = Buffer.alloc(height * stride);
  const paeth = (a, b, c0) => { const p = a + b - c0, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c0); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c0; };
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0, b = prev[x], cc = x >= ch ? prev[x - ch] : 0;
      let v = row[x];
      if (f === 1) v = (v + a) & 0xff; else if (f === 2) v = (v + b) & 0xff;
      else if (f === 3) v = (v + ((a + b) >> 1)) & 0xff; else if (f === 4) v = (v + paeth(a, b, cc)) & 0xff;
      cur[x] = v;
    }
    prev = cur;
  }
  return { width, height, ch, data: out };
}

const OUT = 'tools/_shots2';
fs.mkdirSync(OUT, { recursive: true });
const errors = [];
const fail = (m) => { console.log(`  FAIL: ${m}`); errors.push(m); };

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required', '--mute-audio', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 810 });
page.on('pageerror', (e) => fail(`UNCAUGHT: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') fail(m.text()); });
const click = async (x, y) => { await page.mouse.click(x, y); await new Promise((r) => setTimeout(r, 500)); };
const shots = {};
const shot = async (name) => {
  const p = `${OUT}/${name}.png`;
  await page.screenshot({ path: p });
  shots[name] = decodePNG(fs.readFileSync(p));
};
const px = (name, x, y) => { const img = shots[name]; const i = (y * img.width + x) * img.ch; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };
const bright = (name, x0, y0, x1, y1) => { // avg brightness in region
  const img = shots[name]; let s = 0, n = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = (y * img.width + x) * img.ch; s += (img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3; n++;
  }
  return s / n;
};

console.log('── UI v3 verification ──────────────────────');
await page.goto('http://localhost:8916/', { waitUntil: 'networkidle0', timeout: 25000 });
await new Promise((r) => setTimeout(r, 3000));
await click(720, 455);
await new Promise((r) => setTimeout(r, 1200));
await click(720, 750);
await new Promise((r) => setTimeout(r, 1500));

// Menu: hover spotlight on NEW RUN button (720,168), compare brightness
await page.mouse.move(720, 168);
await new Promise((r) => setTimeout(r, 400));
await shot('menu-hover');
const menuHoverBright = bright('menu-hover', 640, 150, 800, 186);
await page.mouse.move(200, 700);
await new Promise((r) => setTimeout(r, 400));
await shot('menu-plain');
const menuPlainBright = bright('menu-plain', 640, 150, 800, 186);
console.log(`  ${menuHoverBright > menuPlainBright + 4 ? 'ok' : 'FAIL'} menu spotlight brightens on hover (${menuPlainBright.toFixed(1)} -> ${menuHoverBright.toFixed(1)})`);
if (menuHoverBright <= menuPlainBright + 4) fail('spotlight not visible on menu button');

// UNLOCKS modal
await click(720, 312);
await new Promise((r) => setTimeout(r, 700));
await shot('unlocks');
await click(720, 679);
await new Promise((r) => setTimeout(r, 500));

// Upgrade: skill card hover spotlight
await click(720, 168);
await new Promise((r) => setTimeout(r, 1100));
await page.mouse.move(750, 190);
await new Promise((r) => setTimeout(r, 400));
await shot('upgrade-hover');
const upHover = bright('upgrade-hover', 560, 160, 940, 230);
await page.mouse.move(200, 700);
await new Promise((r) => setTimeout(r, 400));
await shot('upgrade-plain');
const upPlain = bright('upgrade-plain', 560, 160, 940, 230);
console.log(`  ${upHover > upPlain + 4 ? 'ok' : 'FAIL'} upgrade skill card spotlight (${upPlain.toFixed(1)} -> ${upHover.toFixed(1)})`);
if (upHover <= upPlain + 4) fail('spotlight not visible on upgrade card');

// text overflow check: bright text pixels below the skill card bottom edge (card 1: y 152-248, check rows 254-270 inside skip button zone? use column x 560-940)
const img = shots['upgrade-plain'];
let spill = 0;
for (let y = 250; y <= 252; y++) for (let x = 560; x <= 940; x++) {
  const i = (y * img.width + img.ch) * img.ch;
  const b = (img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3;
  if (b > 120) spill++;
}
console.log(`  ${spill < 20 ? 'ok' : 'FAIL'} no text spilling below skill card 1 (${spill} bright px)`);
if (spill >= 20) fail(`text spill below skill card (${spill}px)`);

// stat row card text fits: bright pixels below stat card 1 (y 180-232 -> rows 234-236, x 80-410)
let spill2 = 0;
for (let y = 234; y <= 236; y++) for (let x = 90; x <= 400; x++) {
  const i = (y * img.width + x) * img.ch;
  const b = (img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3;
  if (b > 120) spill2++;
}
console.log(`  ${spill2 < 10 ? 'ok' : 'FAIL'} no text spilling below stat card (${spill2} bright px)`);
if (spill2 >= 10) fail('text spill below stat card');

await browser.close();
server.close();
console.log(errors.length ? `\n${errors.length} issue(s) found` : '\nall checks passed');
process.exit(errors.length ? 1 : 0);
