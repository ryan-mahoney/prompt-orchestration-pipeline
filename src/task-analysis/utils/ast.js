/**
 * Check if a path is inside a try/catch block.
 *
 * @param {import("@babel/traverse").NodePath} path - The node path to check
 * @returns {boolean} True if inside try/catch, false otherwise
 */
export function isInsideTryCatch(path) {
  return path.findParent((p) => p.isTryStatement()) !== null;
}

/**
 * Get the stage name by finding the nearest exported function.
 *
 * Walks up the AST to find the parent ExportNamedDeclaration and returns
 * the exported identifier name.
 *
 * @param {import("@babel/traverse").NodePath} path - The node path to start from
 * @returns {string | null} The stage name or null if not in exported function
 */
export function getStageName(path) {
  const exportPath = path.findParent((p) => p.isExportNamedDeclaration());

  if (!exportPath) {
    return null;
  }

  const declaration = exportPath.node.declaration;

  // Handle: export function name() {}
  if (declaration?.type === "FunctionDeclaration") {
    return declaration.id?.name ?? null;
  }

  // Handle: export const name = () => {}
  if (declaration?.type === "VariableDeclaration") {
    const declarator = declaration.declarations[0];
    if (declarator?.id?.type === "Identifier") {
      return declarator.id.name;
    }
  }

  return null;
}
