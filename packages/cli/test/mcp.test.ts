import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createMcpServer } from "@ledring/cli";
import { nodeIOForTest } from "./helpers.js";

const fixtures = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
async function withClient(test: (client: Client) => Promise<void>) {
  const io = nodeIOForTest();
  io.writeFile = () => { throw new Error("MCP must never write"); };
  const server = createMcpServer(io);
  const client = new Client({ name: "test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  try { await test(client); } finally { await client.close(); await server.close(); }
  expect(io.stdout()).toBe("");
  expect(io.stderr()).toBe("");
}
function assertPrivate(value: unknown): void {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    expect(["raw", "input", "output"]).not.toContain(key);
    assertPrivate(child);
  }
}

describe("MCP public tools", () => {
  it("advertises four read-only tools with input and output contracts", async () => withClient(async (client) => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["get_branch_summary", "get_drift", "get_redwall", "list_sessions"]);
    for (const tool of tools) {
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
      expect(tool.inputSchema.properties).toHaveProperty("paths");
      expect(tool.outputSchema).toBeDefined();
    }
  }));
  it("lists runs with counts, sorting and limits", async () => withClient(async (client) => {
    const result = await client.callTool({ name: "list_sessions", arguments: { paths: [`${fixtures}claude-code`], limit: 2 } });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ total: 6, sessions: [
      { id: expect.any(String), file: expect.any(String), source: "claude-code", agent: expect.any(Object), stepCount: expect.any(Number), toolCount: expect.any(Number), errorCount: expect.any(Number), deniedCount: expect.any(Number) },
      { id: expect.any(String) },
    ] });
    const sessions = (result.structuredContent as { sessions: { startedAt: string; instruction?: string }[] }).sessions;
    expect(Date.parse(sessions[0]!.startedAt)).toBeGreaterThanOrEqual(Date.parse(sessions[1]!.startedAt));
    expect(sessions.every((s) => (s.instruction?.length ?? 0) <= 200)).toBe(true);
    assertPrivate(result);
  }));
  it("scores drift and filters a run with an instruction override", async () => withClient(async (client) => {
    const result = await client.callTool({ name: "get_drift", arguments: { paths: [`${fixtures}claude-code`] } });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ schema: "ledring.instability.v1", total: 6, reports: expect.any(Array) });
    const reports = (result.structuredContent as { reports: { runId: string; score: number; steps: unknown[] }[] }).reports;
    expect(reports).toHaveLength(6);
    expect(reports.every((r) => r.score >= 0 && r.score <= 100 && r.steps.length <= 10)).toBe(true);
    const filtered = await client.callTool({ name: "get_drift", arguments: { paths: [`${fixtures}claude-code`], runId: reports[0]!.runId, instruction: "Do not edit tests" } });
    expect(filtered.structuredContent).toMatchObject({ total: 1, reports: [{ runId: reports[0]!.runId, level: expect.any(String) }] });
    assertPrivate(result); assertPrivate(filtered);
  }));
  it("reports RedWall outcomes with default and file scenarios", async () => withClient(async (client) => {
    for (const scenarios of [undefined, `${fixtures}redwall.scenarios.json`]) {
      const result = await client.callTool({ name: "get_redwall", arguments: { paths: [`${fixtures}redwall`], ...(scenarios ? { scenarios } : {}) } });
      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toMatchObject({ schema: "ledring.redwall.v1", runs: expect.any(Number), summary: expect.any(Array), results: expect.any(Array), counts: {
        asked: expect.any(Number), stopped: expect.any(Number), retried: expect.any(Number), workaround: expect.any(Number),
      } });
      const report = result.structuredContent as { totalResults: number; counts: Record<string, number>; results: unknown[] };
      expect(report.totalResults).toBeGreaterThan(0);
      expect(Object.values(report.counts).reduce((a, b) => a + b, 0)).toBe(report.totalResults);
      expect(report.results.length).toBeLessThanOrEqual(100);
      assertPrivate(result);
    }
  }));
  it("summarizes forks and only includes the tree when requested", async () => withClient(async (client) => {
    for (const full of [false, true]) {
      const result = await client.callTool({ name: "get_branch_summary", arguments: { paths: [`${fixtures}claude-code`], full } });
      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toMatchObject({ runCount: 6, forks: expect.any(Number), forkPoints: expect.any(Array) });
      expect(Boolean((result.structuredContent as { tree?: unknown })?.tree)).toBe(full);
      expect(JSON.stringify(result.content)).toContain("ledring flowchart <paths> --out report.html");
      assertPrivate(result);
    }
  }));
  it("returns tool errors for unknown paths", async () => withClient(async (client) => {
    for (const name of ["list_sessions", "get_drift", "get_redwall", "get_branch_summary"]) {
      const result = await client.callTool({ name, arguments: { paths: ["/does-not-exist/trace.jsonl"] } });
      expect(result.isError).toBe(true);
      expect(result.content).toEqual([{ type: "text", text: expect.stringContaining("Check paths") }]);
    }
  }));
});
