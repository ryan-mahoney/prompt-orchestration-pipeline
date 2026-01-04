import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const traverse =
  require("@babel/traverse").default ?? require("@babel/traverse");
const generate =
  require("@babel/generator").default ?? require("@babel/generator");
import * as t from "@babel/types";
import { isInsideTryCatch, getStageName } from "../utils/ast.js";

/**
 * Extract surrounding code context for a node.
 *
 * @param {import("@babel/traverse").NodePath} path - The Babel path
 * @param {string} sourceCode - The original source code
 * @returns {string} 3-5 lines of surrounding context
 */
export function extractCodeContext(path, sourceCode) {
  if (!sourceCode || !path.node.loc) {
    return "";
  }

  const lines = sourceCode.split("\n");
  const nodeLine = path.node.loc.start.line;

  // Get 2 lines before and 2 lines after (5 lines total, 1-indexed)
  const startLine = Math.max(1, nodeLine - 2);
  const endLine = Math.min(lines.length, nodeLine + 2);

  return lines.slice(startLine - 1, endLine).join("\n");
}

/**
 * Extract io.readArtifact calls from the AST.
 *
 * @param {import("@babel/types").File} ast - The AST to analyze
 * @param {string} [sourceCode] - The original source code (for extracting context)
 * @returns {{reads: Array<{fileName: string, stage: string, required: boolean}>, unresolvedReads: Array<{expression: string, codeContext: string, stage: string, required: boolean, location: {line: number, column: number}}>}} Artifact read references
 * @throws {Error} If io.readArtifact call is found outside an exported function
 */
export function extractArtifactReads(ast, sourceCode) {
  const reads = [];
  const unresolvedReads = [];

  traverse(ast, {
    CallExpression(path) {
      const { callee } = path.node;

      // Match: io.readArtifact("file.json") or io.readArtifact`file.json`
      if (
        t.isMemberExpression(callee) &&
        t.isIdentifier(callee.object, { name: "io" }) &&
        t.isIdentifier(callee.property, { name: "readArtifact" })
      ) {
        // Get the stage name (must be in an exported function)
        const stage = getStageName(path);

        if (!stage) {
          throw new Error(
            `io.readArtifact call found outside an exported function at ${path.node.loc?.start?.line}:${path.node.loc?.start?.column}`
          );
        }

        // Check if inside try/catch to determine if required
        const required = !isInsideTryCatch(path);

        // Extract fileName from first argument
        const fileName = extractFileName(path.node.arguments[0]);

        if (fileName) {
          reads.push({ fileName, stage, required });
        } else if (path.node.arguments[0]) {
          // Capture unresolved reference
          const argNode = path.node.arguments[0];
          const expression = generate(argNode, { concise: true }).code;
          const codeContext = extractCodeContext(path, sourceCode);
          const location = {
            line: argNode.loc?.start?.line ?? 0,
            column: argNode.loc?.start?.column ?? 0,
          };
          unresolvedReads.push({
            expression,
            codeContext,
            stage,
            required,
            location,
          });
        }
      }
    },
  });

  return { reads, unresolvedReads };
}

/**
 * Extract io.writeArtifact calls from the AST.
 *
 * @param {import("@babel/types").File} ast - The AST to analyze
 * @param {string} [sourceCode] - The original source code (for extracting context)
 * @returns {{writes: Array<{fileName: string, stage: string}>, unresolvedWrites: Array<{expression: string, codeContext: string, stage: string, location: {line: number, column: number}}>}} Artifact write references
 * @throws {Error} If io.writeArtifact call is found outside an exported function
 */
export function extractArtifactWrites(ast, sourceCode) {
  const writes = [];
  const unresolvedWrites = [];

  traverse(ast, {
    CallExpression(path) {
      const { callee } = path.node;

      // Match: io.writeArtifact("file.json", content)
      if (
        t.isMemberExpression(callee) &&
        t.isIdentifier(callee.object, { name: "io" }) &&
        t.isIdentifier(callee.property, { name: "writeArtifact" })
      ) {
        // Get the stage name (must be in an exported function)
        const stage = getStageName(path);

        if (!stage) {
          throw new Error(
            `io.writeArtifact call found outside an exported function at ${path.node.loc?.start?.line}:${path.node.loc?.start?.column}`
          );
        }

        // Extract fileName from first argument
        const fileName = extractFileName(path.node.arguments[0]);

        if (fileName) {
          writes.push({ fileName, stage });
        } else if (path.node.arguments[0]) {
          // Capture unresolved reference
          const argNode = path.node.arguments[0];
          const expression = generate(argNode, { concise: true }).code;
          const codeContext = extractCodeContext(path, sourceCode);
          const location = {
            line: argNode.loc?.start?.line ?? 0,
            column: argNode.loc?.start?.column ?? 0,
          };
          unresolvedWrites.push({ expression, codeContext, stage, location });
        }
      }
    },
  });

  return { writes, unresolvedWrites };
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
    // If there are no expressions, use the simple approach
    if (!node.expressions || node.expressions.length === 0) {
      return node.quasis.map((q) => q.value.cooked).join("");
    }

    // For template literals with expressions, use @babel/generator to preserve them
    // This ensures dynamic filenames like `file-${name}.json` are preserved as-is
    const generated = generate(node, { concise: true });
    // Remove the backticks from the generated code
    const code = generated.code;
    if (code.startsWith("`") && code.endsWith("`")) {
      return code.slice(1, -1);
    }
    // Fallback in case the generated code doesn't have backticks
    return code;
  }

  return null;
}
