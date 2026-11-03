import { readFileSync } from "node:fs";

/** Package version. Resolved from the workspace package, and from the staged npm package when bundled. */
export const VERSION = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;
