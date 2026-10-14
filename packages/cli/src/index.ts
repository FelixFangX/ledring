import { basename } from "node:path";
import { parseArgs } from "node:util";
import { scoreInstability, type InstabilityReport } from "@ledring/instability";
import { buildBranchTree, renderHtml, type Tokens } from "@ledring/flowchart";
import { parseTrace, type Run } from "@ledring/trace";
import { nodeIO, type IO } from "./io.js";

export type { IO } from "./io.js";

const HELP = `ledring — status lights for AI agents

Usage:
  ledring inspect <traces...> [--adapter name]       Print normalized ledring.trace.v1 runs as JSON
  ledring flowchart <traces...> [--out report.html] [--json] [--highlight runId]
                    [--title text] [--tokens tokens.json] [--adapter name]
                                                     Merge runs into a branch tree with divergence %
  ledring instability <traces...> [--json] [--instruction text] [--fail-above n]
                                                     Heuristic drift-from-instruction score per run
  ledring help

Traces may be files or directories (*.jsonl, *.json). Formats are auto-detected:
claude-code (session JSONL), otel-genai (OTLP/JSON GenAI spans).
`;

export function loadRuns(io: IO, paths: string[], adapter?: string): Run[] {
  if (paths.length === 0) throw new Error("No trace files given.");
  return io.expand(paths).flatMap((p) => parseTrace(io.readFile(p), { filename: basename(p), ...(adapter ? { adapter } : {}) }));
}

type Command = (args: string[], io: IO) => number;

const commands: Record<string, Command> = {
  inspect(args, io) {
    const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { adapter: { type: "string" } } });
    const runs = loadRuns(io, positionals, values.adapter);
    io.out(JSON.stringify(runs, null, 2) + "\n");
    return 0;
  },
  flowchart(args, io) {
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: {
        out: { type: "string", short: "o" },
        json: { type: "boolean" },
        highlight: { type: "string" },
        title: { type: "string" },
        tokens: { type: "string" },
        adapter: { type: "string" },
      },
    });
    const tree = buildBranchTree(loadRuns(io, positionals, values.adapter));
    if (values.json) {
      io.out(JSON.stringify(tree, null, 2) + "\n");
      if (!values.out) return 0;
    }
    const themes = values.tokens ? readTokens(io.readFile(values.tokens)) : {};
    const html = renderHtml(tree, {
      ...themes,
      ...(values.title ? { title: values.title } : {}),
      ...(values.highlight ? { highlightRunId: values.highlight } : {}),
    });
    const out = values.out ?? "report.html";
    io.writeFile(out, html);
    if (!values.json) io.out(`Wrote ${out} — ${tree.runCount} runs, ${countForks(tree.root)} forks\n`);
    return 0;
  },
  instability(args, io) {
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: { json: { type: "boolean" }, instruction: { type: "string" }, "fail-above": { type: "string" }, adapter: { type: "string" } },
    });
    const reports = loadRuns(io, positionals, values.adapter).map((r) => scoreInstability(r, values.instruction ? { instruction: values.instruction } : {}));
    io.out(values.json ? JSON.stringify(reports, null, 2) + "\n" : reports.map(formatReport).join("\n"));
    const limit = values["fail-above"];
    if (limit !== undefined) {
      const n = Number(limit);
      if (!Number.isFinite(n)) throw new Error(`--fail-above expects a number, got "${limit}"`);
      if (reports.some((r) => r.score > n)) return 3;
    }
    return 0;
  },
};

const LED = { calm: "●", processing: "◐", critical: "○" } as const;

function formatReport(r: InstabilityReport): string {
  const lines = [`${LED[r.level]} ${r.score.toString().padStart(3)} ${r.level.toUpperCase().padEnd(10)} peak ${r.peak}  ${r.runId}`];
  for (const s of r.steps) {
    if (s.delta === 0 && s.reasons.length === 0) continue;
    const d = s.delta > 0 ? `▲ +${s.delta}` : s.delta < 0 ? `▼ ${s.delta}` : "  ·";
    lines.push(`    ${d.padEnd(6)} ${s.signature.padEnd(26)} ${s.reasons.join("; ")}`);
  }
  return lines.join("\n") + "\n";
}

interface TreeLike { children: TreeLike[] }
const countForks = (n: TreeLike): number => (n.children.length > 1 ? 1 : 0) + n.children.reduce((a, c) => a + countForks(c), 0);

/** Accepts `{...tokens}` or `{ light: {...}, dark: {...} }`. Unknown keys are ignored by the viewer. */
function readTokens(text: string): { tokens?: Partial<Tokens>; darkTokens?: Partial<Tokens> } {
  const t = JSON.parse(text) as Record<string, unknown>;
  if (t.light || t.dark) return { tokens: (t.light ?? {}) as Partial<Tokens>, darkTokens: (t.dark ?? {}) as Partial<Tokens> };
  return { tokens: t as Partial<Tokens> };
}

/** Run the CLI. Returns the process exit code. */
export async function run(argv: string[], io: IO = nodeIO): Promise<number> {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    io.out(HELP);
    return 0;
  }
  const command = commands[cmd];
  if (!command) {
    io.err(`Unknown command "${cmd}".\n\n${HELP}`);
    return 2;
  }
  try {
    return command(rest, io);
  } catch (e) {
    io.err(`ledring ${cmd}: ${(e as Error).message}\n`);
    return 1;
  }
}
