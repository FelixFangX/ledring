import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseTrace, TRACE_SCHEMA, type Run } from "@ledring/trace";
import { buildBranchTree, fromDesignTokens, renderHtml, type BranchNode } from "@ledring/flowchart";

const dir = new URL("../../../fixtures/claude-code/", import.meta.url);
const runs = readdirSync(dir).sort().flatMap((f) => parseTrace(readFileSync(new URL(f, dir), "utf8"), { filename: f }));
const child = (n: BranchNode, sig: string) => n.children.find((c) => c.signature === sig)!;
const mk = (id: string, sigs: string[], isError = false): Run => ({ schema: TRACE_SCHEMA, id, source: "test", steps: sigs.map((s, i) => ({ id: `${id}-${i}`, kind: "tool", name: s, signature: s, isError: isError && i === sigs.length - 1 })) });

describe("buildBranchTree", () => {
  const tree = buildBranchTree(runs);

  it("merges runs that share a prefix into one path", () => {
    expect(tree.runCount).toBe(6);
    expect(tree.root.children).toHaveLength(1);
    expect(tree.root.children[0]!.signature).toBe("Read(login.ts)");
    expect(tree.root.children[0]!.share).toBe(1);
  });

  it("reports the divergence share of each branch at a fork", () => {
    const read = tree.root.children[0]!;
    expect(read.children.map((c) => [c.signature, c.count])).toEqual([["Edit(login.ts)", 4], ["Grep", 1], ["Edit(login.test.ts)", 1]]);
    expect(Math.round(child(read, "Edit(login.ts)").share * 100)).toBe(67);
    const sum = read.children.reduce((a, c) => a + c.share, 0);
    expect(sum).toBeCloseTo(1);
  });

  it("counts errored steps and where runs end", () => {
    const test = child(child(tree.root.children[0]!, "Edit(login.ts)"), "Bash(npm test)");
    expect(test.count).toBe(3);
    expect(test.errors).toBe(1);
    expect(test.ends).toBe(2);
  });

  it("records each run's path and the common instruction", () => {
    expect(tree.runs[0]!.path).toEqual(["0", "0.0", "0.0.0", "0.0.0.0"]);
    expect(tree.instruction).toMatch(/login bug/);
  });

  it("ignores llm steps by default, and can include them", () => {
    const r: Run = { ...mk("x", ["a"]), steps: [{ id: "1", kind: "llm", name: "m", signature: "llm(m)" }, { id: "2", kind: "tool", name: "a", signature: "a" }] };
    expect(buildBranchTree([r]).root.children[0]!.signature).toBe("a");
    expect(buildBranchTree([r], { kinds: ["llm", "tool"] }).root.children[0]!.signature).toBe("llm(m)");
  });

  it("rejects an empty run set", () => {
    expect(() => buildBranchTree([])).toThrow(/at least one run/);
  });
});

describe("renderHtml", () => {
  const tree = buildBranchTree(runs);
  const html = renderHtml(tree, { title: "fix-login" });

  it("is a self-contained document with no network references", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).not.toMatch(/(src|href)=["']?https?:/);
    expect(html).not.toMatch(/@import|url\(/);
  });

  it("shows divergence percentages and lights the highlighted run's path", () => {
    expect(html).toContain(">67%<");
    expect(html).toContain(">17%<");
    const lit = [...html.matchAll(/<g class="n taken[^"]*" data-id="([^"]+)"/g)].map((m) => m[1]);
    expect(lit).toEqual(expect.arrayContaining(tree.runs[0]!.path));
    expect(html).toMatch(/class="n locked[^"]*" data-id="0\.0\.1"/);
  });

  it("can highlight another run and rejects unknown ones", () => {
    const id = tree.runs[3]!.id;
    expect(renderHtml(tree, { highlightRunId: id })).toMatch(/class="n taken[^"]*" data-id="0\.0\.1"/);
    expect(() => renderHtml(tree, { highlightRunId: "nope" })).toThrow(/nope/);
  });

  it("escapes untrusted signatures", () => {
    const evil = renderHtml(buildBranchTree([mk("r", ["<script>alert(1)</script>"])]));
    expect(evil).not.toContain("<script>alert(1)");
    expect(evil).toContain("&lt;script&gt;");
  });

  it("is styled only through overridable tokens", () => {
    const themed = renderHtml(tree, { tokens: { accent: "#ff00aa" } });
    expect(themed).toContain("--lr-accent:#ff00aa");
    expect(themed).not.toMatch(/#1FB6D6[^;]*;}/i);
  });

  it("is paper-first, with an ink theme for dark schemes and a reduced-motion fallback", () => {
    expect(html).toMatch(/:root\{--lr-bg:#F3F2EE/);
    expect(html).toContain("prefers-color-scheme:dark");
    expect(html).toContain("prefers-reduced-motion:reduce");
  });

  it("reveals the taken path with animated edges and labels node kinds", () => {
    expect(html).toMatch(/class="e-lit on" data-to="0\.0"/);
    expect(html).toContain(">TOOL<");
    expect(html).toContain(">START<");
  });

  it("overrides the dark theme separately", () => {
    expect(renderHtml(tree, { darkTokens: { accent: "#abcdef" } })).toMatch(/prefers-color-scheme:dark\)\{:root\{[^}]*--lr-accent:#abcdef/);
  });

  it("uses system font fallbacks and no glow, blur or rounded plates", () => {
    expect(html).toMatch(/--lr-font-mono:[^;]*monospace/);
    expect(html).toMatch(/--lr-font-sans:[^;]*sans-serif/);
    expect(html).not.toMatch(/drop-shadow|backdrop-filter|blur\(|rx="/);
  });

  it("numbers each plate like a catalogue entry", () => {
    expect(html).toMatch(/<text class="no" x="5" y="11">01<\/text>/);
  });

  it("marks errored nodes", () => {
    const t = buildBranchTree([mk("a", ["x", "y"], true), mk("b", ["x", "z"])]);
    expect(renderHtml(t)).toMatch(/class="n (taken|locked) error" data-id="0\.0\.\d"/);
  });
});

describe("fromDesignTokens", () => {
  it("reads the v3 ink accent and display font", () => {
    expect(fromDesignTokens({ color: { accent: { ink: "#111" } }, font: { display: "Archivo, sans-serif" } })).toEqual({ accent: "#111", fontDisplay: "Archivo, sans-serif" });
  });

  it("maps a structured design-tokens file onto viewer tokens", () => {
    expect(fromDesignTokens({ color: { bg: { base: "#000" }, text: { "1": "#fff" }, ledring: { critical: "#f00" } }, radius: { md: "12px" }, motion: { "path-reveal": "linear" } }))
      .toEqual({ bg: "#000", text: "#fff", critical: "#f00", radiusMd: "12px", easeReveal: "linear" });
  });

  it("ignores unknown or malformed fields", () => {
    expect(fromDesignTokens({ color: { bg: 3 }, other: true })).toEqual({});
    expect(fromDesignTokens(null)).toEqual({});
  });
});

import { STRINGS } from "../src/i18n.js";
describe("viewer i18n", () => {
  it("has every key in both languages, none empty", () => {
    const en = Object.keys(STRINGS.en).sort();
    expect(Object.keys(STRINGS.zh).sort()).toEqual(en);
    for (const k of en) expect(STRINGS.zh[k as keyof typeof STRINGS.zh].length).toBeGreaterThan(0);
  });
  it("renders Chinese chrome with lang and CJK fallbacks on request", () => {
    const tree = buildBranchTree([{ id: "r1", steps: [] } as unknown as Run]);
    const zh = renderHtml(tree, { lang: "zh" });
    expect(zh).toContain('<html lang="zh-CN">');
    expect(zh).toContain("分支回放");
    expect(zh).toContain("PingFang SC");
    expect(renderHtml(tree)).toContain('<html lang="en">');
  });
});
