import { z } from "zod";

/** Schema identifier written into every normalized run. */
export const TRACE_SCHEMA = "ledring.trace.v1" as const;

export const StepKind = z.enum(["plan", "llm", "tool", "agent", "handoff", "human"]);
export type StepKind = z.infer<typeof StepKind>;

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
  agent: z.object({ name: z.string().optional(), model: z.string().optional() }).optional(),
  outcome: z.enum(["success", "failure", "unknown"]).optional(),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  steps: z.array(StepSchema),
});
export type Run = z.infer<typeof RunSchema>;
