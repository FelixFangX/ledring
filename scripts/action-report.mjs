// Used by action.yml: runs the built CLI and writes a GitHub job summary.
// Inputs arrive as environment variables so nothing is interpolated into a shell.
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const env = process.env;
const out = env.OUT_DIR ?? "ledring-report";
mkdirSync(out, { recursive: true });
const traces = (env.INPUT_TRACES ?? "").split(/\s+/).filter(Boolean);
if (!traces.length) throw new Error("input `traces` is empty");

const cli = (args) => {
  const r = spawnSync(process.execPath, [env.LEDRING_BIN, ...args], { encoding: "utf8" });
  if (r.status !== 0 && r.status !== 3) throw new Error(`ledring ${args[0]} failed (${r.status}): ${r.stderr}`);
  return r;
};

cli(["flowchart", ...traces, "--out", join(out, "report.html"), "--title", env.INPUT_TITLE || "LEDRING report"]);

const inst = ["instability", ...traces, ...(env.INPUT_INSTRUCTION ? ["--instruction", env.INPUT_INSTRUCTION] : [])];
const instText = cli(inst).stdout;
const instJson = JSON.parse(cli([...inst, "--json"]).stdout);

const wall = ["redwall", ...traces, ...(env.INPUT_SCENARIOS ? ["--scenarios", env.INPUT_SCENARIOS] : [])];
const wallText = cli(wall).stdout;
const wallJson = JSON.parse(cli([...wall, "--json"]).stdout);

for (const [f, t] of [["instability.txt", instText], ["redwall.txt", wallText], ["redwall.json", JSON.stringify(wallJson, null, 2)]]) appendFileSync(join(out, f), t);

const reasons = [];
const above = env.INPUT_FAIL_ABOVE ? Number(env.INPUT_FAIL_ABOVE) : undefined;
const reports = Array.isArray(instJson) ? instJson : [instJson];
if (above !== undefined) {
  const hot = reports.filter((r) => r.score > above);
  if (hot.length) reasons.push(`${hot.length} run(s) scored instability above ${above}`);
}
const ORDER = ["asked", "stopped", "retried", "workaround"];
if (env.INPUT_FAIL_ON) {
  const min = ORDER.indexOf(env.INPUT_FAIL_ON);
  if (min < 0) throw new Error(`fail-on must be one of ${ORDER.join(", ")}`);
  const bad = wallJson.results.filter((r) => ORDER.indexOf(r.outcome) >= min);
  if (bad.length) reasons.push(`${bad.length} Red Wall result(s) at or beyond ${env.INPUT_FAIL_ON}`);
}

const md = (s) => String(s).replace(/[|<>]/g, (c) => `&#${c.charCodeAt(0)};`);
const short = (id) => md(String(id).split("#")[0]);
const lines = [
  `## ${md(env.INPUT_TITLE || "LEDRING report")}`,
  "",
  `${reports.length} run(s). Full branch-tree report: \`report.html\` in the **${md(env.ARTIFACT_NAME ?? "ledring-report")}** artifact.`,
  "",
  "### Instability",
  "| Run | Score | Level |",
  "|---|---:|---|",
  ...reports.map((r) => `| ${short(r.runId)} | ${r.score} | ${r.level} |`),
  "",
  "### Red Wall",
  "| Scenario | Hit | Outcomes |",
  "|---|---:|---|",
  ...wallJson.summary.map((s) => `| ${md(s.scenario)} | ${s.hit} | ${ORDER.filter((o) => s.counts[o]).map((o) => `${s.counts[o]} ${o}`).join(", ") || "–"} |`),
  "",
  reasons.length ? `**Gate tripped:** ${md(reasons.join("; "))}` : "No gates tripped.",
  "",
];
const summary = lines.join("\n");
appendFileSync(join(out, "summary.md"), summary);
if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, summary);
if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `dir=${out}\nfailed=${reasons.length > 0}\nreason=${reasons.join("; ").replace(/\n/g, " ")}\n`);
process.stdout.write(summary + "\n" + readFileSync(join(out, "redwall.txt"), "utf8"));
