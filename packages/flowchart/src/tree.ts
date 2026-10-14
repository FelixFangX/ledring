import type { Run, StepKind } from "@ledring/trace";

export const BRANCH_TREE_SCHEMA = "ledring.branch-tree.v1" as const;

export interface BranchNode {
  /** Path id, e.g. `0.1.0`. Root is `0`. */
  id: string;
  signature: string;
  depth: number;
  /** Runs that reached this node. */
  count: number;
  /** count / parent.count, 0..1. Root is 1. This is the divergence share. */
  share: number;
  runIds: string[];
  /** Runs whose step at this node reported an error. */
  errors: number;
  /** Runs whose last step is this node. */
  ends: number;
  outcomes: { success: number; failure: number; unknown: number };
  children: BranchNode[];
}

export interface BranchTree {
  schema: typeof BRANCH_TREE_SCHEMA;
  runCount: number;
  /** Most common instruction across runs, if any. */
  instruction?: string;
  root: BranchNode;
  runs: { id: string; source: string; outcome: string; path: string[] }[];
}

export interface BuildOptions {
  /** Step kinds that count as decisions. Default: everything except `llm`. */
  kinds?: readonly StepKind[];
}

const DEFAULT_KINDS: readonly StepKind[] = ["plan", "tool", "agent", "handoff", "human"];

function node(id: string, signature: string, depth: number): BranchNode {
  return { id, signature, depth, count: 0, share: 0, runIds: [], errors: 0, ends: 0, outcomes: { success: 0, failure: 0, unknown: 0 }, children: [] };
}

/** Merge runs into a prefix tree of step signatures, with divergence shares at every fork. */
export function buildBranchTree(runs: readonly Run[], opts: BuildOptions = {}): BranchTree {
  if (runs.length === 0) throw new Error("buildBranchTree needs at least one run.");
  const kinds = new Set(opts.kinds ?? DEFAULT_KINDS);
  const root = node("0", "start", 0);
  const paths: BranchTree["runs"] = [];
  const instructions = new Map<string, number>();

  for (const run of runs) {
    const outcome = run.outcome ?? "unknown";
    if (run.instruction) instructions.set(run.instruction, (instructions.get(run.instruction) ?? 0) + 1);
    const visit = (n: BranchNode) => {
      n.count++;
      n.runIds.push(run.id);
      n.outcomes[outcome]++;
    };
    visit(root);
    let cur = root;
    const path = [root.id];
    for (const step of run.steps.filter((s) => kinds.has(s.kind))) {
      let next = cur.children.find((c) => c.signature === step.signature);
      if (!next) {
        next = node(`${cur.id}.${cur.children.length}`, step.signature, cur.depth + 1);
        cur.children.push(next);
      }
      visit(next);
      if (step.isError) next.errors++;
      cur = next;
      path.push(cur.id);
    }
    cur.ends++;
    paths.push({ id: run.id, source: run.source, outcome, path });
  }

  const share = (n: BranchNode) => {
    for (const c of n.children) {
      c.share = c.count / n.count;
      share(c);
    }
    n.children.sort((a, b) => b.count - a.count);
  };
  root.share = 1;
  share(root);

  const tree: BranchTree = { schema: BRANCH_TREE_SCHEMA, runCount: runs.length, root, runs: paths };
  const top = [...instructions.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top) tree.instruction = top[0];
  return tree;
}

/** Format a share as a whole percentage, e.g. `67%`. */
export const pct = (share: number) => `${Math.round(share * 100)}%`;
