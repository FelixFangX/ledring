import { RunSchema, type Run, type Step } from "@ledring/trace";
import { languageDirective } from "./prompts.js";

export interface Fragment {
  id: string;
  key: "loop" | "trust" | "seen" | "trend" | "ans";
  text: string;
  /** Choice value such as `stop`, `me`, or a trend id. Absent for free text. */
  val?: string;
  src: "choice" | "free" | "trend";
}

export interface Answers {
  loop: Fragment;
  trust: Fragment;
  seen: Fragment;
}

export interface Direction {
  id: string;
  kind: "tool" | "game";
  arch: "pomo" | "tip" | "paint" | "snake";
  title: string;
  brief: string;
  hook: string;
  from: string[];
  wild: boolean;
  by: "generator" | "model";
  fused?: boolean;
}

interface Mechanic {
  id: string;
  fam: "stop" | "pay" | "make" | "wild";
  kind: "tool" | "game";
  arch: Direction["arch"];
  use: ("loop" | "trust" | "seen")[];
  en: { t: string; b: string; h: string };
  zh: { t: string; b: string; h: string };
}

const WHO: Record<"en" | "zh", Record<"me" | "chat" | "stranger", [string, string]>> = {
  en: {
    me: ["just you", "quiet, no sound, one big button"],
    chat: ["your group chat", "a loud finish and a score worth a screenshot"],
    stranger: ["a stranger online", "it ends on a share card, no account needed"],
  },
  zh: {
    me: ["你自己", "安静，没有声音，只有一个大按钮"],
    chat: ["你的群聊", "结尾够热闹，分数值得截图发群"],
    stranger: ["网上的陌生人", "最后生成一张分享卡，不用注册"],
  },
};

const MECH: Mechanic[] = [
  { id: "offswitch", fam: "stop", kind: "tool", arch: "pomo", use: ["loop", "trust", "seen"],
    en: { t: "The Off Switch", b: "A one-screen timer that decides when you stop {loop}", h: "a timer that decides when to stop" },
    zh: { t: "停下键", b: "一个单屏计时器，替你决定什么时候停止「{loop}」", h: "一个替你喊停的计时器" } },
  { id: "stopontime", fam: "stop", kind: "game", arch: "pomo", use: ["loop", "trust", "seen"],
    en: { t: "Stop on Time", b: "A reflex game: hit STOP on the exact second, before {loop} pulls you back in", h: "a stop-on-the-second reflex round" },
    zh: { t: "准点停下", b: "反应小游戏：在「{loop}」把你拉回去之前，准确地按下停止", h: "一轮准点停下的反应挑战" } },
  { id: "fairsplit", fam: "pay", kind: "tool", arch: "tip", use: ["trust", "seen"],
    en: { t: "Fair Split", b: "Enter the total and the people; the machine splits it fairly and shows its math", h: "a splitter that shows its math" },
    zh: { t: "公平分账", b: "输入总额和人数，机器替你们公平分账，并把算式摆出来", h: "一个把算式摆出来的分账器" } },
  { id: "fairornot", fam: "pay", kind: "game", arch: "tip", use: ["trust", "seen"],
    en: { t: "Fair or Not?", b: "Guess everyone's share before the machine reveals it; each round, trust its answer or overrule it", h: "a trust-or-overrule guessing round" },
    zh: { t: "公平吗？", b: "先猜每个人该付多少，再看机器的答案；每一轮都可以信它，也可以推翻它", h: "一轮信它还是推翻它的竞猜" } },
  { id: "obey", fam: "make", kind: "game", arch: "paint", use: ["trust", "seen"],
    en: { t: "Obey or Deviate", b: "You and the machine share a 16×16 canvas: it suggests the next pixel, you obey or deviate", h: "a canvas where you obey or deviate" },
    zh: { t: "服从或偏离", b: "你和机器共用一块 16×16 画布：它建议下一笔，你选择服从还是偏离", h: "一块让你选择服从或偏离的画布" } },
  { id: "loopgrid", fam: "make", kind: "tool", arch: "paint", use: ["loop", "trust", "seen"],
    en: { t: "Loop Breaker", b: "A 16×16 grid: stamp one square for every day you didn't end up {loop}", h: "a grid of days you broke the loop" },
    zh: { t: "断环格子", b: "一张 16×16 的格子：哪天没有「{loop}」，就盖上一格", h: "一张记录破环日子的格子" } },
  { id: "deviant", fam: "wild", kind: "game", arch: "snake", use: ["loop", "seen"],
    en: { t: "Deviant Snake", b: "A snake that steers itself until you grab control; it speeds up every time it eats a “{loopq}”", h: "a self-steering snake you can take over" },
    zh: { t: "失控的蛇", b: "一条自动驾驶的蛇，直到你夺回方向盘；每吃掉一个「{loop}」就更快", h: "一条能被你夺回方向盘的蛇" } },
  { id: "stillhere", fam: "wild", kind: "tool", arch: "pomo", use: ["loop", "seen"],
    en: { t: "Are You Still Here?", b: "A gentle check-in that taps you after 20 minutes of {loop} and asks if this is still your choice", h: "a check-in that asks if it's still your choice" },
    zh: { t: "你还在吗？", b: "当你「{loop}」满二十分钟，它轻轻问你：这还是你自己的选择吗", h: "一个问你“这还是你的选择吗”的提醒" } },
];

/** FNV-1a. Same answers and seed always hash the same. */
export function hashString(value: string): number {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function famOf(fragment: Fragment): "stop" | "pay" | "make" {
  if (fragment.val === "stop" || fragment.val === "pay" || fragment.val === "make") return fragment.val;
  const text = fragment.text.toLowerCase();
  if (/stop|sleep|time|late|quit|停|睡|时间|几点/.test(text)) return "stop";
  if (/pay|money|bill|rent|cost|split|钱|付|账|租|分/.test(text)) return "pay";
  if (/make|draw|create|build|paint|做|画|写|造/.test(text)) return "make";
  const families = ["stop", "pay", "make"] as const;
  return families[hashString(text) % 3] ?? "stop";
}

function seenOf(fragment: Fragment, lang: "en" | "zh"): [string, string] {
  if (fragment.val === "me" || fragment.val === "chat" || fragment.val === "stranger") return WHO[lang][fragment.val];
  const tone = lang === "zh" ? "安静一点，给人留点余地" : "calm and kind, nothing flashy";
  const who = fragment.src === "free" && lang === "zh" ? `「${fragment.text}」` : fragment.src === "free" ? `“${fragment.text}”` : fragment.text;
  return [who, tone];
}

function loopPhrase(fragment: Fragment, lang: "en" | "zh"): { loop: string; raw: string } {
  const raw = fragment.val && fragment.src !== "free"
    ? fragment.val
    : fragment.text.trim().replace(/[。.!！?？]+$/, "");
  const display = lang === "en" && fragment.src === "free" ? raw.replace(/^[A-Z](?=[a-z])/, (char) => char.toLowerCase()) : raw;
  const loop = lang === "en" && fragment.src === "free" ? `“${display}”` : display;
  return { loop, raw: display };
}

function dirFrom(mechanic: Mechanic, answers: Answers, lang: "en" | "zh", wild: boolean): Direction {
  const copy = mechanic[lang];
  const { loop, raw } = loopPhrase(answers.loop, lang);
  const [who, tone] = seenOf(answers.seen, lang);
  const fill = (value: string) => value.replaceAll("{loopq}", raw).replaceAll("{loop}", loop);
  const body = fill(copy.b);
  const question = /[？?]$/.test(copy.t);
  const brief = lang === "zh"
    ? `${copy.t}${question ? "" : "："}${body}。${tone}。做给${who}。`
    : `${copy.t}${question ? "" : ":"} ${body} — ${tone}. Made for ${who}.`;
  const from = mechanic.use.map((key) => answers[key].id).filter((id) => id.length > 0);
  return { id: mechanic.id, kind: mechanic.kind, arch: mechanic.arch, title: copy.t, brief, hook: fill(copy.h), from, wild, by: "generator" };
}

/** Three directions: two from the trust-answer family, plus one wildcard. Pure. */
export function generateDirections(answers: Answers, seed: string, lang: "en" | "zh" = "en"): Direction[] {
  const family = famOf(answers.trust);
  const mine = MECH.filter((mechanic) => mechanic.fam === family);
  const others = MECH.filter((mechanic) => mechanic.fam !== family)
    .map((mechanic) => ({ mechanic, score: hashString(`${seed}|${mechanic.id}`) }))
    .sort((a, b) => b.score - a.score)
    .map((item) => item.mechanic);
  const out = mine.map((mechanic) => dirFrom(mechanic, answers, lang, false));
  if (hashString(seed) % 2) out.reverse();
  const used = new Set(out.map((direction) => direction.arch));
  const wild = others.find((mechanic) => !used.has(mechanic.arch)) ?? others[0];
  if (wild) out.push(dirFrom(wild, answers, lang, true));
  return out;
}

export function fuseDirections(left: Direction, right: Direction, lang: "en" | "zh"): Direction {
  const brief = lang === "zh"
    ? left.brief.replace("。", `，再加上${right.hook}。`)
    : left.brief.replace(" — ", `, plus ${right.hook} — `);
  return {
    id: `${left.id}+${right.id}`,
    kind: left.kind,
    arch: left.arch,
    title: `${left.title} × ${right.title}`,
    brief,
    hook: left.hook,
    from: [...new Set([...left.from, ...right.from])].sort(),
    wild: false,
    fused: true,
    by: left.by,
  };
}

export interface ModelDirection {
  title: string;
  brief: string;
  from: string[];
  kind?: "tool" | "game";
  arch?: Direction["arch"];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/** Parse a model direction list. Drops unknown fragment ids. Fewer than 3 survivors is an error. */
export function parseModelDirections(text: string, allowedIds: readonly string[]): { directions: ModelDirection[]; error?: string } {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  const arrayStart = text.indexOf("[");
  const arrayEnd = text.lastIndexOf("]");
  let raw = "";
  if (start >= 0 && end > start) raw = text.slice(start, end + 1);
  else if (arrayStart >= 0 && arrayEnd > arrayStart) raw = text.slice(arrayStart, arrayEnd + 1);
  else return { directions: [], error: "no json" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { directions: [], error: "invalid json" };
  }
  const record = asRecord(parsed);
  const items = Array.isArray(parsed) ? parsed : record?.directions ?? record?.items;
  if (!Array.isArray(items)) return { directions: [], error: "no directions" };
  const directions: ModelDirection[] = [];
  for (const item of items) {
    const row = asRecord(item);
    if (!row || typeof row.title !== "string" || typeof row.brief !== "string") continue;
    const from = Array.isArray(row.from) ? row.from.filter((id): id is string => typeof id === "string" && allowedIds.includes(id)) : [];
    if (from.length < 2) continue;
    const kind = row.kind === "tool" || row.kind === "game" ? row.kind : undefined;
    const arch = row.arch === "pomo" || row.arch === "tip" || row.arch === "paint" || row.arch === "snake" ? row.arch : undefined;
    directions.push({ title: row.title, brief: row.brief, from, ...(kind ? { kind } : {}), ...(arch ? { arch } : {}) });
  }
  if (directions.length < 3) return { directions, error: directions.length === 0 ? "no directions" : "too few" };
  return { directions: directions.slice(0, 3) };
}

export function directionPrompt(fragments: readonly Fragment[], lang: "en" | "zh"): string {
  const lines = fragments.map((fragment) => `${fragment.id} (${fragment.key}): ${fragment.text}`);
  return [
    "Write exactly 3 different directions for a single-file HTML toy.",
    "Each brief must name one concrete action the user takes and the result they see.",
    "Each direction must cite at least 2 fragment ids from the list in `from`.",
    "Reply with JSON only: {\"directions\":[{\"title\":\"\",\"brief\":\"\",\"from\":[\"F1\",\"F2\"],\"kind\":\"tool\",\"arch\":\"pomo\"}]}",
    `Write title and brief in ${lang === "zh" ? "Simplified Chinese" : "English"}.`,
    languageDirective(lang),
    "Quote the player's own phrases. Do not invent fragment ids.",
    ...lines,
  ].join("\n");
}

/** Use the model JSON when it yields 3 directions. Otherwise fall back to the generator and keep the error. */
export function synthesizeDirections(
  modelText: string,
  answers: Answers,
  seed: string,
  lang: "en" | "zh",
): { directions: Direction[]; fallback: boolean; error?: string } {
  const allowed = [answers.loop.id, answers.trust.id, answers.seen.id];
  const parsed = parseModelDirections(modelText, allowed);
  if (!parsed.error && parsed.directions.length >= 3) {
    return {
      fallback: false,
      directions: parsed.directions.slice(0, 3).map((direction, index) => ({
        id: `model-${index + 1}`,
        kind: direction.kind ?? "tool",
        arch: direction.arch ?? "pomo",
        title: direction.title,
        brief: direction.brief,
        hook: direction.title,
        from: direction.from,
        wild: index === 2,
        by: "model" as const,
      })),
    };
  }
  return { directions: generateDirections(answers, seed, lang), fallback: true, ...(parsed.error ? { error: parsed.error } : {}) };
}

export type InspirationEventType =
  | "answer"
  | "nudge"
  | "directions"
  | "directions_error"
  | "fuse"
  | "pick"
  | "reroll_fragment"
  | "reroll_directions"
  | "rewrite"
  | "brief";

export interface InspirationEvent {
  type: InspirationEventType;
  by: "human" | "model";
  data?: unknown;
}

export interface InspirationExtension {
  source: "offline-questions" | "live-trends";
  fragments: Fragment[];
  directions: Direction[];
  picked?: string;
  brief: string;
  edited: boolean;
  demoArchetype?: string;
  trends?: { id: string; url: string; used: boolean }[];
}

const NOW = "2026-01-01T00:00:00.000Z";

/** Map inspiration events onto a ledring.trace.v1 run. Extension data is attached after schema validation. */
export function inspirationRun(input: {
  id: string;
  brief: string;
  events: readonly InspirationEvent[];
  extension: InspirationExtension;
}): Run & { "x-ledring-play": { inspiration: InspirationExtension } } {
  const steps: Step[] = input.events.map((event, index) => ({
    id: `s${index + 1}`,
    kind: event.by === "model" ? "llm" : "human",
    name: event.by === "model" ? "CX-417" : "user",
    signature: `inspiration:${event.type}`,
    ...(event.data !== undefined ? { [event.by === "model" ? "output" : "input"]: event.data } : {}),
    startedAt: NOW,
    endedAt: NOW,
  }));
  const run = RunSchema.parse({
    schema: "ledring.trace.v1",
    id: input.id,
    source: "ledring-play",
    instruction: input.brief,
    agent: { name: "CX-417" },
    outcome: "unknown",
    startedAt: NOW,
    endedAt: NOW,
    steps,
  });
  return { ...run, "x-ledring-play": { inspiration: input.extension } };
}

export const OFFLINE_QUESTIONS = [
  {
    key: "loop" as const,
    en: { q: "What do you often do without thinking?", options: [
      { label: "Scroll past midnight", val: "scrolling past midnight" },
      { label: "Refresh for replies", val: "refreshing for replies" },
      { label: "Stare at a progress bar", val: "staring at a progress bar" },
    ] },
    zh: { q: "你常不知不觉重复做什么？", options: [
      { label: "刷手机到半夜", val: "刷手机到半夜" },
      { label: "一遍遍刷新等回复", val: "刷新等回复" },
      { label: "盯着进度条发呆", val: "盯着进度条" },
    ] },
  },
  {
    key: "trust" as const,
    en: { q: "One decision you'd hand to a machine. Which?", options: [
      { label: "When I should stop", val: "stop" },
      { label: "Who pays what", val: "pay" },
      { label: "What I make next", val: "make" },
    ] },
    zh: { q: "有一个决定，你愿意交给机器。是哪个？", options: [
      { label: "我该什么时候停", val: "stop" },
      { label: "谁该付多少", val: "pay" },
      { label: "下一步做什么", val: "make" },
    ] },
  },
  {
    key: "seen" as const,
    en: { q: "When it works, who should notice?", options: [
      { label: "Only me", val: "me" },
      { label: "My group chat", val: "chat" },
      { label: "A stranger online", val: "stranger" },
    ] },
    zh: { q: "它成功的那一刻，谁该看见？", options: [
      { label: "只有我", val: "me" },
      { label: "我的群聊", val: "chat" },
      { label: "网上的陌生人", val: "stranger" },
    ] },
  },
];
