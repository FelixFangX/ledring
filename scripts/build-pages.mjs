// Regenerates docs/examples/*.html from the synthetic fixtures. Run after `pnpm build`.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const cli = "packages/cli/dist/bin.js";
mkdirSync("docs/examples", { recursive: true });
const run = (...args) => execFileSync(process.execPath, [cli, ...args], { encoding: "utf8" });
run("flowchart", "fixtures/claude-code", "--title", "Claude Code · fix login bug", "--out", "docs/examples/claude-code.html");
run("flowchart", "fixtures/otel/weather-agent.otlp.json", "--title", "OTel GenAI · weather agent", "--out", "docs/examples/otel-genai.html");
writeFileSync("docs/examples/instability.txt", run("instability", "fixtures/claude-code"));
console.log("docs/examples regenerated");
