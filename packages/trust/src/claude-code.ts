import type { Policy } from "./policy.js";

export interface Permissions { allow: string[]; ask: string[]; deny: string[] }
/** The `permissions` block of a Claude Code `settings.json`. */
export interface ClaudeCodeSettings { permissions: Permissions; [k: string]: unknown }

/**
 * Compile a policy to Claude Code permissions. `ask` is emitted only for destructive
 * rules (as an explicit guard); everything else without evidence stays unlisted.
 */
export function toClaudeCodePermissions(policy: Policy): ClaudeCodeSettings {
  const p: Permissions = { allow: [], ask: [], deny: [] };
  for (const r of policy.rules) {
    if (r.verdict === "allow") p.allow.push(r.rule);
    else if (r.verdict === "deny") p.deny.push(r.rule);
    else if (r.destructive) p.ask.push(r.rule);
  }
  return { permissions: p };
}

export interface PermissionsDiff {
  add: Permissions;
  conflicts: { rule: string; current: keyof Permissions; suggested: keyof Permissions }[];
  /** Current settings plus additions. Existing rules are never removed. */
  merged: ClaudeCodeSettings;
}

const KEYS: (keyof Permissions)[] = ["allow", "ask", "deny"];

/** Compare suggested permissions with current settings. Never drops existing rules. */
export function diffPermissions(current: { permissions?: Partial<Permissions>; [k: string]: unknown } | undefined, suggested: ClaudeCodeSettings): PermissionsDiff {
  const cur: Permissions = { allow: [], ask: [], deny: [], ...(current?.permissions ?? {}) } as Permissions;
  const where = (rule: string) => KEYS.find((k) => (cur[k] ?? []).includes(rule));
  const add: Permissions = { allow: [], ask: [], deny: [] };
  const conflicts: PermissionsDiff["conflicts"] = [];
  for (const k of KEYS) {
    for (const rule of suggested.permissions[k]) {
      const at = where(rule);
      if (at === k) continue;
      if (at) conflicts.push({ rule, current: at, suggested: k });
      if (!at || k === "deny" || k === "ask") add[k].push(rule);
    }
  }
  const merged: ClaudeCodeSettings = {
    ...(current ?? {}),
    permissions: { ...(current?.permissions ?? {}), allow: [...(cur.allow ?? []), ...add.allow], ask: [...(cur.ask ?? []), ...add.ask], deny: [...(cur.deny ?? []), ...add.deny] },
  };
  return { add, conflicts, merged };
}
