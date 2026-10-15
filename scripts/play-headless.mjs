#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "packages/play-core/dist/index.js");

if (!existsSync(dist)) {
  const built = spawnSync("pnpm", ["exec", "tsc", "-p", "packages/play-core/tsconfig.build.json"], {
    cwd: root,
    stdio: "inherit",
  });
  if (built.status !== 0) process.exit(built.status ?? 1);
}

const flag = process.argv.indexOf("--cassette");
const path = flag >= 0 ? process.argv[flag + 1] : undefined;
if (!path) {
  process.stderr.write("usage: node scripts/play-headless.mjs --cassette <file.json>\n");
  process.exit(2);
}

const { loadCassette, playCassette } = await import(pathToFileURL(dist).href);
const cassette = loadCassette(readFileSync(path, "utf8"));
const state = playCassette(cassette);
if (!state.ending) {
  process.stderr.write("cassette produced no ending\n");
  process.exit(1);
}
process.stdout.write(`${state.ending}\n`);
