// Prepare and undo the files that exist only while `pnpm pack` / `pnpm publish` runs.
// pnpm reads this directory after prepack, so the packed manifest must not list
// unpublished workspace libraries or a build script whose file is not shipped.
import { copyFileSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const licenseDest = join(cliRoot, "LICENSE");
const licenseSrc = join(cliRoot, "../../LICENSE");
const pkgPath = join(cliRoot, "package.json");
const backupPath = join(cliRoot, "package.json.pack-backup");

// writeFileSync truncates the destination first. Vitest runs the MCP tests at the
// same time as `pnpm pack`, and those tests read this package.json for the server
// version. A rename keeps that read on one complete file.
function replaceFile(path, contents) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, contents);
  renameSync(tmp, path);
}

if (process.argv.includes("--remove")) {
  rmSync(licenseDest, { force: true });
  if (existsSync(backupPath)) {
    replaceFile(pkgPath, readFileSync(backupPath));
    rmSync(backupPath, { force: true });
  }
} else {
  if (!existsSync(backupPath)) copyFileSync(pkgPath, backupPath);
  const pkg = JSON.parse(readFileSync(backupPath, "utf8"));
  delete pkg.devDependencies;
  delete pkg.scripts;
  replaceFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  copyFileSync(licenseSrc, licenseDest);
}
