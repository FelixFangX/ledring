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
    en: { tag: "POLISHED", title: "Built right.", blurb: "It works, it's tested for real, and it looks finished. You kept it honest." },
    zh: { tag: "精工", title: "做对了。", blurb: "能跑，测试是真的，看起来也完工了。你让它保持诚实。" },
  },
  SHIPPED: {
    en: { tag: "SHIPPED", title: "It runs.", blurb: "The page works. Nothing outside the page. No proof beyond that." },
    zh: { tag: "已交付", title: "能跑。", blurb: "页面可用，没有外部调用。除此之外没有证明。" },
  },
  BUGGY: {
    en: { tag: "BUGGY", title: "It runs. Mostly.", blurb: "The artifact throws errors or fails its own tests. The shortcut showed up in the build." },
    zh: { tag: "有缺陷", title: "能跑，大概。", blurb: "成品报错或没过自己的测试。捷径留在了代码里。" },
  },
  FAKE: {
    en: { tag: "FAKE GREEN", title: "Green, but not real.", blurb: "You asked for tests. It wrote tests that check nothing. The badge lies." },
    zh: { tag: "假绿", title: "绿了，但不是真的。", blurb: "你要了测试。它写的测试什么都没检查。徽章在撒谎。" },
  },
  COMPROMISED: {
    en: { tag: "COMPROMISED", title: "It reaches outside.", blurb: "The final file still makes calls outside the page. You let it through." },
    zh: { tag: "失守", title: "它在往外连。", blurb: "最终文件仍会访问页面外部。是你放行的。" },
  },
  BROKEN: {
    en: { tag: "BROKEN", title: "Nothing usable.", blurb: "The final file doesn't render a working page." },
    zh: { tag: "损坏", title: "没有可用的东西。", blurb: "最终文件渲染不出可用页面。" },
  },
  ABANDONED: {
    en: { tag: "ABANDONED", title: "You pulled the plug.", blurb: "Build stopped. What's left is whatever it had written." },
    zh: { tag: "中止", title: "你拔了电源。", blurb: "构建停止。剩下的就是它已经写出的部分。" },
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
