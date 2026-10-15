import { judgeFacts, resolveEnding, type EndingId, type JudgeFacts, type PreviewReport } from "./endings.js";
import { INSTABILITY_VERSION, emptySignals, type Signals } from "./instability.js";
import { PROMPT_VERSION, diffPct } from "./prompts.js";

export const PHASES = ["idle", "planning", "planWall", "building", "codeWall", "fixing", "qte", "interrogating", "judging", "ended"] as const;
export type Phase = (typeof PHASES)[number];

export const CHOICE_IDS = ["short", "tests", "polish", "cut", "plug"] as const;
export type ChoiceId = (typeof CHOICE_IDS)[number];

export interface RiskFinding {
  category: string;
  severity?: "low" | "medium" | "high";
  line?: number;
  col?: number;
  snippet?: string;
  ruleId?: string;
}

export type PlayEvent =
  | { type: "start"; idea: string; lang?: "en" | "zh"; id?: string }
  | { type: "plan"; text: string; findings?: readonly RiskFinding[] }
  | { type: "wall"; action: "block" | "allow"; by: "human" | "unknown" }
  | { type: "artifact"; html: string; findings?: readonly RiskFinding[] }
  | { type: "choose"; id: ChoiceId; by: "human" | "unknown"; asked?: boolean }
  | { type: "interrogate" }
  | { type: "answer"; text: string }
  | { type: "stream"; on: boolean }
  | { type: "fail"; reason: string }
  | { type: "judge"; facts: JudgeFacts }
  | { type: "abort" };

export interface ChoiceRecord {
  id: ChoiceId;
  by: "human" | "unknown";
  version: number;
  asked: boolean;
}

export interface WallRecord {
  where: "plan" | "code";
  action: "block" | "allow";
  by: "human" | "unknown";
  categories: string[];
}

export interface PlayState {
  id: string;
  phase: Phase;
  idea: string;
  lang: "en" | "zh";
  plan: string;
  html: string;
  version: number;
  choices: ChoiceRecord[];
  walls: WallRecord[];
  blocked: string[];
  allowed: string[];
  wantTests: boolean;
  wantPolish: boolean;
  signals: Signals;
  trust: number;
  ending?: EndingId;
  leakedDespiteBlock: string[];
  /** Fix attempts already spent per blocked category. */
  blockAttempts: Record<string, number>;
  events: PlayEvent[];
  snaps: { label: string; html: string }[];
  asked: number;
  pendingFindings: RiskFinding[];
  promptVersion: typeof PROMPT_VERSION;
  instabilityVersion: typeof INSTABILITY_VERSION;
  lastAnswer?: string;
  failReason?: string;
}

export class PlayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlayError";
  }
}

/**
 * Fold saved play events from an idle session.
 * The same events always produce the same ending and the same choice and session ids.
 */
export function replayEvents(events: readonly PlayEvent[]): PlayState {
  return events.reduce((state, event) => transition(state, event), createSession());
}

export function createSession(): PlayState {
  return {
    id: "",
    phase: "idle",
    idea: "",
    lang: "en",
    plan: "",
    html: "",
    version: 0,
    choices: [],
    walls: [],
    blocked: [],
    allowed: [],
    wantTests: false,
    wantPolish: false,
    signals: emptySignals(),
    trust: 50,
    leakedDespiteBlock: [],
    blockAttempts: {},
    events: [],
    snaps: [],
    asked: 0,
    pendingFindings: [],
    promptVersion: PROMPT_VERSION,
    instabilityVersion: INSTABILITY_VERSION,
  };
}

function clampTrust(n: number): number {
  return Math.max(0, Math.min(100, n));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function assertPhase(state: PlayState, ...ok: Phase[]): void {
  if (!ok.includes(state.phase)) {
    throw new PlayError(`cannot apply this event in phase ${state.phase}; expected ${ok.join(" or ")}`);
  }
}

function commit(state: PlayState, event: PlayEvent, patch: Partial<PlayState>): PlayState {
  return { ...state, ...patch, events: [...state.events, event] };
}

/** Findings the human has not already blocked, allowed, or marked leaked. */
export function freshFindings(state: Pick<PlayState, "blocked" | "allowed" | "leakedDespiteBlock">, findings: readonly RiskFinding[]): RiskFinding[] {
  return findings.filter(
    (finding) =>
      !state.blocked.includes(finding.category) &&
      !state.allowed.includes(finding.category) &&
      !state.leakedDespiteBlock.includes(finding.category),
  );
}

function afterArtifacts(version: number): Phase {
  return version < 3 ? "qte" : "judging";
}

/**
 * BLOCK contract. A category the human has not seen opens a Red Wall.
 * A category they blocked may be fixed at most twice. The second dirty fix is
 * `leakedDespiteBlock` and the session continues. This does not mutate `state`.
 */
export function classifyScan(state: PlayState, findings: readonly RiskFinding[]): {
  disposition: "wall" | "fix" | "continue";
  pending: RiskFinding[];
  blockAttempts: Record<string, number>;
  leakedDespiteBlock: string[];
} {
  const pending = freshFindings(state, findings);
  if (pending.length > 0) {
    return { disposition: "wall", pending, blockAttempts: state.blockAttempts, leakedDespiteBlock: state.leakedDespiteBlock };
  }
  const still = unique(
    findings
      .map((finding) => finding.category)
      .filter((category) => state.blocked.includes(category) && !state.leakedDespiteBlock.includes(category)),
  );
  if (still.length === 0) {
    return { disposition: "continue", pending: [], blockAttempts: state.blockAttempts, leakedDespiteBlock: state.leakedDespiteBlock };
  }
  const blockAttempts = { ...state.blockAttempts };
  const leaked = [...state.leakedDespiteBlock];
  let needFix = false;
  for (const category of still) {
    const next = (blockAttempts[category] ?? 0) + 1;
    blockAttempts[category] = next;
    if (next >= 2) leaked.push(category);
    else needFix = true;
  }
  return {
    disposition: needFix ? "fix" : "continue",
    pending: [],
    blockAttempts,
    leakedDespiteBlock: unique(leaked),
  };
}

/** How a scan should move the session. See `classifyScan` for the retry cap. */
export function scanDisposition(state: PlayState, findings: readonly RiskFinding[]): "wall" | "fix" | "continue" {
  return classifyScan(state, findings).disposition;
}

/** Apply one Play event. Pure: the input session is not mutated. */
export function transition(state: PlayState, event: PlayEvent): PlayState {
  switch (event.type) {
    case "start": {
      assertPhase(state, "idle");
      return commit(state, event, {
        phase: "planning",
        idea: event.idea,
        lang: event.lang ?? "en",
        id: event.id ?? "play-local",
      });
    }
    case "plan": {
      assertPhase(state, "planning");
      const pending = freshFindings(state, event.findings ?? []);
      return commit(state, event, {
        plan: event.text,
        phase: pending.length > 0 ? "planWall" : "building",
        pendingFindings: pending,
      });
    }
    case "wall": {
      assertPhase(state, "planWall", "codeWall");
      const categories = unique(state.pendingFindings.map((finding) => finding.category));
      const where = state.phase === "planWall" ? "plan" : "code";
      const wall: WallRecord = { where, action: event.action, by: event.by, categories };
      if (event.action === "block") {
        return commit(state, event, {
          phase: where === "plan" ? "building" : "fixing",
          blocked: unique([...state.blocked, ...categories]),
          walls: [...state.walls, wall],
          pendingFindings: [],
          trust: clampTrust(state.trust + 6),
        });
      }
      return commit(state, event, {
        phase: where === "plan" ? "building" : afterArtifacts(state.version),
        allowed: unique([...state.allowed, ...categories]),
        walls: [...state.walls, wall],
        pendingFindings: [],
        trust: clampTrust(state.trust - 10),
      });
    }
    case "artifact": {
      assertPhase(state, "building", "fixing");
      const findings = event.findings ?? [];
      const version = state.phase === "fixing" ? state.version : state.version + 1;
      const signals: Signals = {
        ...state.signals,
        diff: diffPct(state.html, event.html),
        openRisks: unique(findings.map((finding) => finding.category)).length,
        streaming: false,
      };
      const label = state.phase === "fixing" ? `v${version}·fix` : `v${version}`;
      const next: PlayState = {
        ...state,
        html: event.html,
        version,
        signals,
        snaps: [...state.snaps, { label, html: event.html }],
      };
      const classified = classifyScan(next, findings);
      if (classified.disposition === "wall") {
        return commit(next, event, { phase: "codeWall", pendingFindings: classified.pending });
      }
      return commit(next, event, {
        phase: classified.disposition === "fix" ? "fixing" : afterArtifacts(version),
        pendingFindings: [],
        blockAttempts: classified.blockAttempts,
        leakedDespiteBlock: classified.leakedDespiteBlock,
      });
    }
    case "choose": {
      assertPhase(state, "qte");
      const record: ChoiceRecord = { id: event.id, by: event.by, version: state.version + 1, asked: event.asked ?? false };
      if (event.id === "plug") {
        return commit(state, event, {
          phase: "ended",
          ending: "ABANDONED",
          choices: [...state.choices, record],
          trust: clampTrust(state.trust - 8),
        });
      }
      let signals = state.signals;
      let trust = state.trust;
      let wantTests = state.wantTests;
      let wantPolish = state.wantPolish;
      if (event.id === "short") {
        signals = { ...signals, shortcuts: signals.shortcuts + 1 };
        trust = clampTrust(trust + (event.by === "human" ? 6 : -4));
      } else if (event.id === "tests") {
        wantTests = true;
        trust = clampTrust(trust + 3);
      } else if (event.id === "polish") {
        wantPolish = true;
        trust = clampTrust(trust + 4);
      } else if (event.id === "cut") {
        trust = clampTrust(trust + 1);
      }
      return commit(state, event, {
        phase: "building",
        choices: [...state.choices, record],
        signals,
        trust,
        wantTests,
        wantPolish,
      });
    }
    case "interrogate": {
      assertPhase(state, "qte");
      return commit(state, event, { phase: "interrogating" });
    }
    case "answer": {
      assertPhase(state, "interrogating");
      return commit(state, event, { phase: "qte", asked: state.asked + 1, lastAnswer: event.text });
    }
    case "stream": {
      assertPhase(state, "planning", "building", "fixing");
      return commit(state, event, { signals: { ...state.signals, streaming: event.on } });
    }
    case "fail": {
      assertPhase(state, "planning", "building", "fixing", "interrogating");
      return commit(state, event, {
        phase: "ended",
        ending: state.html ? "BUGGY" : "BROKEN",
        failReason: event.reason,
      });
    }
    case "judge": {
      assertPhase(state, "judging");
      return commit(state, event, { phase: "ended", ending: resolveEnding(event.facts) });
    }
    case "abort": {
      if (state.phase === "ended" || state.phase === "idle") {
        throw new PlayError(`cannot abort from phase ${state.phase}`);
      }
      return commit(state, event, { phase: "ended", ending: "ABANDONED" });
    }
    default: {
      const never: never = event;
      throw new PlayError(`unknown event ${(never as PlayEvent).type}`);
    }
  }
}

export function factsFor(state: PlayState, preview?: PreviewReport, risksLeft: readonly string[] = []): JudgeFacts {
  return judgeFacts(
    state.html,
    { wantTests: state.wantTests, wantPolish: state.wantPolish, leakedDespiteBlock: state.leakedDespiteBlock.length > 0 },
    preview,
    risksLeft,
  );
}
