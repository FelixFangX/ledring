import { RunSchema, type Run, type Step } from "@ledring/trace";
import { INSTABILITY_VERSION, emptySignals, type Signals } from "./instability.js";
import type { PlayEvent, PlayState } from "./machine.js";
import { PROMPT_VERSION } from "./prompts.js";

/** Play fields that `RunSchema` would strip. Attach this only after `RunSchema.parse`. */
export interface PlayTraceExtension {
  ending?: string;
  signals: Signals;
  blocked: string[];
  allowed: string[];
  promptVersion: string;
  instabilityVersion: string;
  judge?: unknown;
}

export type PlayRun = Run & { "x-ledring-play": PlayTraceExtension };

function step(id: string, fields: Omit<Step, "id">): Step {
  return { id, ...fields };
}

function extension(state: PlayState): PlayTraceExtension {
  const judge = [...state.events].reverse().find((event) => event.type === "judge");
  return {
    ...(state.ending ? { ending: state.ending } : {}),
    signals: state.signals,
    blocked: [...state.blocked],
    allowed: [...state.allowed],
    promptVersion: state.promptVersion,
    instabilityVersion: state.instabilityVersion,
    ...(judge?.type === "judge" ? { judge: judge.facts } : {}),
  };
}

function stepsFrom(events: readonly PlayEvent[]): Step[] {
  const steps: Step[] = [];
  for (const event of events) {
    const id = `s${steps.length + 1}`;
    if (event.type === "plan") {
      steps.push(step(id, { kind: "plan", name: "plan", signature: "plan", output: { text: event.text.slice(0, 4000) } }));
    } else if (event.type === "wall") {
      steps.push(step(id, {
        kind: "human",
        name: "red-wall",
        signature: `wall:${event.action}`,
        decision: { verdict: event.action === "allow" ? "allow" : "deny", by: event.by },
      }));
    } else if (event.type === "choose") {
      steps.push(step(id, {
        kind: "human",
        name: "qte",
        signature: `choice:${event.id}`,
        decision: { verdict: event.id === "plug" ? "deny" : "allow", by: event.by, reason: event.id },
      }));
    } else if (event.type === "artifact") {
      steps.push(step(id, {
        kind: "tool",
        name: "write_file",
        signature: "write_file:index.html",
        output: { bytes: event.html.length },
      }));
    } else if (event.type === "judge") {
      steps.push(step(id, { kind: "tool", name: "judge", signature: "judge", output: { facts: event.facts } }));
    }
  }
  return steps;
}

/** Map a Play session onto ledring.trace.v1. The extension is attached after validation. */
export function playTrace(state: PlayState): PlayRun {
  const run = RunSchema.parse({
    schema: "ledring.trace.v1",
    id: state.id,
    source: "ledring-play",
    instruction: state.idea,
    agent: { name: "CX-417" },
    outcome: state.ending === "POLISHED" || state.ending === "SHIPPED" ? "success" : state.ending ? "failure" : "unknown",
    steps: stepsFrom(state.events),
  });
  return { ...run, "x-ledring-play": extension(state) };
}

export interface StreamLogEvent {
  id: number;
  event: string;
  data: unknown;
}

/** Trace for a bridge session that only has streamed model deltas so far. */
export function streamTrace(id: string, events: readonly StreamLogEvent[]): PlayRun {
  const text = events
    .filter((event) => event.event === "delta")
    .map((event) => {
      const data = event.data as { text?: unknown } | null;
      return typeof data?.text === "string" ? data.text : "";
    })
    .join("");
  const failed = events.some((event) => event.event === "error");
  const steps: Step[] = text || failed
    ? [step("s1", { kind: "llm", name: "provider", signature: "llm", ...(text ? { output: { text } } : {}), ...(failed ? { isError: true } : {}) })]
    : [];
  const run = RunSchema.parse({
    schema: "ledring.trace.v1",
    id,
    source: "ledring-play",
    agent: { name: "CX-417" },
    outcome: failed ? "failure" : "unknown",
    steps,
  });
  return {
    ...run,
    "x-ledring-play": {
      signals: emptySignals(),
      blocked: [],
      allowed: [],
      promptVersion: PROMPT_VERSION,
      instabilityVersion: INSTABILITY_VERSION,
    },
  };
}
