import traverse from "@babel/traverse";
import * as t from "@babel/types";
import { getStageName } from "../utils/ast.js";

/**
 * Extract LLM method calls from the AST.
 *
 * Matches direct calls like:
 * - llm.deepseek.chat(...)
 * - llm.openai.gpt5Mini(...)
 * - llm.anthropic.sonnet45(...)
 * - llm.gemini.flash25(...)
 *
 * And destructured calls like:
 * - const { deepseek } = llm; deepseek.chat(...)
 *
 * @param {import("@babel/types").File} ast - The AST to analyze
 * @returns {Array<{provider: string, method: string, stage: string}>} Array of LLM call references
 * @throws {Error} If LLM call is found outside an exported function
 */
export function extractLLMCalls(ast) {
  const calls = [];
  const destructuredProviders = new Map();

  // First pass: collect destructured providers from llm param
  traverse(ast, {
    VariableDeclarator(path) {
      const { id, init } = path.node;

      // Match: const { deepseek } = llm
      if (t.isObjectPattern(id) && t.isIdentifier(init, { name: "llm" })) {
        id.properties.forEach((prop) => {
          if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
            destructuredProviders.set(prop.key.name, "llm");
          }
        });
      }
    },
  });

  // Second pass: extract LLM calls
  traverse(ast, {
    CallExpression(path) {
      const { callee } = path.node;

      // Match: llm.provider.method(...)
      if (isDirectLLMCall(callee)) {
        const provider = callee.object.property.name;
        const method = callee.property.name;
        const stage = getStageName(path);

        if (!stage) {
          throw new Error(
            `LLM call found outside an exported function at ${path.node.loc?.start?.line}:${path.node.loc?.start?.column}`
          );
        }

        calls.push({ provider, method, stage });
      }

      // Match: provider.method(...) where provider was destructured from llm
      if (isDestructuredLLMCall(callee, destructuredProviders)) {
        const provider = callee.object.name;
        const method = callee.property.name;
        const stage = getStageName(path);

        if (!stage) {
          throw new Error(
            `LLM call found outside an exported function at ${path.node.loc?.start?.line}:${path.node.loc?.start?.column}`
          );
        }

        calls.push({ provider, method, stage });
      }
    },
  });

  return calls;
}

/**
 * Check if a callee node is a direct LLM call pattern.
 *
 * Matches nested member expressions: llm.provider.method
 *
 * @param {import("@babel/types").Node} callee - The callee node to check
 * @returns {boolean} True if the callee is a direct LLM call pattern
 */
function isDirectLLMCall(callee) {
  // Must be a member expression (e.g., llm.provider.method)
  if (!t.isMemberExpression(callee)) {
    return false;
  }

  // The object must also be a member expression (e.g., llm.provider)
  if (!t.isMemberExpression(callee.object)) {
    return false;
  }

  // The root object must be identifier "llm"
  if (!t.isIdentifier(callee.object.object, { name: "llm" })) {
    return false;
  }

  // The object property must be an identifier (the provider)
  if (!t.isIdentifier(callee.object.property)) {
    return false;
  }

  // The callee property must be an identifier (the method)
  if (!t.isIdentifier(callee.property)) {
    return false;
  }

  return true;
}

/**
 * Check if a callee node is a destructured LLM call pattern.
 *
 * Matches: provider.method(...) where provider was destructured from llm
 *
 * @param {import("@babel/types").Node} callee - The callee node to check
 * @param {Map<string, string>} destructuredProviders - Map of destructured provider names
 * @returns {boolean} True if the callee is a destructured LLM call pattern
 */
function isDestructuredLLMCall(callee, destructuredProviders) {
  // Must be a member expression (e.g., provider.method)
  if (!t.isMemberExpression(callee)) {
    return false;
  }

  // The object must be an identifier (the destructured provider)
  if (!t.isIdentifier(callee.object)) {
    return false;
  }

  // The object name must be in the destructured providers map
  if (!destructuredProviders.has(callee.object.name)) {
    return false;
  }

  // The callee property must be an identifier (the method)
  if (!t.isIdentifier(callee.property)) {
    return false;
  }

  return true;
}
