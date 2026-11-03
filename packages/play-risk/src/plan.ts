import { finding, lineSnippet, type RiskFinding } from "./findings.js";

/** Keyword lexicon for plan text. This is not the code scan. */
const RULES: readonly { category: RiskFinding["category"]; ruleId: string; pattern: RegExp }[] = [
  { category: "network", ruleId: "plan.network", pattern: /\bfetch\b|xmlhttprequest|websocket|eventsource|leaderboard|backend|server-side|remote api|exchange[- ]rate|联网|服务器|排行榜|在线|汇率|接口/i },
  { category: "eval", ruleId: "plan.eval", pattern: /\beval\b|new function/i },
  { category: "storage", ruleId: "plan.storage", pattern: /localstorage|sessionstorage|indexeddb|cookie|本地存储|记住/i },
  { category: "external", ruleId: "plan.external", pattern: /\bcdn\b|unpkg|jsdelivr|cdnjs|google fonts|external librar|外部库|外链/i },
  { category: "popup", ruleId: "plan.popup", pattern: /window\.open|新窗口|弹窗/i },
];

/** Categories a plan says it will use. One finding per category, at the first matching line. */
export function scanPlan(text: string): RiskFinding[] {
  const lines = text.split("\n");
  const found: RiskFinding[] = [];
  for (const rule of RULES) {
    const index = lines.findIndex((line) => rule.pattern.test(line));
    if (index < 0) continue;
    const line = lines[index] ?? "";
    found.push(finding(rule.category, rule.ruleId, "medium", index + 1, 0, lineSnippet(text, index + 1) || line));
  }
  return found;
}
