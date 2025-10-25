import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const WORKSPACE_CACHE_DIR = path.join(process.cwd(), ".tmp-task-modules");

/**
 * Convert supported modulePath formats into a file:// URL.
 * @param {string | URL} modulePath
 * @returns {URL}
 */
function resolveToFileURL(modulePath) {
  if (modulePath instanceof URL) {
    return modulePath;
  }

  if (
    modulePath &&
    typeof modulePath === "object" &&
    typeof modulePath.href === "string"
  ) {
    try {
      return new URL(modulePath.href);
    } catch {
      // fall through to error below
    }
  }

  if (typeof modulePath !== "string") {
    throw new TypeError(
      `Module path must be a string or URL. Received: ${typeof modulePath}`
    );
  }

  if (modulePath.startsWith("file://")) {
    return new URL(modulePath);
  }

  if (!path.isAbsolute(modulePath)) {
    throw new Error(
      `Module path must be absolute. Received: ${modulePath}\n` +
        `Hint: resolve module paths before calling loadFreshModule().`
    );
  }

  return pathToFileURL(modulePath);
}

/**
 * Detect whether an error corresponds to a module-not-found condition.
 * @param {unknown} error
 * @returns {boolean}
 */
function isModuleNotFoundError(error) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const err = /** @type {{ code?: string; message?: string }} */ (error);

  if (err.code === "ERR_MODULE_NOT_FOUND") {
    return true;
  }

  const message = err.message || "";
  return (
    message.includes("Cannot find module") ||
    message.includes("Failed to load url")
  );
}

/**
 * Produce a clearer error when the underlying module file is missing.
 * @param {string} modulePath
 * @param {Error} originalError
 */
function createMissingModuleError(modulePath, originalError) {
  const error = new Error(
    `Module not found at "${modulePath}". Ensure the file exists before running the pipeline.`
  );
  error.name = originalError.name || "ERR_MODULE_NOT_FOUND";
  if ("cause" in Error.prototype) {
    error.cause = originalError;
  } else {
    error.originalError = originalError;
  }
  return error;
}

/**
 * Copy a module file into a workspace-local cache directory so Vite/Vitest can load it.
 * @param {string} sourcePath
 * @returns {Promise<string>}
 */
async function copyModuleToWorkspaceCache(sourcePath) {
  await fsp.mkdir(WORKSPACE_CACHE_DIR, { recursive: true });
  const ext = path.extname(sourcePath) || ".js";
  const base = path.basename(sourcePath, ext);
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const destFile = path.join(
    WORKSPACE_CACHE_DIR,
    `${base}.${uniqueSuffix}${ext}`
  );
  await fsp.copyFile(sourcePath, destFile);
  return destFile;
}

/**
 * Dynamically import a module with cache busting while remaining compatible with Node's file:/// resolution.
 * Falls back to copying the module into a workspace-local cache when query parameters break filesystem resolution.
 * @param {string | URL} modulePath
 * @returns {Promise<any>} Module namespace object
 */
export async function loadFreshModule(modulePath) {
  const fileUrl = resolveToFileURL(modulePath);
  const cacheBustedUrl = `${fileUrl.href}?t=${Date.now()}`;

  try {
    return await import(cacheBustedUrl);
  } catch (error) {
    if (!isModuleNotFoundError(error) || fileUrl.protocol !== "file:") {
      throw error;
    }

    const absolutePath = fileURLToPath(fileUrl);

    try {
      await fsp.access(absolutePath);
    } catch {
      throw createMissingModuleError(
        absolutePath,
        /** @type {Error} */ (error)
      );
    }

    try {
      const cacheCopy = await copyModuleToWorkspaceCache(absolutePath);
      const cacheUrl = `${pathToFileURL(cacheCopy).href}?t=${Date.now()}`;
      return await import(cacheUrl);
    } catch (fallbackError) {
      const messageLines = [
        `Failed to load module "${absolutePath}" after attempting cache-busting import.`,
        `Cache-busted URL: ${cacheBustedUrl}`,
        `Original error: ${/** @type {Error} */ (error).message}`,
        `Fallback error: ${/** @type {Error} */ (fallbackError).message}`,
      ];
      const combined = new Error(messageLines.join("\n"));
      if ("cause" in Error.prototype) {
        combined.cause = fallbackError;
      } else {
        combined.fallbackError = fallbackError;
      }
      combined.initialError = error;
      throw combined;
    }
  }
}
