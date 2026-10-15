import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { lintMotion, motionViolations } from "../../../scripts/motion-lint.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));

describe("motion lint", () => {
  it("rejects a layout transition and accepts the shipped page", () => {
    expect(motionViolations(".bar>i{transition:width .6s,background .4s}", "fixture.css")).toEqual([
      "motion lint failed: layout transition width in fixture.css",
    ]);
    expect(motionViolations("@keyframes grow{from{height:0}to{height:10px}}", "fixture.css")).toEqual([
      "motion lint failed: layout keyframe height in fixture.css",
      "motion lint failed: layout keyframe height in fixture.css",
    ]);
    expect(motionViolations(".scene{transition:opacity .5s,transform .5s}@keyframes pop{to{opacity:1;transform:none}}", "ok.css")).toEqual([]);
    expect(lintMotion(root)).toEqual([]);
  });
});
