import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: "./",
  resolve: {
    alias: [
      {
        find: /^@ledring\/(.+)$/,
        replacement: path.resolve(__dirname, "../$1/src/index.ts"),
      },
    ],
  },
  build: {
    outDir: "../../docs/play",
    emptyOutDir: true,
  },
});
