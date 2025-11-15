import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  validateTaskSymlinks,
  repairTaskSymlinks,
  ensureSymlink,
} from "../src/core/symlink-utils.js";

describe("symlink validation and repair", () => {
  let tempDir;
  let taskDir;
  let poRoot;
  let taskModulePath;
  let expectedTargets;

  beforeEach(async () => {
    // Create a temporary directory for testing
    tempDir = await fs.mkdtemp(path.join(tmpdir(), "symlink-test-"));
    taskDir = path.join(tempDir, "tasks", "test-task");
    poRoot = path.join(tempDir, "project-root");
    taskModulePath = path.join(poRoot, "tasks", "test-task.js");

    // Create necessary directories
    await fs.mkdir(taskDir, { recursive: true });
    await fs.mkdir(poRoot, { recursive: true });
    await fs.mkdir(path.dirname(taskModulePath), { recursive: true });
    await fs.mkdir(path.join(tempDir, "node_modules"), { recursive: true });

    // Create a dummy task file
    await fs.writeFile(taskModulePath, "// dummy task file");

    expectedTargets = {
      nodeModules: path.join(tempDir, "node_modules"),
      taskRoot: path.dirname(taskModulePath),
    };
  });

  afterEach(async () => {
    // Clean up temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("validateTaskSymlinks", () => {
    it("should return valid when symlinks exist and point to correct targets", async () => {
      // Create valid symlinks
      await ensureSymlink(
        path.join(taskDir, "node_modules"),
        expectedTargets.nodeModules,
        "dir"
      );
      await ensureSymlink(
        path.join(taskDir, "_task_root"),
        expectedTargets.taskRoot,
        "dir"
      );

      const result = await validateTaskSymlinks(taskDir, expectedTargets);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.details.node_modules.targetAccessible).toBe(true);
      expect(result.details._task_root.targetAccessible).toBe(true);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it("should return invalid when symlinks do not exist", async () => {
      const result = await validateTaskSymlinks(taskDir, expectedTargets);

      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(2);
      expect(result.errors).toContain("node_modules symlink does not exist");
      expect(result.errors).toContain("_task_root symlink does not exist");
      expect(result.details.node_modules.exists).toBe(false);
      expect(result.details._task_root.exists).toBe(false);
    });

    it("should return invalid when symlinks point to wrong targets", async () => {
      // Create symlinks pointing to wrong targets
      await ensureSymlink(
        path.join(taskDir, "node_modules"),
        path.join(tempDir, "wrong-target"),
        "dir"
      );
      await ensureSymlink(
        path.join(taskDir, "_task_root"),
        path.join(tempDir, "another-wrong-target"),
        "dir"
      );

      const result = await validateTaskSymlinks(taskDir, expectedTargets);

      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(2);
      expect(
        result.errors.some((e) =>
          e.includes("node_modules points to wrong target")
        )
      ).toBe(true);
      expect(
        result.errors.some((e) =>
          e.includes("_task_root points to wrong target")
        )
      ).toBe(true);
    });

    it("should return invalid when symlinks are not symlinks (files/directories)", async () => {
      // Create regular files instead of symlinks
      await fs.writeFile(path.join(taskDir, "node_modules"), "not a symlink");
      await fs.mkdir(path.join(taskDir, "_task_root"));

      const result = await validateTaskSymlinks(taskDir, expectedTargets);

      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(2);
      expect(
        result.errors.some((e) => e.includes("exists but is not a symlink"))
      ).toBe(true);
    });

    it("should return invalid when symlink targets are not accessible", async () => {
      // Create symlinks pointing to non-existent targets
      await fs.symlink(
        path.join(tempDir, "non-existent"),
        path.join(taskDir, "node_modules")
      );
      await fs.symlink(
        path.join(tempDir, "another-non-existent"),
        path.join(taskDir, "_task_root")
      );

      const result = await validateTaskSymlinks(taskDir, expectedTargets);

      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(2);
      // Check for either "target is not accessible" or "points to wrong target" (both are valid)
      expect(
        result.errors.some(
          (e) =>
            e.includes("target is not accessible") ||
            e.includes("points to wrong target")
        )
      ).toBe(true);
    });
  });

  describe("repairTaskSymlinks", () => {
    it("should successfully repair missing symlinks", async () => {
      // Start with no symlinks
      const repairResult = await repairTaskSymlinks(
        taskDir,
        poRoot,
        taskModulePath
      );

      expect(repairResult.success).toBe(true);
      expect(repairResult.errors).toHaveLength(0);
      expect(repairResult.relocatedEntry).toBeTruthy();
      expect(repairResult.duration).toBeGreaterThanOrEqual(0);

      // Verify symlinks were created and are valid
      const validationResult = await validateTaskSymlinks(
        taskDir,
        expectedTargets
      );
      expect(validationResult.isValid).toBe(true);
    });

    it("should successfully repair broken symlinks", async () => {
      // Create broken symlinks
      await ensureSymlink(
        path.join(taskDir, "node_modules"),
        path.join(tempDir, "wrong-target"),
        "dir"
      );

      const repairResult = await repairTaskSymlinks(
        taskDir,
        poRoot,
        taskModulePath
      );

      expect(repairResult.success).toBe(true);
      expect(repairResult.errors).toHaveLength(0);

      // Verify symlinks were repaired and are valid
      const validationResult = await validateTaskSymlinks(
        taskDir,
        expectedTargets
      );
      expect(validationResult.isValid).toBe(true);
    });

    it("should return failure when repair encounters errors", async () => {
      // Use a read-only task directory to cause repair to fail
      const readOnlyTaskDir = path.join(tempDir, "readonly-task");
      await fs.mkdir(readOnlyTaskDir, { recursive: true });

      // Create a file in the readonly directory and make it readonly
      const testFile = path.join(readOnlyTaskDir, "test-task.js");
      await fs.writeFile(testFile, "// test file");
      await fs.chmod(readOnlyTaskDir, 0o444); // read-only

      const repairResult = await repairTaskSymlinks(
        readOnlyTaskDir,
        poRoot,
        testFile
      );

      expect(repairResult.success).toBe(false);
      expect(repairResult.errors.length).toBeGreaterThan(0);
      expect(repairResult.relocatedEntry).toBeNull();
    });
  });

  describe("integration", () => {
    it("should complete full validate-repair-validate cycle", async () => {
      // Start with invalid state
      let result = await validateTaskSymlinks(taskDir, expectedTargets);
      expect(result.isValid).toBe(false);

      // Repair the symlinks
      const repairResult = await repairTaskSymlinks(
        taskDir,
        poRoot,
        taskModulePath
      );
      expect(repairResult.success).toBe(true);

      // Validate again - should now be valid
      result = await validateTaskSymlinks(taskDir, expectedTargets);
      expect(result.isValid).toBe(true);
    });
  });
});
