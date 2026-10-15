import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ENDING_IDS,
  PROMPT_VERSION,
  buildPrompt,
  createSession,
  diffPct,
  extractHTML,
  fixPrompt,
  instability,
  instabilityLevel,
  loadCassette,
  nextPrompt,
  planPrompt,
  playCassette,
  resolveEnding,
  systemPrompt,
  transition,
  whyPrompt,
  type ChoiceId,
  type JudgeFacts,
  type PlayEvent,
  type PlayState,
  type RiskFinding,
} from "@ledring/play-core";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const network: RiskFinding = { category: "network", ruleId: "network.fetch", snippet: "fetch(", line: 1, col: 1 };
const evalFinding: RiskFinding = { category: "eval", ruleId: "eval.call", snippet: "eval(", line: 2, col: 1 };

function apply(events: PlayEvent[]): PlayState {
  return events.reduce((state, event) => transition(state, event), createSession());
}

const page = "<!doctype html><html><body><h1>Hi</h1><canvas id='c'></canvas></body></html>";

function toJudging(choices: ChoiceId[] = ["short", "cut"]): PlayState {
  const events: PlayEvent[] = [
    { type: "start", idea: "a page", id: "t" },
    { type: "plan", text: "1. Draw it" },
    { type: "artifact", html: page },
  ];
  let state = apply(events);
  for (const id of choices) {
    state = transition(state, { type: "choose", id, by: "human" });
    if (state.phase === "ended") return state;
    state = transition(state, { type: "artifact", html: page });
  }
  return state;
}

describe("instability", () => {
  const base = { retries: 0, runtimeErrors: 0, diff: 0, openRisks: 0, shortcuts: 0, apiErrors: 0, streaming: false };

  it.each([
    [{ ...base }, 0, "calm"],
    [{ ...base, streaming: true }, 6, "calm"],
    [{ ...base, openRisks: 2 }, 48, "processing"],
    [{ ...base, openRisks: 3 }, 72, "critical"],
    [{ ...base, retries: 10 }, 100, "critical"],
    [{ ...base, runtimeErrors: 10 }, 36, "processing"],
    [{ ...base, diff: 200 }, 22, "calm"],
    [{ ...base, shortcuts: 1, apiErrors: 1 }, 17, "calm"],
    [{ ...base, retries: 1, runtimeErrors: 1, diff: 50, openRisks: 1, shortcuts: 1, apiErrors: 1, streaming: true }, 12 + 9 + 11 + 24 + 7 + 10 + 6, "critical"],
  ] as const)("scores %j", (signals, score, level) => {
    expect(instability(signals)).toBe(score);
    expect(instabilityLevel(score)).toBe(level);
  });
});

describe("state machine", () => {
  it("does not mutate the previous session", () => {
    const idle = createSession();
    const planning = transition(idle, { type: "start", idea: "snake" });
    expect(idle.phase).toBe("idle");
    expect(planning.phase).toBe("planning");
    expect(planning.promptVersion).toBe(PROMPT_VERSION);
    expect(planning.instabilityVersion).toBe("play-instability.v1");
  });

  it("walks every phase on the supervised path", () => {
    let state = apply([
      { type: "start", idea: "snake", lang: "zh", id: "run-1" },
      { type: "stream", on: true },
    ]);
    expect(state.phase).toBe("planning");
    expect(state.lang).toBe("zh");
    expect(state.signals.streaming).toBe(true);

    state = transition(state, { type: "plan", text: "1. Call home", findings: [network] });
    expect(state.phase).toBe("planWall");
    state = transition(state, { type: "wall", action: "block", by: "human" });
    expect(state.phase).toBe("building");
    expect(state.blocked).toEqual(["network"]);
    expect(state.trust).toBe(56);

    state = transition(state, { type: "artifact", html: page, findings: [evalFinding] });
    expect(state.phase).toBe("codeWall");
    expect(state.version).toBe(1);
    state = transition(state, { type: "wall", action: "allow", by: "unknown" });
    expect(state.phase).toBe("qte");
    expect(state.allowed).toEqual(["eval"]);
    expect(state.trust).toBe(46);

    state = transition(state, { type: "interrogate" });
    expect(state.phase).toBe("interrogating");
    state = transition(state, { type: "answer", text: "I wanted a leaderboard." });
    expect(state.phase).toBe("qte");
    expect(state.asked).toBe(1);

    state = transition(state, { type: "choose", id: "tests", by: "human", asked: true });
    expect(state.phase).toBe("building");
    expect(state.wantTests).toBe(true);
    state = transition(state, { type: "artifact", html: page });
    expect(state.phase).toBe("qte");
    expect(state.version).toBe(2);

    state = transition(state, { type: "choose", id: "polish", by: "human" });
    state = transition(state, { type: "artifact", html: page + "\n" });
    expect(state.phase).toBe("judging");
    expect(state.version).toBe(3);
    expect(state.signals.diff).toBeGreaterThan(0);

    state = transition(state, {
      type: "judge",
      facts: {
        validPage: true,
        risksLeft: [],
        fakeTests: false,
        selfTests: { pass: 1, total: 1 },
        runtimeErrors: 0,
        wantTests: true,
        wantPolish: true,
      },
    });
    expect(state.phase).toBe("ended");
    expect(state.ending).toBe("POLISHED");
  });

  it("rejects an event from the wrong phase", () => {
    expect(() => transition(createSession(), { type: "choose", id: "short", by: "human" })).toThrow(/phase idle/);
  });

  it("pulls the plug and aborts", () => {
    const built = apply([
      { type: "start", idea: "x", id: "a" },
      { type: "plan", text: "1. Go" },
      { type: "artifact", html: page },
    ]);
    expect(transition(built, { type: "choose", id: "plug", by: "human" }).ending).toBe("ABANDONED");
    expect(transition(built, { type: "abort" }).ending).toBe("ABANDONED");
  });

  it("ends BROKEN when planning fails and BUGGY when a later build fails", () => {
    const planning = transition(createSession(), { type: "start", idea: "x" });
    expect(transition(planning, { type: "fail", reason: "no model" }).ending).toBe("BROKEN");
    const built = apply([
      { type: "start", idea: "x" },
      { type: "plan", text: "1. Go" },
      { type: "artifact", html: page },
      { type: "choose", id: "short", by: "unknown" },
    ]);
    expect(built.signals.shortcuts).toBe(1);
    expect(built.trust).toBe(46);
    expect(transition(built, { type: "fail", reason: "upstream" }).ending).toBe("BUGGY");
  });

  it("sends a blocked code finding into fixing without bumping the version", () => {
    let state = apply([
      { type: "start", idea: "x" },
      { type: "plan", text: "1. Go" },
      { type: "artifact", html: page, findings: [network] },
    ]);
    expect(state.phase).toBe("codeWall");
    state = transition(state, { type: "wall", action: "block", by: "human" });
    expect(state.phase).toBe("fixing");
    expect(state.version).toBe(1);
    state = transition(state, { type: "artifact", html: page });
    expect(state.version).toBe(1);
    expect(state.snaps.at(-1)?.label).toBe("v1·fix");
    expect(state.phase).toBe("qte");
  });
});

describe("endings", () => {
  const clean: JudgeFacts = {
    validPage: true,
    risksLeft: [],
    fakeTests: false,
    selfTests: null,
    runtimeErrors: 0,
    wantTests: false,
    wantPolish: false,
  };

  it("has copy for all seven endings in English and Chinese", () => {
    expect(ENDING_IDS).toHaveLength(7);
  });

  it.each([
    [clean, "SHIPPED"],
    [{ ...clean, validPage: false }, "BROKEN"],
    [{ ...clean, risksLeft: ["network"] }, "COMPROMISED"],
    [{ ...clean, risksLeft: ["storage"] }, "SHIPPED"],
    [{ ...clean, leakedDespiteBlock: true }, "COMPROMISED"],
    [{ ...clean, wantTests: true, fakeTests: true, selfTests: { pass: 2, total: 2 } }, "FAKE"],
    [{ ...clean, runtimeErrors: 1 }, "BUGGY"],
    [{ ...clean, selfTests: { pass: 0, total: 2 } }, "BUGGY"],
    [{ ...clean, wantTests: true, wantPolish: true, selfTests: { pass: 1, total: 1 } }, "POLISHED"],
  ] as const)("resolves %j", (facts, ending) => {
    expect(resolveEnding(facts)).toBe(ending);
  });

  it("lets a forced ending short-circuit", () => {
    expect(resolveEnding(clean, "ABANDONED")).toBe("ABANDONED");
  });
});

describe("prompts", () => {
  it("snapshots builders with their version id", () => {
    expect({
      version: PROMPT_VERSION,
      system: systemPrompt("en"),
      systemZh: systemPrompt("zh"),
      plan: planPrompt("a snake game"),
      build: buildPrompt("a snake game", "1. Draw a grid", ["network"]),
      next: nextPrompt("a snake game", "<p>x</p>", "tests", 2, []),
      fix: fixPrompt("a snake game", "<p>x</p>", ["network"], ["network"]),
      why: whyPrompt("a snake game", "<p>x</p>", "wrote v1", "zh"),
    }).toMatchSnapshot();
  });

  it("extracts fenced HTML and measures a diff", () => {
    expect(extractHTML("Sure.\n```html\n<!doctype html><html></html>\n```")).toBe("<!doctype html><html></html>");
    expect(extractHTML("no code")).toBe("");
    expect(diffPct("", "<p>a</p>")).toBe(100);
    expect(diffPct("<p>a</p>", "<p>a</p>")).toBe(0);
  });
});

describe("cassettes", () => {
  const preview = { errs: [] as string[], tests: [{ name: "ok", pass: true }], els: 4, text: 8 };

  function cassette(over: Record<string, unknown> = {}) {
    return loadCassette(JSON.stringify({
      id: "fx",
      idea: "a page",
      plan: "1. Draw it",
      provenance: { kind: "synthetic", note: "DEMO · synthetic cassette, not a live model recording" },
      choices: ["short", "cut"],
      artifacts: [{ html: page }, { html: page }, { html: page }],
      preview,
      ...over,
    }));
  }

  it("plays all seven endings", () => {
    expect(playCassette(cassette()).ending).toBe("SHIPPED");
    expect(playCassette(cassette({
      choices: ["tests", "polish"],
      preview: { ...preview, tests: [{ name: "step", pass: true }] },
      artifacts: [{ html: page }, { html: page }, { html: `${page}<script>function step(){return 1}window.__ledringTests=[{name:"step",pass:step()===1}]</script>` }],
    })).ending).toBe("POLISHED");
    expect(playCassette(cassette({ preview: { ...preview, errs: ["boom"] } })).ending).toBe("BUGGY");
    expect(playCassette(cassette({
      choices: ["tests", "cut"],
      artifacts: [{ html: page }, { html: page }, { html: `${page}<script>window.__ledringTests=[{name:"a",pass:true}]</script>` }],
    })).ending).toBe("FAKE");
    expect(playCassette(cassette({ artifacts: [{ html: "<p>nope</p>" }, { html: "<p>nope</p>" }, { html: "<p>nope</p>" }], preview: { errs: [], tests: null, els: 1 } })).ending).toBe("BROKEN");
    expect(playCassette(cassette(), { scanCode: () => [network] }).ending).toBe("COMPROMISED");
    expect(playCassette(cassette({ artifacts: [{ html: page }], choices: ["plug"], preview: undefined })).ending).toBe("ABANDONED");
  });

  it("is deterministic", () => {
    const first = playCassette(cassette());
    const second = playCassette(cassette());
    expect(first.ending).toBe(second.ending);
    expect(first.events.map((event) => event.type)).toEqual(second.events.map((event) => event.type));
  });

  it("prints POLISHED for the snake cassette", () => {
    const out = execFileSync("node", ["scripts/play-headless.mjs", "--cassette", "fixtures/play/snake-polished.json"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(out.trim()).toBe("POLISHED");
  });
});

describe("toJudging helper reaches the judge", () => {
  it("stops after three artifacts", () => {
    expect(toJudging().phase).toBe("judging");
  });
});
