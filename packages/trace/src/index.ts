import { claudeCode } from "./adapters/claude-code.js";
import { otelGenAI } from "./adapters/otel-genai.js";
import type { Adapter, ParseOptions } from "./adapters/types.js";
import { RunSchema, type Run } from "./schema.js";

export { TRACE_SCHEMA, RunSchema, StepSchema, StepKind, type Run, type Step } from "./schema.js";
export { signatureOf, pathsOf } from "./signature.js";
export type { Adapter, ParseOptions } from "./adapters/types.js";

/** Built-in adapters, tried in order during auto-detection. */
export const adapters: readonly Adapter[] = [claudeCode, otelGenAI];

export interface ParseTraceOptions extends ParseOptions {
  /** Force an adapter by name instead of auto-detecting. */
  adapter?: string;
  /** Extra adapters to try before the built-ins. */
  extraAdapters?: readonly Adapter[];
}

/** Parse raw trace text into validated `ledring.trace.v1` runs. */
export function parseTrace(text: string, opts: ParseTraceOptions = {}): Run[] {
  const all = [...(opts.extraAdapters ?? []), ...adapters];
  let adapter: Adapter | undefined;
  if (opts.adapter) {
    adapter = all.find((a) => a.name === opts.adapter);
    if (!adapter) throw new Error(`Unknown adapter "${opts.adapter}". Available: ${all.map((a) => a.name).join(", ")}`);
    if (!adapter.detect(text, opts.filename)) throw new Error(`Input${opts.filename ? ` ${opts.filename}` : ""} does not look like ${adapter.name}`);
  } else {
    adapter = all.find((a) => a.detect(text, opts.filename));
    if (!adapter) throw new Error(`No adapter recognised${opts.filename ? ` ${opts.filename}` : " the input"}. Tried: ${all.map((a) => a.name).join(", ")}`);
  }
  return adapter.parse(text, opts).map((r) => RunSchema.parse(r));
}
