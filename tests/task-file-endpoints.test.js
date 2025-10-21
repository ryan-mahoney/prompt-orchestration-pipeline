import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { startServer } from "../src/ui/server.js";

describe("Task File Endpoints - Single Lifecycle", () => {
  let server;
  let baseUrl;
  let tempDir;
  let testDataDir;

  beforeEach(async () => {
    // Create a temporary directory for testing
    tempDir = await fs.mkdtemp(
      path.join(tmpdir(), "task-file-endpoints-test-")
    );
    testDataDir = path.join(tempDir, "data");

    // Create the pipeline-data structure
    await fs.mkdir(path.join(testDataDir, "pipeline-data"), {
      recursive: true,
    });
    await fs.mkdir(path.join(testDataDir, "pipeline-data", "current"), {
      recursive: true,
    });
    await fs.mkdir(path.join(testDataDir, "pipeline-data", "complete"), {
      recursive: true,
    });
    await fs.mkdir(path.join(testDataDir, "pipeline-data", "rejected"), {
      recursive: true,
    });

    // Start server with test data directory
    const serverResult = await startServer({
      dataDir: testDataDir,
      port: 0, // Use ephemeral port
    });
    baseUrl = serverResult.url;
    server = serverResult.server;
  });

  afterEach(async () => {
    // Clean up server
    if (server && server.close) {
      await new Promise((resolve) => server.close(resolve));
    }

    // Clean up temp directory
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  describe("GET /api/jobs/:jobId/tasks/:taskId/files", () => {
    it("should list files from current lifecycle when job exists in current", async () => {
      // Arrange
      const jobId = "current-job-123";
      const taskId = "analysis";
      const type = "artifacts";

      // Create job directory in current
      const jobDir = path.join(testDataDir, "pipeline-data", "current", jobId);
      const taskDir = path.join(jobDir, "tasks", taskId, type);
      const filesDir = path.join(jobDir, "files", type);
      await fs.mkdir(taskDir, { recursive: true });
      await fs.mkdir(filesDir, { recursive: true });

      // Create test files
      await fs.writeFile(
        path.join(taskDir, "output.json"),
        '{"result": "success"}'
      );
      await fs.writeFile(path.join(taskDir, "data.txt"), "test content");

      // Act
      const response = await fetch(
        `${baseUrl}/api/jobs/${jobId}/tasks/${taskId}/files?type=${type}`,
        {
          headers: { Connection: "close" },
        }
      );

      // Assert
      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.ok).toBe(true);
      expect(data.data.files).toHaveLength(2);
      expect(data.data.files.map((f) => f.name)).toEqual(
        expect.arrayContaining(["output.json", "data.txt"])
      );
      expect(data.data.jobId).toBe(jobId);
      expect(data.data.taskId).toBe(taskId);
      expect(data.data.type).toBe(type);
    });

    it("should list files from complete lifecycle when job exists only in complete", async () => {
      // Arrange
      const jobId = "complete-job-456";
      const taskId = "processing";
      const type = "logs";

      // Create job directory in complete only
      const jobDir = path.join(testDataDir, "pipeline-data", "complete", jobId);
      const taskDir = path.join(jobDir, "tasks", taskId, type);
      const filesDir = path.join(jobDir, "files", type);
      await fs.mkdir(taskDir, { recursive: true });
      await fs.mkdir(filesDir, { recursive: true });

      // Create test files
      await fs.writeFile(
        path.join(taskDir, "execution.log"),
        "Process started\nProcess completed"
      );

      // Act
      const response = await fetch(
        `${baseUrl}/api/jobs/${jobId}/tasks/${taskId}/files?type=${type}`,
        {
          headers: { Connection: "close" },
        }
      );

      // Assert
      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.ok).toBe(true);
      expect(data.data.files).toHaveLength(1);
      expect(data.data.files[0].name).toBe("execution.log");
      expect(data.data.files[0].mime).toBe("text/plain");
    });

    it("should list files from rejected lifecycle when job exists only in rejected", async () => {
      // Arrange
      const jobId = "rejected-job-789";
      const taskId = "validation";
      const type = "tmp";

      // Create job directory in rejected only
      const jobDir = path.join(testDataDir, "pipeline-data", "rejected", jobId);
      const taskDir = path.join(jobDir, "tasks", taskId, type);
      await fs.mkdir(taskDir, { recursive: true });

      // Create test files
      await fs.writeFile(
        path.join(taskDir, "temp.dat"),
        Buffer.from([0x01, 0x02, 0x03])
      );

      // Act
      const response = await fetch(
        `${baseUrl}/api/jobs/${jobId}/tasks/${taskId}/files?type=${type}`,
        {
          headers: { Connection: "close" },
        }
      );

      // Assert
      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.ok).toBe(true);
      expect(data.data.files).toHaveLength(1);
      expect(data.data.files[0].name).toBe("temp.dat");
      expect(data.data.files[0].mime).toBe("application/octet-stream");
    });

    it("should prefer current over complete when job exists in both", async () => {
      // Arrange
      const jobId = "duplicate-job";
      const taskId = "analysis";
      const type = "artifacts";

      // Create job directory in both current and complete
      const currentJobDir = path.join(
        testDataDir,
        "pipeline-data",
        "current",
        jobId
      );
      const completeJobDir = path.join(
        testDataDir,
        "pipeline-data",
        "complete",
        jobId
      );

      const currentTaskDir = path.join(currentJobDir, "tasks", taskId, type);
      const completeTaskDir = path.join(completeJobDir, "tasks", taskId, type);

      await fs.mkdir(currentTaskDir, { recursive: true });
      await fs.mkdir(completeTaskDir, { recursive: true });

      // Different files in each location
      await fs.writeFile(
        path.join(currentTaskDir, "current-output.json"),
        '{"current": true}'
      );
      await fs.writeFile(
        path.join(completeTaskDir, "complete-output.json"),
        '{"complete": true}'
      );

      // Act
      const response = await fetch(
        `${baseUrl}/api/jobs/${jobId}/tasks/${taskId}/files?type=${type}`,
        {
          headers: { Connection: "close" },
        }
      );

      // Assert
      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.ok).toBe(true);
      expect(data.data.files).toHaveLength(1);
      expect(data.data.files[0].name).toBe("current-output.json");
    });

    it("should return empty list when job not found", async () => {
      // Arrange
      const jobId = "nonexistent-job";
      const taskId = "analysis";
      const type = "artifacts";

      // Act
      const response = await fetch(
        `${baseUrl}/api/jobs/${jobId}/tasks/${taskId}/files?type=${type}`,
        {
          headers: { Connection: "close" },
        }
      );

      // Assert
      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.ok).toBe(true);
      expect(data.data.files).toEqual([]);
      expect(data.data.jobId).toBe(jobId);
      expect(data.data.taskId).toBe(taskId);
      expect(data.data.type).toBe(type);
    });

    it("should return empty list when task directory does not exist", async () => {
      // Arrange
      const jobId = "current-job-123";
      const taskId = "nonexistent-task";
      const type = "artifacts";

      // Create job directory but no task directory
      const jobDir = path.join(testDataDir, "pipeline-data", "current", jobId);
      await fs.mkdir(jobDir, { recursive: true });

      // Act
      const response = await fetch(
        `${baseUrl}/api/jobs/${jobId}/tasks/${taskId}/files?type=${type}`,
        {
          headers: { Connection: "close" },
        }
      );

      // Assert
      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.ok).toBe(true);
      expect(data.data.files).toEqual([]);
    });

    it("should reject invalid type parameter", async () => {
      // Arrange
      const jobId = "current-job-123";
      const taskId = "analysis";
      const type = "invalid-type";

      // Act
      const response = await fetch(
        `${baseUrl}/api/jobs/${jobId}/tasks/${taskId}/files?type=${type}`,
        {
          headers: { Connection: "close" },
        }
      );

      // Assert
      expect(response.ok).toBe(false);
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("bad_request");
      expect(data.message).toContain(
        "type must be one of: artifacts, logs, tmp"
      );
    });
  });

  describe("GET /api/jobs/:jobId/tasks/:taskId/file", () => {
    it("should serve file from current lifecycle when job exists in current", async () => {
      // Arrange
      const jobId = "current-job-123";
      const taskId = "analysis";
      const type = "artifacts";
      const filename = "output.json";
      const content = '{"result": "success", "data": [1, 2, 3]}';

      // Create job directory in current
      const jobDir = path.join(testDataDir, "pipeline-data", "current", jobId);
      const taskDir = path.join(jobDir, "tasks", taskId, type);
      const filesDir = path.join(jobDir, "files", type);
      await fs.mkdir(taskDir, { recursive: true });
      await fs.mkdir(filesDir, { recursive: true });

      // Create test file in both task-scoped (for list tests) and job-scoped (for file reads)
      await fs.writeFile(path.join(taskDir, filename), content);
      await fs.writeFile(path.join(filesDir, filename), content);

      // Act
      const response = await fetch(
        `${baseUrl}/api/jobs/${jobId}/tasks/${taskId}/file?type=${type}&filename=${filename}`,
        {
          headers: { Connection: "close" },
        }
      );

      // Assert
      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.ok).toBe(true);
      expect(data.content).toBe(content);
      expect(data.encoding).toBe("utf8");
      expect(data.mime).toBe("application/json");
      expect(data.path).toBe(`tasks/${taskId}/${type}/${filename}`);
      expect(data.jobId).toBe(jobId);
      expect(data.taskId).toBe(taskId);
      expect(data.type).toBe(type);
    });

    it("should serve file from complete lifecycle when job exists only in complete", async () => {
      // Arrange
      const jobId = "complete-job-456";
      const taskId = "processing";
      const type = "logs";
      const filename = "execution.log";
      const content = "Process started\nProcess completed";

      // Create job directory in complete only
      const jobDir = path.join(testDataDir, "pipeline-data", "complete", jobId);
      const taskDir = path.join(jobDir, "tasks", taskId, type);
      const filesDir = path.join(jobDir, "files", type);
      await fs.mkdir(taskDir, { recursive: true });
      await fs.mkdir(filesDir, { recursive: true });

      // Create test file in both task-scoped (for list tests) and job-scoped (for file reads)
      await fs.writeFile(path.join(taskDir, filename), content);
      await fs.writeFile(path.join(filesDir, filename), content);

      // Act
      const response = await fetch(
        `${baseUrl}/api/jobs/${jobId}/tasks/${taskId}/file?type=${type}&filename=${filename}`,
        {
          headers: { Connection: "close" },
        }
      );

      // Assert
      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.ok).toBe(true);
      expect(data.content).toBe(content);
      expect(data.encoding).toBe("utf8");
      expect(data.mime).toBe("text/plain");
    });

    it("should serve binary file with base64 encoding", async () => {
      // Arrange
      const jobId = "current-job-123";
      const taskId = "analysis";
      const type = "artifacts";
      const filename = "binary.dat";
      const binaryContent = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff]);

      // Create job directory in current
      const jobDir = path.join(testDataDir, "pipeline-data", "current", jobId);
      const taskDir = path.join(jobDir, "tasks", taskId, type);
      const filesDir = path.join(jobDir, "files", type);
      await fs.mkdir(taskDir, { recursive: true });
      await fs.mkdir(filesDir, { recursive: true });

      // Create test file in both task-scoped (for list tests) and job-scoped (for file reads)
      await fs.writeFile(path.join(taskDir, filename), binaryContent);
      await fs.writeFile(path.join(filesDir, filename), binaryContent);

      // Act
      const response = await fetch(
        `${baseUrl}/api/jobs/${jobId}/tasks/${taskId}/file?type=${type}&filename=${filename}`,
        {
          headers: { Connection: "close" },
        }
      );

      // Assert
      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.ok).toBe(true);
      expect(data.encoding).toBe("base64");
      expect(data.mime).toBe("application/octet-stream");
      expect(data.content).toBe(binaryContent.toString("base64"));
    });

    it("should prefer current over complete when job exists in both", async () => {
      // Arrange
      const jobId = "duplicate-job";
      const taskId = "analysis";
      const type = "artifacts";
      const filename = "output.json";
      const currentContent = '{"current": true}';
      const completeContent = '{"complete": true}';

      // Create job directory in both current and complete
      const currentJobDir = path.join(
        testDataDir,
        "pipeline-data",
        "current",
        jobId
      );
      const completeJobDir = path.join(
        testDataDir,
        "pipeline-data",
        "complete",
        jobId
      );

      const currentTaskDir = path.join(currentJobDir, "tasks", taskId, type);
      const completeTaskDir = path.join(completeJobDir, "tasks", taskId, type);
      const currentFilesDir = path.join(currentJobDir, "files", type);
      const completeFilesDir = path.join(completeJobDir, "files", type);

      await fs.mkdir(currentTaskDir, { recursive: true });
      await fs.mkdir(completeTaskDir, { recursive: true });
      await fs.mkdir(currentFilesDir, { recursive: true });
      await fs.mkdir(completeFilesDir, { recursive: true });

      // Different files in each location
      await fs.writeFile(path.join(currentTaskDir, filename), currentContent);
      await fs.writeFile(path.join(completeTaskDir, filename), completeContent);
      await fs.writeFile(path.join(currentFilesDir, filename), currentContent);
      await fs.writeFile(
        path.join(completeFilesDir, filename),
        completeContent
      );

      // Act
      const response = await fetch(
        `${baseUrl}/api/jobs/${jobId}/tasks/${taskId}/file?type=${type}&filename=${filename}`,
        {
          headers: { Connection: "close" },
        }
      );

      // Assert
      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.ok).toBe(true);
      expect(data.content).toBe(currentContent);
    });

    it("should return 404 when job not found", async () => {
      // Arrange
      const jobId = "nonexistent-job";
      const taskId = "analysis";
      const type = "artifacts";
      const filename = "output.json";

      // Act
      const response = await fetch(
        `${baseUrl}/api/jobs/${jobId}/tasks/${taskId}/file?type=${type}&filename=${filename}`,
        {
          headers: { Connection: "close" },
        }
      );

      // Assert
      expect(response.ok).toBe(false);
      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe("not_found");
      expect(data.message).toBe("Job not found");
    });

    it("should return 404 when file does not exist", async () => {
      // Arrange
      const jobId = "current-job-123";
      const taskId = "analysis";
      const type = "artifacts";
      const filename = "nonexistent.json";

      // Create job directory but no file
      const jobDir = path.join(testDataDir, "pipeline-data", "current", jobId);
      const taskDir = path.join(jobDir, "tasks", taskId, type);
      await fs.mkdir(taskDir, { recursive: true });

      // Act
      const response = await fetch(
        `${baseUrl}/api/jobs/${jobId}/tasks/${taskId}/file?type=${type}&filename=${filename}`,
        {
          headers: { Connection: "close" },
        }
      );

      // Assert
      expect(response.ok).toBe(false);
      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe("not_found");
      expect(data.message).toBe("File not found");
    });
  });

  describe("Path Jail Security", () => {
    it("should reject path traversal attempts in filename", async () => {
      // Arrange
      const jobId = "current-job-123";
      const taskId = "analysis";
      const type = "artifacts";
      const filename = "../../../etc/passwd";

      // Create job directory
      const jobDir = path.join(testDataDir, "pipeline-data", "current", jobId);
      const taskDir = path.join(jobDir, "tasks", taskId, type);
      await fs.mkdir(taskDir, { recursive: true });

      // Act
      const response = await fetch(
        `${baseUrl}/api/jobs/${jobId}/tasks/${taskId}/file?type=${type}&filename=${encodeURIComponent(filename)}`,
        {
          headers: { Connection: "close" },
        }
      );

      // Assert
      expect(response.ok).toBe(false);
      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toBe("forbidden");
      expect(data.message).toBe("Path validation failed");
    });

    it("should reject absolute paths in filename", async () => {
      // Arrange
      const jobId = "current-job-123";
      const taskId = "analysis";
      const type = "artifacts";
      const filename = "/etc/passwd";

      // Create job directory
      const jobDir = path.join(testDataDir, "pipeline-data", "current", jobId);
      const taskDir = path.join(jobDir, "tasks", taskId, type);
      await fs.mkdir(taskDir, { recursive: true });

      // Act
      const response = await fetch(
        `${baseUrl}/api/jobs/${jobId}/tasks/${taskId}/file?type=${type}&filename=${encodeURIComponent(filename)}`,
        {
          headers: { Connection: "close" },
        }
      );

      // Assert
      expect(response.ok).toBe(false);
      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toBe("forbidden");
      expect(data.message).toBe("Path validation failed");
    });

    it("should reject Windows drive paths in filename", async () => {
      // Arrange
      const jobId = "current-job-123";
      const taskId = "analysis";
      const type = "artifacts";
      const filename = "C:\\Windows\\System32\\config\\sam";

      // Create job directory
      const jobDir = path.join(testDataDir, "pipeline-data", "current", jobId);
      const taskDir = path.join(jobDir, "tasks", taskId, type);
      await fs.mkdir(taskDir, { recursive: true });

      // Act
      const response = await fetch(
        `${baseUrl}/api/jobs/${jobId}/tasks/${taskId}/file?type=${type}&filename=${encodeURIComponent(filename)}`,
        {
          headers: { Connection: "close" },
        }
      );

      // Assert
      expect(response.ok).toBe(false);
      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toBe("forbidden");
      expect(data.message).toBe("Path validation failed");
    });

    it("should reject backslash paths in filename", async () => {
      // Arrange
      const jobId = "current-job-123";
      const taskId = "analysis";
      const type = "artifacts";
      const filename = "..\\..\\windows\\system32\\drivers\\etc\\hosts";

      // Create job directory
      const jobDir = path.join(testDataDir, "pipeline-data", "current", jobId);
      const taskDir = path.join(jobDir, "tasks", taskId, type);
      await fs.mkdir(taskDir, { recursive: true });

      // Act
      const response = await fetch(
        `${baseUrl}/api/jobs/${jobId}/tasks/${taskId}/file?type=${type}&filename=${encodeURIComponent(filename)}`,
        {
          headers: { Connection: "close" },
        }
      );

      // Assert
      expect(response.ok).toBe(false);
      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toBe("forbidden");
      expect(data.message).toBe("Path validation failed");
    });
  });

  describe("Parameter Validation", () => {
    it("should reject missing jobId parameter", async () => {
      // Act
      const response = await fetch(
        `${baseUrl}/api/jobs//tasks/analysis/files?type=artifacts`,
        {
          headers: { Connection: "close" },
        }
      );

      // Assert
      expect(response.ok).toBe(false);
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("bad_request");
      expect(data.message).toBe("Invalid path format");
    });

    it("should reject missing taskId parameter", async () => {
      // Act
      const response = await fetch(
        `${baseUrl}/api/jobs/test-job/tasks//files?type=artifacts`,
        {
          headers: { Connection: "close" },
        }
      );

      // Assert
      expect(response.ok).toBe(false);
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("bad_request");
      expect(data.message).toBe("Invalid path format");
    });

    it("should reject missing filename parameter for file endpoint", async () => {
      // Act
      const response = await fetch(
        `${baseUrl}/api/jobs/test-job/tasks/analysis/file?type=artifacts`,
        {
          headers: { Connection: "close" },
        }
      );

      // Assert
      expect(response.ok).toBe(false);
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("bad_request");
      expect(data.message).toBe("filename is required");
    });
  });
});
