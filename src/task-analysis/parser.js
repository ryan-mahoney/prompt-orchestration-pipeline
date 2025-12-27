import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const parser = require("@babel/parser");

/**
 * Parse task source code into a Babel AST.
 *
 * @param {string} code - The source code to parse
 * @returns {import("@babel/types").File} The parsed AST
 * @throws {Error} If parsing fails, includes syntax error location and message
 */
export function parseTaskSource(code) {
  try {
    const ast = parser.parse(code, {
      sourceType: "module",
      plugins: ["jsx"],
    });
    return ast;
  } catch (error) {
    const loc = error.loc
      ? `line ${error.loc.line}, column ${error.loc.column}`
      : "unknown location";
    throw new Error(
      `Failed to parse task source code at ${loc}: ${error.message}`,
      { cause: error }
    );
  }
}
