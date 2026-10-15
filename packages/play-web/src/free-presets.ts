/**
 * One-click free OpenAI-compatible hosts for Play onboarding.
 *
 * Endpoints and model ids were checked against vendor docs on 2026-10-15.
 * `browser` is the result of a CORS preflight and an unauthenticated POST
 * from a foreign Origin on that date: true only when the response carried
 * Access-Control-Allow-Origin and allowed authorization plus content-type.
 * Hosts that omit that header are marked false and the page sends them
 * through the local bridge instead of calling them from the browser.
 */
export interface FreePreset {
  id: "gemini" | "groq" | "openrouter" | "cloudflare" | "nvidia";
  baseUrl: string;
  model: string;
  keyUrl: string;
  /** The browser may call this host directly. */
  browser: boolean;
  /** The base URL needs a Cloudflare account id before it can be called. */
  accountId: boolean;
}

export const FREE_PRESETS: readonly FreePreset[] = [
  {
    id: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
    model: "gemini-3.8-flash",
    keyUrl: "https://aistudio.google.com/apikey",
    browser: true,
    accountId: false,
  },
  {
    id: "groq",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "openai/gpt-oss-120b",
    keyUrl: "https://console.groq.com/keys",
    browser: true,
    accountId: false,
  },
  {
    id: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openrouter/free",
    keyUrl: "https://openrouter.ai/settings/keys",
    browser: true,
    accountId: false,
  },
  {
    id: "cloudflare",
    baseUrl: "https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1",
    model: "@cf/openai/gpt-oss-120b",
    keyUrl: "https://dash.cloudflare.com/profile/api-tokens",
    browser: false,
    accountId: true,
  },
  {
    id: "nvidia",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    model: "nvidia/nemotron-3-ultra-550b-a55b",
    keyUrl: "https://build.nvidia.com/settings",
    browser: false,
    accountId: false,
  },
];

const ACCOUNT_ID = /^[a-f0-9]{32}$/;

/** Cloudflare account ids are 32 hex characters. Anything else is refused. */
export function composeCloudflareBase(accountId: string): string | null {
  const id = accountId.trim().toLowerCase();
  if (!ACCOUNT_ID.test(id)) return null;
  return `https://api.cloudflare.com/client/v4/accounts/${id}/ai/v1`;
}

export function freePresetById(id: string): FreePreset | undefined {
  return FREE_PRESETS.find((preset) => preset.id === id);
}
