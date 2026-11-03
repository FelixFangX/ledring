import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/** Filesystem and stdout the command uses. Tests pass a fake. */
export interface IO {
  out(text: string): void;
  err(text: string): void;
  readFile(path: string): string;
  writeFile(path: string, text: string): void;
  /** Expand directories into the trace files they contain. */
  expand(paths: string[]): string[];
}

/**
 * One normalized run (`ledring.trace.v1`).
 * Beta publishes the `ledring` command; the workspace libraries are bundled in
 * and are not separate npm packages. Extra fields are present at runtime.
 */
export interface TraceRun {
  schema: "ledring.trace.v1";
  id: string;
}

export function loadRuns(io: IO, paths: string[], adapter?: string): TraceRun[];

/** Run the CLI. Returns the process exit code. */
export function run(argv: string[], io?: IO): Promise<number>;

/** Read-only stdio MCP server. The caller connects a transport. */
export function createMcpServer(io: IO): McpServer;
