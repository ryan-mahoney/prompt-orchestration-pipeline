// ESM
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import chokidar from "chokidar";
import { spawn } from "node:child_process";
import url from "node:url";

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

    this.watcher = chokidar
      .watch(path.join(this.paths.pending, "*-seed.json"), {
        awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
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

    await new Promise((r) => setTimeout(r, 2000));

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
      const pipelineId = this.#makeId();

      await this.#atomicWrite(
        path.join(workDir, "seed.json"),
        JSON.stringify(seed, null, 2)
      );
      await this.#atomicWrite(
        path.join(workDir, "tasks-status.json"),
        JSON.stringify(
          { pipelineId, name, current: null, createdAt: new Date().toISOString(), tasks: {} },
          null,
          2
        )
      );

      await fs.mkdir(path.join(workDir, "tasks"), { recursive: true });

      this.#ensureRunner(name);
    } finally {
      try { await fs.unlink(lockFile); } catch {}
    }
  }

  #ensureRunner(name) {
    if (this.runningProcesses.has(name)) return;

    const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
    const runnerPath = path.join(__dirname, "pipeline-runner.js");

    const env = {
      ...process.env,
      PO_ROOT: process.cwd(),
      PO_DATA_DIR: path.relative(process.cwd(), path.dirname(this.paths.pending)),
      PO_CURRENT_DIR: this.paths.current,
      PO_COMPLETE_DIR: this.paths.complete,
      PO_CONFIG_DIR: path.join(process.cwd(), "pipeline-config"),
      PO_PIPELINE_PATH: this.pipelineDefinition?.__path || path.join(process.cwd(), "pipeline-config", "pipeline.json"),
      PO_TASK_REGISTRY: path.join(process.cwd(), "pipeline-config", "tasks/index.js"),
    };

    const child = spawn(process.execPath, [runnerPath, name], {
      stdio: ["ignore", "inherit", "inherit"],
      env,
      cwd: process.cwd(),
    });

    this.runningProcesses.set(name, { process: child, startedAt: new Date().toISOString(), name });

    child.on("exit", (code, signal) => {
      this.runningProcesses.delete(name);
      if (code !== 0) {
        console.error(`Pipeline ${name} exited with code ${code}, signal ${signal}`);
      } else {
        console.log(`Pipeline ${name} completed successfully`);
      }
    });

    child.on("error", (err) => {
      console.error(`Failed to start pipeline ${name}:`, err);
      this.runningProcesses.delete(name);
    });
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
