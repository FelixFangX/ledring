import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cardFromConfig, PERMISSIONS_EXTENSION, renderCardSvg } from "@ledring/cards";

const dir = fileURLToPath(new URL("../../../fixtures/cards/", import.meta.url));
const read = (p: string) => readFileSync(dir + p, "utf8");
const sources = { agent: read(".claude/agents/release-reviewer.md"), settings: read(".claude/settings.json"), mcp: read(".mcp.json") };

describe("cardFromConfig", () => {
  const card = cardFromConfig({ ...sources, url: "https://agents.example.com/a2a", version: "1.2.0" });
  const ext = card.capabilities.extensions.find((e) => e.uri === PERMISSIONS_EXTENSION)!.params;

  it("fills the A2A Agent Card fields", () => {
    expect(card.name).toBe("release-reviewer");
    expect(card.description).toMatch(/^Reviews release pull requests/);
    expect(card.version).toBe("1.2.0");
    expect(card.supportedInterfaces).toEqual([{ url: "https://agents.example.com/a2a", protocolBinding: "JSONRPC", protocolVersion: "1.0" }]);
    expect(card.defaultInputModes).toEqual(["text/plain"]);
  });

  it("derives one skill per ## section of the prompt", () => {
    expect(card.skills.map((s) => s.id)).toEqual(["check-the-changelog", "check-version-bumps", "check-migration-notes"]);
    expect(card.skills[0]!.description).toMatch(/CHANGELOG entry/);
  });

  it("records tools, model, permissions and MCP servers in an extension", () => {
    expect(ext.tools).toEqual(["Read", "Grep", "Glob", "Bash"]);
    expect(ext.model).toBe("sonnet");
    expect(ext.permissions.deny).toContain("Bash(git push --force:*)");
    expect(ext.mcpServers).toEqual([{ name: "docs", transport: "http" }, { name: "issues", transport: "stdio" }]);
  });

  it("never copies MCP env, args, headers or URLs into the card", () => {
    const json = JSON.stringify(card);
    for (const s of ["ISSUES_TOKEN", "DOCS_TOKEN", "Bearer", "example-issues-mcp", "docs.example.com"]) expect(json).not.toContain(s);
  });

  it("falls back to one skill and the first paragraph without frontmatter description or sections", () => {
    const c = cardFromConfig({ agent: "---\nname: tiny\ntools:\n  - Read\n---\nAnswers questions about the repo.\n" });
    expect(c.description).toBe("Answers questions about the repo.");
    expect(c.skills).toEqual([{ id: "tiny", name: "tiny", description: "Answers questions about the repo.", tags: ["read"] }]);
    expect(c.supportedInterfaces).toEqual([]);
  });

  it("rejects an agent file without a name", () => {
    expect(() => cardFromConfig({ agent: "no frontmatter" })).toThrow(/name/);
  });
});

describe("renderCardSvg", () => {
  const svg = renderCardSvg(cardFromConfig(sources));
  it("is a self-contained SVG with the spec on it", () => {
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).not.toMatch(/<image|href=|@import|url\(/);
    for (const s of ["release-reviewer", "Check the changelog", "git push --force", "issues · stdio", "MODEL SONNET"]) expect(svg).toContain(s);
  });
  it("escapes markup from the config", () => {
    const s = renderCardSvg(cardFromConfig({ agent: "---\nname: <x>\ndescription: a & b\n---\n" }));
    expect(s).toContain("&#60;x&#62;");
    expect(s).not.toContain("<x>");
  });
});
