import { readFile, stat } from "node:fs/promises";

import { Constants, createErrorResponse, type ErrorEnvelope } from "./config-bridge-node";

export interface FileReadSuccess {
  ok: true;
  data: unknown;
  path: string;
}

export interface FileValidationSuccess {
  ok: true;
  path: string;
  size: number;
  modified: Date;
}

export type FileReadResult = FileReadSuccess | ErrorEnvelope;
export type FileValidationResult = FileValidationSuccess | ErrorEnvelope;

export interface RetryOptions {
  maxAttempts?: number;
  delayMs?: number;
}

export interface FileReadingStats {
  totalFiles: number;
  successCount: number;
  errorCount: number;
  successRate: number;
  errorTypes: Record<string, number>;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFsError(filePath: string, error: unknown): ErrorEnvelope {
  return createErrorResponse(
    Constants.ERROR_CODES.FS_ERROR,
    error instanceof Error ? error.message : String(error),
    filePath,
  );
}

export async function validateFilePath(filePath: string): Promise<FileValidationResult> {
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      return createErrorResponse(Constants.ERROR_CODES.NOT_FOUND, "path is not a regular file", filePath);
    }
    if (fileStat.size > Constants.FILE_LIMITS.MAX_FILE_SIZE) {
      return createErrorResponse(
        Constants.ERROR_CODES.BAD_REQUEST,
        `file exceeds ${Constants.FILE_LIMITS.MAX_FILE_SIZE} bytes`,
        filePath,
      );
    }
    return { ok: true, path: filePath, size: fileStat.size, modified: fileStat.mtime };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return createErrorResponse(Constants.ERROR_CODES.NOT_FOUND, "file not found", filePath);
    }
    return getFsError(filePath, error);
  }
}

export async function readJSONFile(filePath: string): Promise<FileReadResult> {
  const validation = await validateFilePath(filePath);
  if (!validation.ok) return validation;

  try {
    const text = stripBom(await readFile(filePath, "utf8"));
    return { ok: true, data: JSON.parse(text), path: filePath };
  } catch (error) {
    if (error instanceof SyntaxError) {
      return createErrorResponse(Constants.ERROR_CODES.INVALID_JSON, error.message, filePath);
    }
    return getFsError(filePath, error);
  }
}

export async function readFileWithRetry(
  filePath: string,
  options: RetryOptions = {},
): Promise<FileReadResult> {
  const maxAttempts = Math.min(options.maxAttempts ?? Constants.RETRY_CONFIG.MAX_ATTEMPTS, 5);
  const delayMs = Math.min(options.delayMs ?? Constants.RETRY_CONFIG.DELAY_MS, 50);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await readJSONFile(filePath);
    if (result.ok) return result;
    if (result.code === Constants.ERROR_CODES.NOT_FOUND) return result;
    if (
      result.code !== Constants.ERROR_CODES.INVALID_JSON &&
      result.code !== Constants.ERROR_CODES.FS_ERROR
    ) {
      return result;
    }
    if (attempt === maxAttempts) return result;
    await sleep(delayMs);
  }

  return createErrorResponse(Constants.ERROR_CODES.FS_ERROR, "retry loop exhausted", filePath);
}

export function readMultipleJSONFiles(filePaths: string[]): Promise<FileReadResult[]> {
  return Promise.all(filePaths.map((filePath) => readJSONFile(filePath)));
}

export function getFileReadingStats(
  filePaths: string[],
  results: FileReadResult[],
): FileReadingStats {
  const errorTypes = results.reduce<Record<string, number>>((acc, result) => {
    if (!result.ok) acc[result.code] = (acc[result.code] ?? 0) + 1;
    return acc;
  }, {});
  const successCount = results.filter((result) => result.ok).length;
  return {
    totalFiles: filePaths.length,
    successCount,
    errorCount: results.length - successCount,
    successRate: filePaths.length === 0 ? 0 : successCount / filePaths.length,
    errorTypes,
  };
}
