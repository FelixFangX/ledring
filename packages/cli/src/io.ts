import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export interface IO {
  out(text: string): void;
  err(text: string): void;
  readFile(path: string): string;
  writeFile(path: string, text: string): void;
  /** Expand directories into the trace files they contain. */
  expand(paths: string[]): string[];
}

export const nodeIO: IO = {
  out: (t) => void process.stdout.write(t),
  err: (t) => void process.stderr.write(t),
  readFile: (p) => readFileSync(p, "utf8"),
  writeFile: (p, t) => writeFileSync(p, t),
  expand: (paths) =>
    paths.flatMap((p) =>
      statSync(p).isDirectory()
        ? readdirSync(p).filter((f) => /\.(jsonl|json)$/.test(f)).sort().map((f) => join(p, f))
        : [resolve(p)],
    ),
};
