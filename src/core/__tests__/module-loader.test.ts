import { describe, test, expect } from "bun:test";
import { loadFreshModule } from "../module-loader";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("loadFreshModule", () => {
  test("loads a module from an absolute path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modloader-"));
    const modPath = join(dir, "test-mod.ts");
    await writeFile(modPath, "export const value = 42;");
    const mod = await loadFreshModule(modPath);
    expect(mod.value).toBe(42);
    await rm(dir, { recursive: true });
  });

  test("throws TypeError for non-string non-URL argument", async () => {
    await expect(loadFreshModule(123 as any)).rejects.toThrow("Module path must be a string or URL");
  });

  test("throws for relative path", async () => {
    await expect(loadFreshModule("./relative.ts")).rejects.toThrow("Module path must be absolute");
  });

  test("throws for nonexistent module", async () => {
    await expect(loadFreshModule("/tmp/nonexistent-module-12345.ts")).rejects.toThrow("Module not found at");
  });

  test("accepts file:// URL string", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modloader-"));
    const modPath = join(dir, "test-mod.ts");
    await writeFile(modPath, "export const value = 99;");
    const mod = await loadFreshModule("file://" + modPath);
    expect(mod.value).toBe(99);
    await rm(dir, { recursive: true });
  });

  test("accepts URL object", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modloader-"));
    const modPath = join(dir, "test-mod.ts");
    await writeFile(modPath, "export const value = 77;");
    const mod = await loadFreshModule(new URL("file://" + modPath));
    expect(mod.value).toBe(77);
    await rm(dir, { recursive: true });
  });
});
