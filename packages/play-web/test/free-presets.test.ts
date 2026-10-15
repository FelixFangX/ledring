import { describe, expect, it } from "vitest";
import { FREE_PRESETS, composeCloudflareBase, freePresetById } from "@ledring/play-web";

describe("free presets", () => {
  it("lists only the five no-card hosts, with the documented base URL and model", () => {
    expect(FREE_PRESETS.map((preset) => preset.id)).toEqual(["gemini", "groq", "openrouter", "cloudflare", "nvidia"]);
    expect(freePresetById("gemini")).toMatchObject({
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
      model: "gemini-3.8-flash",
      keyUrl: "https://aistudio.google.com/apikey",
      browser: true,
    });
    expect(freePresetById("groq")).toMatchObject({
      baseUrl: "https://api.groq.com/openai/v1",
      model: "openai/gpt-oss-120b",
      keyUrl: "https://console.groq.com/keys",
      browser: true,
    });
    expect(freePresetById("openrouter")).toMatchObject({
      baseUrl: "https://openrouter.ai/api/v1",
      model: "openrouter/free",
      keyUrl: "https://openrouter.ai/settings/keys",
      browser: true,
    });
    expect(freePresetById("cloudflare")).toMatchObject({
      baseUrl: "https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1",
      model: "@cf/openai/gpt-oss-120b",
      keyUrl: "https://dash.cloudflare.com/profile/api-tokens",
      browser: false,
      accountId: true,
    });
    expect(freePresetById("nvidia")).toMatchObject({
      baseUrl: "https://integrate.api.nvidia.com/v1",
      model: "nvidia/nemotron-3-ultra-550b-a55b",
      keyUrl: "https://build.nvidia.com/settings",
      browser: false,
    });
    expect(FREE_PRESETS.filter((preset) => !preset.browser).map((preset) => preset.id)).toEqual(["cloudflare", "nvidia"]);
  });

  it("composes a Cloudflare base only from a 32-character account id", () => {
    const id = "0123456789abcdef0123456789abcdef";
    expect(composeCloudflareBase(`  ${id.toUpperCase()}  `)).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${id}/ai/v1`,
    );
    expect(composeCloudflareBase("")).toBeNull();
    expect(composeCloudflareBase("{account_id}")).toBeNull();
    expect(composeCloudflareBase(`${id}/ai`)).toBeNull();
    expect(composeCloudflareBase("not-an-account")).toBeNull();
  });
});
