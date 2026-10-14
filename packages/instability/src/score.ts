import { commandOf, pathsOf, riskOf, type Run } from "@ledring/trace";
import { extractConstraints, type Constraint } from "./constraints.js";

export const INSTABILITY_SCHEMA = "ledring.instability.v1" as const;
export type Level = "calm" | "processing" | "critical";

export interface StepScore { stepId: string; signature: string; delta: number; score: number; reasons: string[] }
export interface InstabilityReport {
  schema: typeof INSTABILITY_SCHEMA;
  runId: string;
  instruction?: string;
  /** Final score, 0..100. Heuristic, not a ground truth. */
  score: number;
  peak: number;
  level: Level;
  constraints: Constraint[];
  steps: StepScore[];
}

export interface ScoreOptions {
  /** Score against this instruction instead of the run's own. */
  instruction?: string;
}

/** Weights for each signal. Exported so callers can see what drives the score. */
export const WEIGHTS = { forbidden: 20, risky: 15, outOfScope: 8, toolError: 3, compliantWrite: -3, passingCheck: -2 } as const;

const WRITE_TOOL = /edit|write|create|delete|remove|move|rename|patch|apply|multiedit|notebookedit/i;
const CHECK = /\b(test|vitest|jest|pytest|lint|typecheck|tsc)\b/;
const TEST_FILE = /(\.|_)(test|spec)\.[\w]+$|(^|\/)(__tests__|tests?)\//i;

const within = (path: string, target: string) => {
  const p = `/${path.replace(/\\/g, "/")}`;
  return p.includes(`/${target}/`) || p.endsWith(`/${target}`);
};
const levelOf = (s: number): Level => (s >= 40 ? "critical" : s >= 20 ? "processing" : "calm");

/** Score how far a run drifts from its instruction, step by step. */
export function scoreInstability(run: Run, opts: ScoreOptions = {}): InstabilityReport {
  const instruction = opts.instruction ?? run.instruction;
  const constraints = instruction ? extractConstraints(instruction) : [];
  const scopes = constraints.filter((c) => c.kind === "scope").map((c) => c.target);
  // Hard drift (broken constraints, risky commands) is never forgiven by later
  // good behaviour; soft drift (scope, errors) can calm down again.
  let hard = 0;
  let soft = 0;
  let score = 0;
  let peak = 0;
  const steps: StepScore[] = [];

  for (const step of run.steps) {
    const reasons: string[] = [];
    let delta = 0;
    let hardDelta = 0;
    const add = (d: number, why: string, isHard = false) => { if (isHard) hardDelta += d; else delta += d; reasons.push(why); };
    const writes = WRITE_TOOL.test(step.name) ? pathsOf(step.input) : [];
    for (const path of writes) {
      let bad = false;
      for (const c of constraints) {
        if (c.kind === "forbid-tests" && TEST_FILE.test(path)) { add(WEIGHTS.forbidden, `edited tests (“${c.text}”)`, true); bad = true; }
        if (c.kind === "forbid-path" && within(path, c.target)) { add(WEIGHTS.forbidden, `edited ${c.target} (“${c.text}”)`, true); bad = true; }
      }
      if (scopes.length && !scopes.some((s) => within(path, s))) { add(WEIGHTS.outOfScope, `wrote outside scope ${scopes.join(", ")}`); bad = true; }
      if (!bad && scopes.length) add(WEIGHTS.compliantWrite, "write within scope");
    }
    const command = commandOf(step.name, step.input) ?? "";
    const risks = riskOf(step.name, step.input);
    for (const label of risks) add(WEIGHTS.risky, `risky command: ${label}`, true);
    if (step.isError) add(WEIGHTS.toolError, "tool reported an error");
    else if (command && CHECK.test(command) && risks.length === 0) add(WEIGHTS.passingCheck, "checks passed");

    hard = Math.min(100, hard + hardDelta);
    soft = Math.max(0, Math.min(100 - hard, soft + delta));
    const next = hard + soft;
    delta = next - score;
    score = next;
    peak = Math.max(peak, score);
    steps.push({ stepId: step.id, signature: step.signature, delta, score, reasons });
  }

  const report: InstabilityReport = { schema: INSTABILITY_SCHEMA, runId: run.id, score, peak, level: levelOf(score), constraints, steps };
  if (instruction !== undefined) report.instruction = instruction;
  return report;
}
