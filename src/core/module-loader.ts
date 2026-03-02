import { access, copyFile } from "node:fs/promises";
import { basename, extname, dirname, join } from "node:path";

export async function loadFreshModule(modulePath: string | URL): Promise<Record<string, unknown>> {
  let filePath: string;
  let fileUrl: string;

  if (modulePath instanceof URL) {
    filePath = modulePath.pathname;
    fileUrl = modulePath.href;
  } else if (typeof modulePath === "string") {
    if (modulePath.startsWith("file://")) {
      filePath = modulePath.slice("file://".length);
      fileUrl = modulePath;
    } else if (modulePath.startsWith("/")) {
      filePath = modulePath;
      fileUrl = "file://" + modulePath;
    } else {
      throw new Error("Module path must be absolute");
    }
  } else {
    throw new TypeError("Module path must be a string or URL");
  }

  try {
    await access(filePath);
  } catch {
    throw new Error(`Module not found at ${filePath}`);
  }

  const errors: string[] = [];

  try {
    return await import(fileUrl) as Record<string, unknown>;
  } catch (e) {
    errors.push((e as Error).message);
  }

  const bustUrl = fileUrl + "?t=" + Date.now();
  try {
    return await import(bustUrl) as Record<string, unknown>;
  } catch (e) {
    errors.push((e as Error).message);
  }

  const ext = extname(filePath);
  const base = basename(filePath, ext);
  const adjacentName = `.cache.${base}.${Date.now()}-${crypto.randomUUID()}${ext}`;
  const adjacentPath = join(dirname(filePath), adjacentName);
  const adjacentUrl = "file://" + adjacentPath;

  try {
    await copyFile(filePath, adjacentPath);
    return await import(adjacentUrl) as Record<string, unknown>;
  } catch (e) {
    errors.push((e as Error).message);
  }

  throw new Error(`Failed to load module after 3 attempts:\n${errors.join("\n")}`);
}
