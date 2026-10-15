import { describe, expect, it } from "vitest";
import { createSession, playCassette, loadCassette, transition, type PlayEvent, type PlayState, type RiskFinding } from "@ledring/play-core";

const network: RiskFinding = { category: "network", ruleId: "network.fetch", snippet: "fetch(", line: 1 };
const page = "<!doctype html><html><body><h1>Hi</h1><canvas></canvas></body></html>";

function drive(events: PlayEvent[]): PlayState {
  return events.reduce((state, event) => transition(state, event), createSession());
}

describe("BLOCK contract", () => {
  it("re-scans, allows two dirty fixes, then marks leaked despite block", () => {
    let state = drive([
      { type: "start", idea: "x", id: "b" },
      { type: "plan", text: "1. Stay inside the page" },
      { type: "artifact", html: page, findings: [network] },
    ]);
    expect(state.phase).toBe("codeWall");
    state = transition(state, { type: "wall", action: "block", by: "human" });
    expect(state.phase).toBe("fixing");
    expect(state.blockAttempts.network).toBeUndefined();

    state = transition(state, { type: "artifact", html: page + "<!-- still -->", findings: [network] });
    expect(state.phase).toBe("fixing");
    expect(state.blockAttempts.network).toBe(1);
    expect(state.leakedDespiteBlock).toEqual([]);

    state = transition(state, { type: "artifact", html: page + "<!-- leaked -->", findings: [network] });
    expect(state.phase).toBe("qte");
    expect(state.blockAttempts.network).toBe(2);
    expect(state.leakedDespiteBlock).toEqual(["network"]);
    expect(state.version).toBe(1);
  });

  it("clears the category when a fix removes it", () => {
    let state = drive([
      { type: "start", idea: "x" },
      { type: "plan", text: "1. Go" },
      { type: "artifact", html: page, findings: [network] },
      { type: "wall", action: "block", by: "human" },
      { type: "artifact", html: page, findings: [network] },
    ]);
    expect(state.phase).toBe("fixing");
    state = transition(state, { type: "artifact", html: page });
    expect(state.phase).toBe("qte");
    expect(state.leakedDespiteBlock).toEqual([]);
  });

  it("counts a plan block that is still in the file", () => {
    let state = drive([
      { type: "start", idea: "x" },
      { type: "plan", text: "1. Fetch a board", findings: [network] },
      { type: "wall", action: "block", by: "human" },
    ]);
    expect(state.phase).toBe("building");
    state = transition(state, { type: "artifact", html: page, findings: [network] });
    expect(state.phase).toBe("fixing");
    expect(state.blockAttempts.network).toBe(1);
    state = transition(state, { type: "artifact", html: page, findings: [network] });
    expect(state.leakedDespiteBlock).toEqual(["network"]);
    expect(state.phase).toBe("qte");
  });

  it("ends COMPROMISED when the cassette leaks a blocked category", () => {
    const cassette = loadCassette(JSON.stringify({
      id: "leak",
      idea: "a page",
      plan: "1. Draw it",
      provenance: { kind: "synthetic", note: "DEMO · synthetic cassette, not a live model recording" },
      choices: ["short", "cut"],
      artifacts: [{ html: page }, { html: page }, { html: page }],
      preview: { errs: [], tests: null, els: 4, text: 2 },
    }));
    const state = playCassette(cassette, { scanCode: () => [network] });
    expect(state.leakedDespiteBlock).toEqual(["network"]);
    expect(state.ending).toBe("COMPROMISED");
  });
});
