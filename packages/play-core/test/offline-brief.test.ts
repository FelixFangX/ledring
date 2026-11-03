import { describe, expect, it } from "vitest";
import { OFFLINE_QUESTIONS, generateDirections, type Answers, type Fragment } from "@ledring/play-core";

function choice(loop: number, trust: number, seen: number): Answers {
  const [qLoop, qTrust, qSeen] = OFFLINE_QUESTIONS;
  const a = qLoop!.zh.options[loop]!;
  const b = qTrust!.zh.options[trust]!;
  const c = qSeen!.zh.options[seen]!;
  const frag = (id: string, key: Fragment["key"], text: string, val: string): Fragment => ({ id, key, text, val, src: "choice" });
  return { loop: frag("F1", "loop", a.label, a.val), trust: frag("F2", "trust", b.label, b.val), seen: frag("F3", "seen", c.label, c.val) };
}

describe("offline briefs", () => {
  it("covers every choice combination and 20 free-text sets without leftover placeholders", () => {
    const briefs: string[] = [];
    for (let loop = 0; loop < 3; loop += 1) {
      for (let trust = 0; trust < 3; trust += 1) {
        for (let seen = 0; seen < 3; seen += 1) {
          const directions = generateDirections(choice(loop, trust, seen), `${loop}${trust}${seen}`, "zh");
          expect(directions).toHaveLength(3);
          for (const direction of directions) {
            expect(direction.brief).not.toMatch(/\{[a-z]+\}/);
            expect(direction.from.length).toBeGreaterThanOrEqual(2);
            briefs.push(direction.brief);
          }
        }
      }
    }
    expect(briefs.length).toBe(81);
    for (let n = 0; n < 20; n += 1) {
      const phrase = `自由短语${n}`;
      const answers: Answers = {
        loop: { id: "F1", key: "loop", text: phrase, src: "free" },
        trust: { id: "F2", key: "trust", text: "停", val: "stop", src: "choice" },
        seen: { id: "F3", key: "seen", text: "我弟弟", src: "free" },
      };
      for (const direction of generateDirections(answers, `free-${n}`, "zh")) {
        expect(direction.brief).not.toMatch(/\{[a-z]+\}/);
        if (direction.brief.includes(phrase)) expect(direction.brief).toContain(`「${phrase}」`);
        if (direction.brief.includes("我弟弟")) expect(direction.brief).toContain("「我弟弟」");
      }
    }
  });
});
