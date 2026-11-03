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
  });
});
