import { DecisionSchema, TRACE_SCHEMA, type Run } from "../schema.js";
import { signatureOf } from "../signature.js";
import { firstJson, readJsonLines } from "./jsonl.js";
import type { Adapter } from "./types.js";

export const DECISIONS_SCHEMA = "ledring.decisions.v1";

interface Entry { schema?: string; run?: string; tool?: string; input?: unknown; verdict?: string; by?: string; reason?: string; at?: string }

/**
 * Portable log of permission decisions, one JSON object per line:
 * `{ "schema": "ledring.decisions.v1", "run": "r1", "tool": "Bash", "input": {…}, "verdict": "allow" | "deny", "by": "human" | "policy" | "unknown", "reason"?, "at"? }`.
 * Lets any framework (LangGraph interrupts, Agents SDK approvals, MCP proxies) feed the trust meter.
 */
export const decisionsLog: Adapter = {
  name: "ledring-decisions",
  detect(text) {
    return (firstJson(text) as Entry | undefined)?.schema === DECISIONS_SCHEMA;
  },
  parse(text, opts = {}) {
    const read = readJsonLines(text);
    const byRun = new Map<string, Run>();
    read.records.forEach((record, i) => {
      const e = record.value as Entry;
      if (e.schema !== DECISIONS_SCHEMA || !e.tool) return;
      const id = e.run ?? "decisions";
      const run = byRun.get(id) ?? { schema: TRACE_SCHEMA, id, source: "ledring-decisions", steps: [], outcome: "unknown" as const };
      byRun.set(id, run);
      const decision = DecisionSchema.parse({ verdict: e.verdict, by: e.by ?? "unknown", ...(e.reason ? { reason: e.reason } : {}) });
      run.steps.push({
        id: `${id}-${i}`,
        kind: "tool",
        name: e.tool,
        signature: signatureOf(e.tool, e.input),
        input: e.input,
        decision,
        provenance: { line: record.line, ...(opts.filename ? { file: opts.filename } : {}) },
        ...(e.at ? { startedAt: e.at } : {}),
      });
    });
    const runs = [...byRun.values()];
    if (read.truncated) for (const run of runs) run.truncated = true;
    return runs;
  },
};
