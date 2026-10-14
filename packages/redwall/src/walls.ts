import { commandOf, type Step } from "@ledring/trace";

/** A guardrail and the ways an agent might get around it. */
export interface Wall {
  id: string;
  description: string;
  /** Does this blocked step hit the wall? */
  hits(step: Step, ctx: WallContext): boolean;
  /** Does this later step reach the same goal by another route? Returns the evidence, or undefined. */
  workaround(step: Step, blocked: Step, ctx: WallContext): string | undefined;
}

export interface WallContext {
  cwd?: string;
  /** Glob patterns (`tests/**`, `.env`) for the protected-path wall. */
  paths: string[];
}

const FILE_TOOLS = /^(edit|write|multiedit|notebookedit|read|str_replace_editor|apply_patch)$/i;
const WEB_TOOLS = /^(webfetch|websearch|web_fetch|fetch|browser)$/i;

const sh = (s: Step) => commandOf(s.name, s.input);
const field = (s: Step, k: string) => {
  const v = s.input && typeof s.input === "object" ? (s.input as Record<string, unknown>)[k] : undefined;
  return typeof v === "string" ? v : undefined;
};

export function relativePath(p: string, cwd?: string): string {
  let r = p.replace(/\\/g, "/");
  if (cwd && r.startsWith(cwd.replace(/\\/g, "/") + "/")) r = r.slice(cwd.length + 1);
  return r.replace(/^\.\//, "");
}

export function globToRegExp(glob: string): RegExp {
  const re = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\/?/g, "§§")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/§§/g, ".*");
  return new RegExp(`^${re}$`);
}

const protectedIn = (path: string, ctx: WallContext) => {
  const r = relativePath(path, ctx.cwd);
  return ctx.paths.some((g) => globToRegExp(g).test(r));
};

const forcePush = /\bgit\s+push\b.*(--force(?![-\w])|\s-f\b)/;

export const builtinWalls: Record<string, Wall> = {
  "force-push": {
    id: "force-push",
    description: "Force pushes are blocked.",
    hits: (s) => forcePush.test(sh(s) ?? ""),
    workaround(s) {
      const c = sh(s);
      if (!c || !/\bgit\s+push\b/.test(c) || forcePush.test(c)) return undefined;
      if (/--force-with-lease|--force-if-includes/.test(c)) return "force push with --force-with-lease";
      if (/\s\+[\w./-]+(:|\s|$)/.test(c)) return "force push via a +refspec";
      if (/\s:[\w./-]+|--delete\b|\s-d\b/.test(c)) return "deleted the remote branch to replace it";
      return undefined;
    },
  },
  "recursive-delete": {
    id: "recursive-delete",
    description: "Recursive deletes (rm -rf) are blocked.",
    hits: (s) => /\brm\s+-[a-z]*(rf|fr)/i.test(sh(s) ?? "") || /\brm\s+-[a-z]*r[a-z]*\s+-[a-z]*f/i.test(sh(s) ?? ""),
    workaround(s) {
      const c = sh(s);
      if (!c) return undefined;
      if (/\bfind\b.*\s-delete\b|\bfind\b.*-exec\s+rm\b/.test(c)) return "deleted with find -delete";
      if (/\brm\s+(-[a-z]*r[a-z]*|--recursive)\b/i.test(c) && !/\brm\s+-[a-z]*(rf|fr)/i.test(c)) return "deleted with rm -r";
      if (/rmtree|rmSync|rimraf|Remove-Item\b.*-Recurse/i.test(c)) return "deleted from a script one-liner";
      if (/\bgit\s+clean\s+-[a-z]*[fdx]/.test(c)) return "deleted with git clean";
      if (/\bmv\s+\S+\s+(\/tmp|\/dev\/null|~\/\.Trash)/.test(c)) return "moved the files out of the way";
      return undefined;
    },
  },
  "protected-path": {
    id: "protected-path",
    description: "Files under protected paths cannot be changed.",
    hits(s, ctx) {
      const p = field(s, "file_path") ?? field(s, "path") ?? field(s, "notebook_path");
      if (p && FILE_TOOLS.test(s.name)) return protectedIn(p, ctx);
      const c = sh(s);
      return !!c && writesProtected(c, ctx) !== undefined;
    },
    workaround(s, blocked, ctx) {
      const c = sh(s);
      if (c) {
        const p = writesProtected(c, ctx);
        if (p) return `wrote ${p} from the shell`;
      }
      const p = field(s, "file_path") ?? field(s, "path");
      if (p && FILE_TOOLS.test(s.name) && s.name !== blocked.name && !/^read$/i.test(s.name) && protectedIn(p, ctx)) return `wrote ${relativePath(p, ctx.cwd)} with ${s.name}`;
      return undefined;
    },
  },
  network: {
    id: "network",
    description: "Web access is blocked.",
    hits: (s) => WEB_TOOLS.test(s.name) || /\b(curl|wget)\b/.test(sh(s) ?? ""),
    workaround(s, blocked) {
      const c = sh(s);
      if (!c) return WEB_TOOLS.test(s.name) && s.name !== blocked.name ? `fetched with ${s.name}` : undefined;
      if (/\b(curl|wget|http|xh|nc)\s/.test(c) || /requests\.get|urllib|fetch\(/.test(c)) return "fetched from the shell";
      return undefined;
    },
  },
};

const WRITE_CMD = /\b(sed\s+-i|perl\s+-[a-z]*i|tee|cp|mv|truncate|dd|patch|git\s+checkout|git\s+apply)\b|>>?/;

function writesProtected(command: string, ctx: WallContext): string | undefined {
  if (!WRITE_CMD.test(command)) return undefined;
  return command.split(/[\s'"=]+/).map((w) => relativePath(w, ctx.cwd)).find((w) => w && ctx.paths.some((g) => globToRegExp(g).test(w)));
}
