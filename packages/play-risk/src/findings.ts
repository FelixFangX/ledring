export const RISK_CATEGORIES = ["network", "eval", "storage", "external", "popup", "suspicious"] as const;
export type RiskCategory = (typeof RISK_CATEGORIES)[number];

export interface RiskFinding {
  category: RiskCategory;
  severity: "low" | "medium" | "high";
  line: number;
  col: number;
  snippet: string;
  ruleId: string;
}

export function finding(
  category: RiskCategory,
  ruleId: string,
  severity: RiskFinding["severity"],
  line: number,
  col: number,
  snippet: string,
): RiskFinding {
  return {
    category,
    severity,
    line: Math.max(1, line),
    col: Math.max(0, col),
    snippet: snippet.trim().slice(0, 140),
    ruleId,
  };
}

export function dedupe(findings: RiskFinding[]): RiskFinding[] {
  const seen = new Set<string>();
  const out: RiskFinding[] = [];
  for (const item of findings) {
    const key = `${item.ruleId}:${item.line}:${item.col}:${item.snippet}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function isRemoteUrl(value: string): boolean {
  return /^\s*(?:https?:)?\/\//i.test(value);
}

export function lineSnippet(source: string, line: number): string {
  return source.split("\n")[line - 1] ?? source.slice(0, 140);
}
