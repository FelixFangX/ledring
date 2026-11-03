# @ledring/play-core

The Play engine: a dependency-free state machine, the versioned instability function (`play-instability.v1`), prompt builders (`play-prompts.v1`), and endings-as-data.

A **cassette** replays a session without a live model. Synthetic cassettes say so in `provenance.note`. A recorded cassette must name `model` and `recordedAt`.

`replayEvents` folds a saved list of play events from an idle session. The ending, the session id, and each choice id match the original run.

```sh
node scripts/play-headless.mjs --cassette fixtures/play/snake-polished.json
# POLISHED
```

Record a cassette only after a real provider response. The script does not call a model. It refuses demo, empty, or hand-authored input:

```sh
node scripts/record-cassette.mjs --response response.json --out fixtures/play/my-run.json
```

`response.json` must contain `provider` (not `demo`), `model`, `recordedAt`, and `html` from that response. Without them the script writes nothing and exits 1.

UI, providers, the AST risk scanner, and the Playwright judge live in their own packages. This package only decides what a session is allowed to do next.
