import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = resolve(siteRoot, "..");
const gameOutput = resolve(projectRoot, "dist", "client");
const target = resolve(siteRoot, "public", "game");

const command = process.platform === "win32" ? "cmd.exe" : "npm";
const args = process.platform === "win32" ? ["/d", "/s", "/c", "npm run build"] : ["run", "build"];
execFileSync(command, args, { cwd: projectRoot, stdio: "inherit" });

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(gameOutput, target, { recursive: true });

async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const batches = await Promise.all(entries.map(async (entry) => {
    const target = resolve(directory, entry.name);
    return entry.isDirectory() ? filesIn(target) : [target];
  }));
  return batches.flat();
}

for (const file of (await filesIn(target)).filter((file) => file.endsWith(".js"))) {
  const contents = await readFile(file, "utf8");
  await writeFile(file, contents
    .replaceAll("'/assets/", "'/game/assets/")
    .replaceAll('"/assets/', '"/game/assets/'));
}
