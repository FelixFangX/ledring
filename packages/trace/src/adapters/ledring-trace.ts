import { TRACE_SCHEMA, type Run } from "../schema.js";
import { signatureOf } from "../signature.js";
import { firstJson, jsonLines } from "./jsonl.js";
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
  parse(text) {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      value = jsonLines(text);
    }
    const runs: unknown[] = Array.isArray(value) ? value : [value];
    return runs.map((run) => {
      if (!isObject(run) || !Array.isArray(run.steps)) return run as Run;
      return {
        ...run,
        steps: run.steps.map((step: unknown) => {
          if (!isObject(step) || step.signature !== undefined || typeof step.name !== "string") return step;
          return { ...step, signature: signatureOf(step.name, step.input) };
        }),
      } as Run;
    });
  },
};
