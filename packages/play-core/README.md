# @ledring/play-core

The Play engine: a dependency-free state machine, the versioned instability function (`play-instability.v1`), prompt builders (`play-prompts.v1`), and endings-as-data.

A **cassette** replays a session without a live model. Synthetic cassettes say so in `provenance.note`. A recorded cassette must name `model` and `recordedAt`.

```sh
node scripts/play-headless.mjs --cassette fixtures/play/snake-polished.json
# POLISHED
```

UI, providers, the AST risk scanner, and the Playwright judge live in their own packages. This package only decides what a session is allowed to do next.
