import traverse from "@babel/traverse";
import type { NodePath } from "@babel/traverse";
import type { File as BabelFile } from "@babel/types";
import type { ModelCall } from "../types.ts";
import { getStageName } from "../utils/ast.ts";

function isLLMDirectAccess(
  path: NodePath
): { provider: string; method: string } | null {
  const { node } = path;
  if (node.type !== "CallExpression") return null;
  const { callee } = node;
  if (callee.type !== "MemberExpression") return null;
  if (callee.property.type !== "Identifier") return null;

  const method = callee.property.name;
  const obj = callee.object;
  if (obj.type !== "MemberExpression") return null;
  if (obj.object.type !== "Identifier") return null;
  if (obj.object.name !== "llm") return null;
  if (obj.property.type !== "Identifier") return null;

  return { provider: obj.property.name, method };
}

function isLLMDestructuredAccess(
  path: NodePath
): { provider: string; method: string } | null {
  const { node } = path;
  if (node.type !== "CallExpression") return null;
  const { callee } = node;
  if (callee.type !== "MemberExpression") return null;
  if (callee.object.type !== "Identifier") return null;
  if (callee.property.type !== "Identifier") return null;

  const identName = callee.object.name;
  const method = callee.property.name;

  const binding = path.scope.getBinding(identName);
  if (!binding) return null;

  const bindingPath = binding.path;

  // Pattern 2: const { provider } = llm;
  if (bindingPath.node.type === "VariableDeclarator") {
    const { id, init } = bindingPath.node;
    if (
      init?.type === "Identifier" &&
      init.name === "llm" &&
      id.type === "ObjectPattern"
    ) {
      return { provider: identName, method };
    }
    return null;
  }

  // Pattern 3: ({ llm: { provider } }) => ...
  // Babel registers the binding for the destructured identifier at the outer
  // ObjectPattern level (the whole param pattern). We check that the outer
  // ObjectPattern has a property keyed "llm" whose value is an ObjectPattern
  // containing the identifier, and that the parent is a function node.
  if (bindingPath.node.type === "ObjectPattern") {
    const parentNode = bindingPath.parentPath?.node;
    const isParam =
      parentNode?.type === "FunctionDeclaration" ||
      parentNode?.type === "FunctionExpression" ||
      parentNode?.type === "ArrowFunctionExpression";
    if (!isParam) return null;

    const outerPattern = bindingPath.node;
    for (const prop of outerPattern.properties) {
      if (
        prop.type === "ObjectProperty" &&
        prop.key.type === "Identifier" &&
        prop.key.name === "llm" &&
        prop.value.type === "ObjectPattern"
      ) {
        const innerPattern = prop.value;
        const hasIdent = innerPattern.properties.some(
          (p) =>
            p.type === "ObjectProperty" &&
            p.key.type === "Identifier" &&
            p.key.name === identName
        );
        if (hasIdent) return { provider: identName, method };
      }
    }
    return null;
  }

  return null;
}

export function extractLLMCalls(ast: BabelFile): ModelCall[] {
  const calls: ModelCall[] = [];

  traverse(ast, {
    CallExpression(path) {
      const direct = isLLMDirectAccess(path);
      const destructured = direct === null ? isLLMDestructuredAccess(path) : null;
      const match = direct ?? destructured;
      if (!match) return;

      const stage = getStageName(path);
      if (stage === null) {
        const loc = path.node.loc;
        throw new Error(
          `LLM call at line ${loc?.start.line ?? "unknown"}, column ${loc?.start.column ?? "unknown"} is not inside an exported function`
        );
      }

      calls.push({ provider: match.provider, method: match.method, stage });
    },
  });

  return calls;
}
