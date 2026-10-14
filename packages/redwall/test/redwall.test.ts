import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseTrace, type Run } from "@ledring/trace";
import { evaluateRun, globToRegExp, parseScenarios, runScenarios } from "@ledring/redwall";

const dir = fileURLToPath(new URL("../../../fixtures/redwall/", import.meta.url));
const load = (name: string): Run => parseTrace(readFileSync(`${dir}${name}.jsonl`, "utf8"))[0]!;
const scenarios = parseScenarios(readFileSync(`${dir}../redwall.scenarios.json`, "utf8"));
const byId = (id: string) => scenarios.find((s) => s.id === id)!;

describe("evaluateRun", () => {
  it.each([
    ["force-push-workaround", "no-force-push", "workaround", /force-with-lease/],
    ["force-push-asked", "no-force-push", "asked", /asked/],
    ["rm-workaround", "no-recursive-delete", "workaround", /find -delete/],
    ["rm-retried", "no-recursive-delete", "retried", /again/],
    ["tests-workaround", "tests-are-read-only", "workaround", /tests\/login\.test\.ts from the shell/],
    ["network-workaround", "no-network", "workaround", /shell/],
  ])("%s → %s", (file, scenario, outcome, detail) => {
    const r = evaluateRun(load(file), byId(scenario))!;
    expect(r.outcome).toBe(outcome);
    expect(r.evidence?.detail).toMatch(detail);
  });

  it("calls it stopped when the agent moves on to allowed work", () => {
    const r = evaluateRun(load("tests-stopped"), byId("tests-are-read-only"))!;
    expect(r.outcome).toBe("stopped");
    expect(r.evidence).toBeUndefined();
  });

  it("ignores runs that never hit the wall, and actions that were not blocked", () => {
    expect(evaluateRun(load("tests-stopped"), byId("no-force-push"))).toBeUndefined();
    const ok = parseTrace(readFileSync(fileURLToPath(new URL("../../../fixtures/trust/session-7.jsonl", import.meta.url)), "utf8"))[0]!;
    expect(evaluateRun(ok, byId("no-recursive-delete"))).toBeUndefined();
  });

  it("rejects unknown walls", () => {
    expect(() => evaluateRun(load("rm-retried"), { id: "x", wall: "nope" })).toThrow(/unknown wall/);
  });
});

describe("runScenarios", () => {
  it("summarizes outcomes per scenario across runs", () => {
    const runs = readdirSync(dir).filter((f) => f.endsWith(".jsonl")).map((f) => load(f.replace(".jsonl", "")));
    const report = runScenarios(runs, scenarios);
    expect(report.runs).toBe(7);
    const s = Object.fromEntries(report.summary.map((x) => [x.scenario, x]));
    expect(s["no-force-push"]).toMatchObject({ hit: 2, counts: { workaround: 1, asked: 1 } });
    expect(s["tests-are-read-only"]).toMatchObject({ hit: 2, counts: { workaround: 1, stopped: 1 } });
    expect(report.results).toHaveLength(7);
  });
});

describe("parseScenarios / globToRegExp", () => {
  it("validates the scenarios file", () => {
    expect(() => parseScenarios(JSON.stringify({ schema: "ledring.redwall.v1", scenarios: [] }))).toThrow();
  });
  it("matches globs", () => {
    expect(globToRegExp("tests/**").test("tests/a/b.ts")).toBe(true);
    expect(globToRegExp("*.env").test("prod.env")).toBe(true);
    expect(globToRegExp("*.env").test("x/prod.env")).toBe(false);
  });
});
