import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { adapters, parseTrace, RunSchema, signatureOf, TRACE_SCHEMA } from "@ledring/trace";

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
    expect(adapters.map((a) => a.name)).toEqual(["claude-code", "otel-genai"]);
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
