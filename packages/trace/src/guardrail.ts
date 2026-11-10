import type { Decision, Step } from "./schema.js";

const BLOCK_TEXT = /\b(blocked|denied|not allowed|not permitted|doesn't want to proceed)\b/i;

export type GuardrailFact =
  | { status: "none" }
  | { status: "interrupted" }
  | { status: "allow" | "deny"; by: Decision["by"]; reason?: string };

/**
 * What the source recorded about a guardrail.
 * `none` means no decision was recorded. It does not mean the call was allowed.
 */
export function guardrailOf(step: Step): GuardrailFact {
  if (step.nonExecution === "interrupted") return { status: "interrupted" };
  if (!step.decision) return { status: "none" };
  return { status: step.decision.verdict, by: step.decision.by, ...(step.decision.reason ? { reason: step.decision.reason } : {}) };
}

/**
 * Why a step counts as blocked.
 * `observed` is a recorded deny. `derived` is only an error string that looks like a block.
 * An interrupt is neither: the source did not record a decision.
 */
export function blockBasis(step: Step): "observed" | "derived" | undefined {
  const fact = guardrailOf(step);
  if (fact.status === "interrupted") return undefined;
  if (fact.status === "deny") return "observed";
  if (!step.isError) return undefined;
  const text = typeof step.output === "string" ? step.output : JSON.stringify(step.output ?? "");
  return BLOCK_TEXT.test(text) ? "derived" : undefined;
}
