// ESM
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import chokidar from "chokidar";
import { spawn } from "node:child_process";
import url from "node:url";
import { validateSeed, formatValidationErrors } from "./validation.js";
import { getConfig } from "./config.js";
import { withRetry } from "./retry.js";

export class Orchestrator {
  constructor({ paths, pipelineDefinition }) {
    this.paths = paths;
    this.pipelineDefinition = pipelineDefinition;
    this.runningProcesses = new Map();
    this.watcher = null;
  }

  async start() {
    await fs.mkdir(this.paths.pending, { recursive: true });
    await fs.mkdir(this.paths.current, { recursive: true });
    await fs.mkdir(this.paths.complete, { recursive: true });

    for (const name of await this.#listDirs(this.paths.current)) {
      this.#ensureRunner(name);
    }

    const config = getConfig();
    this.watcher = chokidar
      .watch(path.join(this.paths.pending, "*-seed.json"), {
        awaitWriteFinish: {
          stabilityThreshold: config.orchestrator.watchStabilityThreshold,
          pollInterval: config.orchestrator.watchPollInterval,
        },
      })
      .on("add", (p) => this.#onSeed(p));

    return this;
  }

  async stop() {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }

    for (const [name, info] of this.runningProcesses) {
      info.process.kill("SIGTERM");
    }

    // Skip the shutdown timeout in test environment
    if (process.env.NODE_ENV !== "test") {
      const config = getConfig();
      await new Promise((r) =>
        setTimeout(r, config.orchestrator.shutdownTimeout)
      );
    }

    for (const [name, info] of this.runningProcesses) {
      if (!info.process.killed) info.process.kill("SIGKILL");
    }

    this.runningProcesses.clear();
  }

  async #onSeed(seedPath) {
    const base = path.basename(seedPath);
    const name = base.replace(/-seed\.json$/, "");
    const workDir = path.join(this.paths.current, name);
    const lockFile = path.join(this.paths.current, `${name}.lock`);

    try {
      await fs.writeFile(lockFile, process.pid.toString(), { flag: "wx" });
    } catch (err) {
      if (err.code === "EEXIST") return;
      throw err;
    }

    try {
      try {
        await fs.mkdir(workDir, { recursive: false });
      } catch (err) {
        if (err.code === "EEXIST") return;
        throw err;
      }

      const seed = JSON.parse(await fs.readFile(seedPath, "utf8"));

      // Validate seed file structure
      const validation = validateSeed(seed);
      if (!validation.valid) {
        const errorMsg = formatValidationErrors(validation.errors);
        console.error(`Invalid seed file ${base}:\n${errorMsg}`);
        // Move invalid seed to a rejected directory for inspection
        const rejectedDir = path.join(
          path.dirname(this.paths.pending),
          "rejected"
        );
        await fs.mkdir(rejectedDir, { recursive: true });
        const rejectedPath = path.join(rejectedDir, base);
        await fs.rename(seedPath, rejectedPath);
        return;
      }

      const pipelineId = this.#makeId();

      await this.#atomicWrite(
        path.join(workDir, "seed.json"),
        JSON.stringify(seed, null, 2)
      );
      await this.#atomicWrite(
        path.join(workDir, "tasks-status.json"),
        JSON.stringify(
          {
            pipelineId,
            name,
            current: null,
            createdAt: new Date().toISOString(),
            tasks: {},
          },
          null,
          2
        )
      );

      await fs.mkdir(path.join(workDir, "tasks"), { recursive: true });

      this.#ensureRunner(name);
    } finally {
      try {
        await fs.unlink(lockFile);
      } catch {}
    }
  }

  #ensureRunner(name) {
    if (this.runningProcesses.has(name)) return;

    const config = getConfig();

    // Wrap process spawn in retry logic
    withRetry(() => this.#spawnRunner(name), {
      maxAttempts: config.orchestrator.processSpawnRetries,
      initialDelay: config.orchestrator.processSpawnRetryDelay,
      onRetry: ({ attempt, delay, error }) => {
        console.warn(
          `Failed to start pipeline ${name} (attempt ${attempt}): ${error.message}. Retrying in ${delay}ms...`
        );
      },
      shouldRetry: (error) => {
        // Don't retry if the error is due to missing files or invalid config
        const nonRetryableErrors = [
          "ENOENT",
          "EACCES",
          "MODULE_NOT_FOUND",
          "Invalid pipeline",
        ];
        return !nonRetryableErrors.some((msg) => error.message?.includes(msg));
      },
    }).catch((error) => {
      console.error(
        `Failed to start pipeline ${name} after ${config.orchestrator.processSpawnRetries} attempts:`,
        error
      );
      // Move to dead letter queue
      this.#moveToDeadLetter(name, error).catch((dlqError) => {
        console.error(`Failed to move ${name} to dead letter queue:`, dlqError);
      });
    });
  }

  #spawnRunner(name) {
    return new Promise((resolve, reject) => {
      const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
      const runnerPath = path.join(__dirname, "pipeline-runner.js");

      const env = {
        ...process.env,
        PO_ROOT: process.cwd(),
        PO_DATA_DIR: path.relative(
          process.cwd(),
          path.dirname(this.paths.pending)
        ),
        PO_CURRENT_DIR: this.paths.current,
        PO_COMPLETE_DIR: this.paths.complete,
        PO_CONFIG_DIR: path.join(process.cwd(), "pipeline-config"),
        PO_PIPELINE_PATH:
          this.pipelineDefinition?.__path ||
          path.join(process.cwd(), "pipeline-config", "pipeline.json"),
        PO_TASK_REGISTRY: path.join(
          process.cwd(),
          "pipeline-config",
          "tasks/index.js"
        ),
      };

      const child = spawn(process.execPath, [runnerPath, name], {
        stdio: ["ignore", "inherit", "inherit"],
        env,
        cwd: process.cwd(),
      });

      // Track if process started successfully
      let started = false;

      // Consider spawn successful after a short delay
      const startupTimeout = setTimeout(() => {
        started = true;
        resolve();
      }, 100);

      this.runningProcesses.set(name, {
        process: child,
        startedAt: new Date().toISOString(),
        name,
      });

      child.on("exit", (code, signal) => {
        clearTimeout(startupTimeout);
        this.runningProcesses.delete(name);
        if (code !== 0) {
          console.error(
            `Pipeline ${name} exited with code ${code}, signal ${signal}`
          );
        } else {
          console.log(`Pipeline ${name} completed successfully`);
        }
      });

      child.on("error", (err) => {
        clearTimeout(startupTimeout);
        this.runningProcesses.delete(name);
        if (!started) {
          reject(err);
        } else {
          console.error(`Pipeline ${name} encountered error:`, err);
        }
      });
    });
  }

  async #moveToDeadLetter(name, error) {
    const workDir = path.join(this.paths.current, name);
    const deadLetterDir = path.join(
      path.dirname(this.paths.pending),
      "dead-letter"
    );
    await fs.mkdir(deadLetterDir, { recursive: true });

    const errorLog = {
      name,
      error: {
        message: error.message,
        stack: error.stack,
      },
      timestamp: new Date().toISOString(),
      attempts: getConfig().orchestrator.processSpawnRetries,
    };

    await this.#atomicWrite(
      path.join(deadLetterDir, `${name}-error.json`),
      JSON.stringify(errorLog, null, 2)
    );

    // Move the work directory to dead letter
    const deadLetterWorkDir = path.join(deadLetterDir, name);
    try {
      await fs.rename(workDir, deadLetterWorkDir);
    } catch (err) {
      // If rename fails, try to copy
      console.warn(`Could not move ${name} to dead letter, attempting copy`);
    }
  }

  async #listDirs(dir) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch (err) {
      if (err.code === "ENOENT") return [];
      throw err;
    }
  }

  #makeId() {
    return (
      "pl-" +
      new Date().toISOString().replaceAll(/[:.]/g, "-") +
      "-" +
      crypto.randomBytes(3).toString("hex")
    );
  }

  async #atomicWrite(file, data) {
    const tmp = file + ".tmp";
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, file);
  }
}
