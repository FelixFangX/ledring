import { z } from "zod";

/** Schema identifier written into every normalized run. */
export const TRACE_SCHEMA = "ledring.trace.v1" as const;

export const StepKind = z.enum(["plan", "llm", "tool", "agent", "handoff", "human"]);
export type StepKind = z.infer<typeof StepKind>;

export const DecisionSchema = z.object({
  verdict: z.enum(["allow", "deny"]),
  /** Who decided. `unknown` when the source cannot tell a human from a policy or an interrupt. */
  by: z.enum(["human", "policy", "unknown"]),
  reason: z.string().optional(),
});
export type Decision = z.infer<typeof DecisionSchema>;

/** Where a step was read from. Omitted fields were not in the source; they are not zeroes. */
export const ProvenanceSchema = z.object({
  /** Path the adapter was given. */
  file: z.string().optional(),
  /** 1-based line of the source record. Absent when the event is not its own line. */
  line: z.number().int().positive().optional(),
  /** Source event id: a Claude message uuid, an OTel span id, or the native step id. */
  eventId: z.string().optional(),
  /** 1-based line of a later record that carried the tool result or the decision. */
  resultLine: z.number().int().positive().optional(),
  resultEventId: z.string().optional(),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

export const StepSchema = z.object({
  id: z.string(),
  parentId: z.string().optional(),
  kind: StepKind,
  /** Tool / model / agent name as reported by the source. */
  name: z.string(),
  /** Stable "same choice" key used to merge runs. See `signatureOf`. */
  signature: z.string(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  isError: z.boolean().optional(),
  /** Explicit permission decision for this step, if the source recorded one. */
  decision: DecisionSchema.optional(),
  /** The call did not run, and the source did not record an allow or a deny. */
  nonExecution: z.enum(["interrupted"]).optional(),
  /** Where this step was read from. */
  provenance: ProvenanceSchema.optional(),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  raw: z.unknown().optional(),
});
export type Step = z.infer<typeof StepSchema>;

export const RunSchema = z.object({
  schema: z.literal(TRACE_SCHEMA),
  id: z.string(),
  /** Adapter name that produced this run, e.g. `claude-code`. */
  source: z.string(),
  instruction: z.string().optional(),
  /** Working directory of the run, when known. */
  cwd: z.string().optional(),
  agent: z.object({ name: z.string().optional(), model: z.string().optional() }).optional(),
  outcome: z.enum(["success", "failure", "unknown"]).optional(),
  /**
   * True only when the adapter saw the input end mid-record.
   * Absence is not a claim that the session finished.
   */
  truncated: z.boolean().optional(),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  steps: z.array(StepSchema),
});
export type Run = z.infer<typeof RunSchema>;
