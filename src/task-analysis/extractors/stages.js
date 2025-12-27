import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const traverse =
  require("@babel/traverse").default ?? require("@babel/traverse");

/**
 * Extract exported function stages from an AST.
 *
 * Visits ExportNamedDeclaration nodes and extracts stage information
 * including name, line order, and async status.
 *
 * @param {import("@babel/types").File} ast - The parsed AST
 * @returns {Array<{name: string, order: number, isAsync: boolean}>}
 *          Array of stages sorted by order (line number)
 */
export function extractStages(ast) {
  const stages = [];

  traverse(ast, {
    ExportNamedDeclaration(path) {
      const declaration = path.node.declaration;

      // Handle: export function name() {}
      if (declaration?.type === "FunctionDeclaration") {
        stages.push({
          name: declaration.id.name,
          order: path.node.loc?.start.line ?? 0,
          isAsync: declaration.async ?? false,
        });
        return;
      }

      // Handle: export const name = () => {} or export const name = async () => {}
      // or export const name = function() {}
      if (declaration?.type === "VariableDeclaration") {
        const declarator = declaration.declarations[0];
        const init = declarator?.init;

        if (init?.type === "ArrowFunctionExpression" || init?.type === "FunctionExpression") {
          stages.push({
            name: declarator.id.name,
            order: path.node.loc?.start.line ?? 0,
            isAsync: init.async ?? false,
          });
        }
      }
    },
  });

  return stages.sort((a, b) => a.order - b.order);
}
