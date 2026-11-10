# 0003 — Say when a review note is observed, derived, or unknown

**Context.** Instability and Red Wall were producing confident sentences from missing evidence. A command that looked like a test was "checks passed" whenever the tool had not reported an error. A trace that ended on a blocked step was "stopped". An interrupt reused the same refusal text as a deny. The branch-tree report showed plate counts and did not say which source record a step came from.

**Decision.** Keep `ledring.trace.v1`. Add optional `provenance`, `nonExecution`, and `truncated`. Absence of a provenance field means the adapter did not have it. `truncated: true` means the adapter saw the input end mid-record; leaving it off is not a claim that the session finished.

Score-changing instability notes stay in `reasons`. Every note is also a finding with status `observed`, `derived`, or `unknown`, and the provenance of the step when it exists. `instructionStatus` is `unknown` when no instruction was recorded or supplied. The numeric score remains a heuristic. It is not drift from an instruction in that case.

Red Wall outcomes `asked`, `stopped`, `retried`, and `workaround` are unchanged in meaning, and `stopped` now cites the later step. A new outcome `unknown` means the trace does not show a follow-up. It is outside `--fail-on`. An interrupt is `nonExecution: "interrupted"` and is not a block.

The HTML report embeds those notes for the runs it rendered. Selecting a plate and selecting that step in the list are the same selection.

**Consequences.**
- Readers of `reasons` and the four original Red Wall outcomes keep working. `findings`, `instructionStatus`, `basis`, and `unknown` are additive.
- `passingCheck` still lowers a score only when the tool output itself says the check passed. `ok` does not.
- A recorded deny suppresses the risky-command weight. The command text is still reported as observed.
- Adapters that do not know a line or an event id omit it. OTel spans in one JSON document have an event id and no line. Claude sidechains stay out of the run. Sibling spans stay in start-time order on the branch tree; `parentId` is on the step for the raw note.
