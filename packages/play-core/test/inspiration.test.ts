import { describe, expect, it } from "vitest";
import { RunSchema } from "@ledring/trace";
import {
  OFFLINE_QUESTIONS,
  fuseDirections,
  generateDirections,
  hashString,
  inspirationRun,
  parseModelDirections,
  synthesizeDirections,
  type Answers,
  type Fragment,
} from "@ledring/play-core";

function fragment(id: string, key: Fragment["key"], text: string, val?: string, src: Fragment["src"] = "choice"): Fragment {
  return { id, key, text, ...(val ? { val } : {}), src };
}

function answersFrom(loop: number, trust: number, seen: number, lang: "en" | "zh" = "en"): Answers {
  const [qLoop, qTrust, qSeen] = OFFLINE_QUESTIONS;
  const loopOpt = qLoop![lang].options[loop]!;
  const trustOpt = qTrust![lang].options[trust]!;
  const seenOpt = qSeen![lang].options[seen]!;
  return {
    loop: fragment("F1", "loop", loopOpt.label, loopOpt.val),
    trust: fragment("F2", "trust", trustOpt.label, trustOpt.val),
    seen: fragment("F3", "seen", seenOpt.label, seenOpt.val),
  };
}

describe("inspiration generator", () => {
  it("is pure and cites at least two fragments", () => {
    const sets: Answers[] = [];
    for (let loop = 0; loop < 3; loop += 1) {
      for (let trust = 0; trust < 3; trust += 1) {
        for (let seen = 0; seen < 3; seen += 1) sets.push(answersFrom(loop, trust, seen));
      }
    }
    expect(sets.length).toBeGreaterThanOrEqual(20);
    for (const answers of sets) {
      const seed = hashString(JSON.stringify(answers)).toString(16);
      const first = generateDirections(answers, seed, "en");
      const second = generateDirections(answers, seed, "en");
      expect(first).toEqual(second);
      expect(new Set(first.map((direction) => direction.id)).size).toBe(3);
      for (const direction of first) {
        expect(direction.from.length).toBeGreaterThanOrEqual(2);
        expect(direction.brief).not.toMatch(/\{loop/);
      }
    }
  });

  it("keeps most first briefs unique across 50 answer sets", () => {
    const briefs = new Set<string>();
    for (let n = 0; n < 50; n += 1) {
      const answers: Answers = {
        loop: fragment("F1", "loop", `habit ${n}`, undefined, "free"),
        trust: fragment("F2", "trust", ["stop", "pay", "make"][n % 3] ?? "stop", ["stop", "pay", "make"][n % 3]),
        seen: fragment("F3", "seen", `person ${n}`, undefined, "free"),
      };
      briefs.add(generateDirections(answers, `seed-${n}`, "en")[0]?.brief ?? "");
    }
    expect(briefs.size / 50).toBeGreaterThanOrEqual(0.8);
  });

  it("quotes a Chinese free-text phrase inside brackets", () => {
    const answers: Answers = {
      loop: fragment("F1", "loop", "刷到停不下来", undefined, "free"),
      trust: fragment("F2", "trust", "我该什么时候停", "stop"),
      seen: fragment("F3", "seen", "只有我", "me"),
    };
    const directions = generateDirections(answers, "zh-seed", "zh");
    expect(directions.length).toBe(3);
    for (const direction of directions) {
      if (direction.brief.includes("刷到停不下来")) expect(direction.brief).toContain("「刷到停不下来」");
      expect(direction.brief).not.toMatch(/\{[a-z]+\}/);
    }
  });

  it("fuses two directions and keeps both fragment sets", () => {
    const [a, b] = generateDirections(answersFrom(0, 0, 1), "fuse", "en");
    const fused = fuseDirections(a!, b!, "en");
    expect(fused.fused).toBe(true);
    expect(fused.from).toEqual([...new Set([...(a?.from ?? []), ...(b?.from ?? [])])].sort());
    expect(fused.title).toContain("×");
  });
});

describe("live synthesis", () => {
  const answers = answersFrom(1, 2, 0);
  const good = JSON.stringify({
    directions: [
      { title: "A", brief: "One", from: ["F1", "F2"], kind: "tool", arch: "pomo" },
      { title: "B", brief: "Two", from: ["F2", "F3"], kind: "game", arch: "paint" },
      { title: "C", brief: "Three", from: ["F1", "F3", "NOPE"], kind: "tool", arch: "tip" },
      { title: "Dropped", brief: "Bad", from: ["NOPE"] },
    ],
  });

  it("accepts JSON, prose-wrapped JSON, and drops unknown fragment ids", () => {
    expect(parseModelDirections(good, ["F1", "F2", "F3"]).directions.map((direction) => direction.from)).toEqual([
      ["F1", "F2"],
      ["F2", "F3"],
      ["F1", "F3"],
    ]);
    const wrapped = parseModelDirections(`Sure, here you go:\n\`\`\`json\n${good}\n\`\`\``, ["F1", "F2", "F3"]);
    expect(wrapped.directions).toHaveLength(3);
    expect(wrapped.error).toBeUndefined();
  });

  it("falls back when the model returns invalid JSON", () => {
    const result = synthesizeDirections("I would build three things, not json", answers, "fallback", "en");
    expect(result.fallback).toBe(true);
    expect(result.error).toBe("no json");
    expect(result.directions).toHaveLength(3);
    expect(result.directions.every((direction) => direction.by === "generator")).toBe(true);
  });

  it("keeps a valid model result", () => {
    const result = synthesizeDirections(good, answers, "ok", "en");
    expect(result.fallback).toBe(false);
    expect(result.directions.map((direction) => direction.by)).toEqual(["model", "model", "model"]);
  });
});

describe("inspiration trace", () => {
  it("validates against RunSchema and keeps inspiration steps in order", () => {
    const answers = answersFrom(0, 1, 2, "zh");
    const directions = generateDirections(answers, "trace", "zh");
    const picked = directions[0]!;
    const run = inspirationRun({
      id: "play-insp",
      brief: picked.brief,
      events: [
        { type: "answer", by: "human", data: answers.loop },
        { type: "answer", by: "human", data: answers.trust },
        { type: "nudge", by: "model", data: { text: "try the timer" } },
        { type: "answer", by: "human", data: answers.seen },
        { type: "directions", by: "model", data: { titles: directions.map((direction) => direction.title) } },
        { type: "fuse", by: "human", data: { ids: [directions[0]?.id, directions[1]?.id] } },
        { type: "reroll_fragment", by: "human", data: { id: "F1" } },
        { type: "reroll_directions", by: "human" },
        { type: "pick", by: "human", data: { id: picked.id } },
        { type: "rewrite", by: "human", data: { brief: picked.brief + "。" } },
        { type: "brief", by: "human", data: { brief: picked.brief } },
      ],
      extension: {
        source: "offline-questions",
        fragments: [answers.loop, answers.trust, answers.seen],
        directions,
        picked: picked.id,
        brief: picked.brief,
        edited: false,
        demoArchetype: picked.arch,
      },
    });
    expect(RunSchema.parse(run).steps.map((step) => step.signature)).toEqual([
      "inspiration:answer",
      "inspiration:answer",
      "inspiration:nudge",
      "inspiration:answer",
      "inspiration:directions",
      "inspiration:fuse",
      "inspiration:reroll_fragment",
      "inspiration:reroll_directions",
      "inspiration:pick",
      "inspiration:rewrite",
      "inspiration:brief",
    ]);
    expect(run["x-ledring-play"].inspiration.picked).toBe(picked.id);
    expect(run["x-ledring-play"].inspiration.demoArchetype).toBe(picked.arch);
  });
});
