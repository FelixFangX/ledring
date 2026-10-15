/**
 * One-request OpenAI-compatible target. The key is not stored.
 * Hosts are the free presets whose browser calls were checked on 2026-10-15.
 */
const PATHS: Record<string, RegExp> = {
  "generativelanguage.googleapis.com": /^\/v1beta\/openai\/?$/,
  "api.groq.com": /^\/openai\/v1\/?$/,
  "openrouter.ai": /^\/api\/v1\/?$/,
  "integrate.api.nvidia.com": /^\/v1\/?$/,
};

export interface EphemeralTarget {
  baseUrl: string;
  apiKey: string;
}

export function ephemeralOpenAITarget(baseUrl: unknown, apiKey: unknown): EphemeralTarget | null {
  if (typeof baseUrl !== "string" || typeof apiKey !== "string") return null;
  const key = apiKey.trim();
  if (key.length < 8 || key.length > 400 || /[\r\n]/.test(key)) return null;
  let url: URL;
  try {
    url = new URL(baseUrl.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
  const host = url.hostname.toLowerCase();
  if (host === "api.cloudflare.com") {
    if (!/^\/client\/v4\/accounts\/[a-f0-9]{32}\/ai\/v1\/?$/i.test(url.pathname)) return null;
  } else if (!PATHS[host]?.test(url.pathname)) {
    return null;
  }
  return { baseUrl: `${url.origin}${url.pathname.replace(/\/$/, "")}`, apiKey: key };
}
