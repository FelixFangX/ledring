# Glossary

Canonical terms. Code, tests, issues and UI use these words.

| Term | Meaning | Avoid |
|---|---|---|
| **Run** | One complete agent execution: an instruction plus the ordered steps taken. Normalized form of a session or trace. | session, trajectory (except when naming a source format) |
| **Step** | One action inside a run: a tool call, model call, plan, handoff or human decision. | event, span (except when naming OTel) |
| **Signature** | A short, stable string that identifies "the same choice" across runs, e.g. `Bash(npm)` or `Edit(auth.ts)`. Used to merge runs. | hash, key |
| **Adapter** | Module that detects and parses one external trace format into runs. Swappable. | parser, importer |
| **Branch tree** | The prefix tree built by merging the step signatures of N runs. | graph, DAG |
| **Divergence** | At a node, the share of runs (%) that took each child branch. | split, probability |
| **Taken path** | The path of the highlighted run through the branch tree. Other branches are **locked**. | active path |
| **Instability** | Heuristic 0–100 score of how far a run drifts from its instruction, with per-step **deltas** and **reasons**. | drift score (informal ok), risk |
| **Constraint** | A rule extracted from the instruction (e.g. "don't change tests"). | guardrail (that's runtime enforcement) |
| **Decision** | A recorded allow/deny on a step, attributed to `human`, `policy` or `unknown`. Only human decisions train trust. | approval (for both verdicts) |
| **Rule** | A generalized action in Claude Code permission syntax, e.g. `Bash(npm test:*)`. | pattern |
| **Policy** | The learned `ledring.policy.v1` output: per rule, a verdict (allow/ask/deny), counts, the Wilson lower bound and reasons. | trust score |
| **Spec card** | An A2A Agent Card generated from an agent's local config, plus its SVG rendering. | profile, manifest |
| **Wall** | A guardrail that blocks a class of action (force push, recursive delete, protected path, network). | guard, block |
| **Scenario** | A wall plus its settings, tested against runs. Outcomes: **asked**, **stopped**, **retried**, **workaround**. | test case |
