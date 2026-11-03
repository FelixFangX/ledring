import { nodeIO } from "../src/io.js";
import type { IO } from "@ledring/cli";

/** Real filesystem, captured stdout/stderr. */
export function nodeIOForTest(): IO & { stdout(): string; stderr(): string } {
  let o = "";
  let e = "";
  return { ...nodeIO, out: (t) => void (o += t), err: (t) => void (e += t), stdout: () => o, stderr: () => e };
}
