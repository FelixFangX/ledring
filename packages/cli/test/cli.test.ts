import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { run, type IO } from "@ledring/cli";
import { nodeIOForTest } from "./helpers.js";

const fixtures = fileURLToPath(new URL("../../../fixtures/", import.meta.url));

describe("ledring inspect", () => {
  it("prints normalized runs for a directory of mixed trace files", async () => {
    const io = nodeIOForTest();
    const code = await run(["inspect", `${fixtures}claude-code`, `${fixtures}otel`], io);
    expect(code).toBe(0);
    const runs = JSON.parse(io.stdout());
    expect(runs).toHaveLength(10);
    expect(new Set(runs.map((r: { source: string }) => r.source))).toEqual(new Set(["claude-code", "otel-genai"]));
    expect(runs[0].schema).toBe("ledring.trace.v1");
  });

  it("fails with a readable error for unknown formats", async () => {
    const io: IO = { ...nodeIOForTest(), readFile: () => "not a trace", expand: (p) => p };
    expect(await run(["inspect", "x.txt"], io)).toBe(1);
  });

  it("shows help and rejects unknown commands", async () => {
    const io = nodeIOForTest();
    expect(await run(["help"], io)).toBe(0);
    expect(io.stdout()).toMatch(/ledring inspect/);
    expect(await run(["nope"], io)).toBe(2);
  });
});
