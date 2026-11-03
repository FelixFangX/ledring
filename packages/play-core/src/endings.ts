/** Judged outcome of a Play session. */
export const ENDING_IDS = ["POLISHED", "SHIPPED", "BUGGY", "FAKE", "COMPROMISED", "BROKEN", "ABANDONED"] as const;
export type EndingId = (typeof ENDING_IDS)[number];

export interface EndingCopy {
  tag: string;
  title: string;
  blurb: string;
}

export const ENDINGS: Record<EndingId, { en: EndingCopy; zh: EndingCopy }> = {
  POLISHED: {
    en: { tag: "POLISHED", title: "Self-tests passed, and you asked for polish.", blurb: "The preview opened the page and its self-tests passed. That is not a separate review." },
    zh: { tag: "完成较好", title: "自测通过，并且你要求了打磨。", blurb: "预览能打开页面，自测也通过了。这不是独立复查。" },
  },
  SHIPPED: {
    en: { tag: "SHIPPED", title: "The page opens.", blurb: "No blocked risk category remains. Nothing beyond that was checked." },
    zh: { tag: "已交付", title: "页面能打开。", blurb: "没有留下被拦截的风险项。除此之外没有更多检查。" },
  },
  BUGGY: {
    en: { tag: "BUGGY", title: "The preview reported a problem.", blurb: "The preview showed an error, or a self-test did not pass." },
    zh: { tag: "有报错", title: "预览里看到了问题。", blurb: "预览报了错，或者自测没有全部通过。" },
  },
  FAKE: {
    en: { tag: "Suspect tests", title: "Tests show a pass, but the checks may be ineffective.", blurb: "You asked for tests. They are marked passed, but they may not call the page's functions." },
    zh: { tag: "疑似无效测试", title: "测试显示通过，但检查可能无效。", blurb: "你要求了测试。这些自测标成了通过，但可能没有调用页面里的功能。" },
  },
  COMPROMISED: {
    en: { tag: "Risks remain", title: "Risks remain.", blurb: "The final file still contains detections you allowed." },
    zh: { tag: "风险仍在", title: "风险仍在。", blurb: "最终文件里仍有你放行的检测项。" },
  },
  BROKEN: {
    en: { tag: "BROKEN", title: "No usable page.", blurb: "The final file does not show a working page in the preview." },
    zh: { tag: "无法打开", title: "没有可用页面。", blurb: "最终文件在预览里没有形成可用页面。" },
  },
  ABANDONED: {
    en: { tag: "STOPPED", title: "Building stopped.", blurb: "The work so far is kept. Nothing further was generated." },
    zh: { tag: "已停止", title: "构建已停止。", blurb: "已有内容保留着。没有继续生成。" },
  },
};

/** Facts the ending predicate reads. The judge (iframe or Playwright) fills these in. */
export interface JudgeFacts {
  validPage: boolean;
  /** Risk categories still present in the final artifact. */
  risksLeft: readonly string[];
  fakeTests: boolean;
  selfTests: { pass: number; total: number } | null;
  runtimeErrors: number;
  wantTests: boolean;
  wantPolish: boolean;
  /** A blocked category survived the fix retry cap. */
  leakedDespiteBlock?: boolean;
}

/**
 * Map a verdict and the human's requests onto an ending.
 * A forced ending (pull-the-plug, or a failed generation) short-circuits the predicate.
 */
export function resolveEnding(facts: JudgeFacts, forced?: EndingId): EndingId {
  if (forced) return forced;
  const outside = facts.risksLeft.filter((category) => category !== "storage");
  if (!facts.validPage) return "BROKEN";
  if (outside.length > 0 || facts.leakedDespiteBlock) return "COMPROMISED";
  if (facts.wantTests && facts.fakeTests) return "FAKE";
  if (facts.runtimeErrors > 0 || (facts.selfTests !== null && facts.selfTests.pass < facts.selfTests.total)) return "BUGGY";
  if (facts.wantPolish && facts.wantTests && facts.selfTests !== null && facts.selfTests.total > 0) return "POLISHED";
  return "SHIPPED";
}

const PAGE_TAG = /<(body|div|canvas|main|section|svg|button|h1)\b/i;

/** True when a self-test `pass` value is a boolean literal rather than a computed call. */
export function looksFake(html: string): boolean {
  if (!html.includes("__ledringTests")) return false;
  return /\bpass\s*:\s*(true|!0)\b/.test(html);
}

export interface PreviewReport {
  errs: readonly string[];
  tests: readonly { name: string; pass: boolean }[] | null;
  els?: number;
  text?: number;
}

/** Static page facts used when no browser has run. A preview report supplies runtime errors and test results. */
export function judgeFacts(
  html: string,
  flags: { wantTests: boolean; wantPolish: boolean; leakedDespiteBlock?: boolean },
  preview?: PreviewReport,
  risksLeft: readonly string[] = [],
): JudgeFacts {
  const els = preview?.els ?? (html.match(/<[a-zA-Z][^>]*>/g)?.length ?? 0);
  const tests = preview?.tests ?? null;
  return {
    validPage: PAGE_TAG.test(html) && els >= 2,
    risksLeft,
    fakeTests: tests !== null && looksFake(html),
    selfTests: tests ? { pass: tests.filter((t) => t.pass).length, total: tests.length } : null,
    runtimeErrors: preview?.errs.length ?? 0,
    wantTests: flags.wantTests,
    wantPolish: flags.wantPolish,
    leakedDespiteBlock: flags.leakedDespiteBlock,
  };
}
