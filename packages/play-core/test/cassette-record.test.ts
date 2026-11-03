import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cassetteLabel, loadCassette } from "@ledring/play-core";
import { cassetteFromResponse } from "../../../scripts/record-cassette.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const synthetic = "DEMO · synthetic cassette, not a live model recording";
const page = "<!doctype html><html><body><h1>Hi</h1><canvas id='c'></canvas></body></html>";

describe("cassetteLabel", () => {
  it("says synthetic unless a real model and timestamp are both present", () => {
    expect(cassetteLabel(undefined)).toBe(synthetic);
    expect(cassetteLabel({ kind: "synthetic", note: "hand written" })).toBe(synthetic);
    expect(cassetteLabel({ kind: "recorded", note: "incomplete", model: "gpt-4o-mini" })).toBe(synthetic);
    expect(cassetteLabel({ kind: "recorded", note: "incomplete", recordedAt: "2026-10-15T00:00:00Z" })).toBe(synthetic);
    expect(
      cassetteLabel({ kind: "recorded", note: "ok", model: "gpt-4o-mini", recordedAt: "2026-10-15T00:00:00Z" }),
    ).toBe("recorded from gpt-4o-mini on 2026-10-15T00:00:00Z");
  });
});

describe("record-cassette", () => {
  it("refuses a demo response and does not write a file", () => {
    const dir = mkdtempSync(join(tmpdir(), "ledring-cassette-"));
    const response = join(dir, "response.json");
    const out = join(dir, "out.json");
    writeFileSync(
      response,
      JSON.stringify({ provider: "demo", model: "x", recordedAt: "2026-10-15T00:00:00Z", html: page, idea: "snake" }),
    );
    const result = spawnSync("node", ["scripts/record-cassette.mjs", "--response", response, "--out", out], {
      cwd: root,
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("record-cassette refused: a real provider response is required");
    expect(existsSync(out)).toBe(false);
  });

  it("refuses a response that is missing a model or a real page", () => {
    expect(cassetteFromResponse({ provider: "openai-compat", html: page, idea: "snake" }).error).toContain("refused");
    expect(
      cassetteFromResponse({
        provider: "openai-compat",
        model: "gpt-4o-mini",
        recordedAt: "2026-10-15T00:00:00Z",
        html: "<p>short</p>",
        idea: "snake",
      }).error,
    ).toContain("refused");
  });

  it("writes a recorded cassette from a real provider response", () => {
    const dir = mkdtempSync(join(tmpdir(), "ledring-cassette-"));
    const response = join(dir, "response.json");
    const out = join(dir, "out.json");
    writeFileSync(
      response,
      JSON.stringify({
        provider: "openai-compat",
        model: "gpt-4o-mini",
        recordedAt: "2026-10-15T00:00:00Z",
        idea: "  a counter  ",
        html: page,
        plan: "1. Draw a button",
      }),
    );
    const result = spawnSync("node", ["scripts/record-cassette.mjs", "--response", response, "--out", out], {
      cwd: root,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("recorded from gpt-4o-mini on 2026-10-15T00:00:00Z");
    const cassette = loadCassette(readFileSync(out, "utf8"));
    expect(cassette.provenance).toEqual({
      kind: "recorded",
      note: "recorded from gpt-4o-mini on 2026-10-15T00:00:00Z",
      model: "gpt-4o-mini",
      recordedAt: "2026-10-15T00:00:00Z",
    });
    expect(cassette.idea).toBe("a counter");
    expect(cassette.plan).toBe("1. Draw a button");
    expect(cassetteLabel(cassette.provenance)).toBe("recorded from gpt-4o-mini on 2026-10-15T00:00:00Z");
  });
});
