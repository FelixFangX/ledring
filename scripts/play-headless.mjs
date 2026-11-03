#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "packages/play-core/dist/index.js");

function buildDeps() {
  // Package exports point at dist/, which `pnpm test` has not produced yet.
  const built = spawnSync("pnpm", ["--filter", "@ledring/play-core...", "run", "build"], {
    cwd: root,
    encoding: "utf8",
  });
  if (built.status !== 0) {
    process.stderr.write(built.stdout ?? "");
    process.stderr.write(built.stderr ?? "");
    process.exit(built.status ?? 1);
  }
}

if (!existsSync(dist)) buildDeps();

const flag = process.argv.indexOf("--cassette");
const path = flag >= 0 ? process.argv[flag + 1] : undefined;
if (!path) {
  process.stderr.write("usage: node scripts/play-headless.mjs --cassette <file.json>\n");
  process.exit(2);
}

let playCore;
try {
  playCore = await import(pathToFileURL(dist).href);
} catch {
  buildDeps();
  playCore = await import(`${pathToFileURL(dist).href}?built=${Date.now()}`);
}
const { loadCassette, playCassette } = playCore;
const cassette = loadCassette(readFileSync(path, "utf8"));
const state = playCassette(cassette);
if (!state.ending) {
  process.stderr.write("cassette produced no ending\n");
  process.exit(1);
}
process.stdout.write(`${state.ending}\n`);
