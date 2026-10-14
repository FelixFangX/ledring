import { riskOf, type Run } from "@ledring/trace";
import { ruleOf } from "./rule.js";

export const POLICY_SCHEMA = "ledring.policy.v1" as const;
export type Verdict = "allow" | "ask" | "deny";

export interface PolicyRule {
  rule: string;
  verdict: Verdict;
  /** Calls that ran (approved or already allowed) or were explicitly allowed. */
  allowed: number;
  /** Calls a human (or an unknown actor) rejected. */
  denied: number;
  /** Wilson 95% lower bound of the allow rate. */
  lowerBound: number;
  /** True when any observed call matched a destructive pattern. */
  destructive: boolean;
  reasons: string[];
}

export interface Policy {
  schema: typeof POLICY_SCHEMA;
  options: Required<LearnOptions>;
  runs: number;
  /** Steps skipped because a policy (not a person) made the call. */
  ignored: number;
  rules: PolicyRule[];
}

export interface LearnOptions {
  /** Minimum Wilson lower bound to suggest `allow`. Default 0.6 (≈ 6 of 6 with no denials). */
  threshold?: number;
  /** Minimum decisions before suggesting `allow` or `deny`. Default 5. */
  minSamples?: number;
  /** Minimum denials before suggesting `deny`. Default 3. */
  minDenials?: number;
}

const Z = 1.96;
function wilsonLower(k: number, n: number): number {
  if (n === 0) return 0;
  const p = k / n, z2 = Z * Z;
  return (p + z2 / (2 * n) - Z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / (1 + z2 / n);
}
const round = (x: number) => Math.round(x * 1000) / 1000;

/** Learn a suggested permission policy from the allow/deny history in runs. */
export function learnPolicy(runs: readonly Run[], opts: LearnOptions = {}): Policy {
  const options = { threshold: opts.threshold ?? 0.6, minSamples: opts.minSamples ?? 5, minDenials: opts.minDenials ?? 3 };
  const stats = new Map<string, { allowed: number; denied: number; destructive: Set<string> }>();
  let ignored = 0;
  for (const run of runs) {
    for (const step of run.steps) {
      if (step.kind !== "tool") continue;
      const d = step.decision;
      if (d?.by === "policy") { ignored++; continue; }
      const key = ruleOf(step, run.cwd);
      const s = stats.get(key) ?? { allowed: 0, denied: 0, destructive: new Set<string>() };
      stats.set(key, s);
      if (d?.verdict === "deny") s.denied++;
      else s.allowed++;
      for (const r of riskOf(step.name, step.input)) s.destructive.add(r);
    }
  }

  const rules: PolicyRule[] = [...stats.entries()].map(([rule, s]) => {
    const n = s.allowed + s.denied;
    const lb = wilsonLower(s.allowed, n);
    const reasons: string[] = [];
    let verdict: Verdict = "ask";
    if (s.denied >= options.minDenials && s.allowed / n <= 0.2) {
      verdict = "deny";
      reasons.push(`rejected ${s.denied} of ${n} times`);
    } else if (n >= options.minSamples && lb >= options.threshold) {
      if (s.destructive.size) reasons.push(`destructive (${[...s.destructive].join(", ")}): never auto-approved`);
      else {
        verdict = "allow";
        reasons.push(`allowed ${s.allowed} of ${n}, lower bound ${round(lb)} ≥ ${options.threshold}`);
      }
    } else {
      if (s.destructive.size) reasons.push(`destructive (${[...s.destructive].join(", ")}): never auto-approved`);
      if (n < options.minSamples) reasons.push(`only ${n} decision${n === 1 ? "" : "s"} (need ${options.minSamples})`);
      else if (s.denied) reasons.push(`mixed: ${s.allowed} allowed, ${s.denied} rejected`);
      else reasons.push(`lower bound ${round(lb)} < ${options.threshold}`);
    }
    return { rule, verdict, allowed: s.allowed, denied: s.denied, lowerBound: round(lb), destructive: s.destructive.size > 0, reasons };
  });
  const order = { allow: 0, deny: 1, ask: 2 };
  rules.sort((a, b) => order[a.verdict] - order[b.verdict] || b.allowed + b.denied - (a.allowed + a.denied) || a.rule.localeCompare(b.rule));
  return { schema: POLICY_SCHEMA, options, runs: runs.length, ignored, rules };
}
