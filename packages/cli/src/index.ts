import { basename } from "node:path";
import { parseArgs } from "node:util";
import { parseTrace, type Run } from "@ledring/trace";
import { nodeIO, type IO } from "./io.js";

export type { IO } from "./io.js";

const HELP = `ledring — status lights for AI agents

Usage:
  ledring inspect <traces...> [--adapter name]       Print normalized ledring.trace.v1 runs as JSON
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
};

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
