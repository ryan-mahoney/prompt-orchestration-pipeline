import fs from "node:fs/promises";
import path from "node:path";

/**
 * Creates a task-scoped file I/O interface that manages file operations
 * and automatically updates tasks-status.json with file tracking.
 *
 * @param {Object} config - Configuration object
 * @param {string} config.workDir - Base working directory (e.g., /path/to/pipeline-data/current/jobId)
 * @param {string} config.taskName - Name of the current task
 * @param {Function} config.getStage - Function that returns current stage name
 * @param {string} config.statusPath - Path to tasks-status.json file
 * @returns {Object} File I/O interface with curried functions
 */

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

export function createTaskFileIO({ workDir, taskName, getStage, statusPath }) {
  const taskDir = path.join(workDir, "tasks", taskName);

  // New directory structure: {workDir}/files/{type}
  const filesRoot = path.join(workDir, "files");
  const artifactsDir = path.join(filesRoot, "artifacts");
  const logsDir = path.join(filesRoot, "logs");
  const tmpDir = path.join(filesRoot, "tmp");

  /**
   * Updates tasks-status.json with file information, ensuring de-duplication
   */
  async function updateStatusWithFiles(fileType, fileName) {
    try {
      const statusContent = await fs.readFile(statusPath, "utf8");
      const status = JSON.parse(statusContent);

      // Initialize files object if it doesn't exist
      if (!status.files) {
        status.files = { artifacts: [], logs: [], tmp: [] };
      }

      // Initialize task files if they don't exist
      if (!status.tasks[taskName].files) {
        status.tasks[taskName].files = { artifacts: [], logs: [], tmp: [] };
      }

      // Add to job-level files array (de-duped)
      const jobArray = status.files[fileType];
      if (!jobArray.includes(fileName)) {
        jobArray.push(fileName);
      }

      // Add to task-level files array (de-duped)
      const taskArray = status.tasks[taskName].files[fileType];
      if (!taskArray.includes(fileName)) {
        taskArray.push(fileName);
      }

      // Write back to file atomically
      await atomicWrite(statusPath, JSON.stringify(status, null, 2));
    } catch (error) {
      // If status file doesn't exist or is invalid, we'll log but not fail
      console.warn(
        `Failed to update status with file ${fileName}:`,
        error.message
      );
    }
  }

  /**
   * Atomic write helper
   */
  async function atomicWrite(filePath, data) {
    const tmpPath = filePath + ".tmp";
    await fs.writeFile(tmpPath, data);
    await fs.rename(tmpPath, filePath);
  }

  /**
   * Generic write function that handles different modes
   */
  async function writeFile(dirPath, fileName, content, mode = "replace") {
    await ensureDir(dirPath);
    const filePath = path.join(dirPath, fileName);

    if (mode === "append") {
      await fs.appendFile(filePath, content);
    } else {
      await atomicWrite(filePath, content);
    }

    return filePath;
  }

  /**
   * Generic read function
   */
  async function readFile(dirPath, fileName) {
    const filePath = path.join(dirPath, fileName);
    return await fs.readFile(filePath, "utf8");
  }

  // Return curried functions for each file type
  return {
    /**
     * Write an artifact file
     * @param {string} name - File name
     * @param {string} content - File content
     * @param {Object} options - Options object
     * @param {string} options.mode - "replace" (default) or "append"
     */
    async writeArtifact(name, content, options = {}) {
      const filePath = await writeFile(
        artifactsDir,
        name,
        content,
        options.mode || "replace"
      );
      await updateStatusWithFiles("artifacts", name);
      return filePath;
    },

    /**
     * Write a log file
     * @param {string} name - File name
     * @param {string} content - Log content
     * @param {Object} options - Options object
     * @param {string} options.mode - "append" (default) or "replace"
     */
    async writeLog(name, content, options = {}) {
      const filePath = await writeFile(
        logsDir,
        name,
        content,
        options.mode || "append"
      );
      await updateStatusWithFiles("logs", name);
      return filePath;
    },

    /**
     * Write a temporary file
     * @param {string} name - File name
     * @param {string} content - File content
     * @param {Object} options - Options object
     * @param {string} options.mode - "replace" (default) or "append"
     */
    async writeTmp(name, content, options = {}) {
      const filePath = await writeFile(
        tmpDir,
        name,
        content,
        options.mode || "replace"
      );
      await updateStatusWithFiles("tmp", name);
      return filePath;
    },

    /**
     * Read an artifact file
     * @param {string} name - File name
     * @returns {string} File content
     */
    async readArtifact(name) {
      return await readFile(artifactsDir, name);
    },

    /**
     * Read a log file
     * @param {string} name - File name
     * @returns {string} File content
     */
    async readLog(name) {
      return await readFile(logsDir, name);
    },

    /**
     * Read a temporary file
     * @param {string} name - File name
     * @returns {string} File content
     */
    async readTmp(name) {
      return await readFile(tmpDir, name);
    },

    /**
     * Get the task directory path
     * @returns {string} Task directory path
     */
    getTaskDir() {
      return taskDir;
    },

    /**
     * Get the current stage name
     * @returns {string} Current stage name
     */
    getCurrentStage() {
      return getStage();
    },
  };
}
