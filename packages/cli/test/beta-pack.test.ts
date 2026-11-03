import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const cliDir = join(root, "packages/cli");
const fixtures = join(root, "fixtures/claude-code");

function run(bin: string, args: string[], cwd: string) {
  return spawnSync(bin, args, { cwd, encoding: "utf8", timeout: 20_000 });
}

describe("ledring beta package", () => {
  const packDir = mkdtempSync(join(tmpdir(), "ledring-pack-"));
  const installDir = mkdtempSync(join(tmpdir(), "ledring-install-"));
  let tarball = "";
  let manifest: {
    name: string;
    version: string;
    license?: string;
    bin?: { ledring?: string };
    engines?: { node?: string };
    publishConfig?: { access?: string };
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
    files?: string[];
    repository?: { url?: string; directory?: string };
  };

  beforeAll(() => {
    execFileSync("pnpm", ["pack", "--pack-destination", packDir], { cwd: cliDir, stdio: "inherit" });
    const names = readdirSync(packDir).filter((name) => name.endsWith(".tgz"));
    expect(names).toHaveLength(1);
    tarball = join(packDir, names[0] ?? "");
    manifest = JSON.parse(execFileSync("tar", ["-xOf", tarball, "package/package.json"], { encoding: "utf8" }));
    writeFileSync(join(installDir, "package.json"), JSON.stringify({ name: "ledring-beta-smoke", private: true }));
    execFileSync(
      "npm",
      ["install", "--ignore-scripts", "--no-fund", "--no-audit", "--omit=dev", tarball],
      { cwd: installDir, stdio: "inherit", timeout: 120_000 },
    );
  }, 180_000);

  afterAll(() => {
    rmSync(packDir, { recursive: true, force: true });
    rmSync(installDir, { recursive: true, force: true });
  });

  it("packs a public ledring manifest with no workspace dependencies", () => {
    expect(manifest.name).toBe("ledring");
    expect(manifest.version).toBe("0.2.0-beta.0");
    expect(manifest.license).toBe("MIT");
    expect(manifest.engines?.node).toBe(">=20");
    expect(manifest.bin?.ledring).toBe("./dist/bin.js");
    expect(manifest.files).toEqual(expect.arrayContaining(["dist", "README.md", "LICENSE"]));
    expect(manifest.repository?.url).toContain("github.com/FelixFangX/ledring");
    expect(manifest.repository?.directory).toBe("packages/cli");
    expect(manifest.publishConfig).toEqual({ access: "public" });
    expect(manifest.devDependencies).toBeUndefined();
    expect(manifest.scripts).toBeUndefined();
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual(["@modelcontextprotocol/sdk", "zod"]);
    expect(JSON.stringify(manifest)).not.toContain("workspace:");
    const source = JSON.parse(readFileSync(join(cliDir, "package.json"), "utf8")) as { devDependencies?: Record<string, string> };
    expect(source.devDependencies?.["@ledring/play-bridge"]).toBe("workspace:*");
    const packed = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" });
    expect(packed).toContain("package/LICENSE");
    expect(packed).toContain("package/dist/bin.js");
    expect(packed).not.toContain("node_modules/");
    expect(existsSync(join(cliDir, "LICENSE"))).toBe(false);
  });

  it("bundles workspace libraries and leaves the Play bridge external", () => {
    const bin = readFileSync(join(cliDir, "dist/bin.js"), "utf8");
    expect(bin.startsWith("#!/usr/bin/env node")).toBe(true);
    expect(bin).not.toContain("@ledring/flowchart");
    expect(bin).not.toContain("playwright");
    expect(bin).toContain("@ledring/play-bridge");
    expect(statSync(join(cliDir, "dist/bin.js")).size).toBeLessThan(2_000_000);
    const types = readFileSync(join(cliDir, "dist/index.d.ts"), "utf8");
    expect(types).not.toContain("@ledring/");
    expect(types).toContain("export function run");
  });

  it("runs flowchart, instability, and mcp from a clean install", () => {
    const bin = join(installDir, "node_modules/.bin/ledring");
    const out = join(installDir, "report.html");
    const flow = run(bin, ["flowchart", fixtures, "--title", "fix login bug", "--out", out], installDir);
    expect(flow.status).toBe(0);
    expect(flow.stdout).toMatch(/Wrote .*report\.html — 6 runs, \d+ forks/);
    expect(readFileSync(out, "utf8")).toContain("fix login bug");
    const score = run(bin, ["instability", fixtures], installDir);
    expect(score.status).toBe(0);
    expect(score.stdout).toMatch(/CALM|PROCESSING|CRITICAL/);
    const mcp = run(bin, ["mcp"], installDir);
    expect(mcp.status).toBe(0);
    const installed = readdirSync(join(installDir, "node_modules"));
    expect(installed).toContain("zod");
    expect(installed).toContain("@modelcontextprotocol");
    expect(installed).not.toContain("playwright");
    expect(installed).not.toContain("@ledring");
  });

  it("points npm users at Play when the local bridge is not installed", () => {
    const bin = join(installDir, "node_modules/.bin/ledring");
    const play = run(bin, ["play", "--print-config", "--home", installDir], installDir);
    expect(play.status).toBe(1);
    expect(play.stderr).toContain("https://play.ledring.dev/play/");
    expect(play.stderr).not.toMatch(/sk-|api[_-]?key/i);
  });

  it("still runs the Play bridge from the workspace bundle", () => {
    execFileSync("pnpm", ["-r", "--filter", "@ledring/play-bridge...", "run", "build"], { cwd: root, stdio: "inherit" });
    const bin = join(cliDir, "dist/bin.js");
    const home = join(installDir, "empty-home");
    const play = spawnSync(process.execPath, [bin, "play", "--print-config", "--home", home], {
      cwd: installDir,
      encoding: "utf8",
      timeout: 20_000,
    });
    expect(play.status).toBe(0);
    expect(play.stdout).toContain("chatgpt-plan: disabled");
    expect(play.stdout).toContain("bind: 127.0.0.1");
  }, 120_000);
});
