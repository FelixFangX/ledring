// A provider id is shipped only when a handler, docs, and a contract test all exist.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

export function providerIds(source) {
  const match = source.match(/export const PROVIDER_IDS = \[([\s\S]*?)\] as const/);
  if (!match) return null;
  return [...match[1].matchAll(/"([^"]+)"/g)].map((hit) => hit[1]);
}

function readTypeScript(dir) {
  const files = [];
  const walk = (current) => {
    for (const name of readdirSync(current)) {
      const path = join(current, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith(".ts")) files.push(readFileSync(path, "utf8"));
    }
  };
  walk(dir);
  return files.join("\n");
}

function mentions(corpus, id) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`["'\`][^"'\`]*(?:${escaped})[^"'\`]*["'\`]`).test(corpus);
}

/** @returns {{ ok: boolean, errors: string[] }} */
export function checkContracts(repo) {
  const providerPath = join(repo, "packages/play-providers/src/provider.ts");
  let source = "";
  try {
    source = readFileSync(providerPath, "utf8");
  } catch {
    return {
      ok: false,
      errors: ["capability contract failed: PROVIDER_IDS is missing from packages/play-providers/src/provider.ts"],
    };
  }
  const ids = providerIds(source);
  if (!ids) {
    return {
      ok: false,
      errors: ["capability contract failed: PROVIDER_IDS is missing from packages/play-providers/src/provider.ts"],
    };
  }
  const src = readTypeScript(join(repo, "packages/play-providers/src"))
    .split("\n")
    .filter((line) => !line.includes("PROVIDER_IDS"))
    .join("\n");
  const readme = readFileSync(join(repo, "packages/play-providers/README.md"), "utf8");
  const tests = readTypeScript(join(repo, "packages/play-providers/test"));
  const errors = [];
  for (const id of ids) {
    if (!mentions(src, id)) errors.push(`capability contract failed: provider "${id}" has no handler`);
    if (!mentions(readme, id)) errors.push(`capability contract failed: provider "${id}" has no docs`);
    if (!mentions(tests, id)) errors.push(`capability contract failed: provider "${id}" has no contract test`);
  }
  return { ok: errors.length === 0, errors };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const result = checkContracts(root);
  if (!result.ok) {
    for (const error of result.errors) console.error(error);
    process.exit(1);
  }
  console.log(`capability contracts ok (${providerIds(readFileSync(join(root, "packages/play-providers/src/provider.ts"), "utf8"))?.length ?? 0} providers)`);
}
