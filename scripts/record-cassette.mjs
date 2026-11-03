// Writes a cassette only from a real provider response. Does not call a model and does not invent HTML.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

export function cassetteFromResponse(response) {
  if (!response || typeof response !== "object") return { error: "record-cassette refused: a real provider response is required" };
  const provider = response.provider;
  const model = response.model;
  const recordedAt = response.recordedAt;
  const html = response.html;
  const idea = response.idea;
  if (typeof provider !== "string" || provider === "" || provider === "demo") {
    return { error: "record-cassette refused: a real provider response is required" };
  }
  if (typeof model !== "string" || model === "" || typeof recordedAt !== "string" || recordedAt === "") {
    return { error: "record-cassette refused: a real provider response is required" };
  }
  if (typeof html !== "string" || html.trim().length < 20 || typeof idea !== "string" || idea.trim() === "") {
    return { error: "record-cassette refused: a real provider response is required" };
  }
  return {
    cassette: {
      id: response.id || `recorded-${recordedAt.replace(/[^0-9A-Za-z]+/g, "-")}`,
      idea: idea.trim(),
      lang: response.lang === "zh" ? "zh" : "en",
      provenance: {
        kind: "recorded",
        note: `recorded from ${model} on ${recordedAt}`,
        model,
        recordedAt,
      },
      plan: typeof response.plan === "string" ? response.plan : idea.trim(),
      choices: [],
      artifacts: [{ html }],
    },
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const responsePath = arg("--response");
  const out = arg("--out");
  if (!responsePath || !out) {
    console.error("usage: node scripts/record-cassette.mjs --response <response.json> --out <cassette.json>");
    process.exit(2);
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(responsePath, "utf8"));
  } catch {
    console.error("record-cassette refused: a real provider response is required");
    process.exit(1);
  }
  const result = cassetteFromResponse(parsed);
  if (result.error || !result.cassette) {
    console.error(result.error ?? "record-cassette refused: a real provider response is required");
    process.exit(1);
  }
  writeFileSync(resolve(out), `${JSON.stringify(result.cassette, null, 2)}\n`);
  console.log(result.cassette.provenance.note);
}
