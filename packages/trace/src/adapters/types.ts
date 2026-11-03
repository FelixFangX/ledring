import type { Run } from "../schema.js";

export interface ParseOptions {
  filename?: string;
  /** Keep the source object on each step as `raw`. */
  keepRaw?: boolean;
}

/** One external trace format. Swappable: views only ever see `Run`. */
export interface Adapter {
  readonly name: string;
  /** Cheap check on the raw text; must not throw. */
  detect(text: string, filename?: string): boolean;
  parse(text: string, opts?: ParseOptions): Run[];
}
