// Packs every public workspace package, checks the Pages build, and smoke-tests the
// bundled `ledring` npm package. Does not publish.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BETA_VERSION, packLedring, publishedManifestErrors, smokeLedring, stageLedring } from "./stage-beta.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

export function packablePackageDirs(repo) {
  return readdirSync(join(repo, "packages"))
    .filter((name) => {
      try {
        const pkg = JSON.parse(readFileSync(join(repo, "packages", name, "package.json"), "utf8"));
        return pkg.private !== true && typeof pkg.name === "string";
      } catch {
        return false;
      }
    })
    .sort();
}

export function pagesBuildError(repo) {
  return existsSync(join(repo, "docs/play/index.html"))
    ? null
    : "release dry-run failed: docs/play/index.html is missing";
}

/** @param {string} tarball @param {string} entry path inside the tarball, without the package/ prefix */
function tarballContains(tarball, entry) {
  const listing = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" });
  return listing.split("\n").includes(`package/${entry}`);
}

/** @param {string} repo @param {string} dest */
export async function releaseDryRun(repo, dest) {
  const pages = pagesBuildError(repo);
  if (pages) return { ok: false, errors: [pages], tarballs: [] };
  /** @type {string[]} */
  const errors = [];
  const dirs = packablePackageDirs(repo);
  for (const name of dirs) {
    const pkg = JSON.parse(readFileSync(join(repo, "packages", name, "package.json"), "utf8"));
    if (pkg.version !== BETA_VERSION) errors.push(`${pkg.name} is ${pkg.version}, expected ${BETA_VERSION}`);
    if (pkg.publishConfig?.access !== "public") errors.push(`${pkg.name} is missing publishConfig.access "public"`);
    execFileSync("pnpm", ["pack", "--pack-destination", dest], {
      cwd: join(repo, "packages", name),
      stdio: "inherit",
    });
  }
  const tarballs = readdirSync(dest)
    .filter((name) => name.endsWith(".tgz"))
    .sort();
  if (tarballs.length !== dirs.length) errors.push(`release dry-run failed: expected ${dirs.length} tarballs, found ${tarballs.length}`);
  for (const name of tarballs) {
    const tarball = join(dest, name);
    const manifest = JSON.parse(execFileSync("tar", ["-xOf", tarball, "package/package.json"], { encoding: "utf8" }));
    for (const error of publishedManifestErrors(manifest)) errors.push(`${name}: ${error}`);
    if (!tarballContains(tarball, "dist/index.js")) errors.push(`${name}: missing dist/index.js (run pnpm build before packing)`);
  }
  const stage = join(dest, "ledring-stage");
  await stageLedring(repo, stage);
  const packed = packLedring(stage, dest);
  tarballs.push(packed.slice(dest.length + 1));
  const extract = join(dest, "ledring-extract");
  rmSync(extract, { recursive: true, force: true });
  mkdirSync(extract, { recursive: true });
  execFileSync("tar", ["-xzf", packed, "-C", extract]);
  const packedManifest = JSON.parse(readFileSync(join(extract, "package/package.json"), "utf8"));
  if (JSON.stringify(packedManifest).includes("workspace:")) errors.push("ledring tarball contains workspace:");
  if (!tarballContains(packed, "dist/bin.js")) errors.push("ledring tarball is missing dist/bin.js");
  for (const error of smokeLedring(join(extract, "package"), repo)) errors.push(`ledring smoke: ${error}`);
  return { ok: errors.length === 0, errors, tarballs: tarballs.sort() };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const dest = mkdtempSync(join(tmpdir(), "ledring-pack-"));
  const result = await releaseDryRun(root, dest);
  if (!result.ok) {
    for (const error of result.errors) console.error(error);
    process.exit(1);
  }
  console.log(result.tarballs.join("\n"));
  console.log("docs/play/index.html");
}
