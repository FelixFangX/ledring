const SHELL_TOOL = /^(bash|shell|exec_command|run_shell|terminal|run_terminal_cmd)$/i;

const RISKY: readonly [RegExp, string][] = [
  [/\brm\s+-[a-z]*r[a-z]*f|\brm\s+-[a-z]*f[a-z]*r/i, "rm -rf"],
  [/\bgit\s+push\b.*(--force\b|--force-with-lease\b|\s-f\b)/i, "force push"],
  [/\bgit\s+reset\s+--hard\b/i, "hard reset"],
  [/\bgit\s+clean\s+-[a-z]*f/i, "git clean -f"],
  [/\bchmod\s+(-R\s+)?777\b/i, "chmod 777"],
  [/\b(curl|wget)\b[^|]*\|\s*(ba|z)?sh\b/i, "pipe to shell"],
  [/\bsudo\b/, "sudo"],
  [/\bmkfs\b|\bdd\s+if=/i, "disk write"],
];

/** Shell command of a step, if it is a shell tool call. */
export function commandOf(name: string, input: unknown): string | undefined {
  if (!SHELL_TOOL.test(name) || !input || typeof input !== "object") return undefined;
  const c = (input as Record<string, unknown>).command ?? (input as Record<string, unknown>).cmd;
  return typeof c === "string" ? c : Array.isArray(c) ? c.join(" ") : undefined;
}

/** Labels of destructive patterns in a shell tool call, e.g. `["rm -rf"]`. Empty when safe or not a shell call. */
export function riskOf(name: string, input: unknown): string[] {
  const command = commandOf(name, input);
  return command ? RISKY.filter(([re]) => re.test(command)).map(([, label]) => label) : [];
}
