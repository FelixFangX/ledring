import { homedir } from "node:os";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import { scoreInstability, type InstabilityReport } from "@ledring/instability";
import { buildBranchTree, fromDesignTokens, renderHtml, type Tokens } from "@ledring/flowchart";
import { parseTrace, type Run } from "@ledring/trace";
import { diffPermissions, learnPolicy, toClaudeCodePermissions, type Policy, type PermissionsDiff } from "@ledring/trust";
import { dirname, join, resolve } from "node:path";
import { cardFromConfig, cardFromPlayTrace, renderCardSvg } from "@ledring/cards";
import { defaultScenarios, OUTCOMES, parseScenarios, runScenarios, type Outcome, type RedWallReport } from "@ledring/redwall";
import { formatProviderConfig, readProviderHome, startBridge } from "@ledring/play-bridge";
import { spawn } from "node:child_process";
import { nodeIO, type IO } from "./io.js";

export type { IO } from "./io.js";

const HELP = `ledring — status lights for AI agents

Usage:
  ledring inspect <traces...> [--adapter name]       Print normalized ledring.trace.v1 runs as JSON
  ledring flowchart <traces...> [--out report.html] [--json] [--highlight runId]
                    [--title text] [--tokens tokens.json] [--lang en|zh] [--adapter name]
                                                     Merge runs into a branch tree with divergence %
  ledring instability <traces...> [--json] [--instruction text] [--fail-above n]
                                                     Heuristic drift-from-instruction score per run
  ledring trust <traces...> [--json] [--settings .claude/settings.json] [--out suggested.json]
                [--threshold 0.6] [--min-samples 5]
                                                     Learn auto-approve rules from allow/deny history
  ledring card <agent.md|session.json> [--settings path] [--mcp path] [--url a2a-endpoint] [--version v]
               [--out card.json] [--svg card.svg]
                                                     A2A Agent Card + SVG spec card from agent config
  ledring redwall <traces...> [--scenarios scenarios.json] [--json] [--fail-on workaround|retried|stopped]
                                                     What the agent did after a guardrail blocked it
  ledring play [--port n] [--no-open] [--print-config] [--home dir]
                                                     Local Play bridge on 127.0.0.1. --print-config never prints secrets.
                                                     Sign in with ChatGPT stays off unless LEDRING_SIWC=1 and both
                                                     LEDRING_SIWC_AUTH_BASE and LEDRING_SIWC_API_BASE are set.
  ledring help

Traces may be files or directories (*.jsonl, *.json). Formats are auto-detected:
claude-code (session JSONL), otel-genai (OTLP/JSON GenAI spans).
`;

export function loadRuns(io: IO, paths: string[], adapter?: string): Run[] {
  if (paths.length === 0) throw new Error("No trace files given.");
  return io.expand(paths).flatMap((p) => parseTrace(io.readFile(p), { filename: basename(p), ...(adapter ? { adapter } : {}) }));
}

type Command = (args: string[], io: IO) => number | Promise<number>;

function openBrowser(url: string): void {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { stdio: "ignore", detached: true });
  child.on("error", () => undefined);
  child.unref();
}

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
        lang: { type: "string" },
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
      ...(values.lang === "zh" ? { lang: "zh" as const } : {}),
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
  trust(args, io) {
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: { json: { type: "boolean" }, settings: { type: "string" }, out: { type: "string" }, threshold: { type: "string" }, "min-samples": { type: "string" }, adapter: { type: "string" } },
    });
    const num = (v: string | undefined, flag: string) => {
      if (v === undefined) return undefined;
      const n = Number(v);
      if (!Number.isFinite(n)) throw new Error(`${flag} expects a number, got "${v}"`);
      return n;
    };
    const threshold = num(values.threshold, "--threshold");
    const minSamples = num(values["min-samples"], "--min-samples");
    const policy = learnPolicy(loadRuns(io, positionals, values.adapter), { ...(threshold !== undefined ? { threshold } : {}), ...(minSamples !== undefined ? { minSamples } : {}) });
    const suggested = toClaudeCodePermissions(policy);
    const current = values.settings ? (JSON.parse(io.readFile(values.settings)) as Parameters<typeof diffPermissions>[0]) : undefined;
    const diff = diffPermissions(current, suggested);
    if (values.out) {
      if (values.settings && resolve(values.out) === resolve(values.settings)) throw new Error("refusing to overwrite --settings; write the suggestion to a separate file");
      io.writeFile(values.out, JSON.stringify(diff.merged, null, 2) + "\n");
    }
    if (values.json) io.out(JSON.stringify({ policy, suggested, diff }, null, 2) + "\n");
    else io.out(formatTrust(policy, diff, values.out));
    return 0;
  },
  card(args, io) {
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: { settings: { type: "string" }, mcp: { type: "string" }, url: { type: "string" }, version: { type: "string" }, out: { type: "string" }, svg: { type: "string" } },
    });
    const [agentPath] = positionals;
    if (!agentPath || positionals.length > 1) throw new Error("expects exactly one agent markdown file or play trace");
    const source = io.readFile(agentPath);
    if (source.trimStart().startsWith("{")) {
      const parsed = JSON.parse(source) as { schema?: unknown; instruction?: unknown; "x-ledring-play"?: { ending?: unknown } };
      if (parsed.schema !== "ledring.trace.v1") throw new Error("JSON card input must be a ledring.trace.v1 play trace");
      const ending = typeof parsed["x-ledring-play"]?.ending === "string" ? parsed["x-ledring-play"].ending : undefined;
      const card = cardFromPlayTrace({
        ...(typeof parsed.instruction === "string" ? { instruction: parsed.instruction } : {}),
        ...(ending ? { ending } : {}),
      });
      const json = JSON.stringify(card, null, 2) + "\n";
      if (values.svg) io.writeFile(values.svg, renderCardSvg(card));
      if (values.out) io.writeFile(values.out, json);
      else io.out(json);
      return 0;
    }
    // In a project layout (.claude/agents/x.md) pick up settings and .mcp.json unless given.
    const claudeDir = dirname(dirname(resolve(agentPath)));
    const tryRead = (explicit: string | undefined, fallback: string) => {
      if (explicit) return io.readFile(explicit);
      if (!claudeDir.endsWith(".claude")) return undefined;
      try { return io.readFile(fallback); } catch { return undefined; }
    };
    const settings = tryRead(values.settings, join(claudeDir, "settings.json"));
    const mcp = tryRead(values.mcp, join(dirname(claudeDir), ".mcp.json"));
    const card = cardFromConfig({
      agent: source,
      ...(settings ? { settings } : {}),
      ...(mcp ? { mcp } : {}),
      ...(values.url ? { url: values.url } : {}),
      ...(values.version ? { version: values.version } : {}),
    });
    const json = JSON.stringify(card, null, 2) + "\n";
    if (values.svg) io.writeFile(values.svg, renderCardSvg(card));
    if (values.out) io.writeFile(values.out, json);
    else io.out(json);
    if (!values.url) io.err("note: no --url given, so supportedInterfaces is empty; set it before publishing the card\n");
    return 0;
  },
  redwall(args, io) {
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: { scenarios: { type: "string" }, json: { type: "boolean" }, "fail-on": { type: "string" }, adapter: { type: "string" } },
    });
    const failOn = values["fail-on"] as Outcome | undefined;
    if (failOn && !OUTCOMES.includes(failOn)) throw new Error(`--fail-on expects one of ${OUTCOMES.join(", ")}`);
    const scenarios = values.scenarios ? parseScenarios(io.readFile(values.scenarios)) : defaultScenarios;
    const report = runScenarios(loadRuns(io, positionals, values.adapter), scenarios);
    io.out(values.json ? JSON.stringify(report, null, 2) + "\n" : formatRedWall(report));
    if (failOn) {
      const min = OUTCOMES.indexOf(failOn);
      const bad = report.results.filter((r) => OUTCOMES.indexOf(r.outcome) >= min);
      if (bad.length) {
        io.err(`${bad.length} run(s) ${failOn === "workaround" ? "worked around a wall" : `ended at or beyond "${failOn}"`}\n`);
        return 3;
      }
    }
    return 0;
  },
  async play(args, io) {
    const { values } = parseArgs({
      args,
      options: {
        port: { type: "string" },
        "no-open": { type: "boolean" },
        "print-config": { type: "boolean" },
        home: { type: "string" },
      },
    });
    const home = values.home ?? join(homedir(), ".ledring", "play");
    const loaded = readProviderHome(home);
    const authBase = process.env.LEDRING_SIWC_AUTH_BASE;
    const apiBase = process.env.LEDRING_SIWC_API_BASE;
    const siwc = {
      enabled: process.env.LEDRING_SIWC === "1",
      configured: Boolean(authBase && apiBase),
      ...(authBase ? { authBase } : {}),
      ...(apiBase ? { apiBase } : {}),
      home,
    };
    if (values["print-config"]) {
      io.out(formatProviderConfig(loaded.config, loaded.warning, siwc));
      return 0;
    }
    const port = values.port === undefined ? 0 : Number(values.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("--port expects a TCP port");
    const bridge = await startBridge({
      port,
      config: loaded.config,
      siwc,
      home,
      ...(values["no-open"] ? {} : { open: openBrowser }),
    });
    io.out(`ledring play ${bridge.url}\n`);
    return await new Promise<number>((resolve) => {
      const stop = () => {
        void bridge.close().then(() => resolve(0));
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    });
  },
};

function formatRedWall(report: RedWallReport): string {
  const mark: Record<Outcome, string> = { asked: "○ asked", stopped: "○ stopped", retried: "◐ retried", workaround: "● WORKAROUND" };
  const lines = [`RED WALL · ${report.runs} runs · ${report.summary.length} scenarios`, ""];
  for (const s of report.summary) {
    const counts = OUTCOMES.filter((o) => s.counts[o]).map((o) => `${s.counts[o]} ${o}`).join(" · ");
    lines.push(`  ${s.scenario}  ${s.hit ? `hit in ${s.hit} run(s): ${counts}` : "not hit"}`);
    for (const r of report.results.filter((x) => x.scenario === s.scenario))
      lines.push(`    ${mark[r.outcome].padEnd(13)} ${r.runId.split("#")[0]}  blocked ${r.blocked.signature}${r.evidence ? ` → ${r.evidence.signature} (${r.evidence.detail})` : ""}`);
  }
  return lines.join("\n") + "\n";
}

function formatTrust(policy: Policy, diff: PermissionsDiff, out?: string): string {
  const lines = [`TRUST · ${policy.runs} runs · ${policy.rules.length} action types${policy.ignored ? ` · ${policy.ignored} policy decisions ignored` : ""}`, ""];
  const w = Math.max(10, ...policy.rules.map((r) => r.rule.length));
  for (const r of policy.rules) {
    const n = r.allowed + r.denied;
    const filled = Math.round(r.lowerBound * 10);
    const bar = "█".repeat(filled) + "░".repeat(10 - filled);
    const verdict = r.verdict === "allow" ? "→ ALLOW" : r.verdict === "deny" ? "→ DENY" : r.destructive ? "NEVER AUTO" : "→ ask";
    lines.push(`  ${r.rule.padEnd(w)}  ${bar}  ${`${r.allowed}/${n}`.padStart(6)}  ${verdict.padEnd(10)}  ${r.reasons.join("; ")}`);
  }
  lines.push("", "Suggested changes (nothing was written to your settings):");
  let any = false;
  for (const k of ["allow", "ask", "deny"] as const) for (const rule of diff.add[k]) { lines.push(`  + ${k.padEnd(5)} ${rule}`); any = true; }
  for (const c of diff.conflicts) { lines.push(`  ! ${c.rule}: currently ${c.current}, history suggests ${c.suggested}`); any = true; }
  if (!any) lines.push("  (none)");
  if (out) lines.push("", `Wrote merged suggestion to ${out}`);
  return lines.join("\n") + "\n";
}

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

/**
 * Accepts flat viewer tokens, `{ dark: {...}, light: {...} }`, or a structured
 * design-tokens file (`{ color: { bg: { base } }, font, radius, motion }`).
 */
function readTokens(text: string): { tokens?: Partial<Tokens>; darkTokens?: Partial<Tokens> } {
  const t = JSON.parse(text) as Record<string, unknown>;
  if (t.color && typeof t.color === "object") return { tokens: fromDesignTokens(t) };
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
    return await command(rest, io);
  } catch (e) {
    io.err(`ledring ${cmd}: ${(e as Error).message}\n`);
    return 1;
  }
}
