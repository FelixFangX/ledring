import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { checkContracts } from "../../../scripts/capability-contracts.mjs";
import { packablePackageDirs, pagesBuildError } from "../../../scripts/release-dry-run.mjs";
import { menuFrameError, recordVisualFailure } from "../../../scripts/visual-diff.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "ledring-contracts-"));
  for (const [path, body] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
  }
  return dir;
}

describe("capability contracts", () => {
  it("accepts the providers that ship with a handler, docs, and a test", () => {
    const result = checkContracts(root);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    const ran = spawnSync(process.execPath, ["scripts/capability-contracts.mjs"], { cwd: root, encoding: "utf8" });
    expect(ran.status).toBe(0);
    expect(ran.stdout).toMatch(/capability contracts ok/);
  });

  it("fails with a clear message when a provider has no contract test", () => {
    const dir = fixture({
      "packages/play-providers/src/provider.ts": 'export const PROVIDER_IDS = ["demo", "ghost"] as const;\nexport const demo = { id: "demo" };\n',
      "packages/play-providers/src/ghost.ts": 'export const ghost = { id: "ghost" };\n',
      "packages/play-providers/README.md": "Providers: `demo`, `ghost`.\n",
      "packages/play-providers/test/provider.test.ts": 'describe("demo", () => {});\n',
    });
    const result = checkContracts(dir);
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(['capability contract failed: provider "ghost" has no contract test']);
  });

  it("names a missing handler and missing docs", () => {
    const dir = fixture({
      "packages/play-providers/src/provider.ts": 'export const PROVIDER_IDS = ["ghost"] as const;\n',
      "packages/play-providers/README.md": "No providers listed.\n",
      "packages/play-providers/test/provider.test.ts": 'describe("ghost", () => {});\n',
    });
    const result = checkContracts(dir);
    expect(result.errors).toEqual([
      'capability contract failed: provider "ghost" has no handler',
      'capability contract failed: provider "ghost" has no docs',
    ]);
  });
});

describe("release dry-run", () => {
  it("packs public packages and requires the Pages build", () => {
    const dirs = packablePackageDirs(root);
    expect(dirs).toContain("play-core");
    expect(dirs).toContain("cli");
    expect(dirs).not.toContain("play-web");
    expect(pagesBuildError(root)).toBeNull();
    const empty = mkdtempSync(join(tmpdir(), "ledring-pages-"));
    mkdirSync(join(empty, "packages"), { recursive: true });
    expect(pagesBuildError(empty)).toBe("release dry-run failed: docs/play/index.html is missing");
  });
});

describe("visual diff artifacts", () => {
  it("rejects a collapsed menu frame and writes the diff files CI uploads", () => {
    expect(menuFrameError({ width: 1180, height: 760 }, { width: 1280, height: 800 })).toBeNull();
    expect(menuFrameError({ width: 390, height: 760 }, { width: 390, height: 844 })).toBeNull();
    expect(menuFrameError({ width: 20, height: 10 }, { width: 1280, height: 800 })).toMatch(/desktop menu/);
    const dir = mkdtempSync(join(tmpdir(), "ledring-visual-"));
    recordVisualFailure(dir, [{ name: "menu-desktop", png: Buffer.from("png"), note: "desktop menu 20x10" }]);
    expect(readFileSync(join(dir, "diff.txt"), "utf8")).toContain("desktop menu 20x10");
    expect(readFileSync(join(dir, "menu-desktop.png"), "utf8")).toBe("png");
    const ci = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");
    expect(ci).toContain("play-visual-diff/");
    expect(ci).toContain("if: failure()");
    expect(ci).toContain("actions/upload-artifact@v4");
  });
});
