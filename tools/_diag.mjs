import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import puppeteer from 'puppeteer';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
let reqCount = 0, pending = 0, maxPending = 0, pendingPaths = new Set();
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  reqCount++; pending++; maxPending = Math.max(maxPending, pending);
  if (url.startsWith('/assets/')) pendingPaths.add(url);
  const file = path.join('dist', url === '/' ? 'index.html' : url);
  fs.readFile(file, (err, data) => {
    pending--;
    if (url.startsWith('/assets/')) pendingPaths.delete(url);
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});
await new Promise((r) => server.listen(8928, r));
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required', '--mute-audio', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 810 });
await page.goto('http://localhost:8928/', { waitUntil: 'load', timeout: 60000 });
console.log('load event fired; requests:', reqCount, 'maxPending:', maxPending);
for (const t of [3000, 15000, 40000]) {
  await new Promise((r) => setTimeout(r, t === 3000 ? 3000 : t - (t === 15000 ? 3000 : 15000)));
  const st = await page.evaluate(() => {
    const g = window.__game;
    return {
      game: !!g,
      scenes: g ? g.scene.getScenes(true).map((s) => s.scene.key) : [],
      logo: g ? g.textures.exists('logo') : false,
      bg: g ? g.textures.exists('bg_menu') : false,
      hero: g ? g.textures.exists('hero_avatar') : false,
    };
  });
  console.log(`t+${t/1000}s:`, JSON.stringify(st), 'server pending:', pending);
}
await browser.close(); server.close();
