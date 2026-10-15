// Fails when a transition or keyframe animates a layout property.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

const LAYOUT = new Set([
  "width",
  "height",
  "top",
  "left",
  "right",
  "bottom",
  "inset",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "border-width",
  "min-width",
  "max-width",
  "min-height",
  "max-height",
  "gap",
  "font-size",
  "line-height",
  "flex-basis",
]);

const FILES = ["packages/play-web/index.html", "docs/play/index.html"];

/** @param {string} css @param {string} file */
export function motionViolations(css, file) {
  const errors = [];
  const transition = /transition\s*:\s*([^;}{]+)/gi;
  let match;
  while ((match = transition.exec(css))) {
    for (const item of match[1].split(",")) {
      const prop = item.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
      if (prop === "all" || LAYOUT.has(prop)) errors.push(`motion lint failed: layout transition ${prop} in ${file}`);
    }
  }
  const frames = /@keyframes\s+[\w-]+\s*\{/g;
  while ((match = frames.exec(css))) {
    let depth = 1;
    let index = match.index + match[0].length;
    for (; index < css.length && depth > 0; index += 1) {
      if (css[index] === "{") depth += 1;
      else if (css[index] === "}") depth -= 1;
    }
    const body = css.slice(match.index + match[0].length, index - 1);
    const decl = /(?:^|[{;])\s*([a-z-]+)\s*:/gi;
    let prop;
    while ((prop = decl.exec(body))) {
      const name = prop[1]?.toLowerCase() ?? "";
      if (LAYOUT.has(name)) errors.push(`motion lint failed: layout keyframe ${name} in ${file}`);
    }
  }
  return errors;
}

/** @param {string} repo */
export function lintMotion(repo) {
  const errors = [];
  for (const file of FILES) {
    errors.push(...motionViolations(readFileSync(join(repo, file), "utf8"), file));
  }
  return errors;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const errors = lintMotion(root);
  if (errors.length) {
    for (const error of errors) console.error(error);
    process.exit(1);
  }
  console.log("motion lint ok");
}
