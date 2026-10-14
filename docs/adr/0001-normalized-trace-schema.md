# 0001 — One normalized trace schema, adapters at the edge

**Context.** Agent traces come in many shapes: Claude Code session JSONL, OpenTelemetry GenAI spans (still "Development" status upstream), LangGraph runs, OpenAI Agents SDK traces. Every LEDRING view needs the same few facts: the instruction, the ordered steps, and a way to tell when two runs made "the same choice".

**Decision.** Define `ledring.trace.v1` (Zod, in `@ledring/trace`) as a small *projection* of OTel GenAI concepts: `Run { instruction, agent, steps[] }`, `Step { kind, name, signature, input, output, isError }`. Each external format is an `Adapter { name, detect, parse }`. Views depend only on the schema, never on a source format. Step kinds and names follow OTel GenAI operation names (`execute_tool`→`tool`, `chat`→`llm`, `invoke_agent`→`agent`, `plan`→`plan`).

**Consequences.**
- Adding a format touches one adapter + fixtures; views are unaffected.
- The schema is lossy by design; adapters keep the raw source object in `step.raw` only when asked (`keepRaw`), so views stay small.
- Signature rules live in one place (`signatureOf`) so merging behaves the same for every format. Changing them changes every branch tree — treat as a breaking change.
- Upstream OTel GenAI attribute names may change; the OTel adapter accepts known aliases and is the only place to update.
