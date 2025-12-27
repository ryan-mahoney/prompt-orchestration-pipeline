import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const traverse =
  require("@babel/traverse").default ?? require("@babel/traverse");
import * as t from "@babel/types";
import { isInsideTryCatch, getStageName } from "../utils/ast.js";

/**
 * Extract io.readArtifact calls from the AST.
 *
 * @param {import("@babel/types").File} ast - The AST to analyze
 * @returns {Array<{fileName: string, stage: string, required: boolean}>} Array of artifact read references
 * @throws {Error} If io.readArtifact call is found outside an exported function
 */
export function extractArtifactReads(ast) {
  const reads = [];

  traverse(ast, {
    CallExpression(path) {
      const { callee } = path.node;

      // Match: io.readArtifact("file.json") or io.readArtifact`file.json`
      if (
        t.isMemberExpression(callee) &&
        t.isIdentifier(callee.object, { name: "io" }) &&
        t.isIdentifier(callee.property, { name: "readArtifact" })
      ) {
        // Extract fileName from first argument
        const fileName = extractFileName(path.node.arguments[0]);

        if (!fileName) {
          throw new Error(
            `io.readArtifact requires a string literal or template literal argument at ${path.node.loc?.start?.line}:${path.node.loc?.start?.column}`
          );
        }

        // Get the stage name (must be in an exported function)
        const stage = getStageName(path);

        if (!stage) {
          throw new Error(
            `io.readArtifact call found outside an exported function at ${path.node.loc?.start?.line}:${path.node.loc?.start?.column}`
          );
        }

        // Check if inside try/catch to determine if required
        const required = !isInsideTryCatch(path);

        reads.push({ fileName, stage, required });
      }
    },
  });

  return reads;
}

/**
 * Extract io.writeArtifact calls from the AST.
 *
 * @param {import("@babel/types").File} ast - The AST to analyze
 * @returns {Array<{fileName: string, stage: string}>} Array of artifact write references
 * @throws {Error} If io.writeArtifact call is found outside an exported function
 */
export function extractArtifactWrites(ast) {
  const writes = [];

  traverse(ast, {
    CallExpression(path) {
      const { callee } = path.node;

      // Match: io.writeArtifact("file.json", content)
      if (
        t.isMemberExpression(callee) &&
        t.isIdentifier(callee.object, { name: "io" }) &&
        t.isIdentifier(callee.property, { name: "writeArtifact" })
      ) {
        // Extract fileName from first argument
        const fileName = extractFileName(path.node.arguments[0]);

        if (!fileName) {
          throw new Error(
            `io.writeArtifact requires a string literal or template literal argument at ${path.node.loc?.start?.line}:${path.node.loc?.start?.column}`
          );
        }

        // Get the stage name (must be in an exported function)
        const stage = getStageName(path);

        if (!stage) {
          throw new Error(
            `io.writeArtifact call found outside an exported function at ${path.node.loc?.start?.line}:${path.node.loc?.start?.column}`
          );
        }

        writes.push({ fileName, stage });
      }
    },
  });

  return writes;
}

/**
 * Extract filename from a string literal or template literal.
 *
 * @param {import("@babel/types").Node} node - The argument node
 * @returns {string | null} The extracted filename or null if not a string/template literal
 */
function extractFileName(node) {
  // Handle string literals: "file.json"
  if (t.isStringLiteral(node)) {
    return node.value;
  }

  // Handle template literals: `file.json` or `file-${name}.json`
  if (t.isTemplateLiteral(node)) {
    // Extract the template literal as-is for Phase 1
    // Note: This includes expressions as placeholders, e.g., "file-${name}.json"
    return node.quasis.map((q) => q.value.cooked).join("");
  }

  return null;
}
