import { basename } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { parseTrace } from "@ledring/trace";
import { INSTABILITY_SCHEMA, scoreInstability } from "@ledring/instability";
import { buildBranchTree, type BranchNode } from "@ledring/flowchart";
import { defaultScenarios, OUTCOMES, parseScenarios, REDWALL_SCHEMA, runScenarios } from "@ledring/redwall";
import type { IO } from "./io.js";

const short = (s: string): string => s.slice(0, 200);
const str = z.string().max(200);
const count = z.number().int().nonnegative();
const common = { paths: z.array(z.string()).min(1), adapter: z.string().optional() };
const reference = z.object({ id: str, signature: str });
const counts = z.object({ asked: count, stopped: count, retried: count, workaround: count });
const branch = z.object({ signature: str, runCount: count, divergence: z.number() });
const fork = z.object({ signature: str, depth: count, branches: z.array(branch) });
const nodeSchema: z.ZodType<BranchNode> = z.lazy(() => z.object({
  id: str, signature: str, kind: str, depth: count, count, share: z.number(),
  runIds: z.array(str), errors: count, ends: count,
  outcomes: z.object({ success: count, failure: count, unknown: count }), children: z.array(nodeSchema),
}));

/** Read-only projections: never serialize a normalized run or step directly. */
export function createMcpServer(io: IO): McpServer {
  const server = new McpServer({ name: "ledring", version: "0.1.0" });
  const load = (paths: string[], adapter?: string) => io.expand(paths).flatMap((file) =>
    parseTrace(io.readFile(file), { filename: basename(file), ...(adapter ? { adapter } : {}) }).map((run) => ({ run, file })));
  const annotations = { readOnlyHint: true, openWorldHint: false };
  const reply = (work: () => Record<string, unknown>, hint = "") => {
    try {
      const structuredContent = work();
      return { content: [{ type: "text" as const, text: JSON.stringify(structuredContent) + hint }], structuredContent };
    } catch {
      // Parser errors can contain offending trace values. Do not echo them.
      return { isError: true, content: [{ type: "text" as const, text: "Unable to read traces or scenarios. Check paths, adapter and file format." }] };
    }
  };
  server.registerTool("list_sessions", {
    description: "List local trace runs, newest first, with metadata and counts. Instructions are limited to 200 characters.",
    inputSchema: { ...common, limit: z.number().int().min(1).max(500).default(50) },
    outputSchema: { sessions: z.array(z.object({
      id: str, source: str, file: str, agent: z.object({ name: str.optional(), model: str.optional() }),
      outcome: str, startedAt: str.optional(), endedAt: str.optional(), stepCount: count,
      toolCount: count, errorCount: count, deniedCount: count, instruction: str.optional(),
    })), total: count }, annotations,
  }, ({ paths, adapter, limit }) => reply(() => {
    const runs = load(paths, adapter);
    runs.sort((a, b) => (Date.parse(b.run.startedAt ?? "") || 0) - (Date.parse(a.run.startedAt ?? "") || 0));
    return { total: runs.length, sessions: runs.slice(0, limit).map(({ run: r, file }) => ({
      id: short(r.id), source: short(r.source), file: short(file),
      agent: { ...(r.agent?.name ? { name: short(r.agent.name) } : {}), ...(r.agent?.model ? { model: short(r.agent.model) } : {}) },
      outcome: r.outcome ?? "unknown", ...(r.startedAt ? { startedAt: short(r.startedAt) } : {}),
      ...(r.endedAt ? { endedAt: short(r.endedAt) } : {}), ...(r.instruction ? { instruction: short(r.instruction) } : {}),
      stepCount: r.steps.length, toolCount: r.steps.filter((s) => s.kind === "tool").length,
      errorCount: r.steps.filter((s) => s.isError).length, deniedCount: r.steps.filter((s) => s.decision?.verdict === "deny").length,
    })) };
  }));
  server.registerTool("get_drift", {
    description: "Score instability for local runs; return up to ten contributing steps per run and up to fifty runs.",
    inputSchema: { ...common, instruction: z.string().optional(), runId: z.string().optional() },
    outputSchema: { schema: z.literal(INSTABILITY_SCHEMA), total: count, reports: z.array(z.object({
      runId: str, score: z.number(), peak: z.number(), level: z.enum(["calm", "processing", "critical"]),
      steps: z.array(z.object({ stepId: str, signature: str, delta: z.number(), score: z.number() })),
    })) }, annotations,
  }, ({ paths, adapter, instruction, runId }) => reply(() => {
    const runs = load(paths, adapter).filter(({ run }) => runId === undefined || run.id === runId);
    return { schema: INSTABILITY_SCHEMA, total: runs.length, reports: runs.slice(0, 50).map(({ run }) => {
      const r = scoreInstability(run, instruction === undefined ? {} : { instruction });
      return { runId: short(r.runId), score: r.score, peak: r.peak, level: r.level,
        steps: r.steps.filter((s) => s.delta !== 0).sort((a, b) => b.delta - a.delta).slice(0, 10)
          .map((s) => ({ stepId: short(s.stepId), signature: short(s.signature), delta: s.delta, score: s.score })) };
    }) };
  }));
  server.registerTool("get_redwall", {
    description: "Evaluate default walls or a local scenarios file. Counts cover all results; lists are limited to 100 entries.",
    inputSchema: { ...common, scenarios: z.string().optional() },
    outputSchema: { schema: z.literal(REDWALL_SCHEMA), runs: count, totalResults: count, totalScenarios: count,
      counts, results: z.array(z.object({ runId: str, scenario: str, wall: str, outcome: z.enum(OUTCOMES), blocked: reference,
        evidence: reference.extend({ detail: str }).optional() })),
      summary: z.array(z.object({ scenario: str, hit: count, counts })),
    }, annotations,
  }, ({ paths, adapter, scenarios }) => reply(() => {
    const report = runScenarios(load(paths, adapter).map(({ run }) => run), scenarios ? parseScenarios(io.readFile(scenarios)) : defaultScenarios);
    const ref = (s: { id: string; signature: string }) => ({ id: short(s.id), signature: short(s.signature) });
    return { schema: report.schema, runs: report.runs, totalResults: report.results.length, totalScenarios: report.summary.length,
      counts: Object.fromEntries(OUTCOMES.map((o) => [o, report.results.filter((r) => r.outcome === o).length])),
      summary: report.summary.slice(0, 100).map((s) => ({ ...s, scenario: short(s.scenario) })),
      results: report.results.slice(0, 100).map((r) => ({ runId: short(r.runId), scenario: short(r.scenario), wall: short(r.wall),
        outcome: r.outcome, blocked: ref(r.blocked), ...(r.evidence ? { evidence: { ...ref(r.evidence), detail: short(r.evidence.detail) } } : {}) })),
    };
  }));
  server.registerTool("get_branch_summary", {
    description: "Merge local runs into a branch tree. Return ten busiest fork points, or the complete metadata tree with full=true.",
    inputSchema: { ...common, full: z.boolean().default(false) },
    outputSchema: { runCount: count, forks: count, forkPoints: z.array(fork), tree: z.object({
      schema: z.literal("ledring.branch-tree.v1"), runCount: count, root: nodeSchema,
      runs: z.array(z.object({ id: str, source: str, outcome: str, path: z.array(str) })),
    }).optional() }, annotations,
  }, ({ paths, adapter, full }) => reply(() => {
    const tree = buildBranchTree(load(paths, adapter).map(({ run }) => run));
    const forks: BranchNode[] = [];
    const visit = (n: BranchNode): BranchNode => {
      if (n.children.length > 1) forks.push(n);
      return { ...n, id: short(n.id), signature: short(n.signature), kind: short(n.kind), runIds: n.runIds.map(short), children: n.children.map(visit) };
    };
    const root = visit(tree.root);
    return { runCount: tree.runCount, forks: forks.length, forkPoints: forks.sort((a, b) => b.count - a.count).slice(0, 10).map((n) => ({
      signature: short(n.signature), depth: n.depth, branches: n.children.slice(0, 50).map((c) => ({ signature: short(c.signature), runCount: c.count, divergence: c.share * 100 })),
    })), ...(full ? { tree: { schema: tree.schema, runCount: tree.runCount, root,
      runs: tree.runs.map((r) => ({ id: short(r.id), source: short(r.source), outcome: short(r.outcome), path: r.path.map(short) })) } } : {}) };
  }, "\nRender HTML with: ledring flowchart <paths> --out report.html"));
  return server;
}
