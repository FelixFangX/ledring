import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const pkgs = readdirSync(new URL("./packages", import.meta.url));
const alias = Object.fromEntries(
  pkgs.map((p) => [`@ledring/${p}`, fileURLToPath(new URL(`./packages/${p}/src/index.ts`, import.meta.url))]),
);

export default defineConfig({
  resolve: { alias },
  test: { include: ["packages/*/test/**/*.test.ts"] },
});
