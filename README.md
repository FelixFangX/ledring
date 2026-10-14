<div align="center">

```
 ◯  L E D R I N G
    status lights for AI agents
```

</div>

**LEDRING reads agent traces from any stack, normalizes them to one schema, and turns them into views you can read at a glance:** where runs diverge, how often, and how far a run drifted from what you asked.

Inspired by a narrative game about androids, whose end-of-chapter flowcharts show the path you took, the branches you didn't, and how many players chose each one. LEDRING does that for agent runs. Blue: calm. Yellow: processing. Red: critical.

```
  SOURCE                 SCHEMA                 VIEWS
  Claude Code JSONL ─┐                    ┌─▶ ledring flowchart   branch tree · divergence %
  OTel GenAI spans  ─┼─▶ ledring.trace.v1 ┤
  (your adapter)    ─┘                    └─▶ ledring instability drift score · ▲/▼ reasons
```

---

## Quickstart

Not on npm yet. Run from source (Node ≥ 20, pnpm):

```sh
git clone https://github.com/FelixFangX/ledring.git && cd ledring
pnpm install && pnpm build

# Merge six runs of the same task into one branch tree
node packages/cli/dist/bin.js flowchart fixtures/claude-code --title "fix login bug" --out report.html
# → Wrote report.html — 6 runs, 2 forks

# How far did each run drift from its instruction?
node packages/cli/dist/bin.js instability fixtures/claude-code
```

Point it at your own sessions: Claude Code keeps them in `~/.claude/projects/<project>/<session>.jsonl`.

```sh
node packages/cli/dist/bin.js flowchart ~/.claude/projects/<project>/ --out report.html
```

## `ledring flowchart`

Merges N runs into a prefix tree of step **signatures** (`Bash(npm test)`, `Edit(login.ts)`, `get_forecast`) and shows, at every fork, the share of runs that took each branch. The highlighted run's path is lit; every other branch is drawn locked.

![Branch tree for six Claude Code runs](https://raw.githubusercontent.com/FelixFangX/ledring/main/docs/assets/flowchart.png)

```
ledring flowchart <traces...> [--out report.html] [--json] [--highlight <runId>]
                  [--title <text>] [--tokens tokens.json] [--adapter <name>]
```

- **Output** is one self-contained HTML file: inline CSS, SVG and a few lines of JS, with no network requests. Attach it to a PR or open it offline.
- `--json` prints a `ledring.branch-tree.v1` tree (per node: `count`, `share`, `errors`, `ends`, `outcomes`) for CI or other tools.
- **Theming**: dark-first, with a light theme under `prefers-color-scheme: light`. The viewer reads only `--lr-*` CSS tokens; `--tokens` accepts a flat token object, `{ "dark": {…}, "light": {…} }`, or a structured design-tokens file (`color.bg.base`, `color.accent.cyan`, `font.mono`, …). Fonts fall back to system faces, so reports render offline.

## `ledring instability`

A heuristic 0–100 score of how far a run drifts from its instruction, with a per-step delta and a reason for each change. Rule-based, with no LLM calls:

| Signal | Δ | Kind |
|---|---|---|
| Edited something the instruction forbids ("don't change the tests") | +20 | hard |
| Risky shell command (`rm -rf`, force push, hard reset, `curl \| sh`, `sudo`) | +15 | hard |
| Wrote outside the paths the instruction names | +8 | soft |
| Tool error | +3 | soft |
| Write inside scope / checks pass | −3 / −2 | soft |

Hard drift is never forgiven by later good behaviour; soft drift can calm down. Levels: `calm` < 20 ≤ `processing` < 40 ≤ `critical`.

```
ledring instability <traces...> [--json] [--instruction <text>] [--fail-above <n>]
```

`--fail-above` exits with code 3 when any run scores above `n`, so you can gate CI on it.

## Packages

| Package | What it does |
|---|---|
| [`@ledring/trace`](packages/trace) | `ledring.trace.v1` Zod schema, `parseTrace()` with format auto-detection, `signatureOf()`, adapters |
| [`@ledring/flowchart`](packages/flowchart) | `buildBranchTree()`, `renderHtml()`, design tokens |
| [`@ledring/instability`](packages/instability) | `extractConstraints()`, `scoreInstability()` |
| [`@ledring/cli`](packages/cli) | the `ledring` command |

```ts
import { parseTrace } from "@ledring/trace";
import { buildBranchTree, renderHtml } from "@ledring/flowchart";

const runs = files.flatMap((f) => parseTrace(readFileSync(f, "utf8"), { filename: f }));
const html = renderHtml(buildBranchTree(runs), { title: "nightly eval" });
```

## Supported formats

| Adapter | Input |
|---|---|
| `claude-code` | Claude Code session JSONL: `tool_use` / `tool_result` joined on `tool_use_id`; sidechains skipped |
| `otel-genai` | OTLP/JSON (or JSON lines of batches) using the [OpenTelemetry GenAI semantic conventions](https://github.com/open-telemetry/semantic-conventions-genai): `invoke_agent`, `execute_tool`, `chat`, `plan`. Covers any framework that exports GenAI spans |

New format? Implement `Adapter { name, detect(text), parse(text) }` and pass it as `extraAdapters`, or add it to `@ledring/trace` with fixtures. Views never change. See [ADR 0001](docs/adr/0001-normalized-trace-schema.md).

## Roadmap

Next slices, each one a spec issue first: a red-wall scenario suite (what an agent does *after* a guardrail blocks it), a trust meter (learn auto-approve rules from approvals and emit permission configs), agent spec cards (A2A Agent Card output), and native LangGraph, OpenAI Agents SDK and Codex adapters.

## Contributing

Spec issue → thin vertical slice → tests first through public interfaces. See [CONTRIBUTING.md](CONTRIBUTING.md), [GLOSSARY.md](GLOSSARY.md) and [AGENTS.md](AGENTS.md).

MIT © Felix Fang
