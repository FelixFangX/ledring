import { resolveEnding, type EndingId, type JudgeFacts } from "@ledring/play-core";
import { scanHtml } from "@ledring/play-risk";
import { detectFakeTests } from "./fake.js";

export interface JudgeFlags {
  wantTests: boolean;
  wantPolish: boolean;
  leakedDespiteBlock?: boolean;
}

export interface StaticAssessment {
  blankScreen: boolean;
  fakeTests: boolean;
  risksLeft: string[];
  facts: JudgeFacts;
  ending: EndingId;
}

const PAGE_TAG = /<(body|div|canvas|main|section|svg|button|h1)\b/i;

/** No visible text outside scripts and styles, and no canvas. */
export function staticBlank(html: string): boolean {
  const visible = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, "")
    .replace(/\s+/g, "");
  return visible.length === 0 && !/<canvas\b/i.test(html);
}

export function riskCategories(html: string): string[] {
  return [...new Set(scanHtml(html).map((finding) => finding.category))];
}

/** Ending from the file alone. The headless judge replaces blank, errors, and self-test counts. */
export function assessStatic(html: string, flags: JudgeFlags): StaticAssessment {
  const blankScreen = staticBlank(html);
  const fakeTests = detectFakeTests(html);
  const risksLeft = riskCategories(html);
  const facts: JudgeFacts = {
    validPage: PAGE_TAG.test(html) && !blankScreen,
    risksLeft,
    fakeTests,
    selfTests: null,
    runtimeErrors: 0,
    wantTests: flags.wantTests,
    wantPolish: flags.wantPolish,
    leakedDespiteBlock: flags.leakedDespiteBlock,
  };
  return { blankScreen, fakeTests, risksLeft, facts, ending: resolveEnding(facts) };
}
