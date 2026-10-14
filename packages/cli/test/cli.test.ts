import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

  it("reports an unknown highlighted run as an error", async () => {
    const io = nodeIOForTest();
    expect(await run(["flowchart", `${fixtures}otel`, "--highlight", "nope", "--out", join(tmp(), "x.html")], io)).toBe(1);
    expect(io.stderr()).toMatch(/nope/);
  });
});
