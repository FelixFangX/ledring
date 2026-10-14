import { TRACE_SCHEMA, type Run, type Step } from "../schema.js";
import { signatureOf } from "../signature.js";
import { firstJson, jsonLines } from "./jsonl.js";
import type { Adapter } from "./types.js";

interface Block { type?: string; id?: string; name?: string; input?: unknown; text?: string; tool_use_id?: string; content?: unknown; is_error?: boolean }
interface Line { type?: string; uuid?: string; parentUuid?: string | null; sessionId?: string; timestamp?: string; isSidechain?: boolean; message?: { role?: string; model?: string; content?: string | Block[] } }

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
    const lines = (jsonLines(text) as Line[]).filter((l) => (l.type === "user" || l.type === "assistant") && !l.isSidechain && l.message);
    const bySession = new Map<string, Line[]>();
    for (const l of lines) {
      const k = l.sessionId ?? "session";
      bySession.set(k, [...(bySession.get(k) ?? []), l]);
    }
    return [...bySession.entries()].map(([sessionId, ls]) => {
      const steps: Step[] = [];
      const byToolId = new Map<string, Step>();
      let instruction: string | undefined;
      let model: string | undefined;
      for (const l of ls) {
        const content = l.message!.content;
        if (l.type === "user") {
          if (instruction === undefined && !(Array.isArray(content) && content.some((b) => b?.type === "tool_result"))) instruction = textOf(content);
          if (Array.isArray(content)) {
            for (const b of content) {
              if (b?.type !== "tool_result" || !b.tool_use_id) continue;
              const step = byToolId.get(b.tool_use_id);
              if (!step) continue;
              step.output = textOf(b.content) ?? b.content;
              step.isError = b.is_error === true;
              step.endedAt = l.timestamp;
            }
          }
        } else {
          model ??= l.message!.model;
          if (!Array.isArray(content)) continue;
          for (const b of content) {
            if (b?.type !== "tool_use" || !b.name) continue;
            const step: Step = { id: b.id ?? `${l.uuid}-${steps.length}`, kind: "tool", name: b.name, signature: signatureOf(b.name, b.input), input: b.input, startedAt: l.timestamp };
            if (opts.keepRaw) step.raw = b;
            steps.push(step);
            if (b.id) byToolId.set(b.id, step);
          }
        }
      }
      const run: Run = { schema: TRACE_SCHEMA, id: opts.filename ? `${opts.filename}#${sessionId}` : sessionId, source: "claude-code", steps, outcome: "unknown", startedAt: ls[0]?.timestamp, endedAt: ls[ls.length - 1]?.timestamp };
      if (instruction !== undefined) run.instruction = instruction;
      if (model) run.agent = { model };
      return run;
    });
  },
};
