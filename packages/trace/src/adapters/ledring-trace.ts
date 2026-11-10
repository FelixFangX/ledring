import { TRACE_SCHEMA, type Run } from "../schema.js";
import { signatureOf } from "../signature.js";
import { firstJson, readJsonLines } from "./jsonl.js";
import type { Adapter } from "./types.js";

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Native normalized runs, with optional signatures filled before RunSchema validation. */
export const ledringTrace: Adapter = {
  name: "ledring-trace",
  detect(text) {
    const value = firstJson(text);
    const first: unknown = Array.isArray(value) ? value[0] : value;
    return isObject(first) && first.schema === TRACE_SCHEMA;
  },
  parse(text, opts = {}) {
    let records: { line?: number; value: unknown }[];
    let truncated = false;
    try {
      records = [{ value: JSON.parse(text) }];
    } catch {
      const read = readJsonLines(text);
      truncated = read.truncated;
      records = read.records;
    }
    return records.flatMap((record) => {
      const runs: unknown[] = Array.isArray(record.value) ? record.value : [record.value];
      return runs.map((run) => {
        if (!isObject(run) || !Array.isArray(run.steps)) return run as Run;
        const next: Run = {
          ...run,
          steps: run.steps.map((step: unknown) => {
            if (!isObject(step)) return step;
            const filled = step.signature !== undefined || typeof step.name !== "string" ? step : { ...step, signature: signatureOf(step.name, step.input) };
            if (isObject(filled) && filled.provenance === undefined && (opts.filename || record.line)) {
              return { ...filled, provenance: { ...(opts.filename ? { file: opts.filename } : {}), ...(record.line ? { line: record.line } : {}) } };
            }
            return filled;
          }),
        } as Run;
        if (truncated) next.truncated = true;
        return next;
      });
    });
  },
};
