import * as acorn from "acorn";
import { parse as parseLoose } from "acorn-loose";
import { finding, isRemoteUrl, lineSnippet, type RiskFinding } from "./findings.js";

interface Ast {
  type: string;
  start: number;
  end: number;
  loc?: { start: { line: number; column: number } };
  [key: string]: unknown;
}

type Binding = { kind: "local" } | { kind: "sink"; name: string } | { kind: "atob" };
type Scope = Map<string, Binding>;

const CALL_SINKS: Record<string, { category: RiskFinding["category"]; ruleId: string; severity: RiskFinding["severity"] }> = {
  fetch: { category: "network", ruleId: "network.fetch", severity: "high" },
  eval: { category: "eval", ruleId: "eval.call", severity: "high" },
  Function: { category: "eval", ruleId: "eval.function", severity: "high" },
};

const CTOR_SINKS: Record<string, { category: RiskFinding["category"]; ruleId: string; severity: RiskFinding["severity"] }> = {
  Function: { category: "eval", ruleId: "eval.function", severity: "high" },
  XMLHttpRequest: { category: "network", ruleId: "network.xhr", severity: "high" },
  WebSocket: { category: "network", ruleId: "network.websocket", severity: "high" },
  EventSource: { category: "network", ruleId: "network.eventsource", severity: "high" },
};

function parseJs(code: string): Ast | undefined {
  const options: acorn.Options = {
    ecmaVersion: "latest",
    locations: true,
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
    allowImportExportEverywhere: true,
    sourceType: "module",
  };
  try {
    return acorn.parse(code, options) as unknown as Ast;
  } catch {
    try {
      return parseLoose(code, options) as unknown as Ast;
    } catch {
      return undefined;
    }
  }
}

function lookup(scopes: Scope[], name: string): Binding | undefined {
  for (let i = scopes.length - 1; i >= 0; i -= 1) {
    const found = scopes[i]?.get(name);
    if (found) return found;
  }
  return undefined;
}

function locOf(node: Ast, lineOffset: number): { line: number; col: number } {
  const line = node.loc?.start.line ?? 1;
  const col = node.loc?.start.column ?? 0;
  return { line: line + lineOffset - 1, col };
}

function staticString(node: Ast | undefined): string | undefined {
  if (!node) return undefined;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral" && Array.isArray(node.expressions) && node.expressions.length === 0) {
    const quasis = node.quasis as { value?: { cooked?: string | null } }[] | undefined;
    return quasis?.map((quasi) => quasi.value?.cooked ?? "").join("");
  }
  return undefined;
}

function isIdent(node: Ast | undefined, name: string): boolean {
  return !!node && node.type === "Identifier" && node.name === name;
}

function unbound(scopes: Scope[], node: Ast | undefined, names: readonly string[]): boolean {
  if (!node || node.type !== "Identifier" || typeof node.name !== "string") return false;
  if (!names.includes(node.name)) return false;
  return !lookup(scopes, node.name);
}

function children(node: Ast): Ast[] {
  const out: Ast[] = [];
  for (const value of Object.values(node)) {
    if (!value || typeof value !== "object") continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object" && typeof (item as Ast).type === "string") out.push(item as Ast);
      }
    } else if (typeof (value as Ast).type === "string") out.push(value as Ast);
  }
  return out;
}

function bindName(scope: Scope, name: string, binding: Binding): void {
  scope.set(name, binding);
}

function patternNames(node: Ast | undefined, out: string[] = []): string[] {
  if (!node) return out;
  if (node.type === "Identifier" && typeof node.name === "string") out.push(node.name);
  if (node.type === "AssignmentPattern") patternNames(node.left as Ast, out);
  if (node.type === "RestElement") patternNames(node.argument as Ast, out);
  if (node.type === "ArrayPattern" && Array.isArray(node.elements)) {
    for (const element of node.elements as (Ast | null)[]) patternNames(element ?? undefined, out);
  }
  if (node.type === "ObjectPattern" && Array.isArray(node.properties)) {
    for (const prop of node.properties as Ast[]) {
      if (prop.type === "Property") patternNames(prop.value as Ast, out);
      if (prop.type === "RestElement") patternNames(prop.argument as Ast, out);
    }
  }
  return out;
}

interface Resolved {
  kind: "sink" | "atob" | "suspicious" | "none";
  name?: string;
}

function resolveExpr(node: Ast | undefined, scopes: Scope[]): Resolved {
  if (!node) return { kind: "none" };
  if (node.type === "Identifier" && typeof node.name === "string") {
    const binding = lookup(scopes, node.name);
    if (binding?.kind === "local") return { kind: "none" };
    if (binding?.kind === "sink") return { kind: "sink", name: binding.name };
    if (binding?.kind === "atob") return { kind: "atob" };
    if (node.name === "atob") return { kind: "atob" };
    if (CALL_SINKS[node.name] || CTOR_SINKS[node.name]) return { kind: "sink", name: node.name };
    return { kind: "none" };
  }
  if (node.type === "MemberExpression") {
    const property = node.property as Ast;
    if (node.computed && unbound(scopes, node.object as Ast, ["window", "globalThis", "self"])) {
      if (property.type === "BinaryExpression") return { kind: "suspicious" };
      const folded = staticString(property);
      if (folded && (CALL_SINKS[folded] || CTOR_SINKS[folded] || folded === "setTimeout" || folded === "setInterval")) {
        return { kind: "sink", name: folded };
      }
      if (folded === "atob") return { kind: "atob" };
      if (folded === undefined) return { kind: "suspicious" };
      return { kind: "none" };
    }
    if (!node.computed && isIdent(property, "fetch") && unbound(scopes, node.object as Ast, ["window", "globalThis", "self"])) {
      return { kind: "sink", name: "fetch" };
    }
  }
  return { kind: "none" };
}

/** Scan one JavaScript program. `lineOffset` is the 1-based line where this program starts in the HTML file. */
export function scanScript(code: string, lineOffset = 1): RiskFinding[] {
  const program = parseJs(code);
  if (!program) return [];
  const found: RiskFinding[] = [];
  const scopes: Scope[] = [new Map()];

  const add = (node: Ast, category: RiskFinding["category"], ruleId: string, severity: RiskFinding["severity"]) => {
    const loc = locOf(node, lineOffset);
    found.push(finding(category, ruleId, severity, loc.line, loc.col, lineSnippet(code, node.loc?.start.line ?? 1)));
  };

  const sinkOf = (name: string | undefined) => (name ? CALL_SINKS[name] ?? CTOR_SINKS[name] : undefined);

  const flagResolved = (node: Ast, resolved: Resolved, args: Ast[]) => {
    if (resolved.kind === "suspicious") {
      add(node, "suspicious", "suspicious.window-computed", "high");
      return;
    }
    const atobArg = args.some((arg) => resolveExpr(arg, scopes).kind === "atob" || (arg.type === "CallExpression" && resolveExpr(arg.callee as Ast, scopes).kind === "atob"));
    if (atobArg && (resolved.kind === "sink" || resolved.kind === "atob")) {
      add(node, "suspicious", "suspicious.atob-sink", "high");
    }
    if (resolved.kind === "sink") {
      const sink = sinkOf(resolved.name);
      if (sink) add(node, sink.category, sink.ruleId, sink.severity);
    }
  };

  const visit = (node: Ast | undefined): void => {
    if (!node || typeof node.type !== "string") return;
    if (node.type === "FunctionDeclaration" || node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression") {
      if (node.type === "FunctionDeclaration" && node.id && typeof (node.id as Ast).name === "string") {
        bindName(scopes[scopes.length - 1] ?? new Map(), (node.id as Ast).name as string, { kind: "local" });
      }
      const inner: Scope = new Map();
      if (node.id && typeof (node.id as Ast).name === "string") bindName(inner, (node.id as Ast).name as string, { kind: "local" });
      for (const param of (node.params as Ast[] | undefined) ?? []) {
        for (const name of patternNames(param)) bindName(inner, name, { kind: "local" });
      }
      scopes.push(inner);
      visit(node.body as Ast);
      scopes.pop();
      return;
    }
    if (node.type === "BlockStatement") {
      scopes.push(new Map());
      for (const stmt of (node.body as Ast[] | undefined) ?? []) visit(stmt);
      scopes.pop();
      return;
    }
    if (node.type === "VariableDeclaration") {
      const scope = scopes[scopes.length - 1] ?? new Map();
      for (const declarator of (node.declarations as Ast[] | undefined) ?? []) {
        visit(declarator.init as Ast | undefined);
        const init = declarator.init as Ast | undefined;
        const resolved = resolveExpr(init, scopes);
        const binding: Binding =
          resolved.kind === "atob" || (init?.type === "CallExpression" && resolveExpr(init.callee as Ast, scopes).kind === "atob")
            ? { kind: "atob" }
            : resolved.kind === "sink" && resolved.name
              ? { kind: "sink", name: resolved.name }
              : { kind: "local" };
        for (const name of patternNames(declarator.id as Ast)) bindName(scope, name, binding);
      }
      return;
    }
    if (node.type === "ClassDeclaration" && node.id && typeof (node.id as Ast).name === "string") {
      bindName(scopes[scopes.length - 1] ?? new Map(), (node.id as Ast).name as string, { kind: "local" });
    }
    if (node.type === "CallExpression" || node.type === "NewExpression") {
      const args = (node.arguments as Ast[] | undefined) ?? [];
      for (const arg of args) visit(arg);
      visit(node.callee as Ast);
      const resolved = resolveExpr(node.callee as Ast, scopes);
      if ((resolved.name === "setTimeout" || resolved.name === "setInterval" || (node.callee as Ast)?.type === "Identifier" && ((node.callee as Ast).name === "setTimeout" || (node.callee as Ast).name === "setInterval") && !lookup(scopes, (node.callee as Ast).name as string))) {
        const first = args[0];
        if (first && staticString(first) !== undefined) add(node, "eval", "eval.timer-string", "high");
        if (first && (resolveExpr(first, scopes).kind === "atob" || (first.type === "CallExpression" && resolveExpr(first.callee as Ast, scopes).kind === "atob"))) {
          add(node, "suspicious", "suspicious.atob-sink", "high");
        }
      }
      if (node.type === "NewExpression") {
        const ctor = sinkOf(resolved.kind === "sink" ? resolved.name : undefined);
        if (ctor) add(node, ctor.category, ctor.ruleId, ctor.severity);
        if (args.some((arg) => resolveExpr(arg, scopes).kind === "atob" || (arg.type === "CallExpression" && resolveExpr(arg.callee as Ast, scopes).kind === "atob"))) {
          add(node, "suspicious", "suspicious.atob-sink", "high");
        }
      } else {
        flagResolved(node, resolved, args);
        const callee = node.callee as Ast;
        if (callee?.type === "MemberExpression" && !callee.computed) {
          const object = callee.object as Ast;
          const property = callee.property as Ast;
          if (isIdent(property, "sendBeacon") && (unbound(scopes, object, ["navigator"]) || (object.type === "MemberExpression" && isIdent(object.property as Ast, "navigator")))) {
            add(node, "network", "network.beacon", "high");
          }
          if (isIdent(property, "write") && unbound(scopes, object, ["document"])) {
            const arg = args[0];
            const text = arg ? staticString(arg) : undefined;
            if (text && /<script/i.test(text)) add(node, "eval", "eval.document-write", "high");
          }
          if (isIdent(property, "open") && unbound(scopes, object, ["window", "globalThis", "self"])) {
            add(node, "popup", "popup.window-open", "high");
          }
          if ((isIdent(property, "assign") || isIdent(property, "replace")) && unbound(scopes, object, ["location"]) && args[0] && isRemoteUrl(staticString(args[0]) ?? "")) {
            add(node, "popup", "popup.location", "high");
          }
          if (isIdent(property, "postMessage")) {
            const target = args[1] ? staticString(args[1]) : undefined;
            const obj = object.type === "MemberExpression" ? (object.object as Ast) : object;
            const mid = object.type === "MemberExpression" ? (object.property as Ast) : undefined;
            const parentish = unbound(scopes, object, ["parent", "top"]) || (mid && (isIdent(mid, "parent") || isIdent(mid, "top")) && unbound(scopes, obj, ["window", "globalThis", "self"]));
            if (parentish && target === "*") add(node, "popup", "popup.postmessage-star", "high");
          }
          if (isIdent(property, "open") && unbound(scopes, object, ["indexedDB"])) add(node, "storage", "storage.indexeddb", "medium");
          if (isIdent(property, "open") && unbound(scopes, object, ["caches"])) add(node, "storage", "storage.cache", "medium");
        }
      }
      return;
    }
    if (node.type === "ImportExpression") {
      const source = staticString(node.source as Ast);
      if (source && isRemoteUrl(source)) add(node, "network", "network.import", "high");
      visit(node.source as Ast);
      return;
    }
    if (node.type === "ImportDeclaration") {
      const source = staticString(node.source as Ast);
      if (source && isRemoteUrl(source)) add(node, "external", "external.import", "high");
      return;
    }
    if (node.type === "AssignmentExpression") {
      visit(node.right as Ast);
      visit(node.left as Ast);
      const left = node.left as Ast;
      const right = node.right as Ast;
      if (left?.type === "MemberExpression" && !left.computed && isIdent(left.property as Ast, "href") && unbound(scopes, left.object as Ast, ["location"]) && isRemoteUrl(staticString(right) ?? "")) {
        add(node, "popup", "popup.location-href", "high");
      }
      if (left?.type === "MemberExpression" && isIdent(left.property as Ast, "location") && unbound(scopes, left.object as Ast, ["top", "parent"])) {
        add(node, "popup", "popup.frame-location", "high");
      }
      if (left?.type === "MemberExpression" && !left.computed && isIdent(left.property as Ast, "src") && isRemoteUrl(staticString(right) ?? "")) {
        add(node, "network", "network.image-src", "high");
      }
      if (left?.type === "MemberExpression" && !left.computed && isIdent(left.property as Ast, "cookie") && unbound(scopes, left.object as Ast, ["document"])) {
        add(node, "storage", "storage.cookie", "medium");
      }
      return;
    }
    if (node.type === "Identifier") {
      if (typeof node.name === "string" && !lookup(scopes, node.name) && ["localStorage", "sessionStorage", "indexedDB"].includes(node.name)) {
        add(node, "storage", "storage.webstorage", "medium");
      }
      return;
    }
    if (node.type === "MemberExpression") {
      if (!node.computed && unbound(scopes, node.object as Ast, ["localStorage", "sessionStorage", "indexedDB"])) {
        add(node, "storage", "storage.webstorage", "medium");
      }
      if (!node.computed && isIdent(node.property as Ast, "cookie") && unbound(scopes, node.object as Ast, ["document"])) {
        add(node, "storage", "storage.cookie", "medium");
      }
      if (!node.computed && unbound(scopes, node.object as Ast, ["window", "globalThis", "self"]) && ["localStorage", "sessionStorage", "indexedDB"].includes(String((node.property as Ast).name ?? ""))) {
        add(node, "storage", "storage.webstorage", "medium");
      }
      if (node.computed && unbound(scopes, node.object as Ast, ["window", "globalThis", "self"])) {
        const property = node.property as Ast;
        if (property.type === "BinaryExpression") add(node, "suspicious", "suspicious.window-concat", "high");
        else if (staticString(property) === undefined) add(node, "suspicious", "suspicious.window-computed", "high");
      }
      visit(node.object as Ast);
      if (node.computed) visit(node.property as Ast);
      return;
    }
    for (const child of children(node)) visit(child);
  };

  visit(program);
  return found;
}
