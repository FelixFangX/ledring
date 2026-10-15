import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendSessionLog, readSessionLog } from "../src/store.js";

describe("session log", () => {
  it("keeps complete events when the last line is torn", () => {
    const dir = mkdtempSync(join(tmpdir(), "ledring-sessions-"));
    appendSessionLog(dir, "sess-1", { id: 1, event: "delta", data: { text: "he" } });
    writeFileSync(join(dir, "sess-1.jsonl"), `${JSON.stringify({ id: 1, event: "delta", data: { text: "he" } })}\n{"id":2,"event":"del`, "utf8");
    expect(readSessionLog(dir, "sess-1")).toEqual([{ id: 1, event: "delta", data: { text: "he" } }]);
  });
});
