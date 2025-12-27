import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const traverse =
  require("@babel/traverse").default ?? require("@babel/traverse");
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
      if (isDestructuredLLMCall(callee, path)) {
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
 * Uses scope analysis to verify the identifier was actually destructured from llm
 * in the current scope, avoiding false positives from same-named identifiers in different scopes.
 *
 * @param {import("@babel/types").Node} callee - The callee node to check
 * @param {import("@babel/traverse").NodePath} path - The path of the call expression
 * @returns {boolean} True if the callee is a destructured LLM call pattern
 */
function isDestructuredLLMCall(callee, path) {
  // Must be a member expression (e.g., provider.method)
  if (!t.isMemberExpression(callee)) {
    return false;
  }

  // The object must be an identifier (the destructured provider)
  if (!t.isIdentifier(callee.object)) {
    return false;
  }

  // The callee property must be an identifier (the method)
  if (!t.isIdentifier(callee.property)) {
    return false;
  }

  // Get the binding for this identifier in the current scope
  const binding = path.scope.getBinding(callee.object.name);
  if (!binding) {
    return false;
  }

  // Check if it was destructured from llm in a variable declaration
  if (t.isVariableDeclarator(binding.path.node)) {
    const { id, init } = binding.path.node;
    // Match: const { provider } = llm
    if (t.isObjectPattern(id) && t.isIdentifier(init, { name: "llm" })) {
      return true;
    }
  }

  // Check if it was destructured from llm in function parameters
  // Match: ({ llm: { provider } }) => {}
  if (binding.kind === "param" && t.isObjectPattern(binding.path.node)) {
    // The binding points to the entire parameter ObjectPattern
    // Look for a property with key "llm" whose value is an ObjectPattern
    const llmProperty = binding.path.node.properties.find(
      (prop) =>
        t.isObjectProperty(prop) &&
        t.isIdentifier(prop.key, { name: "llm" }) &&
        t.isObjectPattern(prop.value)
    );

    if (llmProperty) {
      // Check if the provider identifier is in the nested ObjectPattern
      // Handles both shorthand ({ llm: { provider } }) and renamed ({ llm: { provider: alias } }) patterns
      const providerInPattern = llmProperty.value.properties.some((innerProp) =>
        t.isObjectProperty(innerProp)
          ? // Check key for shorthand pattern: { provider }
            t.isIdentifier(innerProp.key, { name: callee.object.name }) ||
            // Check value for renamed pattern: { provider: alias } where we're looking for alias
            t.isIdentifier(innerProp.value, { name: callee.object.name })
          : false
      );

      if (providerInPattern) {
        return true;
      }
    }
  }

  return false;
}
