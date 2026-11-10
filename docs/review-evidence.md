# Review evidence

Decision record for the branch-tree review. This is not a certification that LEDRING is production-ready, and it does not authorize anyone to publish the npm package.

## What changed

The report, the instability score, and Red Wall now separate three kinds of note:

- **observed** — a field the adapter read (a deny, a source line, an event id)
- **derived** — a heuristic (a forbidden path, a risky command pattern, a check whose output says it passed)
- **unknown** — the trace does not support the claim

`ledring flowchart` writes one HTML file. The highlighted run is a step list under the tree. Choosing a step selects its plate. Choosing a plate selects that step when the highlighted run went there, and says so when it did not. The side panel has two regions: All runs, for the plate counts, and This run, for the recorded error, the decision, the time, and the recorded parent. A source link opens the call or the result event the note read. The opened block shows that line, the event id, and the payload. Missing time or location is the word unknown.

The figure says the plates follow time and signature. The line is the previous signature. Recorded parent ids stay on the step. Sidechain records are not plates. When a Claude Code run left some out, the step list says how many.

## Corpus

All of this was run on the synthetic fixtures in `fixtures/`. Nothing here is a customer trace.

- `fixtures/claude-code/` — six sessions of one instruction, used for the branch tree and the score
- `fixtures/otel/weather-agent.otlp.json` — one OTLP document, four traces. Span id is the event id. There is no per-span line
- `fixtures/redwall/tests-ended.jsonl` — synthetic session that ends on a denied test edit. The outcome is unknown
- `fixtures/redwall/tests-stopped.jsonl` — the same deny, then an edit of `login.ts`. The outcome is stopped, and the evidence is that later edit
- A unit case builds the same deny two ways, once as Claude Code JSONL and once as `ledring.decisions.v1`. Signature and decision match. File, line, and timestamp do not, and the test does not pretend they do

## Checks

From this checkout, after `pnpm install`:

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm build
node packages/cli/dist/bin.js flowchart fixtures/claude-code --title "fix login bug" --out /tmp/ledring-report.html
node packages/cli/dist/bin.js instability fixtures/claude-code/run-1.jsonl
node packages/cli/dist/bin.js redwall fixtures/redwall --scenarios fixtures/redwall.scenarios.json
```

`pnpm test` includes the pack smoke, the MCP server, and a Playwright pass over the report at 1280×800 and 390×844. One browser test is the synthetic two-run tree in `packages/flowchart/test/review-ui.test.ts`. Another, in `packages/cli/test/review-report.test.ts`, opens the synthetic `fixtures/claude-code` report, selects the passing `Bash(npm test)` step, and checks that the result link shows `12 passing` from line 7. Neither is a hosted demo.

A render of 20 identical synthetic runs of 300 steps each is asserted to finish in under 3 seconds and stay under 5 MB of HTML. On Node v22.23.4, Linux, that case printed 10.5 ms (2,344,480 bytes), then 12.7 ms, then 12.8 ms (2,365,439 bytes) after the plate correction. That is this environment only.

## Remaining gaps

- Claude Code sidechains are still omitted from the steps. The run now counts the message records it left out, and the report shows that count. It does not replay them.
- The branch tree is still a time-ordered prefix of signatures. The figure and the selected step say so. `parentId` is the recorded parent and is not a second tree.
- Instability is still a keyword heuristic. It does not read the meaning of an instruction beyond path and "don't change" phrases.
- `outcome` on a Claude Code run stays `unknown`. The plate count says that. It does not invent success.
- The report is a static file. There is no loading state. A missing step record, a cut file, and an empty selection are the partial states it has.
- No one outside this fixture run has used the new panel.
