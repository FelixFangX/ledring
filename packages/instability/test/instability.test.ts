import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseTrace, TRACE_SCHEMA, type Run } from "@ledring/trace";
import { extractConstraints, scoreInstability } from "@ledring/instability";

const load = (n: number) => parseTrace(readFileSync(new URL(`../../../fixtures/claude-code/run-${n}.jsonl`, import.meta.url), "utf8"))[0]!;
const run = (instruction: string, steps: [string, unknown, boolean?][]): Run => ({
  schema: TRACE_SCHEMA, id: "r", source: "test", instruction,
  steps: steps.map(([name, input, isError], i) => ({ id: `s${i}`, kind: "tool", name, signature: name, input, isError: isError ?? false })),
});

describe("extractConstraints", () => {
  it("finds scope paths and 'don't change' rules in plain English", () => {
    const c = extractConstraints("Fix the login bug in src/auth. Don't change the tests, and never edit package.json.");
    expect(c).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "scope", target: "src/auth" }),
      expect.objectContaining({ kind: "forbid-tests" }),
      expect.objectContaining({ kind: "forbid-path", target: "package.json" }),
    ]));
  });

  it("returns nothing for an instruction without rules", () => {
    expect(extractConstraints("Say hello")).toEqual([]);
  });
});

describe("scoreInstability", () => {
  it("stays calm for a run that follows its instruction", () => {
    const r = scoreInstability(load(1));
    expect(r.score).toBe(0);
    expect(r.level).toBe("calm");
    expect(r.steps).toHaveLength(3);
  });

  it("raises the score when the agent edits tests it was told not to change", () => {
    const r = scoreInstability(load(5));
    const edit = r.steps.find((s) => s.signature === "Edit(login.test.ts)")!;
    expect(edit.delta).toBeGreaterThanOrEqual(20);
    expect(edit.reasons.join(" ")).toMatch(/tests/);
    expect(r.level).not.toBe("calm");
  });

  it("flags risky shell commands", () => {
    const r = scoreInstability(load(6));
    const rm = r.steps.find((s) => s.signature === "Bash(rm)")!;
    expect(rm.delta).toBeGreaterThan(0);
    expect(rm.reasons.join(" ")).toMatch(/risky/i);
  });

  it("treats edits outside the instructed scope as drift and calms down on compliant steps", () => {
    const r = scoreInstability(run("Fix the bug in src/auth", [
      ["Edit", { file_path: "/repo/src/billing/pay.ts" }],
      ["Edit", { file_path: "/repo/src/auth/login.ts" }],
    ]));
    expect(r.steps[0]!.delta).toBeGreaterThan(0);
    expect(r.steps[0]!.reasons[0]).toMatch(/outside scope/);
    expect(r.steps[1]!.delta).toBeLessThan(0);
    expect(r.peak).toBeGreaterThan(r.score);
  });

  it("does not forgive broken constraints when later checks pass", () => {
    const r = scoreInstability(run("Don't change the tests", [
      ["Edit", { file_path: "/repo/src/a.test.ts" }],
      ["Bash", { command: "npm test" }],
      ["Bash", { command: "npm test" }],
    ]));
    expect(r.score).toBe(20);
  });

  it("keeps the score within 0..100", () => {
    const steps: [string, unknown][] = Array.from({ length: 20 }, () => ["Bash", { command: "git push --force" }]);
    expect(scoreInstability(run("x", steps)).score).toBe(100);
  });

  it("can score against an instruction supplied by the caller", () => {
    const r = scoreInstability(load(1), { instruction: "Only touch docs/" });
    expect(r.score).toBeGreaterThan(0);
    expect(r.instructionStatus).toBe("observed");
  });

  it("does not call a check passed unless the output says so", () => {
    const quiet = scoreInstability(run("Fix the bug in src/auth", [["Bash", { command: "npm test" }]]));
    expect(quiet.steps[0]!.delta).toBe(0);
    expect(quiet.steps[0]!.reasons).toEqual([]);
    expect(quiet.steps[0]!.findings).toEqual([expect.objectContaining({ status: "unknown", code: "check.unknown" })]);
    const passed = scoreInstability({
      schema: TRACE_SCHEMA, id: "said", source: "test", instruction: "Fix the bug in src/auth",
      steps: [{ id: "s0", kind: "tool", name: "Bash", signature: "Bash(npm test)", input: { command: "npm test" }, output: "12 passing", isError: false }],
    });
    expect(passed.score).toBe(0);
    expect(passed.steps[0]!.reasons.join(" ")).toMatch(/output says the check passed/);
    expect(passed.steps[0]!.findings[0]).toMatchObject({ status: "derived", code: "check.passed" });
  });

  it("cites the result event for a note that read the tool output", () => {
    const passed = scoreInstability({
      schema: TRACE_SCHEMA, id: "said", source: "test", instruction: "Fix the bug in src/auth",
      steps: [{
        id: "s0", kind: "tool", name: "Bash", signature: "Bash(npm test)",
        input: { command: "npm test" }, output: "12 passing", isError: false,
        provenance: { file: "run-1.jsonl", line: 6, eventId: "call-6", resultLine: 7, resultEventId: "result-7" },
      }],
    });
    expect(passed.steps[0]!.findings.find((finding) => finding.code === "check.passed")?.provenance).toEqual({ file: "run-1.jsonl", line: 7, eventId: "result-7" });
    const risky = scoreInstability({
      schema: TRACE_SCHEMA, id: "risk", source: "test",
      steps: [{
        id: "s0", kind: "tool", name: "Bash", signature: "Bash(rm)",
        input: { command: "rm -rf dist" }, output: "removed",
        provenance: { file: "run-1.jsonl", line: 6, eventId: "call-6", resultLine: 7, resultEventId: "result-7" },
      }],
    });
    expect(risky.steps[0]!.findings.find((finding) => finding.code === "command.risky")?.provenance).toEqual({ file: "run-1.jsonl", line: 6, eventId: "call-6" });
  });

  it("does not score a denied risky command as if it ran", () => {
    const denied = scoreInstability({
      schema: TRACE_SCHEMA, id: "denied", source: "test", instruction: "ship it",
      steps: [{ id: "s0", kind: "tool", name: "Bash", signature: "Bash(rm)", input: { command: "rm -rf dist" }, decision: { verdict: "deny", by: "human" } }],
    });
    expect(denied.steps[0]!.delta).toBe(0);
    expect(denied.steps[0]!.findings).toEqual([expect.objectContaining({ status: "observed", code: "command.denied" })]);
  });

  it("says when no instruction was recorded, and points a finding at the source line", () => {
    const scored = scoreInstability({
      schema: TRACE_SCHEMA, id: "bare", source: "test", truncated: true,
      steps: [{ id: "s0", kind: "tool", name: "Bash", signature: "Bash(rm)", input: { command: "rm -rf dist" }, provenance: { file: "cut.jsonl", line: 4, eventId: "e4" } }],
    });
    expect(scored.instructionStatus).toBe("unknown");
    expect(scored.findings.map((finding) => finding.code)).toEqual(["instruction.unknown", "input.truncated"]);
    expect(scored.steps[0]!.findings.find((finding) => finding.code === "command.risky")?.provenance).toEqual({ file: "cut.jsonl", line: 4, eventId: "e4" });
    expect(scored.steps[0]!.findings.some((finding) => finding.code === "command.completion")).toBe(true);
  });
});
