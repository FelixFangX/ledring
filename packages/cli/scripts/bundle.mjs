// Bundle the `ledring` command so one npm package runs without workspace installs.
// Workspace libraries are inlined from source. npm dependencies stay external.
// `@ledring/play-bridge` stays external: it pulls in Playwright, and the local
// Play bridge is a source checkout, not part of the Beta install.
import { chmodSync, copyFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(cliRoot, "../..");
const outdir = join(cliRoot, "dist");

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

const workspaceEntry = (specifier) => {
  const name = specifier.slice("@ledring/".length);
  if (name.includes("/")) return null;
  return join(repoRoot, "packages", name, "src", "index.ts");
};

await esbuild.build({
  absWorkingDir: cliRoot,
  entryPoints: ["src/bin.ts", "src/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outdir,
  packages: "external",
  legalComments: "none",
  plugins: [
    {
      name: "bundle-workspace",
      setup(build) {
        build.onResolve({ filter: /^@ledring\// }, (args) => {
          if (args.path === "@ledring/play-bridge") return { path: args.path, external: true };
          const entry = workspaceEntry(args.path);
          if (!entry) return { path: args.path, external: true };
          return { path: entry };
        });
      },
    },
  ],
});

copyFileSync(join(cliRoot, "published-types.d.ts"), join(outdir, "index.d.ts"));
chmodSync(join(outdir, "bin.js"), 0o755);
