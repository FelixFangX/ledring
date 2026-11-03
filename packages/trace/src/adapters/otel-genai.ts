import { TRACE_SCHEMA, type Run, type Step, type StepKind } from "../schema.js";
import { signatureOf } from "../signature.js";
import { firstJson, jsonLines } from "./jsonl.js";
import type { Adapter } from "./types.js";

interface AnyValue { stringValue?: string; intValue?: string | number; doubleValue?: number; boolValue?: boolean; arrayValue?: { values?: AnyValue[] } }
interface Span { traceId: string; spanId: string; parentSpanId?: string; name: string; startTimeUnixNano?: string; endTimeUnixNano?: string; attributes?: { key: string; value: AnyValue }[]; status?: { code?: number | string } }
interface Batch { resourceSpans?: { scopeSpans?: { spans?: Span[] }[] }[] }

const KIND: Record<string, StepKind> = {
  execute_tool: "tool", chat: "llm", text_completion: "llm", generate_content: "llm", embeddings: "llm",
  invoke_agent: "agent", create_agent: "agent", plan: "plan", handoff: "handoff",
};

function val(v: AnyValue): unknown {
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.intValue !== undefined) return Number(v.intValue);
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.boolValue !== undefined) return v.boolValue;
  if (v.arrayValue) return (v.arrayValue.values ?? []).map(val);
  return undefined;
}
const attrs = (s: Span) => Object.fromEntries((s.attributes ?? []).map((a) => [a.key, val(a.value)]));
const iso = (ns?: string) => (ns ? new Date(Number(BigInt(ns) / 1_000_000n)).toISOString() : undefined);
const isError = (s: Span) => s.status?.code === 2 || s.status?.code === "STATUS_CODE_ERROR";
const json = (v: unknown) => { if (typeof v !== "string") return v; try { return JSON.parse(v); } catch { return v; } };

/** First user text from `gen_ai.input.messages` (parts) or legacy `content`. */
function userText(messages: unknown): string | undefined {
  const arr = json(messages);
  if (!Array.isArray(arr)) return undefined;
  for (const m of arr as { role?: string; parts?: { type?: string; content?: string }[]; content?: string }[]) {
    if (m.role !== "user") continue;
    const t = m.parts?.find((p) => p.type === "text")?.content ?? m.content;
    if (t) return t;
  }
  return undefined;
}

function spansOf(text: string): Span[] {
  const whole = firstJson(text) as Batch | undefined;
  const batches: Batch[] = whole && text.trim().startsWith("{") && (() => { try { JSON.parse(text); return true; } catch { return false; } })() ? [whole] : (jsonLines(text) as Batch[]);
  return batches.flatMap((b) => (b.resourceSpans ?? []).flatMap((r) => (r.scopeSpans ?? []).flatMap((s) => s.spans ?? [])));
}

/** OTLP/JSON export of OpenTelemetry GenAI semantic-convention spans. */
export const otelGenAI: Adapter = {
  name: "otel-genai",
  detect(text) {
    const first = firstJson(text) as Batch | undefined;
    return !!first && typeof first === "object" && Array.isArray(first.resourceSpans);
  },
  parse(text, opts = {}) {
    const byTrace = new Map<string, Span[]>();
    for (const s of spansOf(text)) byTrace.set(s.traceId, [...(byTrace.get(s.traceId) ?? []), s]);
    return [...byTrace.entries()].map(([traceId, spans]) => {
      spans.sort((a, b) => (BigInt(a.startTimeUnixNano ?? "0") < BigInt(b.startTimeUnixNano ?? "0") ? -1 : 1));
      const ids = new Set(spans.map((s) => s.spanId));
      const roots = spans.filter((s) => !s.parentSpanId || !ids.has(s.parentSpanId));
      const root = roots[0];
      const rootAttrs = root ? attrs(root) : {};
      const steps: Step[] = [];
      let instruction: string | undefined;
      let agentName = rootAttrs["gen_ai.agent.name"] as string | undefined;
      let model = rootAttrs["gen_ai.request.model"] as string | undefined;
      for (const s of spans) {
        const a = attrs(s);
        instruction ??= userText(a["gen_ai.input.messages"]) ?? userText(a["gen_ai.prompt"]);
        agentName ??= a["gen_ai.agent.name"] as string | undefined;
        model ??= a["gen_ai.request.model"] as string | undefined;
        const op = String(a["gen_ai.operation.name"] ?? "");
        const kind = KIND[op];
        if (!kind || (s === root && kind === "agent")) continue;
        const name = kind === "tool" ? String(a["gen_ai.tool.name"] ?? s.name.replace(/^execute_tool\s+/, "")) : kind === "agent" ? String(a["gen_ai.agent.name"] ?? s.name) : kind === "llm" ? String(a["gen_ai.request.model"] ?? s.name) : s.name;
        const input = kind === "tool" ? json(a["gen_ai.tool.call.arguments"]) : undefined;
        const step: Step = { id: s.spanId, kind, name, signature: kind === "llm" ? `llm(${name})` : signatureOf(name, input), startedAt: iso(s.startTimeUnixNano), endedAt: iso(s.endTimeUnixNano) };
        if (s.parentSpanId) step.parentId = s.parentSpanId;
        if (input !== undefined) step.input = input;
        const out = a["gen_ai.tool.call.result"];
        if (out !== undefined) step.output = json(out);
        if (isError(s)) step.isError = true;
        if (opts.keepRaw) step.raw = s;
        steps.push(step);
      }
      const run: Run = { schema: TRACE_SCHEMA, id: traceId, source: "otel-genai", steps, outcome: root ? (isError(root) ? "failure" : "success") : "unknown", startedAt: iso(root?.startTimeUnixNano), endedAt: iso(root?.endTimeUnixNano) };
      if (instruction ?? rootAttrs["gen_ai.system_instructions"]) run.instruction = instruction ?? String(rootAttrs["gen_ai.system_instructions"]);
      if (agentName || model) run.agent = { ...(agentName ? { name: agentName } : {}), ...(model ? { model } : {}) };
      return run;
    });
  },
};
