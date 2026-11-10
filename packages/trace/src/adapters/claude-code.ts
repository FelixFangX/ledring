import { TRACE_SCHEMA, type Decision, type Run, type Step } from "../schema.js";
import { signatureOf } from "../signature.js";
import { firstJson, readJsonLines } from "./jsonl.js";
import type { Adapter } from "./types.js";

interface Block { type?: string; id?: string; name?: string; input?: unknown; text?: string; tool_use_id?: string; content?: unknown; is_error?: boolean }
interface Line { cwd?: string; toolUseResult?: unknown; tool_result_meta?: { non_execution_kind?: string }[]; toolResultMeta?: { non_execution_kind?: string }[]; type?: string; uuid?: string; parentUuid?: string | null; sessionId?: string; timestamp?: string; isSidechain?: boolean; message?: { role?: string; model?: string; content?: string | Block[] } }

const REJECTED = "The user doesn't want to proceed with this tool use";
const REASON = "the user said:\n";

/**
 * Claude Code reports a refused tool call with a fixed text. The same text is also used for
 * interrupts and some policy denials, so `by` is only `human` when the transcript says so.
 */
function decisionOf(line: Line, text: string | undefined): Decision | undefined {
  if (!text?.startsWith(REJECTED)) return undefined;
  const kind = [...(line.tool_result_meta ?? []), ...(line.toolResultMeta ?? [])].find((m) => m?.non_execution_kind)?.non_execution_kind;
  const at = text.indexOf(REASON);
  const reason = at >= 0 ? text.slice(at + REASON.length).trim() : undefined;
  let by: Decision["by"] = "unknown";
  if (kind === "user-rejected" || line.toolUseResult === "User rejected tool use" || reason) by = "human";
  if (kind && kind !== "user-rejected") by = "policy";
  if (kind === "interrupted") return undefined;
  return reason ? { verdict: "deny", by, reason } : { verdict: "deny", by };
}

function textOf(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const t = content.map((b: Block) => (b?.type === "text" ? b.text : "")).filter(Boolean).join("\n");
    return t || undefined;
  }
  return undefined;
}

/** Claude Code session transcripts (`~/.claude/projects/<project>/<session>.jsonl`). */
export const claudeCode: Adapter = {
  name: "claude-code",
  detect(text) {
    const first = firstJson(text) as Line | undefined;
    if (!first || typeof first !== "object") return false;
    return ("sessionId" in first || "leafUuid" in first) && typeof first.type === "string";
  },
  parse(text, opts = {}) {
    const read = readJsonLines(text);
    const sidechains = new Map<string, number>();
    for (const record of read.records) {
      const line = record.value as Line;
      if ((line.type === "user" || line.type === "assistant") && line.isSidechain === true && line.message) {
        const key = line.sessionId ?? "session";
        sidechains.set(key, (sidechains.get(key) ?? 0) + 1);
      }
    }
    const lines = read.records.filter((record) => {
      const line = record.value as Line;
      return (line.type === "user" || line.type === "assistant") && !line.isSidechain && line.message;
    });
    const bySession = new Map<string, { line: number; value: Line }[]>();
    for (const record of lines) {
      const line = record.value as Line;
      const key = line.sessionId ?? "session";
      bySession.set(key, [...(bySession.get(key) ?? []), { line: record.line, value: line }]);
    }
    return [...bySession.entries()].map(([sessionId, records]) => {
      const steps: Step[] = [];
      const byToolId = new Map<string, Step>();
      let instruction: string | undefined;
      let model: string | undefined;
      for (const record of records) {
        const l = record.value;
        const content = l.message!.content;
        if (l.type === "user") {
          if (instruction === undefined && !(Array.isArray(content) && content.some((b) => b?.type === "tool_result"))) instruction = textOf(content);
          if (Array.isArray(content)) {
            for (const b of content) {
              if (b?.type !== "tool_result" || !b.tool_use_id) continue;
              const step = byToolId.get(b.tool_use_id);
              if (!step) continue;
              step.output = textOf(b.content) ?? b.content;
              const kind = [...(l.tool_result_meta ?? []), ...(l.toolResultMeta ?? [])].find((m) => m?.non_execution_kind)?.non_execution_kind;
              if (kind === "interrupted") step.nonExecution = "interrupted";
              else {
                const decision = decisionOf(l, textOf(b.content));
                if (decision) step.decision = decision;
              }
              step.isError = b.is_error === true;
              step.endedAt = l.timestamp;
              step.provenance = { ...step.provenance, resultLine: record.line, ...(l.uuid ? { resultEventId: l.uuid } : {}) };
            }
          }
        } else {
          model ??= l.message!.model;
          if (!Array.isArray(content)) continue;
          for (const b of content) {
            if (b?.type !== "tool_use" || !b.name) continue;
            const step: Step = {
              id: b.id ?? `${l.uuid}-${steps.length}`,
              kind: "tool",
              name: b.name,
              signature: signatureOf(b.name, b.input),
              input: b.input,
              startedAt: l.timestamp,
              provenance: { line: record.line, ...(opts.filename ? { file: opts.filename } : {}), ...(l.uuid ? { eventId: l.uuid } : {}) },
            };
            if (l.parentUuid) step.parentId = l.parentUuid;
            if (opts.keepRaw) step.raw = b;
            steps.push(step);
            if (b.id) byToolId.set(b.id, step);
          }
        }
      }
      const run: Run = { schema: TRACE_SCHEMA, id: opts.filename ? `${opts.filename}#${sessionId}` : sessionId, source: "claude-code", steps, outcome: "unknown", startedAt: records[0]?.value.timestamp, endedAt: records[records.length - 1]?.value.timestamp };
      if (read.truncated) run.truncated = true;
      const leftOut = sidechains.get(sessionId) ?? 0;
      if (leftOut > 0) run.omittedSidechains = leftOut;
      if (instruction !== undefined) run.instruction = instruction;
      if (model) run.agent = { model };
      const cwd = records.find((record) => record.value.cwd)?.value.cwd;
      if (cwd) run.cwd = cwd;
      return run;
    });
  },
};
