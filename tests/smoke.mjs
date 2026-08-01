/**
 * Browser smoke test. Boots the real built game in headless Chrome, clicks
 * through Boot -> Menu -> Upgrade -> Level, and fails on ANY
 * console error or uncaught exception.
 *
 * A passing `vite build` only proves the code parses. It says nothing about
 * whether a scene throws on create(), which is exactly the class of bug that
 * makes a game look finished and be unplayable.
 *
 * Usage:  node tests/smoke.mjs <dist-dir>
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const DIST = process.argv[2] || 'dist';

let puppeteer;
try {
  puppeteer = (await import('puppeteer')).default;
} catch {
  console.log('\n  Skipping browser smoke test: puppeteer is not installed.\n');
  console.log('  To enable it:   npm i -D puppeteer');
  console.log('  (downloads a private Chrome build, ~150MB, one time)\n');
  console.log('  In the meantime `npm run test:scene` covers the same panel and');
  console.log('  minigame code paths under jsdom — it just cannot catch a purely');
  console.log('  visual/rendering problem.\n');
  process.exit(0);
}

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.map': 'application/json',
};

const server = http.createServer((req, res) => {
  // The browser URL-encodes paths (spaces -> %20); decode before touching
  // the filesystem or multi-word assets like "Backed Vibes.mp3" 404.
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(DIST, url === '/' ? 'index.html' : url);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

const PORT = 8912;
await new Promise((r) => server.listen(PORT, r));

const errors = [];
const logs = [];

let browser;
try {
  browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required',
           '--mute-audio', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
} catch (e) {
  server.close();
  const msg = e.message || '';
  // npm can block puppeteer's postinstall (the step that downloads Chrome), so
  // the package is present but there is no browser binary to launch.
  if (/Could not find Chrome|does not exist|ENOENT|browser was not found/i.test(msg)) {
    console.log('\n  puppeteer is installed, but its Chrome download was blocked.');
    console.log('  Your npm gated the postinstall script. Fetch the browser directly:\n');
    console.log('      npx puppeteer browsers install chrome\n');
    console.log('  then re-run:  npm run test:browser\n');
    console.log('  (`npm run test:scene` already covers the same code paths meanwhile.)\n');
    process.exit(0);
  }
  if (/libX|shared librar|error while loading/i.test(msg)) {
    console.log('\n  Chrome is present but missing system libraries — common in');
    console.log('  containers. Skipping; use `npm run test:scene` instead.\n');
    process.exit(0);
  }
  console.log(`\n  Could not launch the browser:\n  ${msg.split('\n')[0]}\n`);
  process.exit(1);
}

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 810 });

/**
 * Requests the BROWSER makes on its own, which the page never asked for.
 * These are not game bugs and must not fail the run — but everything else 404ing
 * is a real missing asset and should.
 */
const BENIGN_404 = [
  /\/favicon\.ico$/,
  /\/\.well-known\/appspecific\/com\.chrome\.devtools\.json$/,
  /\.map$/,
  // ASSETS.md: every asset is OPTIONAL — the game falls back to procedural
  // drawing when a file is missing. A 404 here is not a bug. (When you add
  // assets, their filenames must match ASSETS.md exactly or the game will
  // silently keep the fallback — check the browser console for the
  // "[assets] missing" info line to confirm a file was picked up.)
  /\/assets\//,
];

const bad404s = [];
page.on('response', (res) => {
  if (res.status() < 400) return;
  const url = res.url();
  if (BENIGN_404.some((re) => re.test(url))) return;
  bad404s.push(`${res.status()} ${url}`);
});

page.on('console', (m) => {
  const t = m.text();
  logs.push(`${m.type()}: ${t}`);
  if (m.type() !== 'error') return;
  // WebGL/audio warnings in headless are environmental, not game bugs.
  if (/WebGL|GPU|AudioContext|swiftshader/i.test(t)) return;
  // Resource 404s are reported with their URL by the response handler above;
  // this generic console line carries no URL, so it would only be noise.
  if (/Failed to load resource/i.test(t)) return;
  errors.push(t);
});
page.on('pageerror', (e) => errors.push(`UNCAUGHT: ${e.message}`));

const step = async (label, fn) => {
  process.stdout.write(`  ${label} ... `);
  try { await fn(); console.log('ok'); }
  catch (e) { console.log('FAIL'); errors.push(`${label}: ${e.message}`); }
};

const click = async (x, y) => { await page.mouse.click(x, y); await new Promise((r) => setTimeout(r, 450)); };

// Ask the running game which scene is active — the real source of truth.
const activeScenes = () => page.evaluate(() => {
  const g = window.__game;
  if (!g) return ['<no game handle>'];
  return g.scene.getScenes(true).map((s) => s.scene.key);
});

console.log('\n── browser smoke test ───────────────────────────');

await step('page loads', async () => {
  // The soundtrack intentionally keeps a request alive, so `networkidle0`
  // never settles even when the game is fully usable. Wait for the actual
  // application readiness signal instead: Phaser has activated Boot.
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => window.__game?.scene?.getScenes(true)
    .some((s) => s.scene.key === 'Boot'), { timeout: 90000 });
  await new Promise((r) => setTimeout(r, 2500));
});

await step('canvas is rendering', async () => {
  const has = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    return !!c && c.width > 0 && c.height > 0;
  });
  if (!has) throw new Error('no sized canvas found');
});

await step('Boot scene is active', async () => {
  const s = await activeScenes();
  if (!s.includes('Boot')) throw new Error(`expected Boot, got ${s.join(',')}`);
});

await step('click-to-begin advances to Menu', async () => {
  await click(720, 455);
  await new Promise((r) => setTimeout(r, 900));
  const s = await activeScenes();
  if (!s.includes('Menu')) throw new Error(`expected Menu, got ${s.join(',')}`);
});

await step('START BALL HOP opens the Upgrade screen', async () => {
  await click(720, 352);
  await new Promise((r) => setTimeout(r, 900));
  const s = await activeScenes();
  if (!s.includes('Upgrade')) throw new Error(`expected Upgrade, got ${s.join(',')}`);
});

await step('stat points can be spent', async () => {
  // three "+" clicks on the HEALTH row
  for (let i = 0; i < 3; i++) await click(80 + 302, 180 + 14);
  const left = await page.evaluate(() => {
    const sc = window.__game.scene.getScene('Upgrade');
    return sc.run.unspentPoints;
  });
  if (left !== 0) throw new Error(`expected 0 unspent points, got ${left}`);
});

await step('taking a skill works', async () => {
  await click(750, 190);            // first skill offer card
  const n = await page.evaluate(() => window.__game.scene.getScene('Upgrade').run.skills.length);
  if (n !== 1) throw new Error(`expected 1 skill, got ${n}`);
});

await step('FIGHT starts the Level scene', async () => {
  await click(720, 766);
  await new Promise((r) => setTimeout(r, 1500));
  const s = await activeScenes();
  if (!s.includes('Level')) throw new Error(`expected Level, got ${s.join(',')}`);
});

await step('conductor clock advances with the audio', async () => {
  const a = await page.evaluate(() => window.__game.scene.getScene('Level').conductor.beat);
  await new Promise((r) => setTimeout(r, 2000));
  const b = await page.evaluate(() => window.__game.scene.getScene('Level').conductor.beat);
  if (!(b > a)) throw new Error(`beat did not advance: ${a} -> ${b}`);
  if (!Number.isFinite(b)) throw new Error(`beat is not finite: ${b}`);
});

await step('phrases begin and notes spawn', async () => {
  await new Promise((r) => setTimeout(r, 4000));
  const info = await page.evaluate(() => {
    const sc = window.__game.scene.getScene('Level');
    return { idx: sc.phraseIndex, notes: sc.minigame?.notes?.length ?? -1 };
  });
  if (info.idx < 0) throw new Error('no phrase ever started');
  if (info.notes <= 0) throw new Error(`no notes spawned (${info.notes})`);
});

await step('mouse movement drives the minigame without throwing', async () => {
  for (let i = 0; i < 24; i++) {
    await page.mouse.move(500 + Math.sin(i / 2) * 180, 420);
    await new Promise((r) => setTimeout(r, 90));
  }
});

await step('combat actually resolves damage', async () => {
  await new Promise((r) => setTimeout(r, 6000));
  const st = await page.evaluate(() => {
    const sc = window.__game.scene.getScene('Level');
    return { enemyHp: sc.enemy.hp, enemyMax: sc.enemy.maxHp, heroHp: sc.run.hp, phrase: sc.phraseIndex };
  });
  if (st.phrase < 1) throw new Error('never advanced past the first phrase');
  if (st.enemyHp === st.enemyMax && st.heroHp === 100) {
    throw new Error('no damage was dealt in either direction — combat is not wired up');
  }
});

await browser.close();
server.close();

errors.push(...bad404s.map((u) => `missing asset: ${u}`));

console.log(`\n${'─'.repeat(50)}`);
if (errors.length) {
  console.log(`SMOKE TEST FAILED — ${errors.length} error(s):\n`);
  errors.slice(0, 20).forEach((e) => console.log(`  • ${e}`));
  process.exit(1);
}
console.log('smoke test passed — no console errors, full flow reachable');
