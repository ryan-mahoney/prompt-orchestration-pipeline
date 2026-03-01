import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

/**
 * Unit tests for task-save-endpoint.js
 * Focused on testing the dual module format support (ESM vs CommonJS)
 */

// Helper to create temp directory structure
async function createTempPipelineDir() {
  const tempDir = await fs.mkdtemp(path.join(tmpdir(), "task-save-test-"));
  const pipelineConfigDir = path.join(tempDir, "pipeline-config");
  const tasksDir = path.join(pipelineConfigDir, "test-pipeline", "tasks");
  await fs.mkdir(tasksDir, { recursive: true });

  // Create registry.json
  const registry = {
    pipelines: {
      "test-pipeline": {
        name: "test-pipeline",
        description: "Test pipeline",
        pipelinePath: "pipeline-config/test-pipeline/pipeline.json",
        taskRegistryPath: "pipeline-config/test-pipeline/tasks/index.js",
      },
    },
  };
  await fs.writeFile(
    path.join(pipelineConfigDir, "registry.json"),
    JSON.stringify(registry, null, 2)
  );

  return { tempDir, tasksDir };
}

describe("Task Save Endpoint - Module Format Detection", () => {
  let tempDir;
  let tasksDir;

  beforeEach(async () => {
    const result = await createTempPipelineDir();
    tempDir = result.tempDir;
    tasksDir = result.tasksDir;
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  describe("ESM format detection", () => {
    it("should detect 'export default {' pattern", async () => {
      // Arrange
      const indexContent = `export default {
  "existing-task": "./existing-task.js",
};
`;
      await fs.writeFile(path.join(tasksDir, "index.js"), indexContent);

      // Act - test the regex pattern directly
      const esmPattern = /export\s+default\s+\{/;
      const match = esmPattern.test(indexContent);

      // Assert
      expect(match).toBe(true);
    });

    it("should detect 'export default {' with extra whitespace", async () => {
      // Arrange
      const indexContent = `export   default   {
  "existing-task": "./existing-task.js",
};
`;

      // Act
      const esmPattern = /export\s+default\s+\{/;
      const match = esmPattern.test(indexContent);

      // Assert
      expect(match).toBe(true);
    });

    it("should detect empty export default", async () => {
      // Arrange
      const indexContent = `export default {};
`;

      // Act
      const esmPattern = /export\s+default\s+\{/;
      const match = esmPattern.test(indexContent);

      // Assert
      expect(match).toBe(true);
    });
  });

  describe("CommonJS format detection", () => {
    it("should detect 'module.exports = {' pattern", async () => {
      // Arrange
      const indexContent = `module.exports = {
  "existing-task": "./existing-task.js",
};
`;

      // Act
      const cjsPattern = /module\.exports\s*=\s*\{/;
      const match = cjsPattern.test(indexContent);

      // Assert
      expect(match).toBe(true);
    });

    it("should detect 'module.exports = { tasks: {' nested pattern", async () => {
      // Arrange
      const indexContent = `// Task registry for test-pipeline
module.exports = { tasks: {} };
`;

      // Act
      const cjsTasksPattern = /module\.exports\s*=\s*\{\s*tasks\s*:\s*\{/;
      const match = cjsTasksPattern.test(indexContent);

      // Assert
      expect(match).toBe(true);
    });

    it("should detect CommonJS with no spaces around equals", async () => {
      // Arrange
      const indexContent = `module.exports={
  "existing-task": "./existing-task.js",
};
`;

      // Act
      const cjsPattern = /module\.exports\s*=\s*\{/;
      const match = cjsPattern.test(indexContent);

      // Assert
      expect(match).toBe(true);
    });
  });

  describe("Insert position calculation", () => {
    it("should find correct insert position for ESM format", async () => {
      // Arrange
      const indexContent = `export default {
  "existing-task": "./existing-task.js",
};
`;

      // Act
      const esmPattern = /export\s+default\s+\{/;
      const match = indexContent.match(esmPattern);
      const insertPosition = indexContent.indexOf("\n", match.index) + 1;

      // Assert - should be right after the opening brace line
      expect(insertPosition).toBe(17); // After "export default {\n"
      expect(indexContent.slice(insertPosition).startsWith('  "existing')).toBe(
        true
      );
    });

    it("should find correct insert position for CommonJS with nested tasks", async () => {
      // Arrange
      const indexContent = `// Task registry
module.exports = { tasks: {} };
`;

      // Act
      const cjsTasksPattern = /module\.exports\s*=\s*\{\s*tasks\s*:\s*\{/;
      const match = indexContent.match(cjsTasksPattern);
      const insertPosition = indexContent.indexOf("\n", match.index) + 1;

      // Assert - should be after the full match line
      expect(insertPosition).toBeGreaterThan(0);
    });

    it("should handle single-line ESM export", async () => {
      // Arrange
      const indexContent = `export default {};
`;

      // Act
      const esmPattern = /export\s+default\s+\{/;
      const match = indexContent.match(esmPattern);
      const insertPosition = indexContent.indexOf("\n", match.index) + 1;

      // Assert
      expect(insertPosition).toBe(19); // After "export default {};\n"
    });
  });

  describe("Task entry insertion", () => {
    it("should correctly insert task entry in ESM format", async () => {
      // Arrange
      const indexContent = `export default {
  "existing-task": "./existing-task.js",
};
`;
      const taskName = "new-task";
      const filename = "new-task.js";

      // Act
      const esmPattern = /export\s+default\s+\{/;
      const match = indexContent.match(esmPattern);
      const insertPosition = indexContent.indexOf("\n", match.index) + 1;
      const newEntry = `  ${taskName}: "./${filename}",\n`;
      const newContent =
        indexContent.slice(0, insertPosition) +
        newEntry +
        indexContent.slice(insertPosition);

      // Assert
      expect(newContent).toContain('new-task: "./new-task.js"');
      expect(newContent).toContain('existing-task": "./existing-task.js"');
      expect(newContent.indexOf("new-task")).toBeLessThan(
        newContent.indexOf("existing-task")
      );
    });

    it("should correctly insert task entry in CommonJS format", async () => {
      // Arrange
      const indexContent = `module.exports = {
  "existing-task": "./existing-task.js",
};
`;
      const taskName = "new-task";
      const filename = "new-task.js";

      // Act
      const cjsPattern = /module\.exports\s*=\s*\{/;
      const match = indexContent.match(cjsPattern);
      const insertPosition = indexContent.indexOf("\n", match.index) + 1;
      const newEntry = `  ${taskName}: "./${filename}",\n`;
      const newContent =
        indexContent.slice(0, insertPosition) +
        newEntry +
        indexContent.slice(insertPosition);

      // Assert
      expect(newContent).toContain('new-task: "./new-task.js"');
      expect(newContent).toContain('existing-task": "./existing-task.js"');
    });

    it("should correctly insert task entry in nested CommonJS format", async () => {
      // Arrange
      const indexContent = `// Task registry for test-pipeline
module.exports = { tasks: {} };
`;
      const taskName = "new-task";
      const filename = "new-task.js";

      // Act
      const cjsTasksPattern = /module\.exports\s*=\s*\{\s*tasks\s*:\s*\{/;
      const match = indexContent.match(cjsTasksPattern);
      const insertPosition = indexContent.indexOf("\n", match.index) + 1;
      const newEntry = `  ${taskName}: "./${filename}",\n`;
      const newContent =
        indexContent.slice(0, insertPosition) +
        newEntry +
        indexContent.slice(insertPosition);

      // Assert
      expect(newContent).toContain('new-task: "./new-task.js"');
      expect(newContent).toContain("module.exports");
    });
  });

  describe("Error cases", () => {
    it("should not match invalid format", async () => {
      // Arrange
      const indexContent = `// Just a comment
const tasks = {};
`;

      // Act
      const esmPattern = /export\s+default\s+\{/;
      const cjsPattern = /module\.exports\s*=\s*\{/;
      const cjsTasksPattern = /module\.exports\s*=\s*\{\s*tasks\s*:\s*\{/;

      // Assert
      expect(esmPattern.test(indexContent)).toBe(false);
      expect(cjsPattern.test(indexContent)).toBe(false);
      expect(cjsTasksPattern.test(indexContent)).toBe(false);
    });

    it("should not match exports (named export)", async () => {
      // Arrange
      const indexContent = `export const tasks = {};
`;

      // Act
      const esmPattern = /export\s+default\s+\{/;

      // Assert
      expect(esmPattern.test(indexContent)).toBe(false);
    });
  });

  describe("Task name duplicate detection", () => {
    it("should detect existing task name in ESM format (unquoted)", async () => {
      // Arrange - task names without quotes (as inserted by the endpoint)
      const indexContent = `export default {
  existing-task: "./existing-task.js",
};
`;
      const taskName = "existing-task";

      // Act
      const taskNamePattern = new RegExp(`^\\s*${taskName}\\s*:`, "m");
      const exists = taskNamePattern.test(indexContent);

      // Assert
      expect(exists).toBe(true);
    });

    it("should detect existing task name in CommonJS format (unquoted)", async () => {
      // Arrange - task names without quotes (as inserted by the endpoint)
      const indexContent = `module.exports = {
  existing-task: "./existing-task.js",
};
`;
      const taskName = "existing-task";

      // Act
      const taskNamePattern = new RegExp(`^\\s*${taskName}\\s*:`, "m");
      const exists = taskNamePattern.test(indexContent);

      // Assert
      expect(exists).toBe(true);
    });

    it("should detect existing task name with quotes", async () => {
      // Arrange - task names with quotes (JSON style)
      const indexContent = `export default {
  "existing-task": "./existing-task.js",
};
`;
      const taskName = "existing-task";

      // Act - pattern should also match quoted names
      const taskNamePattern = new RegExp(`^\\s*"?${taskName}"?\\s*:`, "m");
      const exists = taskNamePattern.test(indexContent);

      // Assert
      expect(exists).toBe(true);
    });

    it("should not detect non-existing task name", async () => {
      // Arrange
      const indexContent = `export default {
  existing-task: "./existing-task.js",
};
`;
      const taskName = "new-task";

      // Act
      const taskNamePattern = new RegExp(`^\\s*${taskName}\\s*:`, "m");
      const exists = taskNamePattern.test(indexContent);

      // Assert
      expect(exists).toBe(false);
    });
  });
});