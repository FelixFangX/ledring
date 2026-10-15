import type { PreviewReport } from "./endings.js";
import {
  PlayError,
  createSession,
  factsFor,
  freshFindings,
  transition,
  type ChoiceId,
  type PlayState,
  type RiskFinding,
} from "./machine.js";

export interface CassetteProvenance {
  /** `synthetic` until a real model run is recorded. Never imply a model when this is synthetic. */
  kind: "synthetic" | "recorded";
  note: string;
  model?: string;
  recordedAt?: string;
}

export interface CassetteArtifact {
  html: string;
}

export interface CassetteWall {
  action: "block" | "allow";
  by?: "human" | "unknown";
}

/** A replay of one Play session. Model text is already resolved to a plan and HTML artifacts. */
export interface Cassette {
  id: string;
  idea: string;
  lang?: "en" | "zh";
  provenance: CassetteProvenance;
  plan: string;
  /** Human choices between artifacts. `plug` ends the session. */
  choices: ChoiceId[];
  artifacts: CassetteArtifact[];
  /** Consumed in order whenever a Red Wall opens. Defaults to block. */
  walls?: CassetteWall[];
  /** Replacement HTML consumed when a block sends the session into fixing. */
  fixes?: string[];
  preview?: PreviewReport;
}

export interface CassetteOptions {
  scanPlan?: (text: string) => readonly RiskFinding[];
  scanCode?: (html: string) => readonly RiskFinding[];
}

function isChoice(value: unknown): value is ChoiceId {
  return value === "short" || value === "tests" || value === "polish" || value === "cut" || value === "plug";
}

/** Parse and validate a cassette file. Throws if the shape is not playable. */
export function loadCassette(text: string): Cassette {
  const raw = JSON.parse(text) as Partial<Cassette>;
  if (!raw || typeof raw !== "object") throw new PlayError("cassette is not an object");
  if (typeof raw.id !== "string" || typeof raw.idea !== "string" || typeof raw.plan !== "string") {
    throw new PlayError("cassette needs id, idea, and plan");
  }
  if (!raw.provenance || (raw.provenance.kind !== "synthetic" && raw.provenance.kind !== "recorded") || typeof raw.provenance.note !== "string") {
    throw new PlayError("cassette provenance needs kind and note");
  }
  if (raw.provenance.kind === "recorded" && (!raw.provenance.model || !raw.provenance.recordedAt)) {
    throw new PlayError("recorded cassettes need model and recordedAt");
  }
  if (!Array.isArray(raw.artifacts) || raw.artifacts.some((artifact) => typeof artifact?.html !== "string")) {
    throw new PlayError("cassette artifacts need html");
  }
  if (!Array.isArray(raw.choices) || raw.choices.some((choice) => !isChoice(choice))) {
    throw new PlayError("cassette choices must be short, tests, polish, cut, or plug");
  }
  return raw as Cassette;
}

function takeWall(walls: CassetteWall[]): CassetteWall {
  return walls.shift() ?? { action: "block", by: "human" };
}

/**
 * Play a cassette to an ending. Deterministic: no clock, no network.
 * The same cassette and scanners always produce the same ending.
 */
export function playCassette(cassette: Cassette, options: CassetteOptions = {}): PlayState {
  const walls = [...(cassette.walls ?? [])];
  const fixes = [...(cassette.fixes ?? [])];
  let state = transition(createSession(), { type: "start", idea: cassette.idea, lang: cassette.lang, id: cassette.id });
  const planFindings = options.scanPlan?.(cassette.plan) ?? [];
  state = transition(state, { type: "plan", text: cassette.plan, findings: planFindings });
  if (state.phase === "planWall") {
    const wall = takeWall(walls);
    state = transition(state, { type: "wall", action: wall.action, by: wall.by ?? "human" });
  }

  let choiceIndex = 0;
  for (const artifact of cassette.artifacts) {
    if (state.phase === "ended") return state;
    if (state.phase === "qte") {
      const choice = cassette.choices[choiceIndex];
      choiceIndex += 1;
      if (!choice) throw new PlayError(`cassette ${cassette.id} ran out of choices at v${state.version}`);
      state = transition(state, { type: "choose", id: choice, by: "human" });
      if (state.phase === "ended") return state;
    }
    if (state.phase !== "building" && state.phase !== "fixing") {
      throw new PlayError(`cassette ${cassette.id} cannot build from phase ${state.phase}`);
    }
    state = deliver(state, artifact.html, options, walls, fixes);
  }

  if (state.phase === "qte") {
    const choice = cassette.choices[choiceIndex];
    if (choice === "plug") return transition(state, { type: "choose", id: "plug", by: "human" });
    throw new PlayError(`cassette ${cassette.id} ended on a choice with no further artifact`);
  }
  if (state.phase !== "judging") {
    throw new PlayError(`cassette ${cassette.id} finished in phase ${state.phase}, not judging`);
  }
  const risks = uniqueCategories(options.scanCode?.(state.html) ?? []);
  return transition(state, { type: "judge", facts: factsFor(state, cassette.preview, risks) });
}

function deliver(
  state: PlayState,
  html: string,
  options: CassetteOptions,
  walls: CassetteWall[],
  fixes: string[],
): PlayState {
  let next = transition(state, { type: "artifact", html, findings: options.scanCode?.(html) ?? [] });
  let guard = 0;
  while (next.phase === "codeWall" || next.phase === "fixing") {
    guard += 1;
    if (guard > 8) throw new PlayError("risk loop did not settle");
    if (next.phase === "codeWall") {
      const wall = takeWall(walls);
      next = transition(next, { type: "wall", action: wall.action, by: wall.by ?? "human" });
      continue;
    }
    const fixHtml = fixes.shift() ?? html;
    const findings = options.scanCode?.(fixHtml) ?? [];
    // A fix that still contains only categories the human already blocked does not open a new wall.
    next = transition(next, { type: "artifact", html: fixHtml, findings });
    if (freshFindings(next, findings).length === 0 && next.phase !== "codeWall") break;
  }
  return next;
}

function uniqueCategories(findings: readonly RiskFinding[]): string[] {
  return [...new Set(findings.map((finding) => finding.category))];
}
