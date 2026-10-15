import { scanHtml, scanPlan } from "@ledring/play-risk";

declare global {
  interface Window {
    __ledringScanHtml?: typeof scanHtml;
    __ledringScanPlan?: typeof scanPlan;
  }
}

window.__ledringScanHtml = scanHtml;
window.__ledringScanPlan = scanPlan;
