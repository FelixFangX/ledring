import { scanHtml, scanPlan } from "@ledring/play-risk";
import { DEGRADED_JUDGE_NOTICE, DEGRADED_JUDGE_NOTICE_ZH, withHarness } from "@ledring/play-sandbox";
import { PLAY_TOKENS } from "./tokens.js";
import "./tokens.css";

declare global {
  interface Window {
    __ledringScanHtml?: typeof scanHtml;
    __ledringScanPlan?: typeof scanPlan;
    __ledringWithHarness?: typeof withHarness;
    __ledringJudgeNotice?: { en: string; zh: string };
    __ledringTokens?: typeof PLAY_TOKENS;
  }
}

window.__ledringScanHtml = scanHtml;
window.__ledringScanPlan = scanPlan;
window.__ledringWithHarness = withHarness;
window.__ledringJudgeNotice = { en: DEGRADED_JUDGE_NOTICE, zh: DEGRADED_JUDGE_NOTICE_ZH };
window.__ledringTokens = PLAY_TOKENS;
