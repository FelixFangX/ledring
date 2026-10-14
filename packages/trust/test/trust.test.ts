import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseTrace, TRACE_SCHEMA, type Run } from "@ledring/trace";
import { diffPermissions, learnPolicy, ruleOf, toClaudeCodePermissions } from "@ledring/trust";

const dir = new URL("../../../fixtures/trust/", import.meta.url);
const runs = readdirSync(dir).sort().flatMap((f) => parseTrace(readFileSync(new URL(f, dir), "utf8"), { filename: f }));
const policy = learnPolicy(runs);
const rule = (r: string) => policy.rules.find((x) => x.rule === r)!;

describe("ruleOf", () => {
  const step = (name: string, input: unknown) => ({ id: "1", kind: "tool" as const, name, signature: name, input });
  it("writes Claude Code permission rules", () => {
    expect(ruleOf(step("Bash", { command: "npm test -- --watch" }))).toBe("Bash(npm test:*)");
    expect(ruleOf(step("Bash", { command: "npm run lint" }))).toBe("Bash(npm run lint:*)");
    expect(ruleOf(step("Bash", { command: "git push --force origin main" }))).toBe("Bash(git push --force:*)");
    expect(ruleOf(step("Bash", { command: "git push origin main" }))).toBe("Bash(git push:*)");
    expect(ruleOf(step("Bash", { command: "rm -rf dist" }))).toBe("Bash(rm -rf:*)");
    expect(ruleOf(step("Edit", { file_path: "/repo/src/a/b.ts" }), "/repo")).toBe("Edit(src/**)");
    expect(ruleOf(step("Read", { file_path: "/repo/README.md" }), "/repo")).toBe("Read(README.md)");
    expect(ruleOf(step("Edit", { file_path: "/elsewhere/x.ts" }), "/repo")).toBe("Edit");
    expect(ruleOf(step("WebFetch", { url: "https://docs.example.com/a" }))).toBe("WebFetch(domain:docs.example.com)");
    expect(ruleOf(step("mcp__github__create_issue", {}))).toBe("mcp__github__create_issue");
  });
});

describe("learnPolicy", () => {
  it("suggests auto-approving actions that were always allowed, with enough evidence", () => {
    expect(rule("Bash(npm test:*)")).toMatchObject({ verdict: "allow", allowed: 8, denied: 0 });
    expect(rule("Edit(src/**)").verdict).toBe("allow");
    expect(rule("Bash(npm test:*)").lowerBound).toBeGreaterThan(0.6);
  });

  it("suggests denying actions a human repeatedly rejected", () => {
    expect(rule("Bash(git push --force:*)")).toMatchObject({ verdict: "deny", allowed: 0, denied: 3 });
  });

  it("keeps asking when the evidence is thin or mixed", () => {
    expect(rule("WebFetch(domain:status.example.com)").verdict).toBe("ask");
    expect(rule("WebFetch(domain:docs.example.com)").verdict).toBe("ask");
    expect(rule("send_email").verdict).toBe("ask");
  });

  it("never suggests auto-approving destructive actions", () => {
    const rm = rule("Bash(rm -rf:*)");
    expect(rm.verdict).toBe("ask");
    expect(rm.reasons.join(" ")).toMatch(/destructive/);
  });

  it("does not count policy denials as human judgment", () => {
    expect(policy.rules.find((r) => r.rule === "Bash(npm publish:*)")).toBeUndefined();
    expect(policy.ignored).toBe(1);
  });

  it("is stricter with a higher threshold", () => {
    expect(learnPolicy(runs, { threshold: 0.9 }).rules.find((r) => r.rule === "Bash(npm test:*)")!.verdict).toBe("ask");
  });

  it("works on a run with no decisions at all", () => {
    const empty: Run = { schema: TRACE_SCHEMA, id: "x", source: "t", steps: [] };
    expect(learnPolicy([empty]).rules).toEqual([]);
  });
});

describe("Claude Code output", () => {
  const perms = toClaudeCodePermissions(policy);

  it("emits allow / ask / deny lists, with destructive rules pinned to ask", () => {
    expect(perms.permissions.allow).toEqual(expect.arrayContaining(["Bash(npm test:*)", "Edit(src/**)"]));
    expect(perms.permissions.deny).toEqual(["Bash(git push --force:*)"]);
    expect(perms.permissions.ask).toContain("Bash(rm -rf:*)");
  });

  it("diffs against current settings without dropping existing rules", () => {
    const d = diffPermissions({ permissions: { allow: ["Bash(npm test:*)", "Bash(git push --force:*)"], deny: ["Read(.env)"] } }, perms);
    expect(d.add.allow).not.toContain("Bash(npm test:*)");
    expect(d.add.allow).toContain("Edit(src/**)");
    expect(d.conflicts).toEqual([{ rule: "Bash(git push --force:*)", current: "allow", suggested: "deny" }]);
    expect(d.merged.permissions.deny).toEqual(expect.arrayContaining(["Read(.env)", "Bash(git push --force:*)"]));
  });
});
