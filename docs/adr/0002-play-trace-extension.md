# 0002 — Play data lives beside the trace schema

**Context.** A Play session needs an ending, instability signals, blocked and allowed categories, the judge verdict, and prompt versions. ADR 0001 says `RunSchema` is the shared projection. Zod object schemas strip unknown keys, so a field on the run object does not survive `RunSchema.parse`.

**Decision.** Do not add Play fields to `RunSchema`. Export a Play session by parsing the normalized run first, then attaching `x-ledring-play` on the object that is written to disk and returned by `GET /api/sessions/:id/trace`. Readers that only understand `ledring.trace.v1` can ignore the extension. Readers that understand Play must read it from the raw object, not from a second parse.

**Consequences.**
- `ledring card`, `ledring flow`, and `ledring redwall` keep working on the normalized steps.
- A Play-aware tool checks `schema === "ledring.trace.v1"` and then reads `x-ledring-play`.
- Changing `RunSchema` to preserve unknown keys would be a separate decision. This ADR does not do that.
