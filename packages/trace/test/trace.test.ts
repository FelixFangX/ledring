import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { adapters, blockBasis, parseTrace, riskOf, RunSchema, signatureOf, TRACE_SCHEMA } from "@ledring/trace";

const fx = (p: string) => readFileSync(new URL(`../../../fixtures/${p}`, import.meta.url), "utf8");

describe("claude-code adapter", () => {
  it("turns a session file into one run with its instruction and tool steps", () => {
    const [run] = parseTrace(fx("claude-code/run-1.jsonl"), { filename: "run-1.jsonl" });
    expect(run!.source).toBe("claude-code");
    expect(run!.schema).toBe(TRACE_SCHEMA);
    expect(run!.instruction).toBe("Fix the login bug in src/auth. Don't change the tests.");
    expect(run!.agent?.model).toBe("claude-sonnet-4-5");
    expect(run!.steps.map((s) => s.signature)).toEqual(["Read(login.ts)", "Edit(login.ts)", "Bash(npm test)"]);
    expect(run!.steps[0]!.provenance).toEqual({ file: "run-1.jsonl", line: 2, eventId: "00000000-0000-4000-8000-000000000002", resultLine: 3, resultEventId: "00000000-0000-4000-8000-000000000003" });
    expect(run!.truncated).toBeUndefined();
    expect(RunSchema.parse(run)).toBeTruthy();
  });

  it("joins tool results to their calls and marks errors", () => {
    const [run] = parseTrace(fx("claude-code/run-3.jsonl"));
    const errored = run!.steps.filter((s) => s.isError);
    expect(errored).toHaveLength(1);
    expect(errored[0]!.output).toBe("1 failing");
  });

  it("ignores sidechain and non-message lines", () => {
    const text = [
      JSON.stringify({ type: "summary", summary: "x", leafUuid: "u" }),
      JSON.stringify({ type: "user", uuid: "1", parentUuid: null, sessionId: "s", timestamp: "2026-01-01T00:00:00Z", message: { role: "user", content: "hi" } }),
      JSON.stringify({ type: "assistant", uuid: "2", parentUuid: "1", sessionId: "s", isSidechain: true, timestamp: "2026-01-01T00:00:01Z", message: { role: "assistant", content: [{ type: "tool_use", id: "t", name: "Bash", input: { command: "ls" } }] } }),
    ].join("\n");
    const [run] = parseTrace(text);
    expect(run!.steps).toHaveLength(0);
  });

  it("tolerates a truncated final line and records that the input was cut", () => {
    const text = fx("claude-code/run-1.jsonl") + '{"type":"assist';
    const run = parseTrace(text)[0]!;
    expect(run.steps).toHaveLength(3);
    expect(run.truncated).toBe(true);
  });

  it("does not turn an interrupt into a deny", () => {
    const line = (o: object) => JSON.stringify({ sessionId: "s", cwd: "/repo", timestamp: "2026-01-01T00:00:00Z", parentUuid: null, ...o });
    const reject = "The user doesn't want to proceed with this tool use. STOP what you are doing.";
    const text = [
      line({ type: "user", uuid: "u0", message: { role: "user", content: "deploy" } }),
      line({ type: "assistant", uuid: "a1", message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "git push --force" } }] } }),
      line({ type: "user", uuid: "u1", tool_result_meta: [{ non_execution_kind: "interrupted" }], message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: reject, is_error: true }] } }),
    ].join("\n");
    const step = parseTrace(text)[0]!.steps[0]!;
    expect(step.decision).toBeUndefined();
    expect(step.nonExecution).toBe("interrupted");
    expect(blockBasis(step)).toBeUndefined();
  });

  it("keeps a shared deny and does not equate provenance the two sources do not share", () => {
    const line = (o: object) => JSON.stringify({ sessionId: "s", cwd: "/repo", timestamp: "2026-01-01T00:00:00Z", parentUuid: null, ...o });
    const reject = "The user doesn't want to proceed with this tool use. To tell you how to proceed, the user said:\nnot now";
    const claude = [
      line({ type: "user", uuid: "u0", message: { role: "user", content: "deploy" } }),
      line({ type: "assistant", uuid: "a1", message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "npm test" } }] } }),
      line({ type: "user", uuid: "u1", toolUseResult: "User rejected tool use", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: reject, is_error: true }] } }),
    ].join("\n");
    const decisions = JSON.stringify({ schema: "ledring.decisions.v1", run: "r1", tool: "Bash", input: { command: "npm test" }, verdict: "deny", by: "human", reason: "not now" });
    const fromClaude = parseTrace(claude, { filename: "session.jsonl" })[0]!.steps[0]!;
    const fromLog = parseTrace(decisions, { filename: "decisions.jsonl" })[0]!.steps[0]!;
    expect(fromClaude.signature).toBe(fromLog.signature);
    expect(fromClaude.decision).toEqual(fromLog.decision);
    expect(fromClaude.provenance?.file).toBe("session.jsonl");
    expect(fromLog.provenance).toEqual({ file: "decisions.jsonl", line: 1 });
    expect(fromClaude.startedAt).toBe("2026-01-01T00:00:00Z");
    expect(fromLog.startedAt).toBeUndefined();
  });
});

describe("otel-genai adapter", () => {
  const runs = parseTrace(fx("otel/weather-agent.otlp.json"));

  it("produces one run per trace id", () => {
    expect(runs).toHaveLength(4);
    expect(runs.every((r) => r.source === "otel-genai")).toBe(true);
  });

  it("reads agent name, instruction and tool steps from GenAI attributes", () => {
    const r = runs[0]!;
    expect(r.agent?.name).toBe("weather-agent");
    expect(r.instruction).toBe("What should I wear in Paris tomorrow?");
    expect(r.steps.filter((s) => s.kind === "tool").map((s) => s.signature)).toEqual(["get_forecast", "suggest_outfit"]);
    expect(r.steps.some((s) => s.kind === "llm")).toBe(true);
    expect(r.steps[0]!.provenance?.eventId).toBe(r.steps[0]!.id);
    expect(r.steps[0]!.provenance?.line).toBeUndefined();
    expect(r.steps.some((s) => s.parentId)).toBe(true);
  });

  it("marks failed tool spans and failed runs", () => {
    const failed = runs[3]!;
    expect(failed.outcome).toBe("failure");
    expect(failed.steps.find((s) => s.kind === "tool")!.isError).toBe(true);
    expect(runs[0]!.outcome).toBe("success");
  });

  it("accepts JSON lines of OTLP batches (file exporter)", () => {
    const one = JSON.parse(fx("otel/weather-agent.otlp.json"));
    const text = `${JSON.stringify(one)}\n${JSON.stringify(one)}\n`;
    expect(parseTrace(text)).toHaveLength(4);
  });
});

describe("parseTrace", () => {
  it("lists the available adapters", () => {
    expect(adapters.map((a) => a.name)).toEqual(["claude-code", "otel-genai", "ledring-decisions", "ledring-trace"]);
  });

  it("can be forced to one adapter", () => {
    expect(() => parseTrace(fx("claude-code/run-1.jsonl"), { adapter: "otel-genai" })).toThrow(/otel-genai/);
  });

  it("explains when no adapter recognises the input", () => {
    expect(() => parseTrace("hello world")).toThrow(/No adapter/);
  });
});

describe("signatureOf", () => {
  it("merges equivalent shell commands by their leading words", () => {
    expect(signatureOf("Bash", { command: "npm test -- --watch" })).toBe("Bash(npm test)");
    expect(signatureOf("Bash", { command: "FOO=1 git push --force origin main" })).toBe("Bash(git push)");
    expect(signatureOf("Bash", { command: "ls -la" })).toBe("Bash(ls)");
  });

  it("names file tools by basename and other tools by name", () => {
    expect(signatureOf("Edit", { file_path: "/a/b/login.ts" })).toBe("Edit(login.ts)");
    expect(signatureOf("get_forecast", { city: "Paris" })).toBe("get_forecast");
  });
});

describe("decisions", () => {
  const line = (o: object) => JSON.stringify({ sessionId: "s1", cwd: "/repo", timestamp: "2026-01-01T00:00:00Z", parentUuid: null, ...o });
  const use = (id: string, command: string) => line({ type: "assistant", uuid: `a${id}`, message: { role: "assistant", content: [{ type: "tool_use", id, name: "Bash", input: { command } }] } });
  const reject = "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.";

  it("marks Claude Code rejections, attributing them only when the transcript says who decided", () => {
    const text = [
      line({ type: "user", uuid: "u0", message: { role: "user", content: "deploy" } }),
      use("t1", "git push --force"),
      line({ type: "user", uuid: "u1", toolUseResult: "User rejected tool use", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: reject, is_error: true }] } }),
      use("t2", "curl https://x.example"),
      line({ type: "user", uuid: "u2", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t2", content: reject, is_error: true }] } }),
      use("t3", "npm publish"),
      line({ type: "user", uuid: "u3", tool_result_meta: [{ non_execution_kind: "permission-rule" }], message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t3", content: reject, is_error: true }] } }),
      use("t4", "rm -rf dist"),
      line({ type: "user", uuid: "u4", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t4", content: reject.replace(/STOP.*$/, "To tell you how to proceed, the user said:\nnot in this repo"), is_error: true }] } }),
    ].join("\n");
    const [run] = parseTrace(text);
    expect(run!.cwd).toBe("/repo");
    expect(run!.steps.map((s) => s.decision)).toEqual([
      { verdict: "deny", by: "human" },
      { verdict: "deny", by: "unknown" },
      { verdict: "deny", by: "policy" },
      { verdict: "deny", by: "human", reason: "not in this repo" },
    ]);
  });

  it("reads a portable decisions log", () => {
    const text = [
      { schema: "ledring.decisions.v1", run: "r1", tool: "Bash", input: { command: "npm test" }, verdict: "allow", by: "human", at: "2026-01-01T00:00:00Z" },
      { schema: "ledring.decisions.v1", run: "r1", tool: "send_email", input: { to: "a@example.com" }, verdict: "deny", by: "human" },
      { schema: "ledring.decisions.v1", run: "r2", tool: "Bash", input: { command: "npm test" }, verdict: "allow", by: "policy" },
    ].map((o) => JSON.stringify(o)).join("\n");
    const runs = parseTrace(text);
    expect(runs.map((r) => r.source)).toEqual(["ledring-decisions", "ledring-decisions"]);
    expect(runs[0]!.steps.map((s) => [s.signature, s.decision?.verdict])).toEqual([["Bash(npm test)", "allow"], ["send_email", "deny"]]);
  });
});

describe("riskOf", () => {
  it("names destructive shell commands and ignores safe ones", () => {
    expect(riskOf("Bash", { command: "rm -rf node_modules" })).toEqual(["rm -rf"]);
    expect(riskOf("Bash", { command: "git push --force origin main" })).toEqual(["force push"]);
    expect(riskOf("Bash", { command: "npm test" })).toEqual([]);
    expect(riskOf("Edit", { file_path: "rm -rf" })).toEqual([]);
  });
});


describe("ledring-trace adapter", () => {
  const text = fx("native/research-run.ledring.json");
  const native = JSON.parse(text);
  const adapter = () => adapters.find((a) => a.name === "ledring-trace")!;

  it("detects only the native schema in objects, arrays and JSONL", () => {
    for (const input of [text, JSON.stringify([native]), `${JSON.stringify(native)}\n${JSON.stringify(native)}\n`]) {
      expect(adapter().detect(input)).toBe(true);
    }
    for (const input of ["null", "[]", "hello", '{"schema":"ledring.trace.v2"}', fx("claude-code/run-1.jsonl"), fx("otel/weather-agent.otlp.json")]) {
      expect(adapter().detect(input)).toBe(false);
    }
  });

  it("reads objects, arrays and JSONL while preserving run identity and parentIds", () => {
    for (const [input, count] of [[text, 1], [JSON.stringify([native, native]), 2], [`${JSON.stringify(native)}\n${JSON.stringify(native)}\n`, 2]] as const) {
      const runs = parseTrace(input);
      expect(runs).toHaveLength(count);
      expect(runs[0]).toMatchObject({ id: native.id, source: "research-thinking-ai", steps: [{ id: "plan" }, { parentId: "plan" }, { parentId: "llm", name: "check_citation" }] });
      expect(runs[0]).not.toHaveProperty("x-research");
    }
  });

  it("fills missing signatures and preserves supplied signatures", () => {
    const [run] = parseTrace(text);
    expect(run!.steps.map((step) => step.signature)).toEqual(native.steps.map((step: { signature?: string; name: string; input?: unknown }) => step.signature ?? signatureOf(step.name, step.input)));
  });

  it("rejects invalid schemas and invalid runs through RunSchema", () => {
    expect(() => parseTrace(JSON.stringify({ ...native, schema: "ledring.trace.v2" }))).toThrow();
    expect(() => parseTrace(JSON.stringify([native, { ...native, schema: "ledring.trace.v2" }]))).toThrow();
    expect(() => parseTrace(JSON.stringify({ ...native, id: 42 }))).toThrow();
    expect(() => parseTrace(JSON.stringify({ ...native, steps: [{ id: "bad", kind: "invalid", name: "tool" }] }))).toThrow();
  });

  it("reads Play exports as native runs and ignores their extension", () => {
    const play = { ...native, source: "ledring-play", "x-ledring-play": { ending: "POLISHED" } };
    expect(adapter().detect(JSON.stringify(play))).toBe(true);
    const [run] = parseTrace(JSON.stringify(play));
    expect(run!.source).toBe("ledring-play");
    expect(run).not.toHaveProperty("x-ledring-play");
  });
});
