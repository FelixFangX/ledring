// Packs every public workspace package and checks the Pages build. Does not publish.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

/** @param {string} repo @param {string} dest */
export function releaseDryRun(repo, dest) {
  const pages = pagesBuildError(repo);
  if (pages) return { ok: false, errors: [pages], tarballs: [] };
  const dirs = packablePackageDirs(repo);
  for (const name of dirs) {
    execFileSync("pnpm", ["pack", "--pack-destination", dest], {
      cwd: join(repo, "packages", name),
      stdio: "inherit",
    });
  }
  const tarballs = readdirSync(dest)
    .filter((name) => name.endsWith(".tgz"))
    .sort();
  if (tarballs.length !== dirs.length) {
    return {
      ok: false,
      errors: [`release dry-run failed: expected ${dirs.length} tarballs, found ${tarballs.length}`],
      tarballs,
    };
  }
  return { ok: true, errors: [], tarballs };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const dest = mkdtempSync(join(tmpdir(), "ledring-pack-"));
  const result = releaseDryRun(root, dest);
  if (!result.ok) {
    for (const error of result.errors) console.error(error);
    process.exit(1);
  }
  console.log(result.tarballs.join("\n"));
  console.log("docs/play/index.html");
}
