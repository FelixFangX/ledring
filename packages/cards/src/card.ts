import { parseFrontmatter } from "./frontmatter.js";

export const PERMISSIONS_EXTENSION = "https://github.com/FelixFangX/ledring/blob/main/docs/extensions/permissions-v1.md";

export interface AgentSkill { id: string; name: string; description: string; tags: string[] }
export interface AgentCard {
  name: string;
  description: string;
  version: string;
  supportedInterfaces: { url: string; protocolBinding: string; protocolVersion: string }[];
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
    extensions: { uri: string; description: string; required: boolean; params: PermissionsParams }[];
  };
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: AgentSkill[];
}
export interface PermissionsParams {
  tools: string[];
  model?: string;
  permissions: { allow: string[]; ask: string[]; deny: string[] };
  mcpServers: { name: string; transport: "stdio" | "http" | "sse" }[];
}

export interface CardSources {
  /** Claude Code subagent markdown (`.claude/agents/*.md`). */
  agent: string;
  /** `.claude/settings.json` contents. */
  settings?: string;
  /** `.mcp.json` contents. Only server names and transports are read; env, args and headers never leave. */
  mcp?: string;
  url?: string;
  version?: string;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const list = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v : (v ?? "").split(",")).map((s) => s.trim()).filter(Boolean);
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** Build an A2A (v1.0) Agent Card from an agent's local configuration. */
export function cardFromConfig(src: CardSources): AgentCard {
  const { data, body } = parseFrontmatter(src.agent);
  const name = typeof data.name === "string" ? data.name : "";
  if (!name) throw new Error("agent file needs a `name` in its frontmatter");
  const description = typeof data.description === "string" ? data.description : firstParagraph(body);
  const tools = list(data.tools);

  const perms = src.settings ? ((JSON.parse(src.settings) as { permissions?: Record<string, unknown> }).permissions ?? {}) : {};
  const servers = src.mcp ? ((JSON.parse(src.mcp) as { mcpServers?: Record<string, { type?: string; url?: string }> }).mcpServers ?? {}) : {};

  const sections = [...body.matchAll(/^##\s+(.+)\n+([^\n#][^\n]*)?/gm)];
  const skills: AgentSkill[] = sections.length
    ? sections.map((m) => ({ id: slug(m[1]!), name: m[1]!.trim(), description: (m[2] ?? m[1]!).trim(), tags: [slug(name)] }))
    : [{ id: slug(name), name, description, tags: tools.map(slug) }];

  return {
    name,
    description,
    version: src.version ?? "0.1.0",
    supportedInterfaces: src.url ? [{ url: src.url, protocolBinding: "JSONRPC", protocolVersion: "1.0" }] : [],
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extensions: [
        {
          uri: PERMISSIONS_EXTENSION,
          description: "Tools, permission rules and MCP servers this agent runs with.",
          required: false,
          params: {
            tools,
            ...(typeof data.model === "string" ? { model: data.model } : {}),
            permissions: { allow: strings(perms.allow), ask: strings(perms.ask), deny: strings(perms.deny) },
            mcpServers: Object.entries(servers)
              .map(([n, s]): PermissionsParams["mcpServers"][number] => ({ name: n, transport: s.type === "http" || s.type === "sse" ? s.type : s.url ? "http" as const : "stdio" as const }))
              .sort((a, b) => a.name.localeCompare(b.name)),
          },
        },
      ],
    },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills,
  };
}

/** Spec card for a Play trace. Agent markdown cards stay on {@link cardFromConfig}. */
export function cardFromPlayTrace(input: { instruction?: string; ending?: string }): AgentCard {
  const ending = input.ending && input.ending.length > 0 ? input.ending : "UNJUDGED";
  return {
    name: "LEDRING Play",
    description: (input.instruction || "Play session").slice(0, 280),
    version: "0.1.0",
    supportedInterfaces: [],
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extensions: [
        {
          uri: PERMISSIONS_EXTENSION,
          description: "Play session. This is not an agent permission card.",
          required: false,
          params: { tools: [], permissions: { allow: [], ask: [], deny: [] }, mcpServers: [] },
        },
      ],
    },
    defaultInputModes: ["text"],
    defaultOutputModes: ["text/html"],
    skills: [{ id: "ending", name: ending, description: `Ending ${ending}`, tags: ["play"] }],
  };
}

function firstParagraph(body: string): string {
  return body.split(/\n\s*\n/).map((p) => p.trim()).find((p) => p && !p.startsWith("#")) ?? "";
}
