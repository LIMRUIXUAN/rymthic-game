import { execFileSync } from 'node:child_process';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const dist = path.resolve('dist');
const client = path.join(dist, 'client');
const assets = path.join(client, 'assets');

async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const groups = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? filesIn(target) : [target];
  }));
  return groups.flat();
}

function transcode(args) {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
}

const outputFiles = await filesIn(assets);
for (const file of outputFiles.filter((file) => file.endsWith('.png'))) {
  transcode(['-i', file, '-c:v', 'libwebp', '-q:v', '82', `${file.slice(0, -4)}.webp`]);
  await rm(file);
}

for (const file of outputFiles.filter((file) => file.endsWith('.mp3'))) {
  const temp = `${file}.optimized.mp3`;
  transcode(['-i', file, '-c:a', 'libmp3lame', '-b:a', '128k', temp]);
  await rename(temp, file);
}

for (const file of (await filesIn(client)).filter((file) => file.endsWith('.js'))) {
  const contents = await readFile(file, 'utf8');
  await writeFile(file, contents.replaceAll('.png', '.webp'));
}

await mkdir(path.join(dist, 'server'), { recursive: true });
await writeFile(path.join(dist, 'server', 'index.js'), `export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);
    if (response.status !== 404) return response;

    const url = new URL(request.url);
    if (url.pathname.includes('.')) return response;
    return env.ASSETS.fetch(new Request(new URL('/index.html', url), request));
  },
};
`);
