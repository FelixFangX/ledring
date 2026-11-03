import * as acorn from "acorn";
import { looksFake } from "@ledring/play-core";
import { parse, type DefaultTreeAdapterMap } from "parse5";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];
type TextNode = DefaultTreeAdapterMap["textNode"];

interface Ast {
  type: string;
  [key: string]: unknown;
}

function isElement(node: Node): node is Element {
  return node.nodeName !== "#text" && node.nodeName !== "#comment" && node.nodeName !== "#documentType" && "tagName" in node;
}

function isText(node: Node): node is TextNode {
  return node.nodeName === "#text";
}

function isAst(value: unknown): value is Ast {
  return Boolean(value) && typeof value === "object" && typeof (value as Ast).type === "string";
}

function attr(element: Element, name: string): string | undefined {
  return element.attrs.find((item) => item.name.toLowerCase() === name)?.value;
}

function inlineScripts(html: string): string[] {
  const out: string[] = [];
  const walk = (node: Node): void => {
    if (!("childNodes" in node)) return;
    for (const child of node.childNodes) {
      if (!isElement(child)) continue;
      if (child.tagName.toLowerCase() === "script") {
        const type = attr(child, "type");
        const runnable = !type || /javascript|ecmascript|module/i.test(type);
        if (runnable && !attr(child, "src")) {
          const text = child.childNodes.filter(isText).map((item) => item.value).join("");
          if (text.trim()) out.push(text);
        }
      }
      walk(child);
    }
  };
  try {
    walk(parse(html));
  } catch {
    return [];
  }
  return out;
}

function parseJs(code: string): Ast | undefined {
  const options: acorn.Options = {
    ecmaVersion: "latest",
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
    allowImportExportEverywhere: true,
  };
  try {
    return acorn.parse(code, { ...options, sourceType: "script" }) as unknown as Ast;
  } catch {
    try {
      return acorn.parse(code, { ...options, sourceType: "module" }) as unknown as Ast;
    } catch {
      return undefined;
    }
  }
}

function walk(node: Ast, visit: (node: Ast, parent: Ast | undefined) => void, parent?: Ast): void {
  visit(node, parent);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) if (isAst(item)) walk(item, visit, node);
    } else if (isAst(value)) walk(value, visit, node);
  }
}

function identName(node: unknown): string | undefined {
  if (!isAst(node) || node.type !== "Identifier" || typeof node.name !== "string") return undefined;
  return node.name;
}

function definedFunctions(ast: Ast): Set<string> {
  const names = new Set<string>();
  walk(ast, (node, parent) => {
    if (node.type === "FunctionDeclaration") {
      const name = identName(node.id);
      if (name) names.add(name);
    }
    if (node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression") {
      const own = identName(node.id);
      if (own) names.add(own);
      if (parent?.type === "VariableDeclarator") {
        const id = identName(parent.id);
        if (id) names.add(id);
      }
      if (parent?.type === "AssignmentExpression" && parent.right === node) {
        const id = identName(parent.left);
        if (id) names.add(id);
      }
    }
    if (node.type === "MethodDefinition" || (node.type === "Property" && node.method === true)) {
      if (node.computed !== true) {
        const key = identName(node.key);
        if (key) names.add(key);
      }
    }
  });
  return names;
}

function isTestsRef(node: unknown): boolean {
  if (!isAst(node)) return false;
  if (node.type === "Identifier" && node.name === "__ledringTests") return true;
  if (node.type === "MemberExpression" && node.computed !== true) {
    const objectName = identName(node.object);
    const propertyName = identName(node.property);
    return (objectName === "window" || objectName === "globalThis" || objectName === "self") && propertyName === "__ledringTests";
  }
  return false;
}

function testArrays(ast: Ast): Ast[] {
  const aliases = new Map<string, Ast>();
  walk(ast, (node) => {
    if (node.type === "VariableDeclarator" && isAst(node.init) && node.init.type === "ArrayExpression") {
      const id = identName(node.id);
      if (id) aliases.set(id, node.init);
    }
    if (node.type === "AssignmentExpression" && isAst(node.right) && node.right.type === "ArrayExpression" && node.left) {
      const id = identName(node.left);
      if (id) aliases.set(id, node.right);
    }
  });
  const found: Ast[] = [];
  const take = (value: unknown) => {
    if (!isAst(value)) return;
    if (value.type === "ArrayExpression") found.push(value);
    else if (value.type === "Identifier" && typeof value.name === "string") {
      const alias = aliases.get(value.name);
      if (alias) found.push(alias);
    }
  };
  walk(ast, (node) => {
    if (node.type === "VariableDeclarator" && isTestsRef(node.id)) take(node.init);
    if (node.type === "AssignmentExpression" && isTestsRef(node.left)) take(node.right);
  });
  return found;
}

function passExpressions(array: Ast): Ast[] {
  const out: Ast[] = [];
  const elements = Array.isArray(array.elements) ? array.elements : [];
  for (const element of elements) {
    if (!isAst(element) || element.type !== "ObjectExpression" || !Array.isArray(element.properties)) continue;
    for (const prop of element.properties) {
      if (!isAst(prop) || !isAst(prop.value)) continue;
      const key = prop.key;
      const name = identName(key) ?? (isAst(key) && key.type === "Literal" && typeof key.value === "string" ? key.value : undefined);
      if (name === "pass") out.push(prop.value);
    }
  }
  return out;
}

function isLiteralPass(node: Ast): boolean {
  if (node.type === "Literal" && typeof node.value === "boolean") return true;
  if (node.type === "UnaryExpression" && node.operator === "!" && isAst(node.argument) && node.argument.type === "Literal") {
    return node.argument.value === 0 || node.argument.value === 1;
  }
  return false;
}

function callsDefined(node: Ast, defined: Set<string>): boolean {
  let hit = false;
  walk(node, (current) => {
    if (current.type !== "CallExpression" || !isAst(current.callee)) return;
    const name = identName(current.callee);
    if (name && defined.has(name)) hit = true;
    if (current.callee.type === "MemberExpression" && current.callee.computed !== true) {
      const propertyName = identName(current.callee.property);
      if (propertyName && defined.has(propertyName)) hit = true;
    }
  });
  return hit;
}

/**
 * True when `__ledringTests` reports a `pass` that is a boolean literal
 * or that never calls a function defined in the artifact.
 * Missing tests are not fake. A script that will not parse falls back to {@link looksFake}.
 */
export function detectFakeTests(html: string): boolean {
  if (!html.includes("__ledringTests")) return false;
  const asts = inlineScripts(html).flatMap((source) => {
    const ast = parseJs(source);
    return ast ? [ast] : [];
  });
  if (asts.length === 0) return looksFake(html);
  const defined = new Set<string>();
  for (const ast of asts) for (const name of definedFunctions(ast)) defined.add(name);
  const passes = asts.flatMap((ast) => testArrays(ast).flatMap((array) => passExpressions(array)));
  if (passes.length === 0) return looksFake(html);
  return passes.some((pass) => isLiteralPass(pass) || !callsDefined(pass, defined));
}
