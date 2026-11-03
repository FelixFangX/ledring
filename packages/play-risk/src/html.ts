import { parse, type DefaultTreeAdapterMap } from "parse5";
import { dedupe, finding, isRemoteUrl, lineSnippet, type RiskFinding } from "./findings.js";
import { scanScript } from "./js.js";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];
type TextNode = DefaultTreeAdapterMap["textNode"];

function isElement(node: Node): node is Element {
  return node.nodeName !== "#text" && node.nodeName !== "#comment" && node.nodeName !== "#documentType" && "tagName" in node;
}

function isText(node: Node): node is TextNode {
  return node.nodeName === "#text";
}

function attr(element: Element, name: string): string | undefined {
  return element.attrs.find((item) => item.name.toLowerCase() === name)?.value;
}

function textOf(element: Element): { text: string; line: number } {
  const chunks: string[] = [];
  let line = element.sourceCodeLocation?.startLine ?? 1;
  for (const child of element.childNodes) {
    if (isText(child)) {
      chunks.push(child.value);
      if (child.sourceCodeLocation?.startLine) line = child.sourceCodeLocation.startLine;
    }
  }
  return { text: chunks.join(""), line };
}

function remoteAttr(element: Element, html: string, name: string, category: RiskFinding["category"], ruleId: string, out: RiskFinding[]): void {
  const value = attr(element, name);
  if (!value || !isRemoteUrl(value)) return;
  const loc = element.sourceCodeLocation?.attrs?.[name] ?? element.sourceCodeLocation;
  const line = loc?.startLine ?? 1;
  out.push(finding(category, ruleId, "high", line, (loc?.startCol ?? 1) - 1, lineSnippet(html, line)));
}

function scanCss(css: string, lineOffset: number, html: string, out: RiskFinding[]): void {
  let i = 0;
  while (i < css.length) {
    if (css.startsWith("@import", i) && (i === 0 || /[\s;{}]/.test(css[i - 1] ?? ""))) {
      const end = css.indexOf(";", i);
      const rule = css.slice(i, end === -1 ? css.length : end);
      if (/(?:https?:)?\/\//i.test(rule)) {
        const line = lineOffset + css.slice(0, i).split("\n").length - 1;
        out.push(finding("external", "external.css-import", "high", line, 0, lineSnippet(html, line) || rule));
      }
      i = end === -1 ? css.length : end + 1;
    } else i += 1;
  }
}

function walk(node: Node, html: string, out: RiskFinding[]): void {
  if (!("childNodes" in node)) return;
  for (const child of node.childNodes) {
    if (!isElement(child)) continue;
    const tag = child.tagName.toLowerCase();
    if (tag === "script") {
      remoteAttr(child, html, "src", "external", "external.script-src", out);
      const type = attr(child, "type");
      const runnable = !type || /javascript|ecmascript|module/i.test(type);
      if (runnable && !attr(child, "src")) {
        const { text, line } = textOf(child);
        if (text.trim()) out.push(...scanScript(text, line));
      }
    } else if (tag === "link") {
      remoteAttr(child, html, "href", "external", "external.link-href", out);
    } else if (tag === "iframe" || tag === "frame") {
      remoteAttr(child, html, "src", "external", "external.frame-src", out);
    } else if (tag === "img") {
      remoteAttr(child, html, "src", "network", "network.img-src", out);
    } else if (tag === "form") {
      remoteAttr(child, html, "action", "popup", "popup.form-action", out);
    } else if (tag === "meta" && attr(child, "http-equiv")?.toLowerCase() === "refresh") {
      const line = child.sourceCodeLocation?.startLine ?? 1;
      out.push(finding("popup", "popup.meta-refresh", "high", line, 0, lineSnippet(html, line)));
    } else if (tag === "style") {
      const { text, line } = textOf(child);
      scanCss(text, line, html, out);
    }
    for (const attribute of child.attrs) {
      if (!attribute.name.toLowerCase().startsWith("on") || !attribute.value.trim()) continue;
      const line = child.sourceCodeLocation?.attrs?.[attribute.name]?.startLine ?? child.sourceCodeLocation?.startLine ?? 1;
      out.push(...scanScript(attribute.value, line));
    }
    walk(child, html, out);
  }
}

/** Scan an HTML artifact, including a partial stream. Never throws. */
export function scanHtml(html: string): RiskFinding[] {
  try {
    const document = parse(html, { sourceCodeLocationInfo: true });
    const found: RiskFinding[] = [];
    walk(document, html, found);
    return dedupe(found);
  } catch {
    return [];
  }
}
