// Stages the npm package `ledring` (a bundle of the workspace CLI) and smoke-tests it.
// Does not publish. `workspace:*` dependencies are inlined, except the local Play bridge.
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

export const BETA_VERSION = "0.2.0-beta.0";

const root = fileURLToPath(new URL("..", import.meta.url));

/** @param {Record<string, unknown>} manifest */
export function publishedManifestErrors(manifest) {
  /** @type {string[]} */
  const errors = [];
  if (JSON.stringify(manifest).includes("workspace:")) errors.push("manifest contains workspace:");
  if (manifest.version !== BETA_VERSION) errors.push(`version is ${String(manifest.version)}, expected ${BETA_VERSION}`);
  if (manifest.private === true) errors.push("package is private");
  return errors;
}

/** @param {Record<string, any>} manifest */
export function ledringManifestErrors(manifest) {
  /** @type {string[]} */
  const errors = publishedManifestErrors(manifest);
  if (manifest.name !== "ledring") errors.push(`name is ${String(manifest.name)}, expected ledring`);
  if (manifest.type !== "module") errors.push('type must be "module"');
  if (manifest.bin?.ledring !== "./dist/bin.js") errors.push("bin ledring must be ./dist/bin.js");
  for (const field of ["dependencies", "optionalDependencies", "peerDependencies", "bundleDependencies"]) {
    const value = manifest[field];
    if (value && Object.keys(value).length > 0) errors.push(`${field} must be empty (${Object.keys(value).join(", ")})`);
  }
  return errors;
}

/** @param {string} version */
export function ledringPackageManifest(version) {
  return {
    name: "ledring",
    version,
    description: "Branch tree and instability score for AI agent traces. Public Beta.",
    license: "MIT",
    type: "module",
    bin: { ledring: "./dist/bin.js" },
    files: ["dist", "README.md"],
    engines: { node: ">=20" },
    keywords: ["ledring", "ai", "agents", "mcp", "traces", "instability", "flowchart"],
    homepage: "https://ledring.dev",
    bugs: { url: "https://github.com/FelixFangX/ledring/issues" },
    repository: { type: "git", url: "git+https://github.com/FelixFangX/ledring.git", directory: "packages/cli" },
  };
}

/**
 * @param {string} repo
 * @param {string} dest directory that becomes the publishable package
 */
export async function stageLedring(repo, dest) {
  const cli = JSON.parse(readFileSync(join(repo, "packages/cli/package.json"), "utf8"));
  if (cli.version !== BETA_VERSION) throw new Error(`@ledring/cli is ${cli.version}, expected ${BETA_VERSION}`);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(join(dest, "dist"), { recursive: true });
  const manifest = ledringPackageManifest(cli.version);
  writeFileSync(join(dest, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
  cpSync(join(repo, "packages/cli/README.md"), join(dest, "README.md"));
  cpSync(join(repo, "LICENSE"), join(dest, "LICENSE"));
  await esbuild.build({
    absWorkingDir: repo,
    entryPoints: ["packages/cli/src/bin.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    outfile: join(dest, "dist/bin.js"),
    external: ["@ledring/play-bridge"],
    legalComments: "eof",
    logLevel: "silent",
  });
  chmodSync(join(dest, "dist/bin.js"), 0o755);
  return manifest;
}

/**
 * Runs the staged or extracted package the way a Beta install would.
 * @param {string} stage directory containing package.json and dist/bin.js
 * @param {string} repo
 * @returns {string[]}
 */
export function smokeLedring(stage, repo) {
  /** @type {string[]} */
  const errors = [];
  const manifest = JSON.parse(readFileSync(join(stage, "package.json"), "utf8"));
  for (const error of ledringManifestErrors(manifest)) errors.push(error);
  const bin = join(stage, "dist/bin.js");
  const bundled = readFileSync(bin, "utf8");
  if (!bundled.startsWith("#!/usr/bin/env node\n")) errors.push("dist/bin.js is missing its shebang");
  if (bundled.includes("workspace:")) errors.push("bundle contains workspace:");
  const leaked = bundled.match(/@ledring\/(?!play-bridge\b)[a-z0-9-]+/g);
  if (leaked) errors.push(`bundle still imports ${[...new Set(leaked)].join(", ")}`);
  const run = (args) => spawnSync(process.execPath, [bin, ...args], { encoding: "utf8", timeout: 20000 });
  const help = run(["--help"]);
  if (help.status !== 0) errors.push(`ledring --help exited ${help.status}: ${help.stderr}`);
  else {
    for (const needle of ["flowchart", "instability", "ledring mcp", "0.2.0-beta.0", "claude-code"]) {
      if (!help.stdout.includes(needle)) errors.push(`--help missing ${needle}`);
    }
  }
  const report = join(stage, "report.html");
  const flow = run(["flowchart", join(repo, "fixtures/claude-code"), "--title", "fix login bug", "--out", report]);
  if (flow.status !== 0) errors.push(`flowchart exited ${flow.status}: ${flow.stderr}`);
  else if (!flow.stdout.includes("runs")) errors.push(`flowchart stdout unexpected: ${flow.stdout}`);
  else if (!readFileSync(report, "utf8").includes("fix login bug")) errors.push("flowchart report missing title");
  const score = run(["instability", join(repo, "fixtures/claude-code/run-5.jsonl")]);
  if (score.status !== 0 || !score.stdout.includes("PROCESSING")) errors.push(`instability unexpected: ${score.stdout}${score.stderr}`);
  const mcp = run(["mcp"]);
  if (mcp.status !== 0) errors.push(`mcp exited ${mcp.status}: ${mcp.stderr}`);
  const play = run(["play", "--print-config"]);
  if (play.status !== 1 || !play.stderr.includes("https://play.ledring.dev/play/")) {
    errors.push(`play should explain the hosted demo, got ${play.status}: ${play.stderr}`);
  }
  return errors;
}

/** @param {string} stage @param {string} destDir */
export function packLedring(stage, destDir) {
  mkdirSync(destDir, { recursive: true });
  execFileSync("npm", ["pack", "--pack-destination", destDir], { cwd: stage, stdio: "inherit" });
  return join(destDir, `ledring-${BETA_VERSION}.tgz`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const dest = join(root, "build/npm/ledring");
  const manifest = await stageLedring(root, dest);
  const packed = packLedring(dest, join(root, "build/npm"));
  const extract = join(tmpdir(), "ledring-beta-extract");
  rmSync(extract, { recursive: true, force: true });
  mkdirSync(extract, { recursive: true });
  execFileSync("tar", ["-xzf", packed, "-C", extract]);
  const errors = smokeLedring(join(extract, "package"), root);
  if (errors.length) {
    for (const error of errors) console.error(error);
    process.exit(1);
  }
  console.log(`staged ${manifest.name}@${manifest.version}`);
  console.log(packed);
  console.log("smoke ok: --help, flowchart, instability, mcp, play");
}
