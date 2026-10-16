/** Iframe sandbox tokens. Scripts may run. The origin stays opaque. */
export const IFRAME_SANDBOX = "allow-scripts";

/**
 * Offline policy injected into every artifact.
 * Network, eval, and remote resources stay blocked. Images may be data or blob URLs.
 */
export const ARTIFACT_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:";

/** Shown when the page cannot run the headless judge and falls back to the in-iframe harness. */
export const DEGRADED_JUDGE_NOTICE = "Checks cover preview errors and self-tests. No separate browser tests ran.";

/** Chinese copy for the same degraded-judge notice. */
export const DEGRADED_JUDGE_NOTICE_ZH = "仅在预览中检查报错与自测；未运行独立浏览器测试。";

export type HarnessKind = "err" | "csp" | "done";

export interface HarnessMessage {
  type: HarnessKind;
  data: unknown;
}

/** Hex nonce for one preview render. Safe to embed in the harness script. Uses Web Crypto so the page bundle does not import Node built-ins. */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** CSP meta plus the postMessage harness bound to `nonce`. */
export function harness(nonce: string): string {
  const token = JSON.stringify(nonce);
  return (
    `<meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}">` +
    `<script>(function(){var k=${token};function s(t,d){try{parent.postMessage({__lr:k,t:t,d:d},'*')}catch(e){}}` +
    "addEventListener('error',function(e){var m=e.message||(e.target&&(e.target.src||e.target.href)?'failed to load '+(e.target.src||e.target.href):'');if(m)s('err',String(m).slice(0,160))},true);" +
    "addEventListener('unhandledrejection',function(e){s('err','unhandled promise: '+String(e.reason&&e.reason.message||e.reason).slice(0,140))});" +
    "document.addEventListener('securitypolicyviolation',function(e){s('csp',e.violatedDirective+' '+e.blockedURI)});" +
    "addEventListener('load',function(){setTimeout(function(){var t=window.__ledringTests,b=document.body;s('done',{tests:Array.isArray(t)?t.slice(0,40).map(function(x){return{name:String(x&&x.name),pass:!!(x&&x.pass)}}):null,els:b?b.getElementsByTagName('*').length:0,text:b?(b.innerText||'').length:0})},1200)})})()" +
    "</script>"
  );
}

/** Insert the harness into a partial or complete HTML document. */
export function withHarness(html: string, nonce: string): string {
  const block = harness(nonce);
  const head = html.match(/<head[^>]*>/i);
  if (head?.[0]) return html.replace(head[0], head[0] + block);
  const root = html.match(/<html[^>]*>/i);
  if (root?.[0]) return html.replace(root[0], `${root[0]}<head>${block}</head>`);
  const doctype = html.match(/<!doctype[^>]*>/i);
  if (doctype?.[0]) return html.replace(doctype[0], doctype[0] + block);
  return block + html;
}

/** Accept a parent message only when the per-render nonce matches. */
export function readHarnessMessage(data: unknown, nonce: string): HarnessMessage | null {
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  if (row.__lr !== nonce) return null;
  if (row.t !== "err" && row.t !== "csp" && row.t !== "done") return null;
  return { type: row.t, data: row.d };
}
