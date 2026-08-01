import { execFileSync } from 'node:child_process';
import { readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const dist = path.resolve('dist');
const assets = path.join(dist, 'assets');

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

for (const file of (await filesIn(dist)).filter((file) => file.endsWith('.js'))) {
  const contents = await readFile(file, 'utf8');
  await writeFile(file, contents.replaceAll('.png', '.webp'));
}
