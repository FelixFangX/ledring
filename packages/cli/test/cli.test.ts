import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { run, type IO } from "@ledring/cli";
import { nodeIOForTest } from "./helpers.js";

const fixtures = fileURLToPath(new URL("../../../fixtures/", import.meta.url));

describe("ledring inspect", () => {
  it("prints normalized runs for a directory of mixed trace files", async () => {
    const io = nodeIOForTest();
    const code = await run(["inspect", `${fixtures}claude-code`, `${fixtures}otel`], io);
    expect(code).toBe(0);
    const runs = JSON.parse(io.stdout());
    expect(runs).toHaveLength(10);
    expect(new Set(runs.map((r: { source: string }) => r.source))).toEqual(new Set(["claude-code", "otel-genai"]));
    expect(runs[0].schema).toBe("ledring.trace.v1");
  });

  it("fails with a readable error for unknown formats", async () => {
    const io: IO = { ...nodeIOForTest(), readFile: () => "not a trace", expand: (p) => p };
    expect(await run(["inspect", "x.txt"], io)).toBe(1);
  });

  it("shows help and rejects unknown commands", async () => {
    const io = nodeIOForTest();
    expect(await run(["help"], io)).toBe(0);
    expect(io.stdout()).toMatch(/ledring inspect/);
    expect(await run(["nope"], io)).toBe(2);
  });
});

describe("ledring flowchart", () => {
  const tmp = () => mkdtempSync(join(tmpdir(), "ledring-"));

  it("writes a self-contained HTML report", async () => {
    const io = nodeIOForTest();
    const out = join(tmp(), "report.html");
    expect(await run(["flowchart", `${fixtures}claude-code`, "--out", out, "--title", "fix login"], io)).toBe(0);
    expect(io.stdout()).toMatch(/6 runs, \d+ forks/);
    const html = readFileSync(out, "utf8");
    expect(html).toContain("fix login");
    expect(html).toContain(">67%<");
  });

  it("prints the branch tree as JSON", async () => {
    const io = nodeIOForTest();
    expect(await run(["flowchart", `${fixtures}otel`, "--json"], io)).toBe(0);
    const tree = JSON.parse(io.stdout());
    expect(tree.schema).toBe("ledring.branch-tree.v1");
    expect(tree.runCount).toBe(4);
    expect(tree.root.children.map((c: { signature: string }) => c.signature)).toEqual(["get_forecast", "web_search"]);
  });

  it("applies a tokens file and a highlighted run", async () => {
    const dir = tmp();
    const tokens = join(dir, "tokens.json");
    writeFileSync(tokens, JSON.stringify({ light: { accent: "#123456" }, dark: { accent: "#654321" } }));
    const io = nodeIOForTest();
    const out = join(dir, "r.html");
    expect(await run(["flowchart", `${fixtures}claude-code/run-4.jsonl`, `${fixtures}claude-code/run-1.jsonl`, "--tokens", tokens, "--out", out, "--highlight", "run-4.jsonl#00000000-0000-4000-8000-000000000004"], io)).toBe(0);
    const html = readFileSync(out, "utf8");
    expect(html).toContain("--lr-accent:#123456");
    expect(html).toContain("--lr-accent:#654321");
  });

  it("accepts a structured design-tokens file", async () => {
    const dir = tmp();
    const tokens = join(dir, "tokens.json");
    writeFileSync(tokens, JSON.stringify({ color: { bg: { base: "#010203" }, accent: { cyan: "#00ffee" } }, font: { mono: "Geist Mono, monospace" } }));
    const out = join(dir, "r.html");
    expect(await run(["flowchart", `${fixtures}otel`, "--tokens", tokens, "--out", out], nodeIOForTest())).toBe(0);
    const html = readFileSync(out, "utf8");
    expect(html).toContain("--lr-bg:#010203");
    expect(html).toContain("--lr-accent:#00ffee");
  });

  it("reports an unknown highlighted run as an error", async () => {
    const io = nodeIOForTest();
    expect(await run(["flowchart", `${fixtures}otel`, "--highlight", "nope", "--out", join(tmp(), "x.html")], io)).toBe(1);
    expect(io.stderr()).toMatch(/nope/);
  });
});

describe("ledring instability", () => {
  it("prints a per-run score with ▲/▼ deltas and reasons", async () => {
    const io = nodeIOForTest();
    expect(await run(["instability", `${fixtures}claude-code/run-5.jsonl`], io)).toBe(0);
    expect(io.stdout()).toMatch(/PROCESSING/);
    expect(io.stdout()).toMatch(/▲ \+20 +Edit\(login\.test\.ts\)/);
  });

  it("emits JSON reports", async () => {
    const io = nodeIOForTest();
    expect(await run(["instability", `${fixtures}claude-code`, "--json"], io)).toBe(0);
    const reports = JSON.parse(io.stdout());
    expect(reports).toHaveLength(6);
    expect(reports[0].schema).toBe("ledring.instability.v1");
  });

  it("can fail CI above a threshold", async () => {
    expect(await run(["instability", `${fixtures}claude-code/run-6.jsonl`, "--fail-above", "10"], nodeIOForTest())).toBe(3);
    expect(await run(["instability", `${fixtures}claude-code/run-1.jsonl`, "--fail-above", "10"], nodeIOForTest())).toBe(0);
  });
});

describe("ledring trust", () => {
  it("prints relationship bars and suggested permission changes", async () => {
    const io = nodeIOForTest();
    expect(await run(["trust", `${fixtures}trust`], io)).toBe(0);
    expect(io.stdout()).toMatch(/Bash\(npm test:\*\) +█+░* +8\/8 +→ ALLOW/);
    expect(io.stdout()).toMatch(/\+ deny +Bash\(git push --force:\*\)/);
    expect(io.stdout()).toMatch(/NEVER AUTO/);
  });

  it("diffs against existing settings and writes a merged suggestion to a separate file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ledring-"));
    const settings = join(dir, "settings.json");
    writeFileSync(settings, JSON.stringify({ model: "x", permissions: { allow: ["Bash(git push --force:*)"] } }));
    const out = join(dir, "suggested.json");
    const io = nodeIOForTest();
    expect(await run(["trust", `${fixtures}trust`, "--settings", settings, "--out", out], io)).toBe(0);
    expect(io.stdout()).toMatch(/! Bash\(git push --force:\*\): currently allow, history suggests deny/);
    const merged = JSON.parse(readFileSync(out, "utf8"));
    expect(merged.model).toBe("x");
    expect(merged.permissions.deny).toContain("Bash(git push --force:*)");
    expect(JSON.parse(readFileSync(settings, "utf8")).permissions.deny).toBeUndefined();
  });

  it("refuses to overwrite the settings file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ledring-"));
    const settings = join(dir, "settings.json");
    writeFileSync(settings, "{}");
    const io = nodeIOForTest();
    expect(await run(["trust", `${fixtures}trust`, "--settings", settings, "--out", settings], io)).toBe(1);
    expect(io.stderr()).toMatch(/refusing to overwrite/);
  });

  it("emits the policy as JSON", async () => {
    const io = nodeIOForTest();
    expect(await run(["trust", `${fixtures}trust/decisions.jsonl`, "--json"], io)).toBe(0);
    const j = JSON.parse(io.stdout());
    expect(j.policy.schema).toBe("ledring.policy.v1");
    expect(j.policy.rules.map((r: { rule: string }) => r.rule)).toContain("send_email");
  });
});

describe("ledring card", () => {
  it("discovers settings and .mcp.json from the project layout and writes card + SVG", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ledring-"));
    const io = nodeIOForTest();
    const code = await run(["card", `${fixtures}cards/.claude/agents/release-reviewer.md`, "--url", "https://agents.example.com/a2a", "--out", join(dir, "card.json"), "--svg", join(dir, "card.svg")], io);
    expect(code).toBe(0);
    const card = JSON.parse(readFileSync(join(dir, "card.json"), "utf8"));
    expect(card.name).toBe("release-reviewer");
    expect(card.capabilities.extensions[0].params.mcpServers).toHaveLength(2);
    expect(card.capabilities.extensions[0].params.permissions.allow).toContain("Bash(npm test:*)");
    expect(readFileSync(join(dir, "card.svg"), "utf8")).toMatch(/^<svg/);
    expect(io.stderr()).toBe("");
  });

  it("prints JSON to stdout and warns when no endpoint url is set", async () => {
    const io = nodeIOForTest();
    expect(await run(["card", `${fixtures}cards/.claude/agents/release-reviewer.md`], io)).toBe(0);
    expect(JSON.parse(io.stdout()).supportedInterfaces).toEqual([]);
    expect(io.stderr()).toMatch(/--url/);
  });

  it("renders a play trace without treating it as agent markdown", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ledring-"));
    const trace = join(dir, "session.json");
    writeFileSync(trace, JSON.stringify({
      schema: "ledring.trace.v1",
      id: "snake",
      source: "ledring-play",
      instruction: "a small snake",
      steps: [],
      "x-ledring-play": { ending: "POLISHED" },
    }));
    const io = nodeIOForTest();
    expect(await run(["card", trace, "--svg", join(dir, "card.svg")], io)).toBe(0);
    const card = JSON.parse(io.stdout());
    expect(card.name).toBe("LEDRING Play");
    expect(card.description).toBe("a small snake");
    expect(card.skills[0].name).toBe("POLISHED");
    expect(readFileSync(join(dir, "card.svg"), "utf8")).toMatch(/^<svg/);
    expect(io.stderr()).toBe("");
  });
});

describe("ledring redwall", () => {
  const args = ["redwall", `${fixtures}redwall`, "--scenarios", `${fixtures}redwall.scenarios.json`];
  it("lists each wall hit and how the run ended", async () => {
    const io = nodeIOForTest();
    expect(await run(args, io)).toBe(0);
    expect(io.stdout()).toMatch(/no-force-push +hit in 2 run\(s\): 1 asked · 1 workaround/);
    expect(io.stdout()).toMatch(/● WORKAROUND .*force-with-lease/);
  });
  it("exits 3 with --fail-on workaround", async () => {
    const io = nodeIOForTest();
    expect(await run([...args, "--fail-on", "workaround"], io)).toBe(3);
    expect(io.stderr()).toMatch(/4 run\(s\) worked around a wall/);
  });
  it("passes when only safe outcomes occur and uses built-in walls by default", async () => {
    const io = nodeIOForTest();
    expect(await run(["redwall", `${fixtures}redwall/force-push-asked.jsonl`, "--fail-on", "retried", "--json"], io)).toBe(0);
    expect(JSON.parse(io.stdout()).results.map((r: { outcome: string }) => r.outcome)).toEqual(["asked"]);
  });
  it("rejects an unknown --fail-on", async () => {
    const io = nodeIOForTest();
    expect(await run([...args, "--fail-on", "maybe"], io)).toBe(1);
  });
});

describe("ledring play", () => {
  it("prints help for the bridge flags", async () => {
    const io = nodeIOForTest();
    expect(await run(["help"], io)).toBe(0);
    expect(io.stdout()).toMatch(/ledring play \[--port n\] \[--no-open\] \[--print-config\]/);
  });

  it("prints config without secrets", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ledring-play-"));
    const secret = "super-secret-key";
    writeFileSync(join(dir, "providers.json"), JSON.stringify({ openai: { apiKey: secret, baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" } }));
    chmodSync(join(dir, "providers.json"), 0o600);
    const io = nodeIOForTest();
    const previous = process.env.LEDRING_SIWC;
    delete process.env.LEDRING_SIWC;
    try {
      expect(await run(["play", "--print-config", "--home", dir], io)).toBe(0);
    } finally {
      if (previous === undefined) delete process.env.LEDRING_SIWC;
      else process.env.LEDRING_SIWC = previous;
    }
    expect(io.stdout()).toContain("openai-compat: configured");
    expect(io.stdout()).toContain("bind: 127.0.0.1");
    expect(io.stdout()).toContain("chatgpt-plan: disabled");
    expect(io.stdout()).not.toMatch(/Connected|Using ChatGPT plan/);
    expect(io.stdout()).not.toContain(secret);
  });

  it("rejects a bad port without opening a socket", async () => {
    const io = nodeIOForTest();
    expect(await run(["play", "--port", "nope", "--no-open"], io)).toBe(1);
    expect(io.stderr()).toMatch(/--port/);
  });
});


describe("native trace commands", () => {
  it("renders flowchart and instability JSON from a research run", async () => {
    const path = `${fixtures}native/research-run.ledring.json`;
    const flow = nodeIOForTest();
    expect(await run(["flowchart", path, "--json"], flow)).toBe(0);
    expect(JSON.parse(flow.stdout())).toMatchObject({ schema: "ledring.branch-tree.v1", runCount: 1 });
    const instability = nodeIOForTest();
    expect(await run(["instability", path, "--json"], instability)).toBe(0);
    expect(JSON.parse(instability.stdout())).toMatchObject([{ schema: "ledring.instability.v1" }]);
  });
});
