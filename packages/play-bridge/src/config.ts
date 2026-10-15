import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const entry = z.object({
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  model: z.string().optional(),
});

const fileSchema = z.object({
  openai: entry.optional(),
  anthropic: entry.optional(),
  ollama: entry.omit({ apiKey: true }).optional(),
}).strict();

export interface BridgeConfig {
  openai?: { apiKey?: string; baseUrl?: string; model?: string };
  anthropic?: { apiKey?: string; baseUrl?: string; model?: string };
  ollama?: { baseUrl?: string; model?: string };
}

export function parseProviderFile(text: string): BridgeConfig {
  return fileSchema.parse(JSON.parse(text));
}

export function providerSecrets(config: BridgeConfig): string[] {
  return [config.openai?.apiKey, config.anthropic?.apiKey].filter((value): value is string => Boolean(value && value.length >= 6));
}

/** Human-readable config. API keys are never included. */
export function formatProviderConfig(config: BridgeConfig, warning?: string): string {
  const configured = (name: string, key: string | undefined, where?: string) =>
    `${name}: ${key ? "configured" : "not configured"}${where ? ` @ ${where}` : ""}`;
  const lines = [
    "bind: 127.0.0.1",
    "demo: synthetic cassette",
    configured("openai-compat", config.openai?.apiKey, config.openai?.baseUrl),
    configured("anthropic", config.anthropic?.apiKey, config.anthropic?.baseUrl),
    `ollama: ${config.ollama?.baseUrl ?? "http://127.0.0.1:11434/v1"}`,
  ];
  if (warning) lines.push(`warning: ${warning}`);
  return `${lines.join("\n")}\n`;
}

export function readProviderHome(dir: string): { config: BridgeConfig; warning?: string } {
  const path = join(dir, "providers.json");
  let info;
  try {
    info = statSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { config: {} };
    throw error;
  }
  const config = parseProviderFile(readFileSync(path, "utf8"));
  const perms = info.mode & 0o777;
  const warning = (perms & 0o077) !== 0 ? "providers.json is readable by other users; chmod 600 it" : undefined;
  return { config, ...(warning ? { warning } : {}) };
}
