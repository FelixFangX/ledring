import type { ReviewRun, ReviewStep } from "@ledring/flowchart";
import { scoreInstability, type Finding } from "@ledring/instability";
import type { Run, StepKind } from "@ledring/trace";

const KINDS = new Set<StepKind>(["plan", "tool", "agent", "handoff", "human"]);
const PREVIEW = 280;

function clip(value: unknown): { text?: string; cut?: boolean } {
  if (value === undefined) return {};
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length <= PREVIEW ? { text } : { text: text.slice(0, PREVIEW), cut: true };
}

function notes(list: Finding[]): ReviewStep["findings"] {
  return list.map((finding) => ({ status: finding.status, code: finding.code, text: finding.text }));
}

/** Step evidence for the branch-tree report. One entry per run, in tree order. */
export function reviewOf(runs: readonly Run[], paths: ReadonlyMap<string, readonly string[]>): ReviewRun[] {
  return runs.map((run) => {
    const report = scoreInstability(run);
    const byStep = new Map(report.steps.map((step) => [step.stepId, step]));
    const shown = run.steps.filter((step) => KINDS.has(step.kind));
    const path = paths.get(run.id) ?? [];
    const steps: ReviewStep[] = shown.map((step, index) => {
      const input = clip(step.input);
      const output = clip(step.output);
      const view: ReviewStep = {
        stepId: step.id,
        ...(path[index + 1] ? { nodeId: path[index + 1] } : {}),
        signature: step.signature,
        kind: step.kind,
        findings: notes(byStep.get(step.id)?.findings ?? []),
      };
      if (typeof step.isError === "boolean") view.isError = step.isError;
      if (step.decision) view.decision = { verdict: step.decision.verdict, by: step.decision.by, ...(step.decision.reason ? { reason: step.decision.reason } : {}) };
      if (step.nonExecution) view.nonExecution = step.nonExecution;
      if (step.startedAt) view.startedAt = step.startedAt;
      if (step.parentId) view.parentId = step.parentId;
      if (step.provenance) {
        view.provenance = {
          ...(step.provenance.file ? { file: step.provenance.file } : {}),
          ...(step.provenance.line ? { line: step.provenance.line } : {}),
          ...(step.provenance.eventId ? { eventId: step.provenance.eventId } : {}),
          ...(step.provenance.resultLine ? { resultLine: step.provenance.resultLine } : {}),
        };
      }
      if (input.text !== undefined) view.inputPreview = input.text;
      if (input.cut) view.inputCut = true;
      if (output.text !== undefined) view.outputPreview = output.text;
      if (output.cut) view.outputCut = true;
      return view;
    });
    return {
      id: run.id,
      ...(run.truncated ? { truncated: true } : {}),
      instructionStatus: report.instructionStatus,
      omitted: run.steps.length - shown.length,
      findings: notes(report.findings),
      steps,
    };
  });
}
