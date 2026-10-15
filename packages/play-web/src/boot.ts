import {
  OFFLINE_QUESTIONS,
  fuseDirections,
  generateDirections,
  inspirationRun,
  loadCassette,
  playCassette,
  replayEvents,
  synthesizeDirections,
} from "@ledring/play-core";
import { fetchTrends, hackerNews, modelWebSearch } from "../../play-providers/src/trends.js";
import { scanHtml, scanPlan } from "@ledring/play-risk";
import { DEGRADED_JUDGE_NOTICE, DEGRADED_JUDGE_NOTICE_ZH, withHarness } from "@ledring/play-sandbox";
import { briefBucket, nearBuckets } from "@ledring/play-strands";
import { PLAY_TOKENS } from "./tokens.js";
import { MOTION_TOKENS, createMotionEngine, type MotionEngine } from "./motion.js";
import "./tokens.css";

declare global {
  interface Window {
    __ledringScanHtml?: typeof scanHtml;
    __ledringScanPlan?: typeof scanPlan;
    __ledringWithHarness?: typeof withHarness;
    __ledringJudgeNotice?: { en: string; zh: string };
    __ledringTokens?: typeof PLAY_TOKENS;
    __ledringMotionTokens?: typeof MOTION_TOKENS;
    __ledringCreateMotion?: typeof createMotionEngine;
    __ledringMotion?: MotionEngine;
    __ledringReplayEvents?: typeof replayEvents;
    __ledringPlayCassette?: typeof playCassette;
    __ledringLoadCassette?: typeof loadCassette;
    __ledringOfflineQuestions?: typeof OFFLINE_QUESTIONS;
    __ledringGenerateDirections?: typeof generateDirections;
    __ledringFuseDirections?: typeof fuseDirections;
    __ledringSynthesizeDirections?: typeof synthesizeDirections;
    __ledringInspirationRun?: typeof inspirationRun;
    __ledringFetchTrends?: typeof fetchTrends;
    __ledringHackerNews?: typeof hackerNews;
    __ledringModelWebSearch?: typeof modelWebSearch;
    __ledringBriefBucket?: typeof briefBucket;
    __ledringNearBuckets?: typeof nearBuckets;
  }
}

window.__ledringScanHtml = scanHtml;
window.__ledringScanPlan = scanPlan;
window.__ledringWithHarness = withHarness;
window.__ledringJudgeNotice = { en: DEGRADED_JUDGE_NOTICE, zh: DEGRADED_JUDGE_NOTICE_ZH };
window.__ledringTokens = PLAY_TOKENS;
window.__ledringMotionTokens = MOTION_TOKENS;
window.__ledringCreateMotion = createMotionEngine;
window.__ledringReplayEvents = replayEvents;
window.__ledringPlayCassette = playCassette;
window.__ledringLoadCassette = loadCassette;
window.__ledringOfflineQuestions = OFFLINE_QUESTIONS;
window.__ledringGenerateDirections = generateDirections;
window.__ledringFuseDirections = fuseDirections;
window.__ledringSynthesizeDirections = synthesizeDirections;
window.__ledringInspirationRun = inspirationRun;
window.__ledringFetchTrends = fetchTrends;
window.__ledringHackerNews = hackerNews;
window.__ledringModelWebSearch = modelWebSearch;
window.__ledringBriefBucket = briefBucket;
window.__ledringNearBuckets = nearBuckets;
