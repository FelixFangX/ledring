import { commandOf, riskOf, type Step } from "@ledring/trace";

const PKG = new Set(["npm", "pnpm", "yarn", "bun", "npx", "uv", "cargo", "go", "make", "pip", "python", "python3", "node", "docker", "kubectl", "gh", "git"]);
const SUB3 = new Set(["run", "exec", "x", "dlx"]);
const FILE_TOOLS = /^(read|edit|write|multiedit|notebookedit|notebookread)$/i;

/**
 * Leading command words. For destructive commands the flags are kept
 * (`git push --force`, `rm -rf`) so a rule never covers the safe variant.
 */
function shellPrefix(command: string, destructive: boolean): string {
  const words = command.trim().split(/\s+/).filter((w) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w));
  const out: string[] = [];
  if (destructive) {
    for (const w of words) {
      if (/[|;&<>]/.test(w)) break;
      if (!w.startsWith("-") && out.some((x) => x.startsWith("-"))) break;
      out.push(w);
    }
    if (out.some((x) => x.startsWith("-"))) return out.join(" ");
    out.length = 0;
  }
  for (const w of words) {
    if (w.startsWith("-") || /[|;&<>]/.test(w)) break;
    out.push(w);
    const max = PKG.has(out[0]!) ? (SUB3.has(out[1] ?? "") ? 3 : 2) : 1;
    if (out.length >= max) break;
  }
  return out.join(" ");
}

function relative(path: string, cwd?: string): string | undefined {
  const p = path.replace(/\\/g, "/");
  if (!p.startsWith("/")) return p.replace(/^\.\//, "");
  if (!cwd) return undefined;
  const base = cwd.replace(/\\/g, "/").replace(/\/$/, "") + "/";
  return p.startsWith(base) ? p.slice(base.length) : undefined;
}

/**
 * The Claude Code permission rule that covers a step, e.g. `Bash(npm test:*)`,
 * `Edit(src/**)`, `WebFetch(domain:example.com)`. File rules are relative to the
 * run's working directory; files outside it fall back to the bare tool name.
 */
export function ruleOf(step: Pick<Step, "name" | "input">, cwd?: string): string {
  const { name, input } = step;
  const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const command = commandOf(name, input);
  if (command !== undefined) {
    const prefix = shellPrefix(command, riskOf(name, input).length > 0);
    return prefix ? `${name}(${prefix}:*)` : name;
  }
  if (FILE_TOOLS.test(name)) {
    const path = [obj.file_path, obj.notebook_path, obj.path].find((v): v is string => typeof v === "string");
    const rel = path ? relative(path, cwd) : undefined;
    if (!rel) return name;
    const [first, ...rest] = rel.split("/");
    return rest.length ? `${name}(${first}/**)` : `${name}(${first})`;
  }
  if (/^webfetch$/i.test(name) && typeof obj.url === "string") {
    try {
      return `${name}(domain:${new URL(obj.url).hostname})`;
    } catch {
      return name;
    }
  }
  return name;
}
