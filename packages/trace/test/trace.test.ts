import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { adapters, parseTrace, riskOf, RunSchema, signatureOf, TRACE_SCHEMA } from "@ledring/trace";

const fx = (p: string) => readFileSync(new URL(`../../../fixtures/${p}`, import.meta.url), "utf8");

describe("claude-code adapter", () => {
  it("turns a session file into one run with its instruction and tool steps", () => {
    const [run] = parseTrace(fx("claude-code/run-1.jsonl"), { filename: "run-1.jsonl" });
    expect(run!.source).toBe("claude-code");
    expect(run!.schema).toBe(TRACE_SCHEMA);
    expect(run!.instruction).toBe("Fix the login bug in src/auth. Don't change the tests.");
    expect(run!.agent?.model).toBe("claude-sonnet-4-5");
    expect(run!.steps.map((s) => s.signature)).toEqual(["Read(login.ts)", "Edit(login.ts)", "Bash(npm test)"]);
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

  it("tolerates a truncated final line", () => {
    const text = fx("claude-code/run-1.jsonl") + '{"type":"assist';
    expect(parseTrace(text)[0]!.steps).toHaveLength(3);
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
    expect(adapters.map((a) => a.name)).toEqual(["claude-code", "otel-genai", "ledring-decisions"]);
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
