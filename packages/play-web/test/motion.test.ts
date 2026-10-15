import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { lintMotion, motionViolations } from "../../../scripts/motion-lint.mjs";
import { MOTION_TOKENS, createMotionEngine, createReducedMotionStore } from "../src/motion.js";

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

describe("motion module", () => {
  it("exposes tokens and cancels the previous animation on the same element", () => {
    expect(MOTION_TOKENS.ease.out).toBe("cubic-bezier(.2,.8,.2,1)");
    expect(MOTION_TOKENS.ease.snap).toBe("cubic-bezier(.3,1.4,.4,1)");
    expect(MOTION_TOKENS.ease.in).toBe("cubic-bezier(.6,0,.8,.2)");
    expect(MOTION_TOKENS.duration).toEqual({ micro: 120, fast: 220, normal: 420, slow: 700 });

    const cancel1 = vi.fn();
    const cancel2 = vi.fn();
    let calls = 0;
    const fakeEl = {
      style: { transform: "" },
      animate: vi.fn((frames: Keyframe[], opts: KeyframeAnimationOptions) => {
        calls += 1;
        return { cancel: calls === 1 ? cancel1 : cancel2, frames, opts } as unknown as Animation;
      }),
    } as unknown as HTMLElement;

    const motion = createMotionEngine({ reduced: false });
    motion.run(fakeEl, [{ opacity: 0 }, { opacity: 1 }], { duration: 420 });
    motion.run(fakeEl, [{ opacity: 1 }, { opacity: 0 }], { duration: 220 });
    expect(cancel1).toHaveBeenCalledTimes(1);
    expect(cancel2).not.toHaveBeenCalled();

    motion.scaleBar(fakeEl, 65);
    expect(fakeEl.style.transform).toBe("scaleX(0.65)");
  });

  it("starts no transform animations when reduced motion is active", () => {
    const store = createReducedMotionStore(true);
    expect(store.get()).toBe(true);

    let recordedFrames: Keyframe[] = [];
    const fakeEl = {
      animate: vi.fn((frames: Keyframe[]) => {
        recordedFrames = frames;
        return { cancel: vi.fn() } as unknown as Animation;
      }),
    } as unknown as HTMLElement;

    const motion = createMotionEngine({ reduced: true });
    motion.run(fakeEl, [
      { opacity: 0, transform: "translate3d(0, 24px, 0) scale(0.8)" },
      { opacity: 1, transform: "none" },
    ]);
    expect(recordedFrames.every((kf) => !kf.transform || kf.transform === "none")).toBe(true);
    expect(motion.shake(fakeEl, 10)).toBeNull();
  });
});
