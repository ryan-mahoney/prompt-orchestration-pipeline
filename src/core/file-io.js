import fs from "node:fs/promises";
import path from "node:path";
import { writeJobStatus } from "./status-writer.js";
import { LogEvent, LogFileExtension } from "../config/log-events.js";

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
    const jobDir = path.dirname(statusPath);
    await writeJobStatus(jobDir, (snapshot) => {
      snapshot.files ||= { artifacts: [], logs: [], tmp: [] };
      snapshot.tasks ||= {};
      snapshot.tasks[taskName] ||= {};
      snapshot.tasks[taskName].files ||= { artifacts: [], logs: [], tmp: [] };

      const jobArray = snapshot.files[fileType];
      if (!jobArray.includes(fileName)) {
        jobArray.push(fileName);
      }

      const taskArray = snapshot.tasks[taskName].files[fileType];
      if (!taskArray.includes(fileName)) {
        taskArray.push(fileName);
      }

      return snapshot;
    });
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
        options.mode || "replace"
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

/**
 * Generates a standardized log filename following the convention {taskName}-{stage}-{event}.{ext}
 * @param {string} taskName - Name of the task
 * @param {string} stage - Stage name or identifier
 * @param {string} event - Event type from LogEvent constants
 * @param {string} ext - File extension from LogFileExtension constants
 * @returns {string} Formatted log filename
 */
export function generateLogName(
  taskName,
  stage,
  event,
  ext = LogFileExtension.TEXT
) {
  if (!taskName || !stage || !event || !ext) {
    throw new Error(
      "All parameters (taskName, stage, event, ext) are required for generateLogName"
    );
  }
  return `${taskName}-${stage}-${event}.${ext}`;
}

/**
 * Parses a log filename to extract taskName, stage, event, and extension
 * @param {string} fileName - Log filename to parse
 * @returns {Object|null} Parsed components or null if invalid format
 */
export function parseLogName(fileName) {
  if (typeof fileName !== "string") {
    return null;
  }

  // Match pattern: taskName-stage-event.ext
  const match = fileName.match(
    /^(?<taskName>[^-]+)-(?<stage>[^-]+)-(?<event>[^.]+)\.(?<ext>.+)$/
  );
  if (!match) {
    return null;
  }

  const { taskName, stage, event, ext } = match.groups;
  return { taskName, stage, event, ext };
}

/**
 * Generates a glob pattern for matching log files with specific components
 * @param {string} taskName - Task name (optional, use "*" for wildcard)
 * @param {string} stage - Stage name (optional, use "*" for wildcard)
 * @param {string} event - Event type (optional, use "*" for wildcard)
 * @param {string} ext - File extension (optional, use "*" for wildcard)
 * @returns {string} Glob pattern for file matching
 */
export function getLogPattern(
  taskName = "*",
  stage = "*",
  event = "*",
  ext = "*"
) {
  return `${taskName}-${stage}-${event}.${ext}`;
}

/**
 * Validates that a log filename follows the standardized naming convention
 * @param {string} fileName - Log filename to validate
 * @returns {boolean} True if valid, false otherwise
 */
export function validateLogName(fileName) {
  return parseLogName(fileName) !== null;
}
