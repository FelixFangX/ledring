import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { RunSchema } from "@ledring/trace";
import { describe, expect, it } from "vitest";
import { loadCassette, playCassette, playTrace } from "@ledring/play-core";

describe("play trace", () => {
  it("validates a cassette run and keeps x-ledring-play after the schema parse", () => {
    const cassette = loadCassette(readFileSync(fileURLToPath(new URL("../../../fixtures/play/snake-polished.json", import.meta.url)), "utf8"));
    const traced = playTrace(playCassette(cassette));
    expect(traced.schema).toBe("ledring.trace.v1");
    expect(traced.steps.some((step) => step.kind === "plan")).toBe(true);
    expect(traced.steps.some((step) => step.kind === "human")).toBe(true);
    expect(traced.steps.some((step) => step.kind === "tool" && step.name === "judge")).toBe(true);
    expect(traced["x-ledring-play"].ending).toBe("POLISHED");
    expect(RunSchema.parse(traced)).not.toHaveProperty("x-ledring-play");
    expect(traced["x-ledring-play"].promptVersion).toBeTruthy();
  });
});
