const SHELL_TOOLS = new Set(["bash", "shell", "exec_command", "run_shell", "terminal", "run_terminal_cmd"]);
const TWO_WORD = new Set(["npm", "pnpm", "yarn", "bun", "npx", "git", "gh", "cargo", "go", "docker", "kubectl", "pip", "uv", "make", "python", "python3", "node"]);
const PATH_KEYS = ["file_path", "path", "notebook_path", "filename", "file"];

function shellHead(command: string): string {
  const words = command.trim().split(/\s+/).filter((w) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w));
  const [first = "", second] = words;
  if (TWO_WORD.has(first) && second && !second.startsWith("-")) return `${first} ${second}`;
  return first;
}

function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

/**
 * A short, stable key meaning "the same choice" across runs.
 * Shell tools → leading command words; file tools → basename; others → tool name.
 * Changing these rules changes every branch tree (see ADR 0001).
 */
export function signatureOf(name: string, input?: unknown): string {
  const obj = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  if (SHELL_TOOLS.has(name.toLowerCase())) {
    const cmd = obj.command ?? obj.cmd;
    const head = typeof cmd === "string" ? shellHead(cmd) : Array.isArray(cmd) ? shellHead(cmd.join(" ")) : "";
    return head ? `${name}(${head})` : name;
  }
  for (const k of PATH_KEYS) {
    const v = obj[k];
    if (typeof v === "string" && /[./\\]/.test(v) && k !== "path") return `${name}(${basename(v)})`;
    if (typeof v === "string" && k === "path" && /\.[A-Za-z0-9]+$/.test(v)) return `${name}(${basename(v)})`;
  }
  return name;
}

/** File paths a step's input refers to, if any. */
export function pathsOf(input: unknown): string[] {
  if (!input || typeof input !== "object") return [];
  const obj = input as Record<string, unknown>;
  return PATH_KEYS.map((k) => obj[k]).filter((v): v is string => typeof v === "string");
}
