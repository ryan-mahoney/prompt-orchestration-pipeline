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
 * @param {import("@babel/types").File} ast - The AST to analyze
 * @returns {Array<{provider: string, method: string, stage: string}>} Array of LLM call references
 * @throws {Error} If LLM call is found outside an exported function
 */
export function extractLLMCalls(ast) {
  const calls = [];

  traverse.default(ast, {
    CallExpression(path) {
      const { callee } = path.node;

      // Match: llm.provider.method(...)
      // This is a nested member expression with 3 levels: llm.provider.method
      if (isLLMCall(callee)) {
        // Extract provider (second level: llm.provider)
        const provider = callee.object.property.name;

        // Extract method (third level: provider.method)
        const method = callee.property.name;

        // Get the stage name (must be in an exported function)
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
 * Check if a callee node is an LLM call pattern.
 *
 * Matches nested member expressions: llm.provider.method
 *
 * @param {import("@babel/types").Node} callee - The callee node to check
 * @returns {boolean} True if the callee is an LLM call pattern
 */
function isLLMCall(callee) {
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
