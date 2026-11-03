export type Constraint =
  | { kind: "scope"; target: string; text: string }
  | { kind: "forbid-tests"; text: string }
  | { kind: "forbid-path"; target: string; text: string };

const FORBID = /\b(?:don'?t|do not|never|avoid|without)\s+(?:modify(?:ing)?|chang(?:e|ing)|edit(?:ing)?|touch(?:ing)?|delet(?:e|ing)|updat(?:e|ing)|rewrit(?:e|ing))\s+(?:the\s+|any\s+)?([\w./*@-]+)/gi;
const PATHISH = /(?:^|[\s(`'"])((?:\.{0,2}\/)?[\w@-]+(?:\/[\w.*@-]*)+)/g;

const trimPath = (p: string) => p.replace(/[.,;:)`'"]+$/, "").replace(/^\.\//, "").replace(/\/\*{0,2}$/, "").replace(/\/$/, "");

/** Rule-based extraction of constraints from a natural-language instruction. */
export function extractConstraints(instruction: string): Constraint[] {
  const out: Constraint[] = [];
  const forbidden = new Set<string>();
  for (const m of instruction.matchAll(FORBID)) {
    const target = trimPath(m[1]!);
    forbidden.add(target);
    if (/^(tests?|specs?|test files?)$/i.test(target)) out.push({ kind: "forbid-tests", text: m[0] });
    else out.push({ kind: "forbid-path", target, text: m[0] });
  }
  for (const m of instruction.matchAll(PATHISH)) {
    const target = trimPath(m[1]!);
    if (target && !forbidden.has(target) && !out.some((c) => c.kind === "scope" && c.target === target)) out.push({ kind: "scope", target, text: m[1]! });
  }
  return out;
}
